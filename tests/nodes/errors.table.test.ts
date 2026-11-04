import { readFileSync } from 'fs';
import { join } from 'path';

import {
  buildApiError,
  extractResponseBody,
  extractRetryAfterSeconds,
  mapLegacyErrorCodeToMessage,
  mapErrorToMessage,
} from '../../nodes/Taas/errors';

const authEchoFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'v1', 'error-401-auth-echo.json'), 'utf8'),
) as { _meta: { secret: string }; error: Record<string, unknown> };

/** Build a thrown-error shape with a problem+json body. */
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  statusCode: status,
  response: { body: { type: 'https://taas.dev/problems/x', title: code, status, code, ...extra } },
});

/** Build a thrown-error shape with a legacy { error, message? } body. */
const legacy = (status: number, error: string, message?: string) => ({
  statusCode: status,
  response: { body: message === undefined ? { error } : { error, message } },
});

const BASE = 'https://staging.synthaveil.com';

describe('mapErrorToMessage — problem+json taxonomy', () => {
  it.each([
    ['not_found', /not enabled at this base url/i],
    ['unauthorized', /invalid api key/i],
    ['service_unavailable', /temporarily unavailable/i],
    ['insufficient_scope', /tokenize:read and tokenize:write, plus restore for the Restore operation/i],
  ])('maps %s', (code, pattern) => {
    expect(mapErrorToMessage(problem(403, code), BASE)).toMatch(pattern);
  });

  it('maps dpa_required to an actionable portal link built from the base URL (P3)', () => {
    const msg = mapErrorToMessage(problem(403, 'dpa_required'), BASE);
    expect(msg).toMatch(/sign your dpa/i);
    expect(msg).toContain(`${BASE}/commercial/dpa`);
  });

  it('falls back to a generic portal hint for dpa_required when no base URL is known', () => {
    const msg = mapErrorToMessage(problem(403, 'dpa_required'));
    expect(msg).toContain('/commercial/dpa');
  });

  it('maps quota_exceeded and includes the upgrade_url from the body', () => {
    const msg = mapErrorToMessage(
      problem(402, 'quota_exceeded', { upgrade_url: 'https://portal/upgrade' }),
      BASE,
    );
    expect(msg).toMatch(/quota exceeded/i);
    expect(msg).toContain('https://portal/upgrade');
  });

  it('maps rate_limit_exceeded and surfaces the retry_after hint', () => {
    const msg = mapErrorToMessage(problem(429, 'rate_limit_exceeded', { retry_after: 5 }), BASE);
    expect(msg).toMatch(/rate limit exceeded/i);
    expect(msg).toMatch(/retry after 5s/i);
  });
});

describe('mapErrorToMessage — legacy { error } taxonomy', () => {
  it.each([
    ['l3_unavailable', /l3.*not enabled/i],
    ['invalid_text', /missing, empty, or longer/i],
    ['geo_unresolvable_input', /could not be resolved/i],
    ['geo_privacy_floor_refusal', /protect privacy/i],
  ])('maps %s', (code, pattern) => {
    expect(mapErrorToMessage(legacy(422, code), BASE)).toMatch(pattern);
  });

  it('surfaces a human validation message verbatim (400/422 body-validation)', () => {
    const msg = mapErrorToMessage(legacy(400, 'record exceeds 200 fields'), BASE);
    expect(msg).toBe('record exceeds 200 fields');
  });

  it('prefers the message field over an unknown machine code', () => {
    const msg = mapErrorToMessage(legacy(400, 'some_unknown_code', 'Human readable detail'), BASE);
    expect(msg).toBe('Human readable detail');
  });

  it('maps the company key code when it arrives in a batch result slot', () => {
    expect(mapLegacyErrorCodeToMessage('company_entity_key_missing')).toMatch(
      /registration identifier/i,
    );
  });
});

describe('mapErrorToMessage — fallbacks (unchanged from 1b)', () => {
  it('uses the HTTP-status message when there is no body', () => {
    expect(mapErrorToMessage({ statusCode: 404 })).toMatch(/not enabled at this base url/i);
    expect(mapErrorToMessage({ statusCode: 403 })).toMatch(/tokenize:read/);
  });

  it('returns undefined for an unmapped status with no body', () => {
    expect(mapErrorToMessage({ statusCode: 500 })).toBeUndefined();
    expect(mapErrorToMessage(new Error('network down'))).toBeUndefined();
  });
});

describe('credential exposure — A1/I5 (no API key in messages or serialized errors)', () => {
  const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as never;
  const SECRET = authEchoFixture._meta.secret;
  const echoError = authEchoFixture.error;

  /** Every string reachable from an error object, own-props deep (incl. cause chain). */
  const deepSerialize = (value: unknown): string => {
    const seen = new Set<object>();
    const walk = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (typeof v !== 'object' || v === null) return '';
      if (seen.has(v)) return '';
      seen.add(v);
      return Object.getOwnPropertyNames(v)
        .map((k) => walk((v as Record<string, unknown>)[k]))
        .join('\n');
    };
    return walk(value);
  };

  it('fixture sanity: the raw thrown error DOES carry the key everywhere', () => {
    expect(SECRET).toContain('sk-taas-FAKE');
    expect(deepSerialize(echoError)).toContain(SECRET);
  });

  it('mapErrorToMessage never surfaces the echoed Authorization value', () => {
    const msg = mapErrorToMessage(echoError, BASE);
    expect(msg).toBeDefined();
    expect(msg).not.toContain(SECRET);
  });

  it('buildApiError message carries no credential material', () => {
    const err = buildApiError(node, echoError, 0, BASE);
    expect(err.message).not.toContain(SECRET);
  });

  it('buildApiError serialized error (own props + cause chain) carries no credential material', () => {
    const err = buildApiError(node, echoError, 0, BASE);
    expect(deepSerialize(err)).not.toContain(SECRET);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(SECRET);
  });

  it('an unmapped error whose own message embeds the key is still scrubbed', () => {
    const hostile = {
      statusCode: 500,
      message: `Request failed. Sent headers: { Authorization: "${SECRET}" }`,
    };
    const err = buildApiError(node, hostile, 0, BASE);
    expect(err.message).not.toContain(SECRET);
    expect(deepSerialize(err)).not.toContain(SECRET);
  });
});

describe('extractResponseBody', () => {
  it('reads an object body', () => {
    expect(extractResponseBody({ response: { body: { code: 'x' } } })).toEqual({ code: 'x' });
  });
  it('parses a JSON string body', () => {
    expect(extractResponseBody({ response: { body: '{"code":"y"}' } })).toEqual({ code: 'y' });
  });
  it('returns undefined when there is no body', () => {
    expect(extractResponseBody({ statusCode: 500 })).toBeUndefined();
    expect(extractResponseBody(null)).toBeUndefined();
  });
});

describe('extractRetryAfterSeconds', () => {
  it('reads the Retry-After header case-insensitively', () => {
    expect(extractRetryAfterSeconds({ response: { headers: { 'Retry-After': '30' } } })).toBe(30);
  });
  it('falls back to the retry_after body extension', () => {
    expect(extractRetryAfterSeconds({ response: { body: { retry_after: 7 } } })).toBe(7);
  });
  it('returns undefined when neither is present', () => {
    expect(extractRetryAfterSeconds({ statusCode: 429 })).toBeUndefined();
  });
});

describe('scrubbing preserves shared non-cyclic references — finding E (DAG-safe scrubber)', () => {
  // Finding E (2026-08-25 code-review remediation): scrubCredentialMaterial's
  // add-only `seen` set turns the SECOND visit to ANY object into `undefined` —
  // for shared references (a DAG, not a cycle), whichever alias enumerates
  // later is silently dropped. When that alias is `error.response`, every
  // extractor (status code, body code, retry_after) goes blind and the mapped
  // operator message is lost. These errors are built in TypeScript because JSON
  // fixtures cannot express shared references.
  //
  // Asserted through buildApiError (the real consumer of the scrubbed object).
  // For a non-Error payload, n8n's NodeApiError stores the scrubbed object on
  // `errorResponse` (ExecutionBaseError) — used below for structural checks.
  const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as never;

  const payloadOf = (err: Error): Record<string, unknown> | undefined =>
    (err as unknown as { errorResponse?: Record<string, unknown> }).errorResponse;

  /** Every string reachable own-props deep (local copy; the sibling helper is describe-scoped). */
  const deepStrings = (value: unknown): string => {
    const seen = new Set<object>();
    const walk = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (typeof v !== 'object' || v === null) return '';
      if (seen.has(v)) return '';
      seen.add(v);
      return Object.getOwnPropertyNames(v)
        .map((k) => walk((v as Record<string, unknown>)[k]))
        .join('\n');
    };
    return walk(value);
  };

  it('a response object also referenced from request survives scrubbing → 401 still maps', () => {
    const response = { statusCode: 401, body: { code: 'unauthorized' } };
    // Insertion order puts `request` first, so the scrubber walks the shared
    // object there first and (today) nukes the top-level `response` alias.
    const err = { request: { response }, response };
    expect(buildApiError(node, err, 0, BASE).message).toMatch(/invalid api key/i);
  });

  it('cause.response === response (axios-style alias): 429 mapping and retry hint survive', () => {
    const shared = { statusCode: 429, body: { code: 'rate_limit_exceeded', retry_after: 5 } };
    const err = { cause: { response: shared }, response: shared };
    const message = buildApiError(node, err, 0, BASE).message;
    expect(message).toMatch(/rate limit exceeded/i);
    expect(message).toMatch(/retry after 5s/i);
  });

  it('a duplicated object in an array is present (and redacted) at BOTH indices', () => {
    const hop = { authorization: 'Bearer sk-test-123', via: 'proxy-a' };
    const err = { statusCode: 500, message: 'relay failed', hops: [hop, hop] };
    const built = buildApiError(node, err, 0, BASE);
    const hops = (payloadOf(built)?.hops ?? []) as unknown[];
    expect(hops).toHaveLength(2);
    const [first, second] = hops;
    expect(first).toEqual(expect.objectContaining({ authorization: '[redacted]', via: 'proxy-a' }));
    // Today the second alias is scrubbed to `undefined` — the entry vanishes.
    expect(second).toEqual(expect.objectContaining({ authorization: '[redacted]', via: 'proxy-a' }));
    expect(deepStrings(built)).not.toContain('sk-test-123');
  });

  it('a shared headers object is redacted in BOTH places it is referenced', () => {
    const headers = { authorization: 'Bearer sk-test-456', 'content-type': 'application/json' };
    const err = {
      statusCode: 500,
      message: 'send failed',
      config: { headers },
      response: { statusCode: 500, config: { headers } },
    };
    const built = buildApiError(node, err, 0, BASE);
    const payload = payloadOf(built);
    const configHeaders = (payload?.config as Record<string, unknown> | undefined)?.headers;
    const responseConfig = (payload?.response as Record<string, unknown> | undefined)
      ?.config as Record<string, unknown> | undefined;
    expect(configHeaders).toEqual(expect.objectContaining({ authorization: '[redacted]' }));
    // Today the second alias (response.config.headers) is scrubbed to `undefined`.
    expect(responseConfig?.headers).toEqual(
      expect.objectContaining({ authorization: '[redacted]' }),
    );
    expect(deepStrings(built)).not.toContain('sk-test-456');
  });
});

// Slice B1 (Synthaveil migration 0384): an org with no plan has its keys paused (402
// plan_required); a plan without API access (Entry) is 403 plan_has_no_api_access. Each says
// what to do, with the body's upgrade_url when it carries one. WRITTEN RED, 2026-10-12.
describe('mapErrorToMessage — plan refusals', () => {
  it('maps plan_required and includes the upgrade_url from the body', () => {
    const msg = mapErrorToMessage(
      problem(402, 'plan_required', { upgrade_url: 'https://portal/upgrade' }),
      BASE,
    );
    expect(msg).toMatch(/no active plan/i);
    expect(msg).toMatch(/paused/i);
    expect(msg).toContain('https://portal/upgrade');
  });

  it('maps plan_has_no_api_access to the plan sentence', () => {
    const msg = mapErrorToMessage(problem(403, 'plan_has_no_api_access'), BASE);
    expect(msg).toMatch(/does not include API keys/i);
  });
});
