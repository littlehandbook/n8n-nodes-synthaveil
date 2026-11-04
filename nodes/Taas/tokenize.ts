import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INode } from 'n8n-workflow';

import { MAX_RECORD_FIELDS } from '../../src/constants';
import { coerceRecordValues } from './coerce';
import { applyRequestHints } from './requestHints';

/**
 * Builds the `POST /api/v1/tokenize` request body from the node's field mappings
 * and one input item. Pure and side-effect-free so the determinism (INV-001)
 * and fail-safe (P4) tests can exercise it directly.
 *
 * P4 FAIL-SAFE: only fields the operator explicitly mapped reach `record` — an
 * unmapped item field (raw PII) is NEVER sent. `coerceRecordValues` enforces
 * this by reading exactly the mapped field names; policy entries are then built
 * only for fields that actually made it into the record.
 */

/** One row of the fixedCollection: a source field and the method to apply. */
export interface FieldMapping {
  fieldName: string;
  method: string;
}

export interface TokenizeParams {
  fields: FieldMapping[];
  /** Locale hint (GB/IE/US/CA); omitted from the body when empty. */
  country?: string;
  /** Determinism scope; omitted from the body when empty. */
  scopeId?: string;
  /** Execution id, present only under `Consistency: Every run` (P5 Task 5.2). */
  runId?: string;
}

/** The request body, matching `docs/api/openapi.yaml` TokenizeRequest. */
export interface TokenizeBody {
  record: Record<string, string>;
  policy: { fields: Record<string, { method: string }> };
  country?: string;
  scope_id?: string;
  run_id?: string;
}

export interface BuildTokenizeResult {
  body: TokenizeBody;
  /** Notes about fields skipped because they were empty on this item. */
  warnings: string[];
}

/**
 * Validate + de-duplicate the operator's field mappings into a `fieldName →
 * method` map. Shared by the single and batch builders so both apply the same
 * "at least one field", last-mapping-wins, and ≤200-field rules. Throws a
 * `NodeOperationError` (not a machine error) so the caller surfaces it verbatim.
 */
export function normaliseFieldMappings(
  node: INode,
  fields: FieldMapping[],
  itemIndex: number,
): Map<string, string> {
  const mappings = fields.filter(
    (f) => typeof f.fieldName === 'string' && f.fieldName.trim() !== '',
  );
  if (mappings.length === 0) {
    throw new NodeOperationError(node, 'Add at least one field to tokenise.', { itemIndex });
  }

  // De-duplicate by field name (last mapping wins) before the cap check.
  const methodByField = new Map<string, string>();
  for (const m of mappings) methodByField.set(m.fieldName, m.method);

  if (methodByField.size > MAX_RECORD_FIELDS) {
    throw new NodeOperationError(
      node,
      `Too many fields to tokenise (${methodByField.size}); the API accepts at most ${MAX_RECORD_FIELDS} per record.`,
      { itemIndex },
    );
  }
  return methodByField;
}

export function buildTokenizeBody(
  node: INode,
  params: TokenizeParams,
  itemJson: IDataObject,
  itemIndex: number,
): BuildTokenizeResult {
  const methodByField = normaliseFieldMappings(node, params.fields, itemIndex);
  const fieldNames = [...methodByField.keys()];

  const { record, warnings } = coerceRecordValues(node, itemJson, fieldNames, itemIndex);

  // An all-empty record must fail HERE, not reach the API: the request would
  // consume quota while protecting nothing (review RF-2).
  if (Object.keys(record).length === 0) {
    throw new NodeOperationError(
      node,
      `All mapped fields (${fieldNames.join(', ')}) are empty on this item; nothing to tokenise.`,
      { itemIndex },
    );
  }

  // Policy only for fields present in the record — a field skipped as empty
  // carries no policy entry (nothing to protect on this item).
  const fields: Record<string, { method: string }> = {};
  for (const name of Object.keys(record)) {
    fields[name] = { method: methodByField.get(name) as string };
  }

  const body: TokenizeBody = { record, policy: { fields } };
  applyRequestHints(body, params);

  return { body, warnings };
}

/** Output shaping mode for the tokenised result. */
export type OutputMode = 'replaceInPlace' | 'subObject';

/** Key used when `outputMode === 'subObject'`. */
export const TOKENIZED_SUBOBJECT_KEY = 'tokenized';

/**
 * Fold the API's tokenised record back into the item JSON.
 *   - replaceInPlace: tokenised values overwrite their source fields; other
 *     item fields are preserved untouched.
 *   - subObject: the tokenised record is nested under `tokenized`, leaving the
 *     original item fields intact.
 */
export function applyOutputMode(
  itemJson: IDataObject,
  tokenized: IDataObject,
  mode: OutputMode,
): IDataObject {
  if (mode === 'subObject') {
    return { ...itemJson, [TOKENIZED_SUBOBJECT_KEY]: tokenized };
  }
  return { ...itemJson, ...tokenized };
}
