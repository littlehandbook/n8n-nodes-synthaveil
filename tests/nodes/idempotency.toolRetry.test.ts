/**
 * Review on #1622 — Retry On Fail when an AI agent runs the node as a tool.
 *
 * In that context n8n retries the tool itself (`makeHandleToolInvocation` in
 * packages/core get-input-connection-data.ts): every try does
 * `const localRunIndex = runIndex++` and builds a fresh context from it, so each
 * retry has a new `$thisRunIndex`, a new Idempotency-Key, and would be billed
 * again. A tool retry cannot be told apart from a second, intentional call with
 * the same arguments, so the node refuses Retry On Fail there instead.
 */
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { KEY_SHAPE, NO_HEADER, ctxFor, keyOf, routedHttp, sent } from './idempotencyTestKit';

const ITEM: INodeExecutionData = { json: { name: 'Avery Testperson' } };
const AS_TOOL_REFUSAL = /^Turn off Retry On Fail for this node while an AI agent uses it as a tool/;

describe('Retry On Fail as an AI agent tool', () => {
  it.each([
    ['isToolExecution() is true', { isToolExecution: () => true }],
    ['older n8n: only the tool context has getNextRunIndex()', { getNextRunIndex: () => 1 }],
  ])('%s: Tokenize and Tokenize (Batch) refuse it before any request', async (_label, toolCtx) => {
    for (const operation of ['tokenize', 'tokenizeBatch']) {
      const http = routedHttp();
      const ctx = { ...ctxFor({ items: [ITEM], params: { operation }, retryOnFail: true, http }), ...toolCtx };
      await expect(new Taas().execute.call(ctx as IExecuteFunctions)).rejects.toThrow(AS_TOOL_REFUSAL);
      expect(http).not.toHaveBeenCalled();
    }
  });

  it('with Retry On Fail OFF, each tool call runs and is keyed by its own run index', async () => {
    const asTool = (runIndex: number) => {
      const http = routedHttp();
      const ctx = { ...ctxFor({ items: [ITEM], params: {}, http, runIndex }), isToolExecution: () => true };
      return { http, ctx: ctx as IExecuteFunctions };
    };
    const first = asTool(0);
    const second = asTool(1);
    await new Taas().execute.call(first.ctx);
    await new Taas().execute.call(second.ctx);
    expect(keyOf(sent(first.http)[0]) ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(keyOf(sent(second.http)[0])).not.toBe(keyOf(sent(first.http)[0]));
  });

  it('a normal (non-tool) run with Retry On Fail ON is still allowed and keyed', async () => {
    const http = routedHttp();
    const ctx = { ...ctxFor({ items: [ITEM], params: {}, retryOnFail: true, http }), isToolExecution: () => false };
    await expect(new Taas().execute.call(ctx as IExecuteFunctions)).resolves.toBeDefined();
    expect(keyOf(sent(http)[0]) ?? NO_HEADER).toMatch(KEY_SHAPE);
  });
});
