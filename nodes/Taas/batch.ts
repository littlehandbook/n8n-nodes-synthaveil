import type { IDataObject, INode } from 'n8n-workflow';

import { L3_BATCH_MAX_RECORDS, V1_BATCH_MAX_RECORDS } from '../../src/constants';
import { coerceRecordValues } from './coerce';
import { applyRequestHints } from './requestHints';
import { normaliseFieldMappings, type FieldMapping } from './tokenize';

/**
 * Batch tokenisation helpers — pure and side-effect-free so the chunking,
 * determinism (INV-001) and fail-safe (P4) tests exercise them directly. The
 * node-execution glue (fan-out, response→item mapping, error surfacing) lives in
 * `Taas.node.ts`.
 *
 * ONE `policy`/`country`/`scope_id` applies to every record in a request
 * (`docs/api/openapi.yaml` BatchRequest). The shared policy therefore lists ALL
 * mapped fields; each record carries only the fields present (and non-empty) on
 * its own item — P4 fail-safe: an unmapped field never reaches the API.
 */

export interface BatchParams {
  fields: FieldMapping[];
  /** Locale hint (GB/IE/US/CA); omitted from the body when empty. */
  country?: string;
  /** Determinism scope; omitted from the body when empty. */
  scopeId?: string;
  /** Execution id, present only under `Consistency: Every run` (P5 Task 5.2);
   *  ONE run_id covers the whole batch, same as `scopeId`. */
  runId?: string;
}

/** The request body, matching `docs/api/openapi.yaml` BatchRequest. */
export interface BatchBody {
  records: Record<string, string>[];
  policy: { fields: Record<string, { method: string }> };
  country?: string;
  scope_id?: string;
  run_id?: string;
}

/** Sentinel in `sendOffsets` for a record excluded from the outbound request. */
export const EXCLUDED_OFFSET = -1;

export interface BuildBatchResult {
  body: BatchBody;
  /** Notes about fields skipped because they were empty on some item. */
  warnings: string[];
  /**
   * Chunk offset → index in `body.records`, or `EXCLUDED_OFFSET` when the
   * record was all-empty and NOT sent. Response slots align with the OUTBOUND
   * records, so consumers must read `results[sendOffsets[offset]]`, never
   * `results[offset]` (review RF-2).
   */
  sendOffsets: number[];
  /** Operator-facing error for items excluded as all-empty. */
  emptyRecordMessage: string;
}

/** True when any mapped method targets an L3 (realistic-data) synthesiser. */
export function mappingsUseL3(fields: FieldMapping[]): boolean {
  return fields.some((f) => typeof f.method === 'string' && f.method.startsWith('l3.'));
}

/**
 * Effective per-request record cap: the L3 cap when any field is L3, else the V1
 * cap. A non-positive or non-finite requested size falls back to the V1 cap.
 */
export function effectiveBatchSize(requested: number, hasL3: boolean): number {
  const cap = hasL3 ? L3_BATCH_MAX_RECORDS : V1_BATCH_MAX_RECORDS;
  const bounded =
    Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : V1_BATCH_MAX_RECORDS;
  return Math.min(bounded, cap);
}

export interface ItemChunk<T> {
  items: T[];
  /** Global index (in the original array) of this chunk's first item. */
  startIndex: number;
}

/** Split items into order-preserving chunks of at most the effective batch size. */
export function chunkItems<T>(items: T[], requestedSize: number, hasL3: boolean): ItemChunk<T>[] {
  const size = effectiveBatchSize(requestedSize, hasL3);
  const chunks: ItemChunk<T>[] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push({ items: items.slice(i, i + size), startIndex: i });
  }
  return chunks;
}

/**
 * Build the batch request body for one chunk of items. `firstItemIndex` is the
 * global index of `itemsJson[0]`, so coercion warnings/errors name the right item.
 */
export function buildBatchBody(
  node: INode,
  params: BatchParams,
  itemsJson: IDataObject[],
  firstItemIndex: number,
): BuildBatchResult {
  const methodByField = normaliseFieldMappings(node, params.fields, firstItemIndex);

  const fieldNames = [...methodByField.keys()];
  const records: Record<string, string>[] = [];
  const warnings: string[] = [];
  const sendOffsets: number[] = [];
  itemsJson.forEach((json, offset) => {
    const coerced = coerceRecordValues(node, json, fieldNames, firstItemIndex + offset);
    warnings.push(...coerced.warnings);
    // An all-empty record is excluded, never sent: it would bill a quota slot
    // while protecting nothing (review RF-2). The item fails locally instead.
    if (Object.keys(coerced.record).length === 0) {
      sendOffsets.push(EXCLUDED_OFFSET);
      return;
    }
    sendOffsets.push(records.length);
    records.push(coerced.record);
  });

  // Shared policy for the whole request — every mapped field, regardless of
  // presence on any single record.
  const fields: Record<string, { method: string }> = {};
  for (const [name, method] of methodByField) fields[name] = { method };

  const body: BatchBody = { records, policy: { fields } };
  applyRequestHints(body, params);

  const emptyRecordMessage = `All mapped fields (${fieldNames.join(', ')}) are empty on this item; nothing to tokenise.`;
  return { body, warnings, sendOffsets, emptyRecordMessage };
}

/** A per-record error slot in the batch response (vs. a success envelope). */
export interface BatchErrorSlot {
  error: string;
  [key: string]: unknown;
}

/**
 * A batch result slot is a per-record error when it carries a string `error`
 * (`docs/api/openapi.yaml` BatchRecordResult error arm). Callers must check
 * `extractBatchTokenized` FIRST — a tokenised row could contain a user column
 * literally named `error`, and envelope-first classification keeps the two
 * arms disjoint.
 */
export function isBatchErrorSlot(slot: unknown): slot is BatchErrorSlot {
  return (
    typeof slot === 'object' &&
    slot !== null &&
    typeof (slot as { error?: unknown }).error === 'string'
  );
}

/**
 * The success arm of BatchRecordResult is an envelope, not the row itself:
 * `{ tokenized, job_id, processed_at }` (server: tokenize-one.ts). Returns the
 * tokenised row when the slot is a well-formed envelope, else undefined.
 */
export function extractBatchTokenized(slot: unknown): IDataObject | undefined {
  if (typeof slot !== 'object' || slot === null) return undefined;
  const tokenized = (slot as { tokenized?: unknown }).tokenized;
  if (typeof tokenized !== 'object' || tokenized === null || Array.isArray(tokenized)) {
    return undefined;
  }
  return tokenized as IDataObject;
}
