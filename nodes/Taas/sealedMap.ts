/**
 * Local restore (Task 3.3): `buildEntries`, `sealContainer`, `openContainer`,
 * `preflight`. WebCrypto only, via the container profile in
 * `@synthaveil/restore-protocol` (vendored — see `vendorRestoreProtocol.d.ts`).
 */
import type { FailureCode } from '../../vendor/restore-protocol';
import { deriveContainerKey, openEnvelope, sealEnvelope, PROTOCOL_VERSION } from '../../vendor/restore-protocol';
import { base64ToBytes } from './base64';
import { buildContainerAad, CONTAINER_ID_BYTES, decodeContainer, encodeContainer } from './containerCodec';

const MASTER_KEY_BYTES = 32;
const HANDLE_PATTERN = /^svh1-[A-Za-z0-9_-]{22,64}$/;
/** An unpaired UTF-16 surrogate (the `u` flag leaves valid pairs alone). */
const LONE_SURROGATE = /[\ud800-\udfff]/u;

/**
 * True when a value can make the seal → consume → restore round trip. The
 * restore-protocol inventory check refuses a lone surrogate as INVALID_ENTRY,
 * and by then the one-shot map has been consumed (Codex review on #1622), so
 * such a value must be refused before a map is sealed or stored.
 */
export function isRestorableText(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

/** One protected field: the real value paired with its token (FR-2.1). */
export interface MapEntry {
  token: string;
  original: string;
  /** Set only by callers building entries manually; must match the container scope. */
  scope?: string;
}

interface ContainerInventory {
  protocolVersion: string;
  scopeRef: string;
  entries: Array<{ token: string; original: string }>;
}
/**
 * FR-2.1 — pair real request values with their tokens from the response, by
 * field key. Never invents an entry from the response alone: the field sets
 * must match exactly, or this throws (a caller/shape bug, not a data issue).
 */
export function buildEntries(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
): MapEntry[] {
  const requestKeys = Object.keys(request);
  const responseKeys = Object.keys(response);
  const sameKeys =
    requestKeys.length === responseKeys.length && requestKeys.every((k) => responseKeys.includes(k));
  if (!sameKeys) {
    throw new Error('buildEntries: request and response field sets must match exactly.');
  }
  return requestKeys.map((key) => ({ token: String(response[key]), original: String(request[key]) }));
}

/**
 * The entries exactly as Restore will accept them (review on #1622). The
 * restore-protocol inventory check refuses an empty token (INVALID_ENTRY) and
 * ANY two entries whose tokens are equal after NFC (AMBIGUOUS_VALUE), even when
 * their originals match. Tokens are deterministic per value and scope, so two
 * fields holding the same value can share one token: an exact duplicate pair is
 * dropped, since restoring it once gives the same text. A shared token for
 * different values cannot be restored, so it is refused before the map PUT.
 */
export function restorableEntries(entries: MapEntry[]): MapEntry[] {
  const byToken = new Map<string, MapEntry>();
  for (const entry of entries) {
    if (entry.token === '') {
      throw new Error('sealContainer: a field came back with an empty token, so it could not be restored.');
    }
    const key = entry.token.normalize('NFC');
    const kept = byToken.get(key);
    if (kept === undefined) {
      byToken.set(key, entry);
    } else if (kept.token !== entry.token || kept.original !== entry.original) {
      throw new Error('sealContainer: two different values came back with the same token, so they could not be restored.');
    }
  }
  return [...byToken.values()];
}

export interface SealContainerResult {
  bytes: Uint8Array;
}
export type OpenContainerResult =
  | { ok: true; inventory: ContainerInventory }
  | { ok: false; code: FailureCode };

/** PROTOCOL.md §5a — pack entries + scopeRef into one sealed container blob. */
export async function sealContainer(
  entries: MapEntry[],
  scopeId: string,
  masterKey: Uint8Array,
): Promise<SealContainerResult> {
  // Foreign-scope guard (AC6 restated): refuse BEFORE any crypto runs.
  for (const entry of entries) {
    if (entry.scope !== undefined && entry.scope !== scopeId) {
      throw new Error('sealContainer: an entry carries a scope that does not match the container scope.');
    }
  }
  // Same string domain restore accepts: never store a map restore would refuse.
  if (!entries.every((e) => isRestorableText(e.token) && isRestorableText(e.original))) {
    throw new Error('sealContainer: a value contains an unpaired surrogate, so it could not be restored.');
  }
  const accepted = restorableEntries(entries);
  const keyResult = await deriveContainerKey(masterKey);
  if (!keyResult.ok) throw new Error(`sealContainer: key derivation failed (${keyResult.code}).`);
  const header: ContainerInventory = {
    protocolVersion: PROTOCOL_VERSION,
    scopeRef: scopeId,
    entries: accepted.map((e) => ({ token: e.token, original: e.original })),
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(header));
  try {
    // Node 20's global `crypto` (WebCrypto), never `globalThis.crypto` — the
    // scanner's `no-restricted-globals` rule forbids `globalThis`.
    const containerId = crypto.getRandomValues(new Uint8Array(CONTAINER_ID_BYTES));
    const aad = buildContainerAad(containerId);
    const sealed = await sealEnvelope({ key: keyResult.value, plaintext, aad });
    if (!sealed.ok) throw new Error(`sealContainer: seal failed (${sealed.code}).`);
    return { bytes: encodeContainer(containerId, sealed.value) };
  } finally {
    plaintext.fill(0);
  }
}

/**
 * PROTOCOL.md §5a — open a sealed container. A wrong-scope container fully
 * decrypts before the scope check, so on `SCOPE_MISMATCH` the decrypted
 * plaintext is zeroed in `finally` and only the bare code is returned — never
 * inventory, entries, or any plaintext field (TA R2).
 */
export async function openContainer(
  bytes: Uint8Array,
  expectedScopeId: string,
  masterKey: Uint8Array,
): Promise<OpenContainerResult> {
  let plaintext: Uint8Array | undefined;
  try {
    const decoded = decodeContainer(bytes);
    const keyResult = await deriveContainerKey(masterKey);
    if (!keyResult.ok) return { ok: false, code: keyResult.code };
    const aad = buildContainerAad(decoded.containerId);
    const opened = await openEnvelope(decoded.envelope, keyResult.value, aad);
    if (!opened.ok) return { ok: false, code: opened.code };
    plaintext = opened.value;
    const header = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<ContainerInventory>;
    if (typeof header.scopeRef !== 'string' || !Array.isArray(header.entries)) {
      return { ok: false, code: 'INVALID_ENTRY' };
    }
    if (header.scopeRef !== expectedScopeId) {
      return { ok: false, code: 'SCOPE_MISMATCH' };
    }
    return {
      ok: true,
      inventory: {
        protocolVersion: typeof header.protocolVersion === 'string' ? header.protocolVersion : PROTOCOL_VERSION,
        scopeRef: header.scopeRef,
        entries: header.entries,
      },
    };
  } catch {
    return { ok: false, code: 'INVALID_ENTRY' };
  } finally {
    plaintext?.fill(0);
  }
}

/**
 * CC-7 — structural validation that runs BEFORE any network call: handle
 * grammar, key length, scope, non-empty text. Never touches the network.
 */
export function preflight(handle: string, keyB64: string, scopeId: string, text: string): void {
  if (!HANDLE_PATTERN.test(handle)) {
    throw new Error('preflight: map handle does not match the expected svh1-… format.');
  }
  const keyBytes = base64ToBytes(keyB64);
  if (keyBytes.length !== MASTER_KEY_BYTES) {
    throw new Error(`preflight: map key must decode to exactly ${MASTER_KEY_BYTES} bytes.`);
  }
  if (typeof scopeId !== 'string' || scopeId.trim() === '') {
    throw new Error('preflight: scope ID is required for Local restore.');
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('preflight: text to restore must not be empty.');
  }
}
