/**
 * PROTOCOL.md §5a — the n8n Local-restore container wire frame and its AAD.
 *
 * Wire format: `[u8 version=0x01][16-byte containerId][envelope]`. The AAD is
 * built from three length-prefixed components (domain tag, version, containerId)
 * using the §4 byte convention — reproduced locally because
 * `encodeLengthPrefixedText` is not part of `@synthaveil/restore-protocol`'s
 * public surface (only the per-entry AAD helpers are exported). The version and
 * containerId enter the AAD as fixed-width lowercase hex TEXT ('01', 32 hex
 * chars), not raw bytes — `encodeLengthPrefixedText` only accepts NFC text.
 */

/** Frame header size: 1 version byte + 16-byte containerId. */
export const CONTAINER_ID_BYTES = 16;
const CONTAINER_VERSION = 0x01;
const HEADER_BYTES = 1 + CONTAINER_ID_BYTES;
const DOMAIN_TAG = 'synthaveil/container/v1';
const LENGTH_PREFIX_BYTES = 4;
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

/** PROTOCOL.md §4 component encoder: `length(4, BE) || utf8Bytes(NFC(raw))`. */
function encodeComponent(text: string): Uint8Array {
  const utf8 = new TextEncoder().encode(text.normalize('NFC'));
  const out = new Uint8Array(LENGTH_PREFIX_BYTES + utf8.length);
  new DataView(out.buffer).setUint32(0, utf8.length, false);
  out.set(utf8, LENGTH_PREFIX_BYTES);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0'))
    .join('');
}

function assertContainerIdLength(containerId: Uint8Array): void {
  if (containerId.length !== CONTAINER_ID_BYTES) {
    throw new Error(`containerId must be exactly ${CONTAINER_ID_BYTES} bytes`);
  }
}

/** PROTOCOL.md §5a AAD: domain tag, version (as hex text), containerId (as hex text). */
export function buildContainerAad(containerId: Uint8Array): Uint8Array {
  assertContainerIdLength(containerId);
  const versionHex = CONTAINER_VERSION.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0');
  return concatBytes([
    encodeComponent(DOMAIN_TAG),
    encodeComponent(versionHex),
    encodeComponent(toHex(containerId)),
  ]);
}

/** Frame `[version(1)][containerId(16)][envelope]`, no padding. */
export function encodeContainer(containerId: Uint8Array, envelope: Uint8Array): Uint8Array {
  assertContainerIdLength(containerId);
  const out = new Uint8Array(HEADER_BYTES + envelope.length);
  out[0] = CONTAINER_VERSION;
  out.set(containerId, 1);
  out.set(envelope, HEADER_BYTES);
  return out;
}

export interface DecodedContainer {
  version: number;
  containerId: Uint8Array;
  envelope: Uint8Array;
}

/** Parses the frame header BEFORE any decrypt attempt; refuses an unknown version byte. */
export function decodeContainer(frame: Uint8Array): DecodedContainer {
  if (frame.length < HEADER_BYTES) {
    throw new Error('container frame is too short to carry version + containerId');
  }
  const version = frame[0];
  if (version !== CONTAINER_VERSION) {
    throw new Error(`unsupported container version byte 0x${version.toString(HEX_RADIX)}`);
  }
  return {
    version,
    containerId: frame.slice(1, HEADER_BYTES),
    envelope: frame.slice(HEADER_BYTES),
  };
}
