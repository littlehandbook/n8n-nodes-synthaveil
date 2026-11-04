import type {
  ICredentialDataDecryptedObject,
  ICredentialsDecrypted,
  ICredentialTestFunctions,
  IExecuteFunctions,
} from 'n8n-workflow';

import { taasApiTest } from '../../nodes/Taas/credentialTest';
import { resolveBaseUrl } from '../../nodes/Taas/transport';
import { DEFAULT_BASE_URL, USAGE_PATH } from '../../src/constants';

/**
 * The credential Test button and execution must agree (QA verification of
 * PR #633, claims (a) and (b); fixed 2026-09-14).
 *
 * Phase 4 extracted the URL *check* into src/baseUrlPolicy.ts so there was one
 * implementation, but target *selection* stayed written twice -- once in
 * `resolveTestTarget` (credentialTest.ts) and once in `resolveBaseUrl`
 * (transport.ts) -- and the two copies disagreed:
 *
 * (a) Toggle OFF: the credential test IGNORED the stored `baseUrl` and always
 *     targeted production. Before `baseUrl` became an options list it was free
 *     text, so an existing credential can still hold a non-default
 *     synthaveil.com host. The Test button sent the Bearer key to a host the
 *     operator never configured, and reported success for a credential
 *     `resolveBaseUrl` refuses at execution.
 *
 * (b) Toggle ON + empty/whitespace override: the credential test refused, but
 *     `resolveBaseUrl` fell through its `override !== ''` guard to the stored
 *     `baseUrl`, whose host check was SKIPPED because allowNonProduction was
 *     true -- so execution silently ran against production.
 *
 * Both paths now call the single `selectBaseUrl` in src/baseUrlPolicy.ts.
 * These cases were RED against 6eae1e27 and are the regression pins for it.
 */

const FAKE_KEY = 'sk-taas-FAKE-qa633-000';
const LEGACY_ALLOWED_HOST = 'https://eu.synthaveil.com';

function execCtx(credentials: ICredentialDataDecryptedObject): IExecuteFunctions {
  return {
    getCredentials: jest.fn().mockResolvedValue(credentials),
    getNode: jest.fn().mockReturnValue({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    helpers: { httpRequestWithAuthentication: jest.fn() },
  } as unknown as IExecuteFunctions;
}

function testCtx(request: jest.Mock): ICredentialTestFunctions {
  return {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    helpers: { request } as unknown as ICredentialTestFunctions['helpers'],
  } as ICredentialTestFunctions;
}

function decrypted(data: Record<string, unknown>): ICredentialsDecrypted {
  return { id: '1', name: 'acct', type: 'taasApi', data: { apiKey: FAKE_KEY, ...data } };
}

describe('claim (b) -- execution path with the toggle ON and an empty override', () => {
  it('must not silently resolve to production when the override is empty', async () => {
    const ctx = execCtx({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: FAKE_KEY,
      allowNonProductionUrl: true,
      baseUrlOverride: '',
    } as ICredentialDataDecryptedObject);

    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/override/i);
  });

  it('must not silently resolve to production when the override is whitespace only', async () => {
    const ctx = execCtx({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: FAKE_KEY,
      allowNonProductionUrl: true,
      baseUrlOverride: '   ',
    } as ICredentialDataDecryptedObject);

    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/override/i);
  });

  it('agrees with the credential test, which already refuses the same credential', async () => {
    const request = jest.fn();
    const result = await taasApiTest.call(
      testCtx(request),
      decrypted({ allowNonProductionUrl: true, baseUrlOverride: '' }),
    );
    // This half was already correct -- it pins the behaviour execution now matches.
    expect(result.status).toBe('Error');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('claim (a) -- credential test target for a legacy free-text baseUrl', () => {
  it('must not send the Bearer key to production when the stored baseUrl is a different host', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true });
    await taasApiTest.call(
      testCtx(request),
      decrypted({ baseUrl: LEGACY_ALLOWED_HOST, allowNonProductionUrl: false }),
    );

    // The off-list host is refused before any request, so the key goes nowhere
    // — asserting on the sent URI would pass vacuously when nothing is sent.
    expect(request).not.toHaveBeenCalled();
  });

  it('must not report a successful connection for a credential execution refuses', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true });
    const testResult = await taasApiTest.call(
      testCtx(request),
      decrypted({ baseUrl: LEGACY_ALLOWED_HOST, allowNonProductionUrl: false }),
    );

    const ctx = execCtx({
      baseUrl: LEGACY_ALLOWED_HOST,
      apiKey: FAKE_KEY,
      allowNonProductionUrl: false,
    } as ICredentialDataDecryptedObject);
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/recognised API host/i);

    // Execution refuses the credential, so the Test button must not say OK.
    expect(testResult.status).toBe('Error');
  });

  it('the usage path is the probe target either way (pins the endpoint under test)', () => {
    expect(USAGE_PATH).toBe('/api/v1/usage');
  });
});
