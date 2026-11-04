/**
 * #619 quality review — the 409 resend must fire on the error shape n8n really throws, not only on
 * the hand-built `{ statusCode, response: { body } }` fakes. `httpRequestWithAuthentication` lets
 * axios fail with an `AxiosError` (status, parsed JSON body in `response.data`, headers in
 * `response.headers`) and wraps it as `new NodeApiError(node, axiosError)`. The real n8n-workflow
 * NodeApiError keeps the status on `httpCode` (a string) and the body on `context.data`, and drops
 * the AxiosError itself (ExecutionBaseError keeps `cause` only for non-Error causes), so the
 * Retry-After HEADER is gone and the wait must come from the body's `retry_after`.
 *
 * axios is not a dependency of this package (only a transitive one of the dev CLI), so the
 * AxiosError below is a local stand-in with the fields axios sets. NodeApiError recognises an
 * AxiosError by its constructor NAME; the fixture guard test pins the resulting shape.
 */
import { NodeApiError, sleep, type IExecuteFunctions, type INode, type JsonObject } from 'n8n-workflow';

import { taasRequest } from '../../nodes/Taas/transport';
import { buildApiError, mapErrorToMessage } from '../../nodes/Taas/errors';
import { TOKENIZE_PATH } from '../../src/constants';
import { keyOf, type SentRequest } from './idempotencyTestKit';

jest.mock('n8n-workflow', () => ({
  ...jest.requireActual('n8n-workflow'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

const NODE = { id: 'node-1', name: 'Synthaveil', type: 'taas' } as unknown as INode;
const KEY = 'n8n1_' + 'a'.repeat(64);
const BASE = 'https://staging.synthaveil.com';
const HTTP_CONFLICT = 409;
const RETRY_AFTER_SECONDS = 2;
const MS_PER_SECOND = 1000;

/** Minimal stand-in for axios's AxiosError (same class name and response fields). */
class AxiosError extends Error {
  readonly isAxiosError = true;
  constructor(
    message: string,
    readonly code: string,
    readonly response: { status: number; statusText: string; data: unknown; headers: Record<string, string> },
  ) {
    super(message);
    this.name = 'AxiosError';
  }
}

/** What n8n throws for a problem+json answer: NodeApiError wrapping an AxiosError. */
function n8nWrapped(status: number, data: Record<string, unknown>): NodeApiError {
  const response = {
    status,
    statusText: 'Error',
    data: { type: 'about:blank', title: 'error', status, ...data },
    headers: { 'retry-after': String(RETRY_AFTER_SECONDS), 'content-type': 'application/problem+json' },
  };
  const axiosError = new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', response);
  return new NodeApiError(NODE, axiosError as unknown as JsonObject);
}

/** A 409 with the given problem code, as n8n throws it. */
function n8nWrapped409(code: string): NodeApiError {
  return n8nWrapped(HTTP_CONFLICT, { code, retry_after: RETRY_AFTER_SECONDS });
}

function ctxWith(http: jest.Mock): IExecuteFunctions {
  return {
    getCredentials: jest.fn().mockResolvedValue({ baseUrl: BASE, apiKey: 'taas_sk_test_fake' }),
    getNode: jest.fn().mockReturnValue(NODE),
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;
}

const options = { baseUrl: BASE, method: 'POST' as const, path: TOKENIZE_PATH, body: { record: { name: 'x' } }, idempotencyKey: KEY };

beforeEach(() => (sleep as unknown as jest.Mock).mockClear());

describe('409 on the real n8n error shape (NodeApiError wrapping AxiosError)', () => {
  it('the shape really is what this suite claims (guard on the fixture)', () => {
    const err = n8nWrapped409('idempotency_conflict') as unknown as {
      httpCode: string;
      response?: unknown;
      cause?: unknown;
      context: { data?: { code?: string } };
    };
    expect(err.httpCode).toBe(String(HTTP_CONFLICT));
    expect(err.response).toBeUndefined();
    expect(err.cause).toBeUndefined();
    expect(err.context.data?.code).toBe('idempotency_conflict');
  });

  it('idempotency_conflict ⇒ one wait of the server hint, then one resend with the same key', async () => {
    const http = jest.fn().mockRejectedValueOnce(n8nWrapped409('idempotency_conflict')).mockResolvedValueOnce({ ok: true });
    await expect(taasRequest(ctxWith(http), options)).resolves.toEqual({ ok: true });
    expect(http).toHaveBeenCalledTimes(2);
    const [first, second] = http.mock.calls.map((c) => c[1] as SentRequest);
    expect(keyOf(second)).toBe(KEY);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(sleep).toHaveBeenCalledWith(RETRY_AFTER_SECONDS * MS_PER_SECOND);
  });

  it('settlement_mismatch ⇒ never resent', async () => {
    const http = jest.fn().mockRejectedValue(n8nWrapped409('settlement_mismatch'));
    await expect(taasRequest(ctxWith(http), options)).rejects.toBeDefined();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('the operator message is mapped from the wrapped body', () => {
    expect(mapErrorToMessage(n8nWrapped409('idempotency_conflict'))).toMatch(/still finishing/i);
  });
});

describe('buildApiError on the real n8n error shape — the throwing path shows our mapped copy', () => {
  const HTTP_PAYMENT_REQUIRED = 402;
  const HTTP_FORBIDDEN = 403;

  it('409 idempotency_conflict ⇒ the still-finishing message', () => {
    expect(buildApiError(NODE, n8nWrapped409('idempotency_conflict'), 0).message).toMatch(/still finishing/i);
  });

  it("what n8n renders (description ?? message) is the mapped copy, not n8n's own description", () => {
    const err = n8nWrapped(HTTP_CONFLICT, { code: 'idempotency_conflict', detail: 'raw server detail' });
    expect(err.description).toEqual(expect.any(String)); // n8n filled one in from the body
    const built = buildApiError(NODE, err, 0) as NodeApiError;
    expect(built.description ?? built.message).toMatch(/still finishing/i);
  });

  it('402 quota_exceeded ⇒ the mapped quota message, with its upgrade link', () => {
    const err = n8nWrapped(HTTP_PAYMENT_REQUIRED, { code: 'quota_exceeded', upgrade_url: 'https://synthaveil.com/upgrade' });
    expect(buildApiError(NODE, err, 0).message).toBe('Monthly quota exceeded. Upgrade your plan: https://synthaveil.com/upgrade');
  });

  it('403 dpa_required ⇒ the mapped DPA message with the portal link', () => {
    const err = n8nWrapped(HTTP_FORBIDDEN, { code: 'dpa_required' });
    expect(buildApiError(NODE, err, 0, BASE).message).toContain(`${BASE}/commercial/dpa`);
  });

  it('returns the same NodeApiError instance (no re-wrap) and keeps an unmapped one as n8n wrote it', () => {
    const mapped = n8nWrapped409('idempotency_conflict');
    expect(buildApiError(NODE, mapped, 0)).toBe(mapped);
    const unmapped = n8nWrapped(HTTP_CONFLICT, { code: 'some_future_code' });
    const before = unmapped.message;
    expect(buildApiError(NODE, unmapped, 0).message).toBe(before);
  });
});
