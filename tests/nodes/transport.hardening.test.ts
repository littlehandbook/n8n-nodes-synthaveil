import { readFileSync } from 'fs';
import { join } from 'path';

import type { ICredentialDataDecryptedObject, IExecuteFunctions } from 'n8n-workflow';

import { resolveBaseUrl, taasRequest } from '../../nodes/Taas/transport';
import { DEFAULT_BASE_URL } from '../../src/constants';

/**
 * Chunk A1 (I5 transport hardening, R8) — SPEC tests, written test-first.
 *
 * Behaviour under test (plan-d1-restore-and-publish.md, Chunk A1):
 *   - `baseUrl` must be `https:`; a plain-`http:` URL is rejected unless the
 *     operator has explicitly ticked the "Allow non-production URL (local
 *     development)" boolean credential field (default off).
 *   - `baseUrl` hosts outside the Synthaveil allow-list (synthaveil.com and its
 *     subdomains) are rejected unless that same boolean is on.
 *   - No environment variable may influence transport/baseUrl behaviour.
 *   - No credential material ever appears in a request body the transport builds.
 *
 * The enforcement seam is `resolveBaseUrl` — the single place the credential
 * base URL is read (every operation and the batch path flow through it).
 */

/** Value of the new boolean credential field (see TaasApi.credentials.test.ts). */
const ALLOW_FIELD = 'allowNonProductionUrl';

const FAKE_KEY = 'sk-taas-FAKE-a1-credential-000';

function ctxWith(
  http: jest.Mock,
  credentials: ICredentialDataDecryptedObject,
): IExecuteFunctions {
  return {
    getCredentials: jest.fn().mockResolvedValue(credentials),
    getNode: jest.fn().mockReturnValue({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;
}

const creds = (
  baseUrl: string,
  extra: Record<string, unknown> = {},
): ICredentialDataDecryptedObject =>
  ({ baseUrl, apiKey: FAKE_KEY, ...extra }) as ICredentialDataDecryptedObject;

describe('resolveBaseUrl — https enforcement (A1/I5)', () => {
  it('accepts the allow-listed production https URL', async () => {
    const ctx = ctxWith(jest.fn(), creds(DEFAULT_BASE_URL));
    await expect(resolveBaseUrl(ctx)).resolves.toBe(DEFAULT_BASE_URL);
  });

  it('rejects an http: URL when the local-development boolean is absent', async () => {
    const ctx = ctxWith(jest.fn(), creds('http://staging.synthaveil.com'));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });

  it('rejects an http: URL when the local-development boolean is explicitly false', async () => {
    const ctx = ctxWith(jest.fn(), creds('http://localhost:5678', { [ALLOW_FIELD]: false }));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });

  it('allows an http: localhost URL when the local-development boolean is true', async () => {
    const ctx = ctxWith(
      jest.fn(),
      creds(DEFAULT_BASE_URL, { [ALLOW_FIELD]: true, baseUrlOverride: 'http://localhost:5678' }),
    );
    await expect(resolveBaseUrl(ctx)).resolves.toBe('http://localhost:5678');
  });

  it('never leaks the API key in the rejection error', async () => {
    const ctx = ctxWith(jest.fn(), creds('http://staging.synthaveil.com'));
    await expect(resolveBaseUrl(ctx)).rejects.not.toThrow(FAKE_KEY);
    // Belt and braces: inspect the thrown error's full serialisation too.
    let thrown: unknown;
    try {
      await resolveBaseUrl(ctx);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    const serialized =
      String((thrown as Error).message) + JSON.stringify(thrown, Object.getOwnPropertyNames(thrown as object));
    expect(serialized).not.toContain(FAKE_KEY);
  });
});

describe('resolveBaseUrl — host allow-list (A1/I5)', () => {
  it('accepts other synthaveil.com subdomains (future production host)', async () => {
    const ctx = ctxWith(jest.fn(), creds('https://api.synthaveil.com'));
    await expect(resolveBaseUrl(ctx)).resolves.toBe('https://api.synthaveil.com');
  });

  it('rejects a non-allow-listed https host when the boolean is absent (default off)', async () => {
    const ctx = ctxWith(jest.fn(), creds('https://evil.example.com'));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/allow|host|non-production/i);
  });

  it('rejects a suffix-spoof host (synthaveil.com.evil.example)', async () => {
    const ctx = ctxWith(jest.fn(), creds('https://synthaveil.com.evil.example'));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/allow|host|non-production/i);
  });

  it('allows a non-allow-listed host when the local-development boolean is true', async () => {
    const ctx = ctxWith(
      jest.fn(),
      creds(DEFAULT_BASE_URL, { [ALLOW_FIELD]: true, baseUrlOverride: 'https://tunnel.example.dev' }),
    );
    await expect(resolveBaseUrl(ctx)).resolves.toBe('https://tunnel.example.dev');
  });
});

describe('resolveBaseUrl — toggle relaxes ONLY the host check (finding D: TLS decoupled)', () => {
  // Finding D (2026-08-25 code-review remediation): the "Allow non-production
  // URL (local development)" toggle currently bypasses URL parsing, the https
  // check, AND the host allow-list together. The remediated policy: URL parsing
  // ALWAYS runs; plain http is allowed ONLY for loopback names (localhost,
  // 127.0.0.1, ::1/[::1], *.localhost) and only with the toggle on; the toggle
  // relaxes nothing but the host allow-list.

  it('rejects a plain-http REMOTE host even when the local-development boolean is true', async () => {
    // THE regression under test: today the toggle disables TLS for any host.
    const ctx = ctxWith(jest.fn(), creds('http://evil.example.com', { [ALLOW_FIELD]: true }));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });

  it('allows http://127.0.0.1 with the boolean on (IPv4 loopback pin)', async () => {
    const ctx = ctxWith(
      jest.fn(),
      creds(DEFAULT_BASE_URL, { [ALLOW_FIELD]: true, baseUrlOverride: 'http://127.0.0.1:5678' }),
    );
    await expect(resolveBaseUrl(ctx)).resolves.toBe('http://127.0.0.1:5678');
  });

  it('allows http://[::1] with the boolean on (IPv6 loopback pin)', async () => {
    const ctx = ctxWith(
      jest.fn(),
      creds(DEFAULT_BASE_URL, { [ALLOW_FIELD]: true, baseUrlOverride: 'http://[::1]:5678' }),
    );
    await expect(resolveBaseUrl(ctx)).resolves.toBe('http://[::1]:5678');
  });

  it('allows http://n8n.localhost with the boolean on (*.localhost pin)', async () => {
    const ctx = ctxWith(
      jest.fn(),
      creds(DEFAULT_BASE_URL, { [ALLOW_FIELD]: true, baseUrlOverride: 'http://n8n.localhost:5678' }),
    );
    await expect(resolveBaseUrl(ctx)).resolves.toBe('http://n8n.localhost:5678');
  });

  it('rejects http://127.0.0.2 with the boolean on — exact loopback names only, not 127/8 (council-adopted pin)', async () => {
    const ctx = ctxWith(
      jest.fn(),
      creds(DEFAULT_BASE_URL, { [ALLOW_FIELD]: true, baseUrlOverride: 'http://127.0.0.2:5678' }),
    );
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https|localhost|loopback/i);
  });

  it('still rejects a syntactically invalid base URL when the boolean is true (URL parse always runs)', async () => {
    const ctx = ctxWith(jest.fn(), creds('not-a-url', { [ALLOW_FIELD]: true }));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/valid url/i);
  });

  // NOTE (case 7 of the spec): "https://api.synthaveil.com allowed with toggle
  // OFF" is already pinned above ('accepts other synthaveil.com subdomains') —
  // not duplicated here.
});

describe('resolveBaseUrl — no environment-variable influence (A1/I5)', () => {
  const ENV_KEYS = ['TAAS_ALLOW_HTTP', 'TAAS_ALLOW_NON_PRODUCTION_URL', 'TAAS_BASE_URL'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('still rejects http: even when permissive-looking env vars are set', async () => {
    process.env.TAAS_ALLOW_HTTP = 'true';
    process.env.TAAS_ALLOW_NON_PRODUCTION_URL = '1';
    const ctx = ctxWith(jest.fn(), creds('http://api.synthaveil.com'));
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });

  it('ignores TAAS_BASE_URL — the credential is the only base-URL source', async () => {
    process.env.TAAS_BASE_URL = 'https://evil.example.com';
    const ctx = ctxWith(jest.fn(), creds(DEFAULT_BASE_URL));
    await expect(resolveBaseUrl(ctx)).resolves.toBe(DEFAULT_BASE_URL);
  });

  it('transport/credential/constants source contains no process.env reads', () => {
    const pkgRoot = join(__dirname, '..', '..');
    const sources = [
      'nodes/Taas/transport.ts',
      // Target SELECTION moved here (2026-09-14) when `resolveBaseUrl` and the
      // credential test were collapsed onto one implementation — the pin has to
      // follow the decision, or it stops covering the code that picks the host.
      'src/baseUrlPolicy.ts',
      'credentials/TaasApi.credentials.ts',
      'src/constants.ts',
      'nodes/Taas/Taas.node.ts',
    ];
    for (const rel of sources) {
      expect({ file: rel, hasEnvRead: readFileSync(join(pkgRoot, rel), 'utf8').includes('process.env') })
        .toEqual({ file: rel, hasEnvRead: false });
    }
  });
});

describe('taasRequest — no credential material in any request body (A1/I5)', () => {
  it('the constructed request options never contain the API key', async () => {
    const http = jest.fn().mockResolvedValue({ ok: true });
    const ctx = ctxWith(http, creds('https://staging.synthaveil.com'));

    await taasRequest(ctx, {
      baseUrl: 'https://staging.synthaveil.com',
      method: 'POST',
      path: '/api/v1/tokenize',
      body: { record: { full_name: 'Jane Smith' } },
    });

    // Auth is injected downstream by n8n's httpRequestWithAuthentication from
    // the credential store — the options WE build must carry no key material.
    const [, opts] = http.mock.calls[0];
    expect(JSON.stringify(opts)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(opts).toLowerCase()).not.toContain('apikey');
    expect(JSON.stringify(opts.body ?? {})).not.toMatch(/authorization|bearer/i);
  });

  it('golden request fixtures carry no credential material', () => {
    const fixturesDir = join(__dirname, '..', 'fixtures', 'v1');
    for (const name of ['tokenize-request.golden.json', 'batch-request.golden.json']) {
      const raw = readFileSync(join(fixturesDir, name), 'utf8');
      const body = JSON.stringify(JSON.parse(raw).body).toLowerCase();
      expect({ fixture: name, clean: !/apikey|api_key|authorization|bearer/.test(body) })
        .toEqual({ fixture: name, clean: true });
    }
  });
});
