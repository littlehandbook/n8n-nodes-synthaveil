/**
 * QA review (PR #523, finding 8): Continue On Fail writes the failure into the
 * item, where it flows on to the next node and into the execution log. That
 * path must never carry credential material.
 *
 * `perItemErrorRow` fell back to the RAW `error.message` whenever the error had
 * no mapped problem code — and transport errors routinely embed the request,
 * including its Authorization header. The scrubber existed and was already used
 * on the throwing path; the Continue On Fail path simply never called it.
 */
import { perItemErrorRow } from '../../nodes/Taas/errors';
import { scrubCredentialMaterial } from '../../nodes/Taas/errorScrubbing';

const BASE_URL = 'https://api.synthaveil.com';
// Deliberately a Synthaveil-shaped key from the sanctioned `sv_example_*`
// placeholder family (scripts/check-fixture-secrets.js, and the global
// allowlist in .gitleaks.toml). This node authenticates against Synthaveil,
// never Stripe, so the previous `sk_live_...` literal was both inaccurate and
// enough to trip the `stripe-access-token` rule in secrets-gitleaks. The
// scrubber matches on the `Bearer <token>` shape, not on the token's own
// format, so the substitution tests exactly the same path.
const SECRET = 'sv_example_a1b2c3d4e5f6g7h8';

describe('perItemErrorRow never emits credential material', () => {
  it('redacts a bearer token carried in an unmapped error message', () => {
    const error = new Error(`connect ECONNREFUSED — sent Authorization: Bearer ${SECRET}`);

    const row = perItemErrorRow(error, 0, BASE_URL);

    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(String(row.json.error)).toContain('[redacted]');
  });

  it('redacts a bearer token carried in a mapped API problem message', () => {
    const error = Object.assign(new Error('Request failed'), {
      response: {
        statusCode: 400,
        body: { error: 'bad_request', message: `rejected Bearer ${SECRET}` },
      },
    });

    const row = perItemErrorRow(error, 1, BASE_URL);

    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it('leaves an ordinary message untouched', () => {
    const row = perItemErrorRow(new Error('Something ordinary failed'), 2, BASE_URL);

    expect(row.json.error).toBe('Something ordinary failed');
    expect(row.pairedItem).toEqual({ item: 2 });
  });
});

describe('scrubCredentialMaterial redacts the Idempotency-Key header (#619)', () => {
  const KEY = 'n8n1_' + 'd'.repeat(64);

  it.each(['Idempotency-Key', 'idempotency-key'])('redacts a %s header carried on the failed request', (name) => {
    const error = Object.assign(new Error('Request failed with status code 503'), {
      config: { headers: { [name]: KEY, 'Content-Type': 'application/json' } },
    });

    const scrubbed = scrubCredentialMaterial(error) as { config: { headers: Record<string, string> } };

    expect(JSON.stringify(scrubbed)).not.toContain(KEY);
    expect(scrubbed.config.headers[name]).toBe('[redacted]');
    expect(scrubbed.config.headers['Content-Type']).toBe('application/json');
  });
});

describe('scrubCredentialMaterial redacts a raw Idempotency-Key header line (#619)', () => {
  const KEY = 'n8n1_' + 'f'.repeat(64);

  it('redacts the key inside a request._header string', () => {
    const error = Object.assign(new Error('socket hang up'), {
      request: {
        _header: `POST /api/v1/tokenize HTTP/1.1\r\nAccept: application/json\r\nIdempotency-Key: ${KEY}\r\nHost: api.synthaveil.com\r\n\r\n`,
      },
    });

    const scrubbed = scrubCredentialMaterial(error) as { request: { _header: string } };

    expect(JSON.stringify(scrubbed)).not.toContain(KEY);
    expect(scrubbed.request._header).toContain('Idempotency-Key: [redacted]');
    expect(scrubbed.request._header).toContain('Host: api.synthaveil.com');
  });
});

describe('scrubCredentialMaterial redacts JSON-style Idempotency-Key text (#619)', () => {
  const KEY = 'n8n1_' + '9'.repeat(64);

  it.each([
    ['JSON', `{"headers":{"Idempotency-Key":"${KEY}","Accept":"application/json"}}`],
    ['single-quoted', `{ 'idempotency-key': '${KEY}' }`],
    ['query-style', `idempotency-key=${KEY}&x=1`],
  ])('redacts the key in %s text', (_label, text) => {
    const scrubbed = scrubCredentialMaterial(new Error(`request failed: ${text}`)) as Error;

    expect(scrubbed.message).not.toContain(KEY);
    expect(scrubbed.message).toContain('[redacted]');
  });
});
