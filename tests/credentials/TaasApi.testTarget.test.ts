import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

import { selectBaseUrl } from '../../src/baseUrlPolicy';
import { DEFAULT_BASE_URL, REFUSED_OVERRIDE_BASE_URL, USAGE_PATH } from '../../src/constants';
import { renderTestRequest } from './testTargetKit';

/**
 * Codex P1 on PR #1741, owner decision 6 Nov 2026: "send the key only to the
 * server they chose". The API key credential's Test button must send the
 * Bearer key to the Base URL Override when the operator turned the override on,
 * and to production only when they did not.
 */

const FAKE_KEY = 'sk-taas-FAKE-p1-000';
const PRODUCTION_HOST = new URL(DEFAULT_BASE_URL).host;
const SELF_HOSTED = 'https://taas.self-hosted.example.com';
const LOCAL = 'http://localhost:7781';

const creds = (fields: Record<string, unknown>): ICredentialDataDecryptedObject =>
  ({ baseUrl: DEFAULT_BASE_URL, apiKey: FAKE_KEY, ...fields }) as ICredentialDataDecryptedObject;

describe('TaasApi Test button — override off checks production', () => {
  it.each([
    ['toggle off, no override', {}],
    ['toggle off, override typed in anyway', { allowNonProductionUrl: false, baseUrlOverride: SELF_HOSTED }],
  ])('%s → https://api.synthaveil.com/api/v1/usage', (_label, fields) => {
    const sent = renderTestRequest(creds(fields));
    expect(sent.baseURL).toBe(DEFAULT_BASE_URL);
    expect(sent.href).toBe(`${DEFAULT_BASE_URL}${USAGE_PATH}`);
    expect(sent.authorization).toBe(`Bearer ${FAKE_KEY}`);
  });
});

describe('TaasApi Test button — override on checks the configured server, never production', () => {
  it.each([
    ['a self-hosted https host', SELF_HOSTED, SELF_HOSTED],
    ['a localhost http host', LOCAL, LOCAL],
    ["n8n's own localhost port", 'http://localhost:5678', 'http://localhost:5678'],
    ['an override with surrounding spaces', `  ${SELF_HOSTED}  `, SELF_HOSTED],
  ])('%s', (_label, override, expected) => {
    const sent = renderTestRequest(creds({ allowNonProductionUrl: true, baseUrlOverride: override }));
    expect(sent.baseURL).toBe(expected);
    expect(sent.href).toBe(`${expected}${USAGE_PATH}`);
    // The request that carries the key goes to the override's host, not production's.
    expect(sent.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(new URL(sent.href).host).not.toBe(PRODUCTION_HOST);
  });
});

/**
 * SA-C1 closed (owner decision 6 Nov 2026): an override execution's policy
 * refuses never receives the key. The Test goes to the reserved `.invalid`
 * host instead, so it fails without reaching the override or production.
 */
describe('TaasApi Test button — a refused override sends the key nowhere', () => {
  const REFUSED_HOST = new URL(REFUSED_OVERRIDE_BASE_URL).host;

  it.each([
    ['cloud metadata over plain http', 'http://169.254.169.254'],
    ['a remote host over plain http', 'http://example.com'],
    ['a userinfo trick naming production', 'https://api.synthaveil.com@evil.example'],
    ['a trailing-dot, uppercase loopback over plain http', 'http://LOCALHOST.:7781'],
  ])('%s (%s) → override-refused.invalid', (_label, override) => {
    const sent = renderTestRequest(creds({ allowNonProductionUrl: true, baseUrlOverride: override }));
    expect(sent.baseURL).toBe(REFUSED_OVERRIDE_BASE_URL);
    expect(new URL(sent.href).host).toBe(REFUSED_HOST);
    expect(new URL(sent.href).host).not.toBe(PRODUCTION_HOST);
  });

  it('a trailing-dot, uppercase https host is accepted and goes where execution goes', () => {
    const override = 'https://API.SYNTHAVEIL.COM.';
    const sent = renderTestRequest(creds({ allowNonProductionUrl: true, baseUrlOverride: override }));
    const selected = selectBaseUrl({ allowNonProductionUrl: true, baseUrlOverride: override });
    expect(selected.ok).toBe(true);
    expect(sent.baseURL).toBe(override);
    expect(new URL(sent.href).host).toBe(new URL(selected.ok ? selected.url : '').host);
    expect(new URL(sent.href).host).toBe('api.synthaveil.com.');
  });
});

describe('TaasApi Test button — toggle on with no override falls back to production', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['missing', undefined],
  ])('%s override → production (the host that issued the key)', (_label, override) => {
    const sent = renderTestRequest(creds({ allowNonProductionUrl: true, baseUrlOverride: override }));
    expect(sent.baseURL).toBe(DEFAULT_BASE_URL);
  });
});
