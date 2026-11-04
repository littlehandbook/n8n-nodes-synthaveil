/**
 * #619 (IT Council C2/C7) — operator messages for the idempotency answers (errors.ts).
 *
 * Wording is PENDING OWNER APPROVAL (decision form, C7), so this file pins only what the copy must
 * do, not its exact words: each code has its OWN message (defined, distinct from the others and
 * from the generic fallback), and a 409 still-processing that survives the one resend says the
 * request is still being finished ("still finishing").
 */
import type { INode } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { buildApiError, mapErrorToMessage } from '../../nodes/Taas/errors';
import { ctxFor } from './idempotencyTestKit';

jest.mock('n8n-workflow', () => ({
  ...jest.requireActual('n8n-workflow'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

const NODE = { id: 'node-1', name: 'Synthaveil', type: 'taas' } as unknown as INode;
const keyReused = { statusCode: 422, response: { body: { code: 'idempotency_key_reused' } } };
const settlementMismatch = { statusCode: 409, response: { body: { code: 'settlement_mismatch' } } };
const stillProcessing = {
  statusCode: 409,
  response: { headers: { 'retry-after': '1' }, body: { code: 'idempotency_conflict', retry_after: 1 } },
};
const generic422 = { statusCode: 422, response: { body: { code: 'something_else_entirely' } } };

describe('mapErrorToMessage — idempotency codes', () => {
  const reused = mapErrorToMessage(keyReused);
  const mismatch = mapErrorToMessage(settlementMismatch);
  const working = mapErrorToMessage(stillProcessing);

  it('422 idempotency_key_reused has its own message', () => {
    expect(reused).toEqual(expect.any(String));
    expect(reused).not.toBe(mapErrorToMessage(generic422));
  });

  it('409 settlement_mismatch has its own message', () => {
    expect(mismatch).toEqual(expect.any(String));
    expect(mismatch).not.toBe(mapErrorToMessage(generic422));
  });

  it('409 idempotency_conflict maps to the still-finishing message', () => {
    expect(working).toMatch(/still finishing/i);
  });

  it('the three messages are pairwise distinct', () => {
    expect(new Set([reused, mismatch, working]).size).toBe(3);
    expect([reused, mismatch, working]).not.toContain(undefined);
  });

  it('buildApiError carries the mapped copy, not the raw transport text', () => {
    expect(buildApiError(NODE, settlementMismatch, 0).message).toBe(mismatch);
    expect(buildApiError(NODE, keyReused, 0).message).toBe(reused);
  });
});

describe('execute() — a 409 still-processing that outlives the one resend', () => {
  it('fails the item with the still-finishing message after exactly two sends', async () => {
    const http = jest.fn().mockRejectedValue(stillProcessing);
    const ctx = ctxFor({ items: [{ json: { name: 'Avery Testperson' } }], params: {}, http });
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/still finishing/i);
    expect(http).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
  });
});
