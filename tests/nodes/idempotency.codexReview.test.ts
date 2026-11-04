/**
 * #619 Codex review round — node behaviour around the Idempotency-Key:
 *  - Tokenize (Batch) Continue-On-Fail rows scrub the raw fallback message (Bearer token, key).
 *  - The Local-restore Retry-On-Fail pre-scan survives a Return Mode expression that throws for
 *    one item (that item is left to the per-item loop), and still refuses any Local restore item.
 *  - The transport composes its bounded retries: one 429 retry and one 409-conflict resend, each
 *    at most once, in either order, always with the same key and body.
 */
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { taasRequest } from '../../nodes/Taas/transport';
import { TOKENIZE_PATH } from '../../src/constants';
import { ctxFor, keyOf, routedHttp, type SentRequest } from './idempotencyTestKit';

jest.mock('n8n-workflow', () => ({
  ...jest.requireActual('n8n-workflow'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

const SECRET = 'sv_example_a1b2c3d4e5f6g7h8';
const KEY = 'n8n1_' + 'b'.repeat(64);
const PEOPLE: INodeExecutionData[] = [
  { json: { name: 'Avery Testperson' } },
  { json: { name: 'Blake Fakename' } },
  { json: { name: 'Casey Madeup' } },
];

function withOverrides(base: IExecuteFunctions, over: Partial<Record<keyof IExecuteFunctions, unknown>>): IExecuteFunctions {
  return { ...base, ...over } as unknown as IExecuteFunctions;
}

describe('Tokenize (Batch) Continue On Fail rows are scrubbed', () => {
  it('a raw transport message carrying a Bearer token and the key never reaches the item', async () => {
    const http = jest.fn().mockRejectedValue(new Error(`socket hang up; sent Authorization: Bearer ${SECRET} Idempotency-Key: ${KEY}`));
    const base = ctxFor({ items: PEOPLE, params: { operation: 'tokenizeBatch' }, http });
    const ctx = withOverrides(base, { continueOnFail: () => true });
    const [rows] = await new Taas().execute.call(ctx);
    expect(rows).toHaveLength(PEOPLE.length);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(KEY);
    expect(text).toContain('[redacted]');
  });
});

describe('Local restore Retry-On-Fail pre-scan and a throwing Return Mode expression', () => {
  const throwingAt = (bad: number, modes: string[]) => (base: IExecuteFunctions) =>
    withOverrides(base, {
      getNodeParameter: (name: string, i: number, fallback?: unknown) => {
        if (name !== 'returnMode') return base.getNodeParameter(name, i, fallback as never);
        if (i === bad) throw new Error('expression failed for this item');
        return modes[i];
      },
    });

  it('does not abort the run: the other items tokenize, the bad item gets its own error row', async () => {
    const http = routedHttp();
    const base = ctxFor({ items: PEOPLE, params: {}, retryOnFail: true, http });
    const ctx = withOverrides(throwingAt(1, ['recordId', 'recordId', 'recordId'])(base), { continueOnFail: () => true });
    const [rows] = await new Taas().execute.call(ctx);
    expect(rows).toHaveLength(PEOPLE.length);
    expect(rows[1].json.error).toEqual(expect.any(String));
    expect(rows[0].json.error).toBeUndefined();
    expect(rows[2].json.error).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('still refuses before any request when another item resolves to Local restore', async () => {
    const http = routedHttp();
    const base = ctxFor({ items: PEOPLE, params: { scopeId: 'crm-sync' }, retryOnFail: true, http });
    const ctx = throwingAt(0, ['recordId', 'recordId', 'localRestore'])(base);
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/Retry On Fail/);
    expect(http).not.toHaveBeenCalled();
  });
});

describe('transport — one 429 retry and one 409 resend compose', () => {
  const conflict = { statusCode: 409, response: { body: { code: 'idempotency_conflict', retry_after: 1 } } };
  const rateLimited = { statusCode: 429, response: { body: { code: 'rate_limit_exceeded', retry_after: 1 } } };
  const ctxWith = (http: jest.Mock): IExecuteFunctions =>
    ({
      getCredentials: jest.fn().mockResolvedValue({ baseUrl: 'https://staging.synthaveil.com', apiKey: 'taas_sk_test_fake' }),
      getNode: jest.fn().mockReturnValue({ id: 'node-1', name: 'Synthaveil', type: 'taas' }),
      helpers: { httpRequestWithAuthentication: http },
    }) as unknown as IExecuteFunctions;
  const opts = { baseUrl: 'https://staging.synthaveil.com', method: 'POST' as const, path: TOKENIZE_PATH, body: { record: { name: 'x' } }, idempotencyKey: KEY };
  const sends = (http: jest.Mock): SentRequest[] => http.mock.calls.map((c) => c[1] as SentRequest);

  beforeEach(() => (sleep as unknown as jest.Mock).mockClear());

  it.each([
    ['409 then 429', [conflict, rateLimited]],
    ['429 then 409', [rateLimited, conflict]],
  ])('%s: each gets its single retry (3 sends), same key and body', async (_label, failures) => {
    const http = jest.fn();
    for (const f of failures) http.mockRejectedValueOnce(f);
    http.mockResolvedValueOnce({ ok: true });
    await expect(taasRequest(ctxWith(http), opts)).resolves.toEqual({ ok: true });
    expect(http).toHaveBeenCalledTimes(3);
    const sent = sends(http);
    expect(new Set(sent.map(keyOf))).toEqual(new Set([KEY]));
    expect(new Set(sent.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['429, 409, 429', [rateLimited, conflict, rateLimited]],
    ['409, 429, 409', [conflict, rateLimited, conflict]],
  ])('%s: the third failure propagates — still bounded at 3 sends', async (_label, failures) => {
    const http = jest.fn();
    for (const f of failures) http.mockRejectedValueOnce(f);
    http.mockResolvedValue({ ok: true });
    await expect(taasRequest(ctxWith(http), opts)).rejects.toBe(failures[2]);
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('429 with Retry On Rate Limit off propagates at once (no retry)', async () => {
    const http = jest.fn().mockRejectedValueOnce(rateLimited).mockResolvedValue({ ok: true });
    await expect(taasRequest(ctxWith(http), { ...opts, retryOnRateLimit: false })).rejects.toBe(rateLimited);
    expect(http).toHaveBeenCalledTimes(1);
  });
});
