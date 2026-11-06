import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// Task 3.1 — the Local-restore Map Key credential. Distinct from `taasApi` (the
// hosted API bearer key): this key never leaves n8n and Synthaveil never sees it.
//
// Task 2b.2 (n8n submission readiness r4) renames it to pass n8n's own checker,
// following the verified `n8n-nodes-nostr` precedent (`NostrPrivateKeyApi`):
// `-Api` suffix, title-case display name ending " API", an icon, and a
// declarative `test` that sends nothing from the credential.
import { SynthaveilMapKeyApi } from '../../credentials/SynthaveilMapKeyApi.credentials';
import { TaasApi } from '../../credentials/TaasApi.credentials';
import { Taas } from '../../nodes/Taas/Taas.node';
import * as constants from '../../src/constants';

const PKG_ROOT = join(__dirname, '..', '..');
const CRED_FILE = join(PKG_ROOT, 'credentials', 'SynthaveilMapKeyApi.credentials.ts');
const OLD_CRED_FILE = join(PKG_ROOT, 'credentials', 'SynthaveilMapKey.credentials.ts');

const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));

/** Constants the rename/test block adds; read loosely so a missing one reds an assertion, not the suite. */
const declared = constants as Record<string, unknown>;

/** Every `.ts` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function notice(properties: INodeProperties[], name: string) {
  return properties.find((p) => p.name === name);
}

describe('SynthaveilMapKeyApi credential (Task 3.1, renamed by 2b.2)', () => {
  // Typed as ICredentialType so `test`/`authenticate` compile before the class grows them.
  const cred: ICredentialType = new SynthaveilMapKeyApi();

  it('is named synthaveilMapKeyApi with a title-case display name ending " API" (2b.2)', () => {
    expect(cred.name).toBe('synthaveilMapKeyApi');
    expect(cred.displayName).toBe('Synthaveil Map Key (Local Restore) API');
  });

  it('MAP_KEY_CREDENTIAL_NAME follows the rename', () => {
    expect(constants.MAP_KEY_CREDENTIAL_NAME).toBe('synthaveilMapKeyApi');
  });

  it('has a documentation URL', () => {
    expect(typeof cred.documentationUrl).toBe('string');
    expect(cred.documentationUrl?.length).toBeGreaterThan(0);
  });

  it('uses the same light/dark icon as the Synthaveil API credential (2b.2 step 2)', () => {
    expect(cred.icon).toBeDefined();
    expect(cred.icon).toEqual(new TaasApi().icon);
  });

  // CC-17: the warning must be seen BEFORE the key field is filled in, so the
  // notice property has to come first in the properties array.
  it('shows the lost-key notice BEFORE the mapKey field (CC-17)', () => {
    const names = cred.properties.map((p: INodeProperties) => p.name);
    const noticeIndex = names.indexOf('lostKeyNotice');
    const keyIndex = names.indexOf('mapKey');
    expect(noticeIndex).toBeGreaterThanOrEqual(0);
    expect(keyIndex).toBeGreaterThanOrEqual(0);
    expect(noticeIndex).toBeLessThan(keyIndex);
  });

  it('lostKeyNotice warns that Synthaveil cannot recover the key and names N8N_ENCRYPTION_KEY', () => {
    const lostKeyNotice = notice(cred.properties, 'lostKeyNotice');
    expect(lostKeyNotice?.type).toBe('notice');
    const description = String(lostKeyNotice?.description ?? '');
    expect(description).toContain('Synthaveil cannot recover it');
    expect(description).toContain('N8N_ENCRYPTION_KEY');
  });

  it('mapKey is a required password-masked string field', () => {
    const mapKey = notice(cred.properties, 'mapKey');
    expect(mapKey?.type).toBe('string');
    expect(mapKey?.required).toBe(true);
    expect(mapKey?.typeOptions).toMatchObject({ password: true });
  });

  it('mapKey description includes per-OS key-generation instructions', () => {
    const mapKey = notice(cred.properties, 'mapKey');
    const description = String(mapKey?.description ?? '');
    expect(description).toContain('openssl rand -base64 32');
    // Windows PowerShell alternative must also be present — this credential is
    // used by n8n operators on any OS, not just macOS/Linux.
    expect(description).toMatch(/powershell/i);
  });

  // L06-1 (High): `Get-Random` is not a cryptographic RNG (it's a
  // general-purpose PRNG, not suitable for generating a symmetric key that
  // seals maps). The Windows hint must use the .NET cryptographic RNG instead.
  it('Windows key-generation hint uses a cryptographic RNG, not Get-Random (L06-1)', () => {
    const mapKey = notice(cred.properties, 'mapKey');
    const description = String(mapKey?.description ?? '');
    expect(description).not.toMatch(/get-random/i);
    expect(description).toContain('System.Security.Cryptography.RandomNumberGenerator');
    // The OpenSSL alternative must still be present alongside the fix.
    expect(description).toContain('openssl rand -base64 32');
  });
});

/**
 * 2b.2 step 3 + IT Council SA-1 / SA-3: a declarative GET to the public,
 * unauthenticated health endpoint on the fixed production host. The credential
 * has no `authenticate`, so n8n attaches nothing from it — the Map Key is never
 * sent. The "Test" button proves only that Synthaveil is reachable.
 */
describe('SynthaveilMapKeyApi.test — static-host declarative test that sends no secret (2b.2, SA-1)', () => {
  const cred: ICredentialType = new SynthaveilMapKeyApi();
  const request = (cred.test?.request ?? {}) as unknown as Record<string, unknown>;

  it('HEALTH_PATH constant is the public health endpoint', () => {
    expect(declared.HEALTH_PATH).toBe('/api/v1/health');
  });

  it('has no authenticate property, so nothing from the credential is attached', () => {
    expect('authenticate' in cred).toBe(false);
    expect(cred.authenticate).toBeUndefined();
  });

  it('declares a test.request', () => {
    expect(cred.test?.request).toBeDefined();
  });

  it('baseURL is the plain DEFAULT_BASE_URL string, never an expression', () => {
    expect(typeof request.baseURL).toBe('string');
    expect(request.baseURL).toBe(constants.DEFAULT_BASE_URL);
    expect(String(request.baseURL).startsWith('=')).toBe(false);
    expect(String(request.baseURL)).not.toContain('{{');
  });

  it('url is HEALTH_PATH and relative (an absolute url would override baseURL)', () => {
    expect(request.url).toBe(declared.HEALTH_PATH);
    expect(String(request.url)).toMatch(/^\/(?!\/)/);
  });

  it('is a GET that refuses redirects (2b.7)', () => {
    expect(request.method).toBe('GET');
    expect(request.disableFollowRedirect).toBe(true);
  });

  it('carries no headers, qs, auth or sendCredentialsOnCrossOriginRedirect (SA-1: minimal)', () => {
    expect(cred.test?.request).toBeDefined(); // a test-less credential must not pass this vacuously
    for (const key of ['headers', 'qs', 'auth', 'sendCredentialsOnCrossOriginRedirect']) {
      expect(Object.keys(request)).not.toContain(key);
    }
  });

  it('references no credential field anywhere in the test block', () => {
    const serialized = JSON.stringify(cred.test ?? {});
    expect(serialized).not.toContain('$credentials');
    expect(serialized).not.toContain('mapKey');
  });

  it.each([301, 302, 303, 307, 308])('has a responseCode rule refusing a %i redirect (2b.7)', (code) => {
    const rules = (cred.test?.rules ?? []) as Array<{
      type: string;
      properties: { value: number; message: string };
    }>;
    const rule = rules.find((r) => r.type === 'responseCode' && r.properties.value === code);
    expect(rule).toBeDefined();
    expect(rule?.properties.message).toMatch(/redirect/i);
    expect(rule?.properties.message).toMatch(/nothing was sent onward/i);
  });
});

describe('SynthaveilMapKeyApi source — rename complete, no lint escapes (2b.2, 2b.3 step 3, FSD-C7)', () => {
  it('the old SynthaveilMapKey.credentials.ts file is gone', () => {
    expect(existsSync(OLD_CRED_FILE)).toBe(false);
  });

  it('the credential file carries no eslint-disable (the checker ignores inline config)', () => {
    expect(readFileSync(CRED_FILE, 'utf8')).not.toContain('eslint-disable');
  });

  // FSD-C7 "all old references gone" for shipped source. Examples are pinned in
  // examples.runnable.test.ts.
  it('no shipped source under nodes/, credentials/ or src/ still names synthaveilMapKey', () => {
    const offenders = ['nodes', 'credentials', 'src']
      .flatMap((dir) => sourceFiles(join(PKG_ROOT, dir)))
      .filter((file) => /\bsynthaveilMapKey\b|\bSynthaveilMapKey\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(PKG_ROOT, file));
    expect(offenders).toEqual([]);
  });
});

describe('package.json ships the Map Key credential dist artifact (Task 3.1, 2b.2)', () => {
  it('n8n.credentials includes dist/credentials/SynthaveilMapKeyApi.credentials.js', () => {
    expect(pkg.n8n.credentials).toContain('dist/credentials/SynthaveilMapKeyApi.credentials.js');
  });

  it('n8n.credentials no longer lists the old SynthaveilMapKey.credentials.js', () => {
    expect(pkg.n8n.credentials).not.toContain('dist/credentials/SynthaveilMapKey.credentials.js');
  });

  // The existing taasApi credential entry must survive the rename.
  it('keeps the taasApi credential entry alongside the Map Key', () => {
    expect(pkg.n8n.credentials).toContain('dist/credentials/TaasApi.credentials.js');
  });
});

describe('Taas node wires the Map Key credential to Local Restore (Task 3.1)', () => {
  it('declares the Map Key once, across the whole Token resource', () => {
    // Was: a second descriptor keyed on `returnMode`, required. n8n resolves a
    // credential with `credentials.find((c) => c.name === type)`, so only the
    // first descriptor of a name is ever evaluated and the Restore descriptor
    // behind it was dead — every Restore threw `Credentials not found` with the
    // credential filled in on screen. One descriptor over `resource: token`
    // covers both journeys that need the key; `required` must then be false,
    // because the same row is on screen for Return Mode "Record ID", which
    // needs no key and would otherwise be blocked by a node issue.
    const credentials = new Taas().description.credentials ?? [];
    const mapKeyCreds = credentials.filter((c) => c.name === 'synthaveilMapKeyApi');
    expect(mapKeyCreds).toHaveLength(1);
    expect(mapKeyCreds[0].required).toBe(false);
    expect(mapKeyCreds[0].displayOptions?.show?.resource).toEqual(['token']);
  });

  it('no descriptor still uses the old synthaveilMapKey name', () => {
    const credentials = new Taas().description.credentials ?? [];
    expect(credentials.map((c) => c.name)).not.toContain('synthaveilMapKey');
  });

  it('keeps the original taasApi credential entry unconditionally required', () => {
    const credentials = new Taas().description.credentials ?? [];
    const apiCred = credentials.find((c) => c.name === 'taasApi');
    expect(apiCred).toBeDefined();
    expect(apiCred?.required).toBe(true);
  });
});
