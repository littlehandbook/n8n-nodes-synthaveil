import type { ICredentialsDecrypted, ICredentialTestFunctions } from 'n8n-workflow';

import { taasApiTest } from '../../nodes/Taas/credentialTest';
import { DEFAULT_BASE_URL, USAGE_PATH } from '../../src/constants';

/**
 * SA-C1 (IT Council, QA review of PR #633): the credential connection check
 * must run the same base-URL policy `resolveBaseUrl` enforces at execution
 * time, and must make ZERO requests when that policy refuses the configured
 * target — a declarative `test.request.baseURL` could not do this (it can
 * only be a static expression), so `http://169.254.169.254` would have had
 * the Bearer key sent to it.
 */

const FAKE_KEY = 'sk-taas-FAKE-credtest-000';

function ctxWith(request: jest.Mock): ICredentialTestFunctions {
  return {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    helpers: { request } as unknown as ICredentialTestFunctions['helpers'],
  } as ICredentialTestFunctions;
}

/** `baseUrl` is options-bound and always present on a real credential. */
function decrypted(data: Record<string, unknown>): ICredentialsDecrypted {
  return {
    id: '1',
    name: 'acct',
    type: 'taasApi',
    data: { baseUrl: DEFAULT_BASE_URL, apiKey: FAKE_KEY, ...data },
  };
}

describe('taasApiTest — target selection (the stored host, never a host the operator did not configure)', () => {
  it('toggle off → requests the stored baseUrl host', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true });
    await taasApiTest.call(ctxWith(request), decrypted({ allowNonProductionUrl: false }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({ uri: `${DEFAULT_BASE_URL}${USAGE_PATH}` });
  });

  it('toggle off + a legacy off-list stored baseUrl → Error, no request (execution refuses it too)', async () => {
    // Before `baseUrl` became an options list it was free text, so an existing
    // credential can hold an allow-listed but off-list synthaveil.com host.
    // The Test button used to ignore the field, send the Bearer key to
    // production and report "Connection successful!" for a credential
    // `resolveBaseUrl` refuses at execution time.
    const request = jest.fn().mockResolvedValue({ ok: true });
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ baseUrl: 'https://eu.synthaveil.com', allowNonProductionUrl: false }),
    );
    expect(result.status).toBe('Error');
    expect(result.message).toMatch(/recognised API host/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('toggle on + a valid https override → requests the override host', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true });
    await taasApiTest.call(
      ctxWith(request),
      decrypted({
        allowNonProductionUrl: true,
        baseUrlOverride: 'https://self-hosted.example.com',
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      uri: `https://self-hosted.example.com${USAGE_PATH}`,
    });
  });
});

describe('taasApiTest — refuses an unsafe override with ZERO requests made', () => {
  // L08-1 fix_sketch, toggle OFF: the SSRF target sits in the STORED `baseUrl`,
  // not the override. Red at 6eae1e27 — the test ignored the stored field with
  // the toggle off, so it sent the Bearer key to production and reported
  // "Connection successful!" for a credential execution refuses outright.
  it('toggle off + a stored http://169.254.169.254 (SSRF metadata endpoint) → Error, no request', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ baseUrl: 'http://169.254.169.254', allowNonProductionUrl: false }),
    );
    expect(result.status).toBe('Error');
    expect(result.message).toMatch(/https/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('toggle off + a stored http://10.0.0.5 (private-network SSRF target) → Error, no request', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ baseUrl: 'http://10.0.0.5', allowNonProductionUrl: false }),
    );
    expect(result.status).toBe('Error');
    expect(result.message).toMatch(/https/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('toggle on + http://evil.example (not https) → Error, no request', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ allowNonProductionUrl: true, baseUrlOverride: 'http://evil.example' }),
    );
    expect(result.status).toBe('Error');
    expect(request).not.toHaveBeenCalled();
  });

  it('toggle on + http://169.254.169.254 (SSRF metadata endpoint) → Error, no request', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ allowNonProductionUrl: true, baseUrlOverride: 'http://169.254.169.254' }),
    );
    expect(result.status).toBe('Error');
    expect(request).not.toHaveBeenCalled();
  });

  it('toggle on + empty override → Error, no request (never silently falls back to production)', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ allowNonProductionUrl: true, baseUrlOverride: '' }),
    );
    expect(result.status).toBe('Error');
    expect(request).not.toHaveBeenCalled();
  });

  it('never includes the API key in an Error message', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      ctxWith(request),
      decrypted({ allowNonProductionUrl: true, baseUrlOverride: 'http://169.254.169.254' }),
    );
    expect(result.message).not.toContain(FAKE_KEY);
  });
});

describe('taasApiTest — status mapping once a request is actually sent', () => {
  it('200 → OK', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true });
    const result = await taasApiTest.call(ctxWith(request), decrypted({}));
    expect(result.status).toBe('OK');
  });

  it('401 → Error, key rejected', async () => {
    const request = jest.fn().mockRejectedValue({ statusCode: 401 });
    const result = await taasApiTest.call(ctxWith(request), decrypted({}));
    expect(result.status).toBe('Error');
    expect(result.message).toMatch(/invalid|revoked/i);
  });

  it('403 → Error, missing scope', async () => {
    const request = jest.fn().mockRejectedValue({ statusCode: 403 });
    const result = await taasApiTest.call(ctxWith(request), decrypted({}));
    expect(result.status).toBe('Error');
    expect(result.message).toMatch(/tokenize:read/);
  });

  it('404 → Error, existing base-URL message', async () => {
    const request = jest.fn().mockRejectedValue({ statusCode: 404 });
    const result = await taasApiTest.call(ctxWith(request), decrypted({}));
    expect(result.status).toBe('Error');
    expect(result.message).toMatch(/base url/i);
  });
});
