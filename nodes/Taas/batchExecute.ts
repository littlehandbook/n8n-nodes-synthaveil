import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { BATCH_PATH, V1_BATCH_MAX_RECORDS } from '../../src/constants';
import {
  buildBatchBody,
  chunkItems,
  EXCLUDED_OFFSET,
  extractBatchTokenized,
  isBatchErrorSlot,
  mappingsUseL3,
  type BuildBatchResult,
  type ItemChunk,
} from './batch';
import {
  buildApiError,
  buildBatchError,
  mapErrorToMessage,
  mapLegacyErrorCodeToMessage,
} from './errors';
import { applyOutputMode, type FieldMapping, type OutputMode } from './tokenize';
import { taasRequest } from './transport';
import { scrubCredentialMaterial } from './errorScrubbing';
import { deriveIdempotencyKey, executionIdOf, instanceIdOf, runIndexOf } from './idempotencyKey';

/**
 * Node-execution glue for the Tokenize (Batch) operation: fan the input items
 * out into capped chunks, POST each chunk, and fold the per-record results back
 * onto their originating items (`pairedItem`). Kept out of `Taas.node.ts` so the
 * node file stays focused on its declaration + dispatch.
 */

const HTTP_POST = 'POST' as const;

interface BatchConfig {
  baseUrl: string;
  mappings: FieldMapping[];
  country: string;
  scopeId: string;
  outputMode: OutputMode;
  retryOnRateLimit: boolean;
  /** `this.getExecutionId()` under `Consistency: Every run`, else undefined
   *  (P5 Task 5.2, AC9) — ONE run_id covers the whole batch execution. */
  runId?: string;
}

/** Read the batch node parameters (one set applies to the whole execution). */
function readBatchConfig(ctx: IExecuteFunctions, baseUrl: string): BatchConfig {
  const consistency = ctx.getNodeParameter('consistency', 0, 'stable') as string;
  return {
    baseUrl,
    mappings: ctx.getNodeParameter('fieldsToTokenize.field', 0, []) as FieldMapping[],
    country: ctx.getNodeParameter('country', 0, '') as string,
    scopeId: ctx.getNodeParameter('scopeId', 0, '') as string,
    outputMode: ctx.getNodeParameter('outputMode', 0, 'replaceInPlace') as OutputMode,
    retryOnRateLimit: ctx.getNodeParameter('retryOnRateLimit', 0, true) as boolean,
    runId: consistency === 'everyRun' ? ctx.getExecutionId() : undefined,
  };
}

/** Run the batch operation over every input item, returning one output per item. */
export async function runBatch(
  ctx: IExecuteFunctions,
  baseUrl: string,
): Promise<INodeExecutionData[]> {
  const items = ctx.getInputData();
  const cfg = readBatchConfig(ctx, baseUrl);
  const batchSize = ctx.getNodeParameter('batchSize', 0, V1_BATCH_MAX_RECORDS) as number;

  const chunks = chunkItems(items, batchSize, mappingsUseL3(cfg.mappings));
  const out: INodeExecutionData[] = [];
  for (const chunk of chunks) {
    out.push(...(await processChunk(ctx, cfg, chunk)));
  }
  return out;
}

/** POST one chunk and map its results; a whole-request failure poisons the chunk. */
async function processChunk(
  ctx: IExecuteFunctions,
  cfg: BatchConfig,
  chunk: ItemChunk<INodeExecutionData>,
): Promise<INodeExecutionData[]> {
  const node = ctx.getNode();
  let build: BuildBatchResult;
  try {
    build = buildBatchBody(
      node,
      { fields: cfg.mappings, country: cfg.country, scopeId: cfg.scopeId, runId: cfg.runId },
      chunk.items.map((it) => it.json),
      chunk.startIndex,
    );
  } catch (error) {
    return handleChunkFailure(ctx, chunk, error, cfg.baseUrl);
  }

  // Every record excluded as all-empty → nothing to send; skip the HTTP call
  // entirely and let the mapper fail each item locally (review RF-2).
  let response: IDataObject | undefined;
  if (build.body.records.length > 0) {
    const body = build.body as unknown as IDataObject;
    try {
      response = await taasRequest(ctx, {
        baseUrl: cfg.baseUrl,
        method: HTTP_POST,
        path: BATCH_PATH,
        body,
        retryOnRateLimit: cfg.retryOnRateLimit,
        // #619: one key per chunk, stable across Retry On Fail in the same execution.
        idempotencyKey: deriveIdempotencyKey({
          instanceId: instanceIdOf(ctx),
          executionId: executionIdOf(ctx),
          nodeId: node.id,
          runIndex: runIndexOf(ctx),
          endpoint: BATCH_PATH,
          index: chunk.startIndex,
          body,
        }),
      });
    } catch (error) {
      return handleChunkFailure(ctx, chunk, error, cfg.baseUrl);
    }
  }
  return mapChunkResults({ ctx, chunk, response, mode: cfg.outputMode, build });
}

/** Whole-request failure (503/429-after-retry/4xx/validation): every item in the chunk fails. */
function handleChunkFailure(
  ctx: IExecuteFunctions,
  chunk: ItemChunk<INodeExecutionData>,
  error: unknown,
  baseUrl: string,
): INodeExecutionData[] {
  if (!ctx.continueOnFail()) throw buildApiError(ctx.getNode(), error, chunk.startIndex, baseUrl);
  const raw = mapErrorToMessage(error, baseUrl) ?? (error as Error)?.message ?? 'Request failed';
  // Continue On Fail puts this text into every item of the chunk; the unmapped
  // fallback is the raw transport message, which can embed the Authorization or
  // Idempotency-Key header — scrub it like perItemErrorRow does.
  const scrubbed = scrubCredentialMaterial(raw);
  const message = typeof scrubbed === 'string' ? scrubbed : raw;
  return chunk.items.map((_it, offset) => ({
    json: { error: message },
    pairedItem: { item: chunk.startIndex + offset },
  }));
}

/** The mapped output for one slot: item JSON plus the error message if it failed. */
interface SlotOutcome {
  json: IDataObject;
  failure?: string;
}

/**
 * Classify one OUTBOUND result slot. Envelope FIRST (see
 * extractBatchTokenized): a success slot is `{ tokenized, ... }`; using the
 * whole slot (or the raw item) would pass the original PII through as if it
 * had been tokenised.
 */
function resolveSlot(itemJson: IDataObject, slot: unknown, mode: OutputMode): SlotOutcome {
  const tokenized = extractBatchTokenized(slot);
  if (tokenized) return { json: applyOutputMode(itemJson, tokenized, mode) };
  if (isBatchErrorSlot(slot)) {
    const message = mapLegacyErrorCodeToMessage(slot.error) ?? slot.error;
    return { json: { error: message }, failure: message };
  }
  const message = 'The API returned an unrecognised result for this record.';
  return { json: { error: message }, failure: message };
}

/**
 * Fold a chunk's result slots back onto their items; aggregate errors if not
 * continuing. Slots align with the OUTBOUND records, so items map through
 * `build.sendOffsets`; an excluded (all-empty) item fails locally without a
 * slot. `response` is undefined when the whole chunk was excluded.
 */
interface MapChunkInput {
  ctx: IExecuteFunctions;
  chunk: ItemChunk<INodeExecutionData>;
  response: IDataObject | undefined;
  mode: OutputMode;
  build: BuildBatchResult;
}

function mapChunkResults(input: MapChunkInput): INodeExecutionData[] {
  const { ctx, chunk, response, mode, build } = input;
  const results = Array.isArray(response?.results) ? (response.results as unknown[]) : [];
  const out: INodeExecutionData[] = [];
  const failedIndices: number[] = [];
  const messages: string[] = [];

  chunk.items.forEach((item, offset) => {
    const globalIndex = chunk.startIndex + offset;
    const sendIndex = build.sendOffsets[offset];
    const outcome =
      sendIndex === EXCLUDED_OFFSET
        ? { json: { error: build.emptyRecordMessage }, failure: build.emptyRecordMessage }
        : resolveSlot(item.json, results[sendIndex], mode);

    if (outcome.failure !== undefined) {
      failedIndices.push(globalIndex);
      messages.push(outcome.failure);
    }
    out.push({ json: outcome.json, pairedItem: { item: globalIndex } });
  });

  if (failedIndices.length > 0 && !ctx.continueOnFail()) {
    throw buildBatchError(ctx.getNode(), failedIndices, messages, chunk.startIndex);
  }
  return out;
}
