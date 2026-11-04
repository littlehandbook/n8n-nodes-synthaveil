import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INodeProperties } from 'n8n-workflow';

// Task 3.1 — the Local-restore Map Key credential. Distinct from `taasApi` (the
// hosted API bearer key): this key never leaves n8n and Synthaveil never sees it.
//
// EXPECTED STATE: RED — `credentials/SynthaveilMapKey.credentials.ts` does not
// exist yet.
import { SynthaveilMapKey } from '../../credentials/SynthaveilMapKey.credentials';
import { Taas } from '../../nodes/Taas/Taas.node';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

function notice(properties: INodeProperties[], name: string) {
  return properties.find((p) => p.name === name);
}

describe('SynthaveilMapKey credential (Task 3.1)', () => {
  const cred = new SynthaveilMapKey();

  it('is named synthaveilMapKey and scoped to Local restore in its display name', () => {
    expect(cred.name).toBe('synthaveilMapKey');
    expect(cred.displayName).toBe('Synthaveil Map Key (Local restore)');
  });

  it('has a documentation URL', () => {
    expect(typeof cred.documentationUrl).toBe('string');
    expect(cred.documentationUrl?.length).toBeGreaterThan(0);
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

describe('package.json ships the Map Key credential dist artifact (Task 3.1)', () => {
  it('n8n.credentials includes dist/credentials/SynthaveilMapKey.credentials.js', () => {
    expect(pkg.n8n.credentials).toContain('dist/credentials/SynthaveilMapKey.credentials.js');
  });

  // The existing taasApi credential entry must survive the addition — this is
  // additive, not a replacement (tests/package.test.ts:20 pins the original
  // array; that file is intentionally left untouched by this task).
  it('keeps the taasApi credential entry alongside the new one', () => {
    expect(pkg.n8n.credentials).toContain('dist/credentials/TaasApi.credentials.js');
  });
});

describe('Taas node wires the Map Key credential to Local restore (Task 3.1)', () => {
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
    const mapKeyCreds = credentials.filter((c) => c.name === 'synthaveilMapKey');
    expect(mapKeyCreds).toHaveLength(1);
    expect(mapKeyCreds[0].required).toBe(false);
    expect(mapKeyCreds[0].displayOptions?.show?.resource).toEqual(['token']);
  });

  it('keeps the original taasApi credential entry unconditionally required', () => {
    const credentials = new Taas().description.credentials ?? [];
    const apiCred = credentials.find((c) => c.name === 'taasApi');
    expect(apiCred).toBeDefined();
    expect(apiCred?.required).toBe(true);
  });
});
