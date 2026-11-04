/**
 * #619 (IT Council C4/C5/C6/C8) — what `execute()` puts on the wire.
 *
 * Pinned behaviour:
 *  - Tokenize: each item's POST /api/v1/tokenize carries
 *    referenceKey(instanceId, executionId, node.id, TOKENIZE_PATH, itemIndex, body, runIndex) — see idempotencyTestKit.ts.
 *  - A second run of the node in one execution (loop, agent tool call) gets new keys (#1622).
 *  - Tokenize (Batch): each chunk's POST carries referenceKey(..., BATCH_PATH, chunk.startIndex, body).
 *  - The node NAME is not an input: renaming the node keeps every key.
 *  - Empty getExecutionId() ⇒ no header at all.
 *  - Simulated Retry On Fail: execute() twice with the same execution id sends identical keys.
 *  - Never on /detect, /usage, /maps PUT or /maps/{handle}/consume.
 *  - Retry-On-Fail guard: Tokenize with Return = Local restore and Retry On Fail ON is refused
 *    before any request (IT Council C6); the Restore guard is unchanged.
 */
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { BATCH_PATH, TOKENIZE_PATH } from '../../src/constants';
import {
  EXECUTION_ID,
  INSTANCE_ID,
  KEY_SHAPE,
  NODE_ID,
  NO_HEADER,
  ctxFor,
  keyOf,
  referenceKey,
  routedHttp,
  sent,
  type CtxOptions,
} from './idempotencyTestKit';

const item = (json: IDataObject): INodeExecutionData => ({ json });
const PEOPLE = [item({ name: 'Avery Testperson' }), item({ name: 'Blake Fakename' }), item({ name: 'Casey Madeup' })];

async function run(over: Partial<CtxOptions> = {}): Promise<ReturnType<typeof sent>> {
  const http = over.http ?? routedHttp();
  await new Taas().execute.call(ctxFor({ items: PEOPLE, params: {}, ...over, http }));
  return sent(http);
}

const keys = (reqs: ReturnType<typeof sent>): Array<string | undefined> => reqs.map(keyOf);

describe('Tokenize — one key per item', () => {
  it('each item carries the reference key for (execution, node id, endpoint, item index, body)', async () => {
    const reqs = await run();
    expect(reqs).toHaveLength(PEOPLE.length);
    reqs.forEach((req, i) => {
      expect(keyOf(req) ?? NO_HEADER).toMatch(KEY_SHAPE);
      expect(keyOf(req)).toBe(referenceKey(INSTANCE_ID, EXECUTION_ID, NODE_ID, TOKENIZE_PATH, i, req.body));
    });
    expect(new Set(keys(reqs)).size).toBe(PEOPLE.length);
  });

  it('two items with IDENTICAL data still get different keys (the index is an input)', async () => {
    const twins = [item({ name: 'Avery Testperson' }), item({ name: 'Avery Testperson' })];
    const reqs = await run({ items: twins });
    expect(keyOf(reqs[0]) ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(keyOf(reqs[0])).not.toBe(keyOf(reqs[1]));
  });
});

describe('Tokenize (Batch) — one key per chunk', () => {
  it('each chunk carries the reference key for its chunk.startIndex and body', async () => {
    const reqs = await run({ params: { operation: 'tokenizeBatch', batchSize: 2 } });
    expect(reqs).toHaveLength(2);
    const starts = [0, 2];
    reqs.forEach((req, n) => {
      expect(req.url).toBe(BATCH_PATH);
      expect(keyOf(req) ?? NO_HEADER).toMatch(KEY_SHAPE);
      expect(keyOf(req)).toBe(referenceKey(INSTANCE_ID, EXECUTION_ID, NODE_ID, BATCH_PATH, starts[n], req.body));
    });
  });
});

describe('stability and variance across runs', () => {
  it('simulated Retry On Fail: execute() twice in the same execution sends identical keys', async () => {
    const first = keys(await run());
    const retry = keys(await run());
    expect(first[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(retry).toEqual(first);
  });

  it('a renamed node (same id) keeps its keys', async () => {
    const before = keys(await run({ nodeName: 'Synthaveil' }));
    const after = keys(await run({ nodeName: 'Protect customer names' }));
    expect(before[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(after).toEqual(before);
  });

  it('a new execution (re-run, or retry from the Executions list) gets new keys and bills again', async () => {
    const first = keys(await run());
    const rerun = keys(await run({ executionId: 'exec-619-0002' }));
    expect(first[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    rerun.forEach((k, i) => expect(k).not.toBe(first[i]));
  });

  it('a copied node (different id) gets different keys', async () => {
    const first = keys(await run());
    const copy = keys(await run({ nodeId: '3b0c6c1e-6f2a-4d5e-9a7b-000000000999' }));
    expect(first[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(copy[0]).not.toBe(first[0]);
  });

  it('another n8n installation (same execution id, same node id) gets different keys', async () => {
    const first = keys(await run());
    const otherInstall = keys(await run({ instanceId: 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1' }));
    expect(first[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    otherInstall.forEach((k, i) => expect(k).not.toBe(first[i]));
  });

  it.each([
    ['empty', ''],
    ['undefined', undefined],
  ])('an %s instance id sends NO header at all', async (_label, instanceId) => {
    const reqs = await run({ instanceId });
    expect(reqs).toHaveLength(PEOPLE.length);
    for (const req of reqs) expect(keyOf(req)).toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['undefined', undefined],
  ])('an %s execution id sends NO header at all (guard: passes today)', async (_label, executionId) => {
    const reqs = await run({ executionId });
    expect(reqs).toHaveLength(PEOPLE.length);
    for (const req of reqs) expect(req.headers?.['Idempotency-Key']).toBeUndefined();
    for (const req of reqs) expect(keyOf(req)).toBeUndefined();
  });
});

// Codex review on #1622: a loop re-entering the node, or an AI agent calling it twice, is a new
// run of the node in the SAME execution with the same item indices and possibly the same body.
// Without the run index in the key, the second call was answered from the first call's stored
// response: not run, not billed, not audited.
describe('separate calls in one execution (loop / agent tool call)', () => {
  it('a second run of the node with identical data gets different keys', async () => {
    const firstRun = keys(await run({ runIndex: 0 }));
    const secondRun = keys(await run({ runIndex: 1 }));
    expect(firstRun[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    secondRun.forEach((k, i) => expect(k).not.toBe(firstRun[i]));
  });

  it('a second run of Tokenize (Batch) with identical data gets a different key', async () => {
    const params = { operation: 'tokenizeBatch' };
    const firstRun = keys(await run({ params, runIndex: 0 }));
    const secondRun = keys(await run({ params, runIndex: 1 }));
    expect(firstRun[0] ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(secondRun[0]).not.toBe(firstRun[0]);
  });

  it('Retry On Fail inside one run (same run index) still sends the same keys', async () => {
    const firstReqs = await run({ runIndex: 3 });
    const retry = keys(await run({ runIndex: 3 }));
    expect(keyOf(firstReqs[0]) ?? NO_HEADER).toMatch(KEY_SHAPE);
    expect(retry).toEqual(keys(firstReqs));
    firstReqs.forEach((req, i) => {
      expect(keyOf(req)).toBe(referenceKey(INSTANCE_ID, EXECUTION_ID, NODE_ID, TOKENIZE_PATH, i, req.body, 3));
    });
  });

  it('no run index available: no key is sent (never a key shared across calls)', async () => {
    const reqs = await run({ runIndex: null });
    expect(reqs).toHaveLength(PEOPLE.length);
    for (const req of reqs) expect(keyOf(req)).toBeUndefined();
  });
});

describe('never on the unkeyed endpoints', () => {
  it('Local restore: the tokenize POST is keyed, the /maps PUT is not', async () => {
    const reqs = await run({
      items: [PEOPLE[0]],
      params: { returnMode: 'localRestore', scopeId: 'crm-sync' },
    });
    const tokenize = reqs.find((r) => r.url === TOKENIZE_PATH);
    const put = reqs.find((r) => r.url === '/api/v1/maps' && r.method === 'PUT');
    expect(put).toBeDefined();
    expect(keyOf(tokenize as (typeof reqs)[number]) ?? NO_HEADER).toMatch(KEY_SHAPE);
    // The repeated PUT is not billed: tests/api/maps-put-repeat-unbilled.test.ts (#619 C8).
    expect(keyOf(put as (typeof reqs)[number])).toBeUndefined();
  });

  it('Scan Text (/detect) and Get Usage (/usage) carry no key (guard: passes today)', async () => {
    const scan = await run({
      items: [item({ notes: 'Call Avery on Tuesday' })],
      params: { resource: 'text', operation: 'scanText', textField: 'notes' },
    });
    const usage = await run({ items: [item({})], params: { resource: 'account', operation: 'getUsage' } });
    expect(scan[0].url).toBe('/api/v1/detect');
    expect(usage[0].url).toBe('/api/v1/usage');
    expect(keyOf(scan[0])).toBeUndefined();
    expect(keyOf(usage[0])).toBeUndefined();
  });
});

describe('Retry-On-Fail guard (IT Council C6)', () => {
  it('Tokenize + Local restore + Retry On Fail ON is refused before any request', async () => {
    const http = routedHttp();
    const ctx = ctxFor({
      items: [PEOPLE[0]],
      params: { returnMode: 'localRestore', scopeId: 'crm-sync' },
      retryOnFail: true,
      http,
    });
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/Retry On Fail/);
    expect(http).not.toHaveBeenCalled();
  });

  it('Return Mode as a per-item expression (one item Local restore) + Retry On Fail ON is refused before any request', async () => {
    const http = routedHttp();
    const base = ctxFor({ items: PEOPLE, params: { scopeId: 'crm-sync' }, retryOnFail: true, http });
    const perItem = ['recordId', 'localRestore', 'recordId'];
    const ctx = {
      ...base,
      getNodeParameter: (name: string, i: number, fallback?: unknown) =>
        name === 'returnMode' ? perItem[i] : base.getNodeParameter(name, i, fallback as never),
    } as unknown as IExecuteFunctions;
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/Retry On Fail/);
    expect(http).not.toHaveBeenCalled();
  });

  const NO_RUN_ID = /^Turn off Retry On Fail for this node: this n8n run gives the node no run id, so a retry would be billed again\.$/;

  it.each([
    ['Tokenize', 'tokenize', 'instance id', { instanceId: undefined }],
    ['Tokenize', 'tokenize', 'execution id', { executionId: '' }],
    ['Tokenize (Batch)', 'tokenizeBatch', 'instance id', { instanceId: '' }],
    ['Tokenize (Batch)', 'tokenizeBatch', 'execution id', { executionId: undefined }],
    ['Tokenize', 'tokenize', 'run index', { runIndex: null }],
    ['Tokenize (Batch)', 'tokenizeBatch', 'run index', { runIndex: null }],
  ] as Array<[string, string, string, Partial<CtxOptions>]>)(
    '%s + Retry On Fail ON with no %s (no key possible) is refused before any request',
    async (_op, operation, _missing, ids) => {
      const http = routedHttp();
      const ctx = ctxFor({ items: [PEOPLE[0]], params: { operation }, retryOnFail: true, http, ...ids });
      await expect(new Taas().execute.call(ctx)).rejects.toThrow(NO_RUN_ID);
      expect(http).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Tokenize', 'tokenize'],
    ['Tokenize (Batch)', 'tokenizeBatch'],
  ])('%s with Retry On Fail OFF and no ids still runs, with no key header', async (_op, operation) => {
    const http = routedHttp();
    const ctx = ctxFor({ items: [PEOPLE[0]], params: { operation }, http, instanceId: undefined, executionId: undefined });
    await expect(new Taas().execute.call(ctx)).resolves.toBeDefined();
    expect(http).toHaveBeenCalledTimes(1);
    expect(keyOf(sent(http)[0])).toBeUndefined();
  });

  it('Tokenize (Batch) + Retry On Fail ON with both ids is allowed and keyed', async () => {
    const http = routedHttp();
    const ctx = ctxFor({ items: [PEOPLE[0]], params: { operation: 'tokenizeBatch' }, retryOnFail: true, http });
    await expect(new Taas().execute.call(ctx)).resolves.toBeDefined();
    expect(keyOf(sent(http)[0]) ?? NO_HEADER).toMatch(KEY_SHAPE);
  });

  it('Tokenize + Record ID + Retry On Fail ON is allowed (guard: passes today, must stay so)', async () => {
    const http = routedHttp();
    const ctx = ctxFor({ items: [PEOPLE[0]], params: {}, retryOnFail: true, http });
    await expect(new Taas().execute.call(ctx)).resolves.toBeDefined();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('Restore + Retry On Fail ON is still refused (guard unchanged; passes today)', async () => {
    const http = routedHttp();
    const ctx = ctxFor({ items: [PEOPLE[0]], params: { operation: 'restore' }, retryOnFail: true, http });
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/Retry On Fail/);
    expect(http).not.toHaveBeenCalled();
  });
});
