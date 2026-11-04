/**
 * Task 3.3 — `nodes/Taas/containerCodec.ts`: the container wire frame and its AAD.
 * PROTOCOL.md §5a is the normative spec; this pins the frame layout and the AAD
 * golden vector against it.
 *
 * EXPECTED STATE: RED — `nodes/Taas/containerCodec.ts` does not exist yet.
 *
 * `encodeLengthPrefixedText` (the §4 component encoder `buildContainerAad` is
 * built on) is NOT part of the package's public surface — `index.ts` exports
 * only `AAD_DOMAIN_TAG`/`encodeAad`/`buildEntryAad` for the per-entry AAD, and
 * the vendored bundle (`vendor/restore-protocol.js`) mirrors that same export
 * list. So the golden AAD below is computed independently in this test from
 * PROTOCOL.md §4's documented byte convention (4-byte big-endian length prefix
 * + UTF-8 bytes per NFC-normalized component, no separators), not by importing
 * an internal encoder.
 */
import {
  buildContainerAad,
  decodeContainer,
  encodeContainer,
} from '../../nodes/Taas/containerCodec';

const CONTAINER_ID_BYTES = 16;
const CONTAINER_VERSION = 0x01;
const DOMAIN_TAG = 'synthaveil/container/v1';

/** PROTOCOL.md §4 component encoder, reproduced independently for the golden vector. */
function encodeComponent(text: string): Uint8Array {
  const utf8 = new TextEncoder().encode(text.normalize('NFC'));
  const out = new Uint8Array(4 + utf8.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, utf8.length, false);
  out.set(utf8, 4);
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
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const CONTAINER_ID_AB16 = new Uint8Array(CONTAINER_ID_BYTES).fill(0xab);

/** Golden vector: sixteen 0xab bytes as the containerId. */
const EXPECTED_AAD_AB16 = concatBytes([
  encodeComponent(DOMAIN_TAG),
  encodeComponent('01'),
  encodeComponent(toHex(CONTAINER_ID_AB16)), // 32 lowercase hex chars
]);

describe('buildContainerAad (Task 3.3, PROTOCOL.md §5a)', () => {
  it('matches the golden vector for sixteen 0xab bytes', () => {
    const aad = buildContainerAad(CONTAINER_ID_AB16);
    expect(new Uint8Array(aad)).toEqual(EXPECTED_AAD_AB16);
  });

  it('encodes the version as the fixed-width lowercase hex string "01", not a raw byte', () => {
    const aad = buildContainerAad(CONTAINER_ID_AB16);
    // The version component's own length prefix (4 bytes, BE) must read 2 —
    // "01" as text, not 1 as a single raw version byte.
    const domainComponent = encodeComponent(DOMAIN_TAG);
    const versionLengthOffset = domainComponent.length;
    const view = new DataView(aad.buffer, aad.byteOffset + versionLengthOffset, 4);
    expect(view.getUint32(0, false)).toBe(2);
  });

  it('produces different AAD for different containerIds (no accidental collision)', () => {
    const other = new Uint8Array(CONTAINER_ID_BYTES).fill(0xcd);
    const aadAb = buildContainerAad(CONTAINER_ID_AB16);
    const aadCd = buildContainerAad(other);
    expect(new Uint8Array(aadAb)).not.toEqual(new Uint8Array(aadCd));
  });

  it('rejects a containerId that is not exactly 16 bytes', () => {
    expect(() => buildContainerAad(new Uint8Array(15).fill(1))).toThrow();
    expect(() => buildContainerAad(new Uint8Array(17).fill(1))).toThrow();
  });
});

describe('encodeContainer / decodeContainer frame round-trip (Task 3.3)', () => {
  const containerId = new Uint8Array(CONTAINER_ID_BYTES).fill(0x11);
  const envelope = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it('round-trips version, containerId, and envelope bytes', () => {
    const frame = encodeContainer(containerId, envelope);
    const decoded = decodeContainer(frame);

    expect(decoded.version).toBe(CONTAINER_VERSION);
    expect(new Uint8Array(decoded.containerId)).toEqual(containerId);
    expect(new Uint8Array(decoded.envelope)).toEqual(envelope);
  });

  it('lays out bytes as [version(1)][containerId(16)][envelope] with no padding', () => {
    const frame = encodeContainer(containerId, envelope);
    expect(frame[0]).toBe(CONTAINER_VERSION);
    expect(new Uint8Array(frame.slice(1, 1 + CONTAINER_ID_BYTES))).toEqual(containerId);
    expect(new Uint8Array(frame.slice(1 + CONTAINER_ID_BYTES))).toEqual(envelope);
    expect(frame.length).toBe(1 + CONTAINER_ID_BYTES + envelope.length);
  });

  it('enforces the containerId is exactly 16 bytes on encode', () => {
    expect(() => encodeContainer(new Uint8Array(15).fill(1), envelope)).toThrow();
  });

  it('rejects an unknown version byte on decode (0x02 forward-compat refusal)', () => {
    const frame = encodeContainer(containerId, envelope);
    const tampered = new Uint8Array(frame);
    tampered[0] = 0x02;
    expect(() => decodeContainer(tampered)).toThrow();
  });

  it('rejects a frame too short to carry version + containerId', () => {
    expect(() => decodeContainer(new Uint8Array([CONTAINER_VERSION, 1, 2, 3]))).toThrow();
  });
});
