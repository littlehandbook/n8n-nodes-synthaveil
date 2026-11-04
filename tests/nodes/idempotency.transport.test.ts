/**
 * #619 (IT Council C2/C5) — the transport carries the Idempotency-Key, only where it belongs, and
 * handles the 409 answers.
 *
 * CONTRACT FOR THE IMPLEMENTER (names fixed here):
 *  - `TaasRequestOptions.idempotencyKey?: string` (transport.ts). When set AND the path is
 *    TOKENIZE_PATH or BATCH_PATH, the request carries `headers: { 'Idempotency-Key': <key> }`.
 *    On any other path (/detect, /maps PUT, /maps/{handle}/consume, /usage) it is dropped — an
 *    allow-list in the transport, so a future caller cannot leak a key onto an unkeyed endpoint.
 *  - 409 `idempotency_conflict`: ONE bounded wait-and-resend with the SAME key and the SAME body,
 *    waiting the Retry-After / retry_after hint clamped to MAX_RETRY_AFTER_SECONDS (60 s); a
 *    second 409 propagates (the caller maps it to the still-finishing message).
 *  - 409 `settlement_mismatch` is never resent.
 *  - the existing single 429 retry re-sends the same key.
 */
import type { IExecuteFunctions } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { taasRequest, type TaasRequestOptions } from '../../nodes/Taas/transport';
import { BATCH_PATH, DETECT_PATH, MAPS_PATH, TOKENIZE_PATH, USAGE_PATH } from '../../src/constants';
import { IDEMPOTENCY_HEADER, NO_HEADER, keyOf, type SentRequest } from './idempotencyTestKit';

jest.mock('n8n-workflow', () => ({
  ...jest.requireActual('n8n-workflow'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

const sleepMock = sleep as unknown as jest.Mock;
const KEY = 'n8n1_' + 'c'.repeat(64);
const BASE = 'https://staging.synthaveil.com';
const MAX_RETRY_AFTER_MS = 60_000;

function ctxWith(http: jest.Mock): IExecuteFunctions {
  return {
    getCredentials: jest.fn().mockResolvedValue({ baseUrl: BASE, apiKey: 'taas_sk_test_fake' }),
    getNode: jest.fn().mockReturnValue({ id: 'node-1', name: 'Synthaveil', type: 'taas' }),
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;
}

/** Build options with the new `idempotencyKey` field without depending on today's type. */
function opts(path: string, extra: Record<string, unknown> = {}): TaasRequestOptions {
  return {
    baseUrl: BASE,
    method: path === MAPS_PATH ? 'PUT' : path === USAGE_PATH ? 'GET' : 'POST',
    path,
    body: path === USAGE_PATH ? undefined : { record: { name: 'Avery Testperson' } },
    idempotencyKey: KEY,
    ...extra,
  } as unknown as TaasRequestOptions;
}

const conflict = (retryAfter = '0') => ({
  statusCode: 409,
  response: { headers: { 'retry-after': retryAfter }, body: { code: 'idempotency_conflict', retry_after: 1 } },
});
const settlementMismatch = () => ({ statusCode: 409, response: { body: { code: 'settlement_mismatch' } } });
const rateLimited = () => ({
  statusCode: 429,
  response: { headers: { 'retry-after': '0' }, body: { code: 'rate_limit_exceeded' } },
});

const requests = (http: jest.Mock): SentRequest[] => http.mock.calls.map((c) => c[1] as SentRequest);

beforeEach(() => sleepMock.mockClear());

describe('the header is allow-listed to the two keyed endpoints', () => {
  it.each([
    ['Tokenize', TOKENIZE_PATH],
    ['Tokenize (Batch)', BATCH_PATH],
  ])('%s carries Idempotency-Key exactly as given', async (_label, path) => {
    const http = jest.fn().mockResolvedValue({ ok: true });
    await taasRequest(ctxWith(http), opts(path));
    const [req] = requests(http);
    expect(keyOf(req) ?? NO_HEADER).toBe(KEY);
    expect(Object.keys(req.headers ?? {})).toContain(IDEMPOTENCY_HEADER);
  });

  it.each([
    ['Detect', DETECT_PATH],
    ['Maps PUT', MAPS_PATH],
    ['Maps consume', `${MAPS_PATH}/svh1-${'a'.repeat(22)}/consume`],
    ['Usage', USAGE_PATH],
  ])('%s never carries it, even when a caller passes one (guard: passes today)', async (_label, path) => {
    const http = jest.fn().mockResolvedValue({ ok: true });
    await taasRequest(ctxWith(http), opts(path));
    expect(keyOf(requests(http)[0])).toBeUndefined();
  });

  it('no idempotencyKey ⇒ no header (today behaviour, guard: passes today)', async () => {
    const http = jest.fn().mockResolvedValue({ ok: true });
    await taasRequest(ctxWith(http), opts(TOKENIZE_PATH, { idempotencyKey: undefined }));
    expect(keyOf(requests(http)[0])).toBeUndefined();
  });
});

describe('409 idempotency_conflict — one bounded wait-and-resend', () => {
  it('resends ONCE with the same key and the same body, and returns the resend result', async () => {
    const http = jest.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ ok: 'replayed' });
    const out = await taasRequest(ctxWith(http), opts(TOKENIZE_PATH));
    expect(out).toEqual({ ok: 'replayed' });
    const [first, second] = requests(http);
    expect(http).toHaveBeenCalledTimes(2);
    expect(keyOf(second) ?? NO_HEADER).toBe(KEY);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(second.body).toEqual(first.body);
  });

  it('a second 409 propagates (bounded: exactly two sends)', async () => {
    const http = jest.fn().mockRejectedValue(conflict());
    await expect(taasRequest(ctxWith(http), opts(BATCH_PATH))).rejects.toMatchObject({ statusCode: 409 });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('waits the Retry-After hint, clamped to MAX_RETRY_AFTER_SECONDS (60 s)', async () => {
    const http = jest.fn().mockRejectedValueOnce(conflict('9999')).mockResolvedValueOnce({ ok: true });
    await taasRequest(ctxWith(http), opts(TOKENIZE_PATH));
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(MAX_RETRY_AFTER_MS);
  });

  it('waits the server hint when it is in range (1 s)', async () => {
    const http = jest.fn().mockRejectedValueOnce(conflict('1')).mockResolvedValueOnce({ ok: true });
    await taasRequest(ctxWith(http), opts(TOKENIZE_PATH));
    expect(sleepMock).toHaveBeenCalledWith(1_000);
  });
});

describe('409 settlement_mismatch and 429', () => {
  it('settlement_mismatch is never resent (guard: passes today)', async () => {
    const http = jest.fn().mockRejectedValue(settlementMismatch());
    await expect(taasRequest(ctxWith(http), opts(TOKENIZE_PATH))).rejects.toMatchObject({ statusCode: 409 });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('the single 429 retry re-sends the same key', async () => {
    const http = jest.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce({ ok: true });
    await taasRequest(ctxWith(http), opts(BATCH_PATH));
    const [first, second] = requests(http);
    expect(keyOf(first) ?? NO_HEADER).toBe(KEY);
    expect(keyOf(second)).toBe(KEY);
  });
});
