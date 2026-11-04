import type { IExecuteFunctions, NodeHint } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { canDeriveIdempotencyKey } from './idempotencyKey';

/**
 * AC13 — always-on visible warning for the Restore operation. Advisory only: a
 * hint cannot stop anyone, and hint expressions can only see node parameters,
 * not node settings — {@link assertRetryOnFailOffForRestore} is the real guard.
 *
 * `warning`, not `danger`: this renders on EVERY Restore run, including the
 * ones that worked, and a red banner over a green run is crying wolf — in UAT
 * the founder read a fully successful round trip as "one last error" because
 * of it. Red is reserved for a run that has actually failed; that is what the
 * hard guard's thrown error looks like (D-RM-11).
 */
export const RESTORE_RETRY_HINT: NodeHint = {
  type: 'warning',
  location: 'ndv',
  displayCondition: '={{ $parameter["operation"] === "restore" }}',
  message: 'Retry On Fail must be off for Restore — the map is destroyed on first hand-over.',
};

/**
 * QA review (PR #523, finding 5) — the one-shot-consume interaction with n8n's
 * Continue On Fail setting.
 *
 * The reviewer asked for Restore to isolate every item unconditionally. We do
 * NOT do that: throwing when Continue On Fail is off is the n8n-wide contract,
 * and a node that quietly ignores the user's setting is a worse surprise than
 * the one being avoided. But the underlying concern is real and specific to
 * this operation: each restored item has already CONSUMED its map, and a map is
 * destroyed on first hand-over. So when a later item throws, the earlier items'
 * restored text is discarded along with the run — and it cannot be recovered by
 * re-running, because those maps are gone.
 *
 * That is a genuine footgun, so it gets a visible warning at the point of
 * decision. The setting stays the user's.
 */
export const RESTORE_CONTINUE_ON_FAIL_HINT: NodeHint = {
  type: 'warning',
  location: 'ndv',
  displayCondition: '={{ $parameter["operation"] === "restore" }}',
  message:
    'Restoring several items? Turn on Continue On Fail (Settings). Each item consumes its map as it is restored, so if a later item fails without it, the items already restored are lost and cannot be restored again.',
};

/**
 * AC13 hard guard, called first thing in `Taas.node.ts execute()` for the
 * Restore branch: the sealed map is destroyed on first hand-over, so a retry
 * can never succeed. Checked before preflight and before any network call.
 */
export function assertRetryOnFailOffForRestore(ctx: IExecuteFunctions): void {
  if (!ctx.getNode().retryOnFail) return;
  throw new NodeOperationError(
    ctx.getNode(),
    'Turn off Retry On Fail for this node: the sealed map is destroyed on first hand-over, so a retry can never succeed.',
  );
}

/**
 * One item's Return Mode for the pre-scan, or undefined when its expression
 * throws: that item is left to the per-item loop, which reports the error under
 * Continue On Fail like any other, instead of the scan aborting the whole run.
 */
function returnModeOrUnknown(ctx: IExecuteFunctions, itemIndex: number): unknown {
  try {
    return ctx.getNodeParameter('returnMode', itemIndex, 'recordId');
  } catch {
    return undefined;
  }
}

/**
 * #619 (IT Council C6): Tokenize with Return Mode = Local restore refuses Retry
 * On Fail too. The tokenize call itself is now safe to retry (it carries an
 * Idempotency-Key), but each retry also seals and stores ANOTHER map, and
 * those spare maps count toward the map store limit until they expire. Lifted
 * only behind a test that also bounds the spare maps. Restore's own guard
 * ({@link assertRetryOnFailOffForRestore}) is unchanged. Checked before any
 * network call; every item is checked because Return Mode can be an expression.
 */
export function assertRetryOnFailOffForLocalRestore(ctx: IExecuteFunctions): void {
  if (!ctx.getNode().retryOnFail) return;
  const items = ctx.getInputData();
  const anyLocalRestore = items.some((_item, i) => returnModeOrUnknown(ctx, i) === 'localRestore');
  if (!anyLocalRestore) return;
  throw new NodeOperationError(
    ctx.getNode(),
    'Turn off Retry On Fail for this node while Return Mode is Local restore: every retry stores another sealed map, and the spare maps can fill your map storage.',
  );
}

/**
 * #619 (Codex review): Tokenize and Tokenize (Batch) are only safe to retry
 * because each request carries an Idempotency-Key. When n8n gives the node no
 * installation id, execution id or run index, no key can be built, so a Retry On Fail retry
 * would be billed again — refuse it before any request rather than let the
 * notice's promise fail silently. With Retry On Fail off, no key is fine.
 */
export function assertRetryOnFailHasIdempotencyKey(ctx: IExecuteFunctions): void {
  if (!ctx.getNode().retryOnFail || canDeriveIdempotencyKey(ctx)) return;
  throw new NodeOperationError(
    ctx.getNode(),
    'Turn off Retry On Fail for this node: this n8n run gives the node no run id, so a retry would be billed again.',
  );
}

/**
 * True when an AI agent runs this node as a tool. n8n's own `isToolExecution()`
 * where it exists; older n8n has no such method, but only its tool/supply-data
 * context carries `getNextRunIndex()`.
 */
function isToolExecution(ctx: IExecuteFunctions): boolean {
  if (typeof ctx.isToolExecution === 'function') return ctx.isToolExecution();
  return typeof (ctx as { getNextRunIndex?: unknown }).getNextRunIndex === 'function';
}

/**
 * Review on #1622: as an agent tool, n8n runs Retry On Fail itself
 * (`makeHandleToolInvocation`) and gives every try the NEXT run index, so each
 * retry carries a new Idempotency-Key and is billed again. Nothing stable tells
 * a tool retry apart from a second, intentional tool call with the same
 * arguments, so Retry On Fail is refused there instead.
 */
export function assertRetryOnFailOffAsTool(ctx: IExecuteFunctions): void {
  if (!ctx.getNode().retryOnFail || !isToolExecution(ctx)) return;
  throw new NodeOperationError(
    ctx.getNode(),
    'Turn off Retry On Fail for this node while an AI agent uses it as a tool: n8n counts each tool retry as a new call, so a retry would be billed again.',
  );
}

/**
 * The Retry On Fail and billing notice (#619, IT Council C7). The ONLY copy:
 * the Tokenize (Batch) notice and operation description read it from here.
 * Wording is pending owner approval (pinned in tests/nodes/idempotency.notice.test.ts).
 */
export const TOKENIZE_RETRY_NOTICE =
  'Tokenize and Tokenize (Batch) are safe to retry: with Retry On Fail on, a retry in the same run is matched to the first attempt and not billed twice. ' +
  'When an AI agent uses this node as a tool, turn Retry On Fail off: n8n counts each tool retry as a new call. ' +
  'A retry is checked for its API key, rate limit and quota before it is matched, so it can still be refused (for example 402 if the first attempt used up your quota); a refused retry is not billed. ' +
  'Keep Retry On Fail off for Restore and Local restore. ' +
  'Batches bill every record sent, including error rows, and running the workflow again or retrying it from the Executions list is a new run and bills again.';

/**
 * Chairman ruling: Tokenize (Batch) + Local restore has no sealing
 * implementation yet (real per-record batch sealing is a named follow-up), so
 * it must refuse loudly rather than silently fall through to Record ID
 * behaviour. Called before `runBatch`, so before any network call.
 */
export function assertBatchNotLocalRestore(ctx: IExecuteFunctions, returnMode: string): void {
  if (returnMode !== 'localRestore') return;
  throw new NodeOperationError(
    ctx.getNode(),
    'Local restore is not yet supported for Tokenize (Batch). Use the single Tokenize operation with Local restore, or switch this operation back to Record ID.',
  );
}

export interface RequestHints {
  country?: string;
  scopeId?: string;
  /** Present only under `Consistency: Every run` (plan P5 Task 5.2, AC9) —
   *  the node's own execution id, so the same value gets a different token
   *  on every run instead of staying stable within the scope. */
  runId?: string;
}

interface HintBody {
  country?: string;
  scope_id?: string;
  run_id?: string;
}

/**
 * Locale-hint spellings this node has shipped, mapped to the code the API
 * accepts.
 *
 * n8n persists the SELECTED VALUE in the workflow JSON, so correcting a picker
 * option cannot reach a workflow that is already saved. A canvas built under
 * 0.2.0 keeps handing `country: 'UK'` to `execute()` after the upgrade — and
 * keeps getting a `400` — while the dropdown renders "United Kingdom" as though
 * nothing were wrong, because only the value changed, not the label. Healing
 * the value here is what actually upgrades those workflows.
 *
 * Deliberately one entry: only the spelling this package itself once produced
 * is aliased. A general country-name resolver would rewrite the user's own
 * expression output, hiding a real mistake behind a wrong-but-accepted locale.
 */
const LEGACY_COUNTRY_ALIASES: Readonly<Record<string, string>> = { UK: 'GB' };

/**
 * The country code to put on the wire for a hint the workflow persisted.
 * Case-insensitive, because the value can also arrive from an expression.
 */
function normalizeCountry(country: string): string {
  const trimmed = country.trim();
  return LEGACY_COUNTRY_ALIASES[trimmed.toUpperCase()] ?? trimmed;
}

/** Add normalized optional API request hints without emitting empty values. */
export function applyRequestHints(body: HintBody, hints: RequestHints): void {
  if (hints.country && hints.country.trim() !== '') body.country = normalizeCountry(hints.country);
  if (hints.scopeId && hints.scopeId.trim() !== '') body.scope_id = hints.scopeId.trim();
  if (hints.runId && hints.runId.trim() !== '') body.run_id = hints.runId;
}
