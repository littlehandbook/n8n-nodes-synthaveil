import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { MAP_CONSISTENCY, MAP_CONSISTENCY_EVERY_RUN, MAPS_PATH, TOKENIZE_PATH, USAGE_PATH } from '../../src/constants';
import { readMapKey } from './nodeCredentials';
import { scanTextItem } from './scanExecute';
import { base64ToBytes, bytesToBase64 } from './base64';
import { applyConsumedMap } from './applyConsumedMap';
import { buildEntries, isRestorableText, preflight, sealContainer } from './sealedMap';
import {
  applyOutputMode,
  buildTokenizeBody,
  type FieldMapping,
  type OutputMode,
} from './tokenize';
import { taasRequest } from './transport';
import { deriveIdempotencyKey, executionIdOf, instanceIdOf, runIndexOf } from './idempotencyKey';

/**
 * Per-item execution glue for the single-record operations (Get Usage, Tokenize).
 * Kept out of `Taas.node.ts` so the node file stays focused on its declaration +
 * dispatch, mirroring `batchExecute.ts`.
 */

const HTTP_GET: IHttpRequestMethods = 'GET';
const HTTP_POST: IHttpRequestMethods = 'POST';
const HTTP_PUT: IHttpRequestMethods = 'PUT';
const CONSUME_SUFFIX = '/consume';

export interface OperationContext {
  resource: string;
  operation: string;
  baseUrl: string;
  itemIndex: number;
}

/** Dispatch one input item to the selected operation, returning its output JSON. */
export async function runOperation(
  ctx: IExecuteFunctions,
  op: OperationContext,
): Promise<IDataObject> {
  if (op.resource === 'token' && op.operation === 'tokenize') {
    return tokenizeItem(ctx, op);
  }
  if (op.resource === 'token' && op.operation === 'restore') {
    return restoreItem(ctx, op);
  }
  if (op.resource === 'text' && op.operation === 'scanText') {
    return scanTextItem(ctx, op);
  }
  return getUsageItem(ctx, op.baseUrl);
}

/** GET /api/v1/usage — the raw usage snapshot. */
async function getUsageItem(ctx: IExecuteFunctions, baseUrl: string): Promise<IDataObject> {
  return taasRequest(ctx, { baseUrl, method: HTTP_GET, path: USAGE_PATH });
}

/** Read the tokenize-operation parameters for one item in a single place. */
function readTokenizeParams(ctx: IExecuteFunctions, itemIndex: number) {
  const consistency = ctx.getNodeParameter('consistency', itemIndex, 'stable') as string;
  return {
    fields: ctx.getNodeParameter('fieldsToTokenize.field', itemIndex, []) as FieldMapping[],
    country: ctx.getNodeParameter('country', itemIndex, '') as string,
    // Trimmed ONCE, here, so tokenize, the maps PUT and sealContainer all use
    // the SAME scope identity (branch review finding 6, chairman ruling,
    // plan line 346) — requestHints.ts trims again defensively but this is
    // the single source of truth for what "the scope" is on this item.
    scopeId: (ctx.getNodeParameter('scopeId', itemIndex, '') as string).trim(),
    outputMode: ctx.getNodeParameter('outputMode', itemIndex, 'replaceInPlace') as OutputMode,
    retryOnRateLimit: ctx.getNodeParameter('retryOnRateLimit', itemIndex, true) as boolean,
    returnMode: ctx.getNodeParameter('returnMode', itemIndex, 'recordId') as string,
    runId: consistency === 'everyRun' ? ctx.getExecutionId() : undefined,
  };
}

/**
 * POST the tokenize body and return the tokenised record.
 *
 * Fails LOUD on a success response without the envelope: emitting the item with
 * an empty or absent tokenised row would pass the original personal data
 * through as if it had been protected. Per-item under Continue On Fail
 * (Taas.node.ts).
 */
async function requestTokenizedRecord(
  ctx: IExecuteFunctions,
  input: {
    baseUrl: string;
    body: ReturnType<typeof buildTokenizeBody>['body'];
    retryOnRateLimit: boolean;
    itemIndex: number;
  },
): Promise<IDataObject> {
  const { baseUrl, body, retryOnRateLimit, itemIndex } = input;
  // TokenizeBody is a named interface (no index signature); its members are all
  // JSON-safe, so bridge it to the transport's IDataObject body param.
  const wireBody = body as unknown as IDataObject;
  const response = await taasRequest(ctx, {
    baseUrl,
    method: HTTP_POST,
    path: TOKENIZE_PATH,
    body: wireBody,
    retryOnRateLimit,
    // #619: same execution + node + item + body ⇒ same key, so Retry On Fail is not billed twice.
    idempotencyKey: deriveIdempotencyKey({
      instanceId: instanceIdOf(ctx),
      executionId: executionIdOf(ctx),
      nodeId: ctx.getNode().id,
      runIndex: runIndexOf(ctx),
      endpoint: TOKENIZE_PATH,
      index: itemIndex,
      body: wireBody,
    }),
  });

  const tokenized = response.tokenized;
  if (typeof tokenized !== 'object' || tokenized === null || Array.isArray(tokenized)) {
    throw new NodeOperationError(
      ctx.getNode(),
      'The API response is missing the tokenized record; the item was not passed through.',
      { itemIndex },
    );
  }
  return tokenized as IDataObject;
}

/** POST /api/v1/tokenize — protect the mapped fields of one input item. */
async function tokenizeItem(ctx: IExecuteFunctions, op: OperationContext): Promise<IDataObject> {
  const { baseUrl, itemIndex } = op;
  const itemJson = ctx.getInputData()[itemIndex].json;
  const { fields, country, scopeId, outputMode, retryOnRateLimit, returnMode, runId } =
    readTokenizeParams(ctx, itemIndex);

  // Local restore PUTs the sealed map to /api/v1/maps, where scope_id is
  // REQUIRED (it is optional on tokenize). Refusing here, before the tokenize
  // request, keeps the default journey from spending a quota unit on work that
  // the very next call rejects (QA review of PR #523, finding 3).
  if (returnMode === 'localRestore' && scopeId === '') {
    throw new NodeOperationError(
      ctx.getNode(),
      'Local restore needs a Scope ID: the sealed map is stored against it. Set Scope ID on this node.',
      { itemIndex },
    );
  }

  const { body } = buildTokenizeBody(
    ctx.getNode(),
    { fields, country, scopeId, runId },
    itemJson,
    itemIndex,
  );
  if (returnMode === 'localRestore') assertRestorableRecord(ctx, body.record, itemIndex);
  const tokenized = await requestTokenizedRecord(ctx, {
    baseUrl,
    body,
    retryOnRateLimit,
    itemIndex,
  });

  if (returnMode === 'localRestore') {
    return localRestoreOutput(ctx, {
      baseUrl,
      scopeId,
      runId,
      record: body.record,
      tokenized,
      itemJson,
      outputMode,
    });
  }
  return applyOutputMode(itemJson, tokenized, outputMode);
}

/**
 * Local restore refuses a value restore could never give back (an unpaired
 * surrogate) before the tokenize request, so no quota is spent and no one-shot
 * map is stored for it (Codex review on #1622). Names the field, never the value.
 */
function assertRestorableRecord(ctx: IExecuteFunctions, record: Record<string, string>, itemIndex: number): void {
  const field = Object.keys(record).find((key) => !isRestorableText(record[key]));
  if (field === undefined) return;
  throw new NodeOperationError(
    ctx.getNode(),
    `Local restore cannot protect field "${field}": its text contains broken Unicode (an unpaired surrogate), so it could not be restored. Fix the text or use Return Mode Record ID.`,
    { itemIndex },
  );
}

/**
 * Local restore output: seal and store the map, then emit the protected record
 * with the handle ALONGSIDE it, in the same shape Record ID mode emits.
 *
 * Returning the bare handle instead (QA review of PR #523, finding 2) left the
 * next node in the chain — the AI step in every shipped example — reading
 * `undefined` for every field the node had just protected.
 */
async function localRestoreOutput(
  ctx: IExecuteFunctions,
  input: {
    baseUrl: string;
    scopeId: string;
    runId?: string;
    record: Record<string, string>;
    tokenized: IDataObject;
    itemJson: IDataObject;
    outputMode: OutputMode;
  },
): Promise<IDataObject> {
  const { itemJson, tokenized, outputMode, ...sealInput } = input;
  const handle = await sealAndStoreMap(ctx, { ...sealInput, tokenized });
  return {
    ...applyOutputMode(itemJson, tokenized, outputMode),
    synthaveil_map_handle: handle,
  };
}

/**
 * Local restore (FR-2.3): seal request↔response value pairs into a map, PUT it
 * to the store, and return the store handle. The sealed bytes and the entry
 * inventory never leave this function — only the handle does; the caller emits
 * it beside the protected record.
 */
async function sealAndStoreMap(
  ctx: IExecuteFunctions,
  input: {
    baseUrl: string;
    scopeId: string;
    /** Present only under `Consistency: Every run` (P5 Task 5.2, AC9). */
    runId?: string;
    record: Record<string, string>;
    tokenized: IDataObject;
  },
): Promise<string> {
  const { baseUrl, scopeId, runId, record, tokenized } = input;
  const masterKey = base64ToBytes(await readMapKey(ctx));

  const entries = buildEntries(record, tokenized as Record<string, unknown>);
  const { bytes } = await sealContainer(entries, scopeId, masterKey);

  const body: IDataObject = {
    blob: bytesToBase64(bytes),
    scope_id: scopeId,
    // Branch review finding 7: mirror the node's own Consistency parameter
    // (runId is only set under Every run) instead of hardcoding 'stable'.
    consistency: runId ? MAP_CONSISTENCY_EVERY_RUN : MAP_CONSISTENCY,
  };
  if (runId) body.run_id = runId;

  const putResponse = await taasRequest(ctx, { baseUrl, method: HTTP_PUT, path: MAPS_PATH, body });

  return String(putResponse.handle);
}

/**
 * Restore (Task 3.4): preflight → consume the map → open the container →
 * restore the text. A post-consume failure never carries sealed bytes or the
 * inventory (FR-2.5) — it is returned as the item's output, not thrown, since
 * "the map is already gone" is an expected outcome of a one-shot map.
 */
async function restoreItem(ctx: IExecuteFunctions, op: OperationContext): Promise<IDataObject> {
  const { baseUrl, itemIndex } = op;
  const itemJson = ctx.getInputData()[itemIndex].json;
  const mapHandle = ctx.getNodeParameter(
    'mapHandle',
    itemIndex,
    itemJson.synthaveil_map_handle as string,
  ) as string;
  const textFieldName = ctx.getNodeParameter('textField', itemIndex, '') as string;
  // Trimmed to match the tokenize path (readTokenizeParams), which seals
  // under the TRIMMED scope. Reading it raw here meant a scope typed with
  // stray whitespace consumed the one-shot map and only then failed
  // SCOPE_MISMATCH — the map gone, the plaintext unrecoverable (QA review
  // of PR #523, finding 9).
  const scopeId = (ctx.getNodeParameter('scopeId', itemIndex, '') as string).trim();
  const text = String(itemJson[textFieldName] ?? '');

  const mapKeyB64 = await readMapKey(ctx);
  preflight(mapHandle, mapKeyB64, scopeId, text);

  const consumeResponse = await taasRequest(ctx, {
    baseUrl,
    method: HTTP_POST,
    path: `${MAPS_PATH}/${mapHandle}${CONSUME_SUFFIX}`,
  });

  return applyConsumedMap(ctx, {
    consumeResponse,
    mapKeyB64,
    scopeId,
    text,
    itemJson,
    textField: textFieldName,
  });
}
