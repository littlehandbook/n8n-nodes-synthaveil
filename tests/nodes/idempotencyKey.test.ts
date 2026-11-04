/**
 * #619 (IT Council C4) — the n8n node's Idempotency-Key derivation, as a pure function.
 *
 * CONTRACT FOR THE IMPLEMENTER (names fixed here):
 *   module  integrations/n8n-nodes-taas/nodes/Taas/idempotencyKey.ts
 *   export  deriveIdempotencyKey(input: {
 *             instanceId: string | undefined;   // this.getInstanceId() (added in Codex review)
 *             executionId: string | undefined;  // this.getExecutionId()
 *             nodeId: string;                    // this.getNode().id (NOT the node name)
 *             runIndex: number | undefined;      // $thisRunIndex (Codex review on #1622)
 *             endpoint: string;                  // TOKENIZE_PATH or BATCH_PATH
 *             index: number;                     // itemIndex (Tokenize) or chunk.startIndex (Batch)
 *             body: IDataObject;                 // the request body handed to the transport
 *           }): string | undefined
 *     = 'n8n1_' + hex(sha256('n8n1' | instanceId | executionId | nodeId | runIndex | endpoint | index | hex(sha256(JSON.stringify(body)))))
 *     and `undefined` (send NO header) when runIndex is undefined, or executionId is undefined, empty or blank (n8n#16965:
 *     getExecutionId() can be empty in some run modes — a constant key would replay across runs).
 *   See idempotencyTestKit.ts#referenceKey.
 *
 * The run index separates a loop or a usableAsTool agent calling the node twice in one execution,
 * even with identical data; the body digest separates different data within one run.
 */
import type { IDataObject } from 'n8n-workflow';

import { deriveIdempotencyKey } from '../../nodes/Taas/idempotencyKey';
import { BATCH_PATH, TOKENIZE_PATH } from '../../src/constants';
import { EXECUTION_ID, INSTANCE_ID, KEY_SHAPE, NODE_ID, referenceKey } from './idempotencyTestKit';

const BODY: IDataObject = {
  record: { name: 'Avery Testperson' },
  policy: { fields: { name: { method: 'l2.synthesize-name' } } },
};

type Input = Parameters<typeof deriveIdempotencyKey>[0];
const base: Input = { instanceId: INSTANCE_ID, executionId: EXECUTION_ID, nodeId: NODE_ID, runIndex: 0, endpoint: TOKENIZE_PATH, index: 0, body: BODY };
const derive = (over: Partial<Input> = {}): string | undefined => deriveIdempotencyKey({ ...base, ...over });

describe('deriveIdempotencyKey — n8n1 key', () => {
  it('equals the council formula byte-for-byte', () => {
    expect(derive()).toBe(referenceKey(INSTANCE_ID, EXECUTION_ID, NODE_ID, TOKENIZE_PATH, 0, BODY));
  });

  it('is prefixed, hex and fixed length (n8n1_ + 64 hex)', () => {
    expect(derive()).toMatch(KEY_SHAPE);
    const big = { ...BODY, record: { name: 'x'.repeat(10_000) } };
    expect(derive({ body: big })).toHaveLength((derive() as string).length);
  });

  it('is stable: same inputs, same key (n8n Retry On Fail re-enters execute() with the same execution id)', () => {
    expect(derive()).toBe(derive());
    expect(derive({ body: JSON.parse(JSON.stringify(BODY)) })).toBe(derive());
  });

  it.each([
    ['n8n installation', { instanceId: 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1' }],
    ['executionId', { executionId: 'exec-619-0002' }],
    ['node id', { nodeId: '3b0c6c1e-6f2a-4d5e-9a7b-000000000620' }],
    ['run index (a loop or a second agent tool call)', { runIndex: 1 }],
    ['endpoint', { endpoint: BATCH_PATH }],
    ['index', { index: 1 }],
    ['body', { body: { ...BODY, record: { name: 'Blake Fakename' } } }],
  ] as Array<[string, Partial<Input>]>)('differs when the %s differs', (_label, over) => {
    expect(derive(over)).toMatch(KEY_SHAPE);
    expect(derive(over)).not.toBe(derive());
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('returns undefined (no header) when the execution id is %s', (_label, executionId) => {
    expect(derive({ executionId })).toBeUndefined();
  });

  it('returns undefined (no header) when the run index is unknown', () => {
    expect(derive({ runIndex: undefined })).toBeUndefined();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('returns undefined (no header, never a random key) when the instance id is %s', (_label, instanceId) => {
    expect(derive({ instanceId })).toBeUndefined();
  });

  it('carries no input text', () => {
    const key = derive() as string;
    for (const fragment of ['Avery', 'Testperson', EXECUTION_ID, NODE_ID, 'tokenize', 'synthesize']) {
      expect(key).not.toContain(fragment);
    }
  });
});
