import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IAuthenticateGeneric, ICredentialType } from 'n8n-workflow';
import { ALLOWED_BASE_URL_HOSTS, DEFAULT_BASE_URL, USAGE_PATH } from '../../src/constants';
import { TaasApi } from '../../credentials/TaasApi.credentials';
import { TAAS_CREDENTIALS } from '../../nodes/Taas/nodeCredentials';
import { Taas } from '../../nodes/Taas/Taas.node';

describe('TaasApi credential', () => {
  const cred = new TaasApi();
  const credType: ICredentialType = cred;

  it('has the expected identity', () => {
    expect(cred.name).toBe('taasApi');
    expect(cred.displayName).toBe('Synthaveil API');
    expect(cred.documentationUrl).toContain('synthaveil');
  });

  // Task 0.3: production base URL. The credential's own default and the
  // shared DEFAULT_BASE_URL constant it reads from both move to the
  // production host; the synthaveil.com allow-list entry does not change.
  it('exposes a base URL defaulting to production and a password-masked API key', () => {
    const byName = Object.fromEntries(cred.properties.map((p) => [p.name, p]));
    expect(byName.baseUrl.default).toBe('https://api.synthaveil.com');
    expect(byName.apiKey.typeOptions?.password).toBe(true);
    expect(byName.apiKey.default).toBe('');
  });

  it('DEFAULT_BASE_URL constant is the production host', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.synthaveil.com');
  });

  it('ALLOWED_BASE_URL_HOSTS already permits synthaveil.com', () => {
    expect(ALLOWED_BASE_URL_HOSTS).toContain('synthaveil.com');
  });

  it('apiKey description names all three scopes, tokenize:read for the credential test and restore for Restore', () => {
    const byName = Object.fromEntries(cred.properties.map((p) => [p.name, p]));
    const description = String(byName.apiKey.description ?? '');
    expect(description).toMatch(/tokenize:read \([^)]*credential test\)/);
    expect(description).toContain('tokenize:write');
    expect(description).toMatch(/and restore only if this credential runs a Restore step/);
  });

  it('apiKey description says the Test button sends the key only to the server the operator chose', () => {
    const byName = Object.fromEntries(cred.properties.map((p) => [p.name, p]));
    expect(String(byName.apiKey.description ?? '')).toContain(
      'The Test button sends the key only to the server you chose: api.synthaveil.com, or your Base URL Override when that is on.',
    );
  });

  it('apiKey description states activation requires the operator\'s own key', () => {
    const byName = Object.fromEntries(cred.properties.map((p) => [p.name, p]));
    expect(String(byName.apiKey.description ?? '')).toContain(
      'Activation requires your own Synthaveil API key.',
    );
  });

  // --- Chunk A1 (I5 transport hardening): the local-development escape hatch ---
  it('exposes the "Allow non-production URL (local development)" boolean, visible, default off (A1/I5)', () => {
    const byName = Object.fromEntries(cred.properties.map((p) => [p.name, p]));
    const allow = byName.allowNonProductionUrl;
    expect(allow).toBeDefined();
    expect(allow.type).toBe('boolean'); // not 'hidden' — the operator must see it
    expect(allow.default).toBe(false);
    expect(allow.displayName).toMatch(/allow non-production url/i);
    expect(allow.displayName).toMatch(/local development/i);
    // Visible: no displayOptions/typeOptions machinery hiding it unconditionally.
    expect(allow.displayOptions?.hide).toBeUndefined();
  });

  it('toggle description states the real policy: https for non-synthaveil hosts, plain-http for localhost only, enforced at execution time (council condition 12)', () => {
    // Finding D / council condition 12: once transport decouples TLS from the
    // host toggle, the operator-facing copy must match the enforced policy —
    // non-synthaveil.com hosts must still be https, plain http works for
    // localhost/loopback only, and enforcement happens at execution time.
    const byName = Object.fromEntries(cred.properties.map((p) => [p.name, p]));
    const description = String(byName.allowNonProductionUrl.description ?? '');
    expect(description).toMatch(/https/i);
    expect(description).toMatch(/localhost/i);
    expect(description).toMatch(/execution/i);
  });

  it('never echoes the API key outside the Authorization header (A1/I5, SA-1)', () => {
    // The ONLY place `$credentials.apiKey` may appear is the authenticate
    // headers map. The declarative `test` block reads the override fields to
    // pick its host (owner decision 6 Nov 2026), but never the key — n8n's
    // generic `authenticate` adds the bearer header to the test request
    // itself, and nothing else may carry the key.
    expect(JSON.stringify(credType.test ?? {})).not.toContain('apiKey');
    for (const p of cred.properties) {
      if (p.name === 'apiKey') continue;
      expect(JSON.stringify(p.default ?? '')).not.toContain('apiKey');
    }
  });

  it('injects Authorization: Bearer via the n8n `headers` map (P2 intent)', () => {
    // P2's INTENT: guarantee the Bearer token is actually injected. The council
    // record names the singular `header`, but n8n's IAuthenticateGeneric type
    // and its own bearer.credentials.ts template use `headers` (plural); the
    // singular key is an unknown property n8n ignores, so it would silently drop
    // the token. This pins the WORKING form and fails if anyone flips to `header`.
    const auth = cred.authenticate as IAuthenticateGeneric;
    const props = auth.properties as Record<string, unknown> & {
      headers?: Record<string, string>;
    };
    expect(auth.type).toBe('generic');
    expect(props.headers).toBeDefined();
    expect(props.header).toBeUndefined(); // regression pin: singular never injects
    expect(props.headers?.Authorization).toContain('Bearer');
    expect(props.headers?.Authorization).toContain('$credentials.apiKey');
  });
});

/**
 * The declarative `test` replaced the programmatic `taasApiTest`, which used the
 * deprecated `helpers.request` (n8n's checker fails it, and the Creator Portal
 * rejects `testedBy`-only credentials). From 24 Sep 2026 its `baseURL` was the
 * static `DEFAULT_BASE_URL` (IT Council SA-C1 refined); on 6 Nov 2026 the owner
 * chose "send the key only to the server they chose", so `baseURL` is now an
 * n8n expression over the toggle and the override. Where it resolves to:
 * `TaasApi.testTarget.test.ts`. Pins: SA-1 (shape), SA-2 (notice), 2b.7 (30x).
 */
describe('TaasApi.test — declarative test shape (2b.1, owner decision 6 Nov 2026)', () => {
  const credType: ICredentialType = new TaasApi();
  const request = (credType.test?.request ?? {}) as unknown as Record<string, unknown>;
  const rules = (credType.test?.rules ?? []) as Array<{
    type: string;
    properties: { value: number; message: string };
  }>;
  const ruleFor = (code: number) =>
    rules.find((r) => r.type === 'responseCode' && r.properties.value === code);

  it('declares a test.request', () => {
    expect(credType.test?.request).toBeDefined();
  });

  it('only baseURL reads the credential, and only the toggle and the override', () => {
    const { baseURL, ...rest } = request;
    expect(JSON.stringify(rest)).not.toContain('$credentials');
    const fields = String(baseURL).match(/\$credentials\.\w+/g) ?? [];
    expect(new Set(fields)).toEqual(
      new Set(['$credentials.allowNonProductionUrl', '$credentials.baseUrlOverride']),
    );
  });

  it('baseURL is an n8n expression whose fallback is DEFAULT_BASE_URL', () => {
    expect(typeof request.baseURL).toBe('string');
    expect(String(request.baseURL).startsWith('={{')).toBe(true);
    expect(String(request.baseURL)).toContain(`'${DEFAULT_BASE_URL}'`);
  });

  it('url is USAGE_PATH and relative (an absolute url would override baseURL) (SA-1)', () => {
    expect(USAGE_PATH).toBe('/api/v1/usage');
    expect(request.url).toBe(USAGE_PATH);
    expect(String(request.url)).toMatch(/^\/(?!\/)/);
  });

  it('is a GET that refuses redirects (SA-1, 2b.7)', () => {
    expect(request.method).toBe('GET');
    expect(request.disableFollowRedirect).toBe(true);
  });

  it('carries no headers, qs, auth or sendCredentialsOnCrossOriginRedirect (SA-1: minimal; FSD-C6 flag is transport-only)', () => {
    expect(credType.test?.request).toBeDefined(); // a test-less credential must not pass this vacuously
    for (const key of ['headers', 'qs', 'auth', 'sendCredentialsOnCrossOriginRedirect']) {
      expect(Object.keys(request)).not.toContain(key);
    }
  });

  it('401 rule says the key was not accepted and mentions the override (SA-2)', () => {
    const message = String(ruleFor(401)?.properties.message ?? '');
    expect(message).toMatch(/api key/i);
    expect(message).toMatch(/not accepted/i);
    expect(message).toContain('override');
  });

  it('403 rule says the key lacks the tokenize scope', () => {
    const message = String(ruleFor(403)?.properties.message ?? '');
    expect(message).toMatch(/tokenize:read/);
  });

  it.each([301, 302, 303, 307, 308])('%i rule refuses the redirect and says nothing was sent onward (2b.7)', (code) => {
    const message = String(ruleFor(code)?.properties.message ?? '');
    expect(message).toMatch(/redirect/i);
    expect(message).toMatch(/nothing was sent onward/i);
  });
});

/**
 * SA-2: whenever the override toggle is on, a notice says where the Test button
 * sends the key — the override, or api.synthaveil.com while the override is
 * empty. Shown on the toggle alone (not on `baseUrlOverride`), so the
 * empty-override case is covered.
 */
describe('TaasApi — override notice: where the Test button sends the key (SA-2)', () => {
  const overrideNotice = () =>
    new TaasApi().properties.find(
      (p) => p.type === 'notice' && p.displayOptions?.show?.allowNonProductionUrl !== undefined,
    );

  it('has a notice property shown exactly when allowNonProductionUrl is on', () => {
    const notice = overrideNotice();
    expect(notice).toBeDefined();
    expect(notice?.displayOptions?.show).toEqual({ allowNonProductionUrl: [true] });
    expect(notice?.displayOptions?.hide).toBeUndefined();
  });

  it('names the Test button, the override and the empty-override fallback', () => {
    const displayName = String(overrideNotice()?.displayName ?? '');
    expect(displayName).toContain('Test');
    expect(displayName).toContain('sends your key only there');
    expect(displayName).toContain('While the override is empty it checks api.synthaveil.com');
  });

  it('no longer claims the override cannot be checked', () => {
    const displayName = String(overrideNotice()?.displayName ?? '');
    expect(displayName).not.toMatch(/does not check the override|always checks your key against api/i);
  });
});

describe('TaasApi — programmatic test fully removed (2b.1 step 2, FSD-C5)', () => {
  const PKG_ROOT = join(__dirname, '..', '..');

  it('no TAAS_CREDENTIALS descriptor carries testedBy', () => {
    for (const descriptor of TAAS_CREDENTIALS) {
      expect('testedBy' in descriptor).toBe(false);
    }
  });

  it('nodes/Taas/credentialTest.ts no longer exists', () => {
    expect(existsSync(join(PKG_ROOT, 'nodes', 'Taas', 'credentialTest.ts'))).toBe(false);
  });

  it('Taas.node.ts registers no methods.credentialTest / taasApiTest', () => {
    const source = readFileSync(join(PKG_ROOT, 'nodes', 'Taas', 'Taas.node.ts'), 'utf8');
    expect(source).not.toMatch(/taasApiTest|credentialTest/);
    const methods = (new Taas() as unknown as { methods?: { credentialTest?: unknown } }).methods;
    expect(methods?.credentialTest).toBeUndefined();
  });

  it('the credential file carries no eslint-disable (the checker ignores inline config)', () => {
    const source = readFileSync(join(PKG_ROOT, 'credentials', 'TaasApi.credentials.ts'), 'utf8');
    expect(source).not.toContain('eslint-disable');
  });
});
