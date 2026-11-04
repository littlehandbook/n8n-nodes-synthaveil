/**
 * Pre-item-loop dispatch for the Taas node.
 *
 * Restore refuses Retry On Fail outright (the sealed map is destroyed on
 * first hand-over, so a retry can never succeed), Tokenize and Tokenize (Batch)
 * refuse it when the run gives no id to build an Idempotency-Key from (#619)
 * or when an AI agent runs the node as a tool (each tool retry is a new key),
 * Tokenize refuses it under Local restore (#619: every retry stores a spare
 * map), and Batch fans ALL items
 * into capped chunks rather than one call per item. Extracted from
 * Taas.node.ts to keep that file under the 300-line ceiling.
 */
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { runBatch } from './batchExecute';
import {
  assertBatchNotLocalRestore,
  assertRetryOnFailHasIdempotencyKey,
  assertRetryOnFailOffAsTool,
  assertRetryOnFailOffForLocalRestore,
  assertRetryOnFailOffForRestore,
} from './requestHints';

/** Returns the full result set for batch, null when the per-item loop runs. */
export async function dispatchBeforeItemLoop(
  ctx: IExecuteFunctions,
  resource: string,
  operation: string,
  baseUrl: string,
): Promise<INodeExecutionData[][] | null> {
  if (resource !== 'token') return null;
  if (operation === 'restore') assertRetryOnFailOffForRestore(ctx);
  if (operation === 'tokenize' || operation === 'tokenizeBatch') {
    assertRetryOnFailOffAsTool(ctx);
    assertRetryOnFailHasIdempotencyKey(ctx);
  }
  if (operation === 'tokenize') assertRetryOnFailOffForLocalRestore(ctx);
  if (operation !== 'tokenizeBatch') return null;
  const returnMode = ctx.getNodeParameter('returnMode', 0, 'recordId') as string;
  assertBatchNotLocalRestore(ctx, returnMode);
  return [await runBatch(ctx, baseUrl)];
}
