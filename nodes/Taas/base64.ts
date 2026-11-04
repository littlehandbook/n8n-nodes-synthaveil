/**
 * base64 <-> bytes without Node's `Buffer` global — the scanner's
 * `no-restricted-globals` rule forbids `Buffer` in shipped JS. `atob`/`btoa`
 * are ordinary Node 18+ globals and are not on that restricted list.
 */

/** Encode bytes as base64 (used for the map blob sent to the store). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Decode base64 (a Map Key credential, or a map blob) into raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
