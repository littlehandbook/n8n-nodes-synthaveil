import type { IAuthenticateGeneric } from 'n8n-workflow';
import { ALLOWED_BASE_URL_HOSTS, DEFAULT_BASE_URL } from '../../src/constants';
import { TaasApi } from '../../credentials/TaasApi.credentials';

describe('TaasApi credential', () => {
  const cred = new TaasApi();

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

  it('never echoes the API key outside the Authorization header (A1/I5)', () => {
    // The ONLY place `$credentials.apiKey` may appear is the authenticate
    // headers map. There is deliberately no declarative `test` on this
    // credential (IT Council SA-C1 — see credentialTest.test.ts for the
    // programmatic connection check's own no-key-leak coverage); every
    // property default must not reference or contain the key.
    expect('test' in cred).toBe(false);
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

  // QA review of PR #633 (IT Council SA-C1): a declarative `test` block can
  // only be a static expression, so it could not refuse an unsafe
  // `baseUrlOverride` before the request was built. The connection check is
  // now the programmatic `taasApiTest` (nodes/Taas/credentialTest.ts),
  // registered via `testedBy` in nodeCredentials.ts — see
  // tests/nodes/credentialTest.test.ts for its target-selection, policy-
  // refusal, and status-message coverage.
  it('has no declarative test block', () => {
    expect('test' in cred).toBe(false);
  });
});
