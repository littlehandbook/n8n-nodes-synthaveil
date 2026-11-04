/**
 * Task 3.3 — `nodes/Taas/sealedMap.ts`: `buildEntries`, `sealContainer`,
 * `openContainer`, `preflight`. Crypto runs for real (WebCrypto, via the
 * container profile in `@synthaveil/restore-protocol`) rather than being
 * stubbed — these are fast, and the whole point of the container profile is
 * that seal/open actually round-trip.
 *
 * EXPECTED STATE: RED — `nodes/Taas/sealedMap.ts` does not exist yet.
 */
import {
  buildEntries,
  openContainer,
  preflight,
  sealContainer,
} from '../../nodes/Taas/sealedMap';

const MASTER_KEY_BYTES = 32;

function freshMasterKey(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES));
}

const VALID_HANDLE = 'svh1-' + 'a'.repeat(22);
const VALID_KEY_B64 = Buffer.from(freshMasterKey()).toString('base64');

describe('buildEntries (FR-2.1)', () => {
  it('pairs real request values with their tokens from the response, by field key', () => {
    const request = { name: 'Jane Doe', email: 'jane@example.com' };
    const response = { name: 'Alex Roe', email: 'alex@example.com' };

    const entries = buildEntries(request, response);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: 'Alex Roe', original: 'Jane Doe' }),
        expect.objectContaining({ token: 'alex@example.com', original: 'jane@example.com' }),
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it('never invents an entry for a field that exists only in the response', () => {
    const request = { name: 'Jane Doe' };
    const response = { name: 'Alex Roe', extra: 'should-not-become-an-entry' };

    // FR-2.1: the response alone must never mint an entry — a shape mismatch
    // like this is a caller bug, so it fails closed rather than silently
    // picking a subset.
    expect(() => buildEntries(request, response)).toThrow();
  });

  it('throws on mismatched lengths (a field mapped in the request never came back)', () => {
    const request = { name: 'Jane Doe', email: 'jane@example.com' };
    const response = { name: 'Alex Roe' };

    expect(() => buildEntries(request, response)).toThrow();
  });
});

describe('sealContainer / openContainer round-trip', () => {
  const scopeId = 'crm-sync';
  const entries = [
    { token: 'Alex Roe', original: 'Jane Doe' },
    { token: 'alex@example.com', original: 'jane@example.com' },
  ];

  it('opens with the same entries it was sealed with, under the right key and scope', async () => {
    const masterKey = freshMasterKey();
    const { bytes } = await sealContainer(entries, scopeId, masterKey);

    const opened = await openContainer(bytes, scopeId, masterKey);

    expect(opened.ok).toBe(true);
    if (opened.ok) {
      const openedEntries = opened.inventory.entries;
      expect(openedEntries).toEqual(expect.arrayContaining(entries.map((e) => expect.objectContaining(e))));
      expect(openedEntries).toHaveLength(entries.length);
    }
  });

  it('produces different bytes across two seals of identical input (fresh containerId per seal)', async () => {
    const masterKey = freshMasterKey();
    const first = await sealContainer(entries, scopeId, masterKey);
    const second = await sealContainer(entries, scopeId, masterKey);

    expect(new Uint8Array(first.bytes)).not.toEqual(new Uint8Array(second.bytes));
  });

  it('refuses AUTH_FAILED when opened with the wrong key', async () => {
    const sealKey = freshMasterKey();
    const wrongKey = freshMasterKey();
    const { bytes } = await sealContainer(entries, scopeId, sealKey);

    const opened = await openContainer(bytes, scopeId, wrongKey);

    expect(opened).toEqual({ ok: false, code: 'AUTH_FAILED' });
  });

  it('refuses SCOPE_MISMATCH when opened with the right key but the wrong expected scope — and leaks nothing', async () => {
    const masterKey = freshMasterKey();
    const { bytes } = await sealContainer(entries, scopeId, masterKey);

    const opened = await openContainer(bytes, 'a-different-scope', masterKey);

    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('SCOPE_MISMATCH');
    }
    // TA R2 leak rule: on SCOPE_MISMATCH the caller gets the bare code — never
    // inventory, entries, or any plaintext field, even though the container
    // fully decrypted before the scope check ran.
    expect(opened).not.toHaveProperty('inventory');
    expect(opened).not.toHaveProperty('entries');
    expect(JSON.stringify(opened)).not.toMatch(/Jane Doe|jane@example\.com/);
  });

  it('refuses to seal entries carrying a scope that does not match the container scope (foreign-scope guard, AC6 restated)', async () => {
    const masterKey = freshMasterKey();
    const mixedEntries = [
      { token: 'Alex Roe', original: 'Jane Doe', scope: 'crm-sync' },
      { token: 'Sam Kim', original: 'John Poe', scope: 'a-different-scope' },
    ];

    // Must refuse BEFORE any crypto runs — a caller bug here must never
    // produce sealed bytes mixing two scopes under one container.
    await expect(sealContainer(mixedEntries, scopeId, masterKey)).rejects.toThrow();
  });
});

describe('preflight (CC-7) — runs before any network activity', () => {
  const scopeId = 'crm-sync';
  const text = 'Some text containing tokens';

  it('accepts a well-formed handle, 32-byte base64 key, scope and non-empty text', () => {
    expect(() => preflight(VALID_HANDLE, VALID_KEY_B64, scopeId, text)).not.toThrow();
  });

  it('rejects a handle that does not match the svh1- grammar', () => {
    expect(() => preflight('not-a-handle', VALID_KEY_B64, scopeId, text)).toThrow();
    expect(() => preflight('svh1-short', VALID_KEY_B64, scopeId, text)).toThrow();
    expect(() => preflight('svh2-' + 'a'.repeat(22), VALID_KEY_B64, scopeId, text)).toThrow();
  });

  it('rejects a key that is not exactly 32 bytes after base64 decode', () => {
    const shortKeyB64 = Buffer.from(new Uint8Array(16)).toString('base64');
    expect(() => preflight(VALID_HANDLE, shortKeyB64, scopeId, text)).toThrow();
  });

  it('rejects empty text', () => {
    expect(() => preflight(VALID_HANDLE, VALID_KEY_B64, scopeId, '')).toThrow();
  });

  it('never touches the network — no fetch/http helper is invoked by preflight itself', () => {
    const networkSpy = jest.fn();
    (globalThis as unknown as { fetch?: jest.Mock }).fetch = networkSpy;
    try {
      preflight(VALID_HANDLE, VALID_KEY_B64, scopeId, text);
    } finally {
      delete (globalThis as unknown as { fetch?: jest.Mock }).fetch;
    }
    expect(networkSpy).not.toHaveBeenCalled();
  });
});
