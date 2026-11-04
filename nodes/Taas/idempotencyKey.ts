import { createHash } from 'crypto';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

/**
 * The `Idempotency-Key` this node sends on Tokenize and Tokenize (Batch)
 * (#619, IT Council C4):
 *
 *   'n8n1_' + hex(sha256('n8n1' | instanceId | executionId | nodeId | runIndex | endpoint | index | hex(sha256(JSON.stringify(body)))))
 *
 * - `instanceId` (n8n's `getInstanceId()`, stable per n8n installation) keeps
 *   two installs that share one Synthaveil credential apart: execution ids are
 *   auto-increment and node ids travel with exported workflows, so without it a
 *   dev run could replay a prod answer (or the reverse) for 30 days.
 * - n8n's Retry On Fail re-runs the node inside the SAME execution and the SAME
 *   run (n8n computes the run index once, before its retry loop), so the same
 *   item and body yield the same key and the server answers the retry from its
 *   stored response instead of billing it again. NOT as an AI agent tool:
 *   there n8n gives every retry the next run index, so Retry On Fail is
 *   refused in that context (`assertRetryOnFailOffAsTool`, review on #1622).
 * - `runIndex` (`$thisRunIndex`) tells separate, intentional calls apart: a
 *   loop re-entering the node, or an AI agent calling it as a tool twice, is a
 *   new run of the node with the next run index (n8n's makeHandleToolInvocation), so a new key even when the
 *   item index and body are identical. Without it the second call would be
 *   answered from the first call's stored response: not run, not billed and
 *   not audited (Codex review on #1622).
 * - A new execution (running the workflow again, or retrying it from the
 *   Executions list) has a new execution id, so a new key, and bills as normal.
 * - The node id (not its name) keeps keys stable across a rename and distinct
 *   for a copied node. `index` is the item index (Tokenize) or the chunk's
 *   start index (Tokenize (Batch)).
 * - The body digest still separates different data sent by one run.
 *
 * No key at all when the execution id, the instance id or the run index is
 * missing or blank (n8n#16965): a key built from a constant would replay a
 * stored answer across separate runs, calls or installs. Never a random key:
 * that would defeat retries. The key is a hash of record values, so it is
 * never logged or shown.
 */

const KEY_DOMAIN = 'n8n1';
const KEY_PREFIX = `${KEY_DOMAIN}_`;
const PART_SEPARATOR = '|';

export interface IdempotencyKeyInput {
  /** `this.getInstanceId()` — the n8n installation. */
  instanceId: string | undefined;
  /** `this.getExecutionId()`. */
  executionId: string | undefined;
  /** `this.getNode().id`. */
  nodeId: string;
  /** This node's run index in the execution (`$thisRunIndex`); see {@link runIndexOf}. */
  runIndex: number | undefined;
  /** TOKENIZE_PATH or BATCH_PATH. */
  endpoint: string;
  /** Item index (Tokenize) or `chunk.startIndex` (Tokenize (Batch)). */
  index: number;
  /** The request body handed to the transport (n8n sends it as JSON.stringify(body)). */
  body: IDataObject;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The current execution id, or undefined when the context cannot give one
 * (then no key is sent, exactly as for an empty id).
 */
export function executionIdOf(ctx: IExecuteFunctions): string | undefined {
  return typeof ctx.getExecutionId === 'function' ? ctx.getExecutionId() : undefined;
}

/** The n8n installation id, or undefined when the context cannot give one (then no key). */
export function instanceIdOf(ctx: IExecuteFunctions): string | undefined {
  return typeof ctx.getInstanceId === 'function' ? ctx.getInstanceId() : undefined;
}

/**
 * This node's run index in the current execution (`$thisRunIndex`), or
 * undefined when the context cannot give a non-negative integer (then no key).
 * It is the same for every item and every Retry On Fail try of one run.
 */
export function runIndexOf(ctx: IExecuteFunctions): number | undefined {
  if (typeof ctx.getWorkflowDataProxy !== 'function') return undefined;
  try {
    const runIndex: unknown = ctx.getWorkflowDataProxy(0).$thisRunIndex;
    return Number.isInteger(runIndex) && (runIndex as number) >= 0 ? (runIndex as number) : undefined;
  } catch {
    return undefined;
  }
}

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

/** True when this run can carry a key (all three ids present); without one a retry bills again. */
export function canDeriveIdempotencyKey(ctx: IExecuteFunctions): boolean {
  return !isBlank(instanceIdOf(ctx)) && !isBlank(executionIdOf(ctx)) && runIndexOf(ctx) !== undefined;
}

/** The key for one request, or `undefined` (send no header) without an instance, execution or run id. */
export function deriveIdempotencyKey(input: IdempotencyKeyInput): string | undefined {
  const { instanceId, executionId, nodeId, runIndex, endpoint, index, body } = input;
  if (isBlank(instanceId) || isBlank(executionId) || runIndex === undefined) return undefined;
  const digest = sha256Hex(JSON.stringify(body));
  const parts = [KEY_DOMAIN, instanceId, executionId, nodeId, String(runIndex), endpoint, String(index), digest];
  return KEY_PREFIX + sha256Hex(parts.join(PART_SEPARATOR));
}
