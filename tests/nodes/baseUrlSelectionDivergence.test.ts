import type { ICredentialDataDecryptedObject, ICredentialType, IExecuteFunctions } from 'n8n-workflow';

import { TaasApi } from '../../credentials/TaasApi.credentials';
import { resolveBaseUrl } from '../../nodes/Taas/transport';
import { selectBaseUrl } from '../../src/baseUrlPolicy';
import { DEFAULT_BASE_URL, REFUSED_OVERRIDE_BASE_URL, USAGE_PATH } from '../../src/constants';
import { renderTestRequest } from '../credentials/testTargetKit';

/**
 * The credential Test button and execution must never disagree in a way that
 * sends the key somewhere unsafe (QA verification of PR #633, claims (a) and
 * (b); fixed 2026-09-14; Test-button half rewritten by 2b.1, 24 Sep 2026).
 *
 * History: target *selection* used to be written twice -- once in the
 * programmatic credential test and once in `resolveBaseUrl` (transport.ts) --
 * and the two copies disagreed:
 *
 * (a) Toggle OFF: the credential test IGNORED the stored `baseUrl` and always
 *     targeted production, reporting success for a legacy free-text host
 *     `resolveBaseUrl` refuses at execution.
 *
 * (b) Toggle ON + empty/whitespace override: the credential test refused, but
 *     `resolveBaseUrl` fell through to the stored `baseUrl` -- so execution
 *     silently ran against production.
 *
 * Execution now calls the single `selectBaseUrl` in src/baseUrlPolicy.ts; the
 * claim (b) and claim (a) execution pins below stay.
 *
 * The Test-button side: 2b.1 replaced the programmatic test with a declarative
 * one locked to `DEFAULT_BASE_URL` (IT Council SA-C1 refined, 24 Sep 2026). The
 * owner reversed the lock on 6 Nov 2026 ("send the key only to the server they
 * chose"): the Test now targets the override when the toggle is on and the
 * override is filled in and passes a strict subset of the policy. The pins below
 * hold it to `selectBaseUrl` wherever execution has a target, and send a refused
 * override to `.invalid`; the one accepted difference is the empty override,
 * where execution refuses and the Test checks production.
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
});

describe('claim (a) -- execution refuses a legacy free-text baseUrl', () => {
  it('refuses an off-list stored host instead of sending the Bearer key to it', async () => {
    const ctx = execCtx({
      baseUrl: LEGACY_ALLOWED_HOST,
      apiKey: FAKE_KEY,
      allowNonProductionUrl: false,
    } as ICredentialDataDecryptedObject);
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/recognised API host/i);
  });
});

describe('Test button -- agrees with execution wherever execution has a target (owner decision 6 Nov 2026)', () => {
  const test = (new TaasApi() as ICredentialType).test;

  it.each([
    ['toggle off', { allowNonProductionUrl: false }],
    ['toggle off, stray override', { allowNonProductionUrl: false, baseUrlOverride: 'https://x.example.com' }],
    ['toggle on, https override', { allowNonProductionUrl: true, baseUrlOverride: 'https://x.example.com' }],
    ['toggle on, localhost override', { allowNonProductionUrl: true, baseUrlOverride: 'http://localhost:7781' }],
  ])('%s: Test targets the host execution selects', (_label, fields) => {
    const credential = { baseUrl: DEFAULT_BASE_URL, apiKey: FAKE_KEY, ...fields };
    const selected = selectBaseUrl(credential);
    expect(selected.ok).toBe(true);
    expect(renderTestRequest(credential as ICredentialDataDecryptedObject).baseURL).toBe(
      selected.ok ? selected.url : undefined,
    );
  });

  it('claim (b) on the Test side: toggle on, empty override checks production while execution refuses', () => {
    const credential = { baseUrl: DEFAULT_BASE_URL, apiKey: FAKE_KEY, allowNonProductionUrl: true, baseUrlOverride: '' };
    expect(selectBaseUrl(credential)).toEqual({ ok: false, reason: 'override-empty' });
    expect(renderTestRequest(credential as ICredentialDataDecryptedObject).baseURL).toBe(DEFAULT_BASE_URL);
  });

  it('an override execution refuses is refused by the Test too: the key goes to .invalid', () => {
    const credential = {
      baseUrl: DEFAULT_BASE_URL,
      apiKey: FAKE_KEY,
      allowNonProductionUrl: true,
      baseUrlOverride: 'http://evil.example',
    };
    expect(selectBaseUrl(credential)).toEqual({ ok: false, reason: 'override-https-required' });
    expect(renderTestRequest(credential as ICredentialDataDecryptedObject).baseURL).toBe(REFUSED_OVERRIDE_BASE_URL);
  });

  it('never reads the stored baseUrl, so claim (a) cannot recur on the Test side', () => {
    expect(JSON.stringify(test ?? {})).not.toMatch(/\$credentials\.baseUrl\b/);
  });

  it('the usage path is the probe target (pins the endpoint under test)', () => {
    expect(USAGE_PATH).toBe('/api/v1/usage');
    expect(test?.request.url).toBe(USAGE_PATH);
  });
});
