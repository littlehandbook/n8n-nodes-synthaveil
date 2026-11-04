"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../packages/restore-protocol/src/index.ts
var index_exports = {};
__export(index_exports, {
  AAD_DOMAIN_TAG: () => AAD_DOMAIN_TAG,
  ALG_BYTES: () => ALG_BYTES,
  CODE_WRAP_KEY_KINDS: () => CODE_WRAP_KEY_KINDS,
  ENVELOPE_FORMAT_VERSION: () => ENVELOPE_FORMAT_VERSION,
  FAILURE_CODES: () => FAILURE_CODES,
  HPKE_RECIPIENT_KINDS: () => HPKE_RECIPIENT_KINDS,
  KEY_LOCKING_METHODS: () => KEY_LOCKING_METHODS,
  KEY_LOCKING_METHOD_CODE_WRAP: () => KEY_LOCKING_METHOD_CODE_WRAP,
  KEY_LOCKING_METHOD_HPKE_P256: () => KEY_LOCKING_METHOD_HPKE_P256,
  KEY_LOCKING_METHOD_NAMESPACE: () => KEY_LOCKING_METHOD_NAMESPACE,
  LOOKUP_CONTAINER_DOMAIN_TAG: () => LOOKUP_CONTAINER_DOMAIN_TAG,
  LOOKUP_DIGEST_DOMAIN_TAG: () => LOOKUP_DIGEST_DOMAIN_TAG,
  LOOKUP_ROLES: () => LOOKUP_ROLES,
  LOOKUP_SURFACES: () => LOOKUP_SURFACES,
  MAX_META_PER_SEGMENT: () => MAX_META_PER_SEGMENT,
  MAX_PAIRS_PER_SEGMENT: () => MAX_PAIRS_PER_SEGMENT,
  PROTOCOL_VERSION: () => PROTOCOL_VERSION,
  ProtocolRefusal: () => ProtocolRefusal,
  SUPPORTED_ALGS: () => SUPPORTED_ALGS,
  buildEntryAad: () => buildEntryAad,
  createCodeWrap: () => createCodeWrap,
  decodeLookupContainer: () => decodeLookupContainer,
  decodeRecoveryCode: () => decodeRecoveryCode,
  deriveContainerKey: () => deriveContainerKey,
  deriveScopedKey: () => deriveScopedKey,
  encodeAad: () => encodeAad,
  encodeLookupContainer: () => encodeLookupContainer,
  encodeLookupContainerAad: () => encodeLookupContainerAad,
  isFailureCode: () => isFailureCode,
  lookupContentDigest: () => lookupContentDigest,
  lookupKeyLockingMethod: () => lookupKeyLockingMethod,
  normalizeRecoveryCode: () => normalizeRecoveryCode,
  openEnvelope: () => openEnvelope,
  openLookupContainer: () => openLookupContainer,
  planTextRestore: () => planTextRestore,
  restoreStructured: () => restoreStructured,
  restoreText: () => restoreText,
  runConformanceFixtures: () => runConformanceFixtures,
  sealEnvelope: () => sealEnvelope,
  sealLookupContainer: () => sealLookupContainer,
  unwrapDek: () => unwrapDek,
  unwrapWithCode: () => unwrapWithCode,
  validateContainer: () => validateContainer,
  validateEntry: () => validateEntry,
  validateInventory: () => validateInventory,
  validateLookupAadFields: () => validateLookupAadFields,
  validateLookupContainer: () => validateLookupContainer,
  wrapDek: () => wrapDek
});
module.exports = __toCommonJS(index_exports);

// scripts/webcrypto-shim.mjs
var import_node_crypto = require("node:crypto");
var __synthaveilWebCrypto = import_node_crypto.webcrypto;

// ../../packages/restore-protocol/src/version.ts
var PROTOCOL_VERSION = "0.1.0-draft";

// ../../packages/restore-protocol/src/failureCodes.ts
var FAILURE_CODES = [
  "VERSION_CONFLICT",
  "UNKNOWN_TOKEN",
  "MISSING_ENTRY",
  "SCOPE_MISMATCH",
  "EXPIRED",
  "PURGED",
  "RESIDUAL_DETECTED",
  "AMBIGUOUS_VALUE",
  "UNSUPPORTED_ALGORITHM",
  "AUTH_FAILED",
  "INVALID_ENTRY"
];
var FAILURE_CODE_SET = new Set(FAILURE_CODES);
function isFailureCode(value) {
  return typeof value === "string" && FAILURE_CODE_SET.has(value);
}

// ../../packages/restore-protocol/src/lengthPrefixedEncoding.ts
var LENGTH_PREFIX_BYTES = 4;
function encodeLengthPrefixedText(raw) {
  const bytes = new TextEncoder().encode(raw.normalize("NFC"));
  const output = new Uint8Array(LENGTH_PREFIX_BYTES + bytes.length);
  new DataView(output.buffer).setUint32(0, bytes.length, false);
  output.set(bytes, LENGTH_PREFIX_BYTES);
  return output;
}

// ../../packages/restore-protocol/src/aad.ts
var AAD_DOMAIN_TAG = "restore-protocol/entry/v0";
function encodeComponent(raw) {
  return encodeLengthPrefixedText(raw);
}
function encodeAad(input) {
  const parts = [
    encodeComponent(AAD_DOMAIN_TAG),
    encodeComponent(input.recordRef),
    encodeComponent(input.fieldPath),
    encodeComponent(input.scopeRef),
    encodeComponent(input.protocolVersion)
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function buildEntryAad(entry) {
  return encodeAad({
    recordRef: entry.recordRef,
    fieldPath: entry.fieldPath,
    scopeRef: entry.scopeRef,
    protocolVersion: entry.protocolVersion
  });
}

// ../../packages/restore-protocol/src/guards.ts
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../../packages/restore-protocol/src/stage2Bytes.ts
var LENGTH_PREFIX_BYTES2 = 4;
var MAX_INDEX = 2147483647;
var AES_256_KEY_BYTES = 32;
var GCM_NONCE_BYTES = 12;
var GCM_TAG_BYTES = 16;
var LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function copyBytes(bytes) {
  return new Uint8Array(bytes);
}
function wipe(...buffers) {
  wipeAll(buffers);
}
function wipeAll(buffers) {
  for (const buffer of buffers) buffer.fill(0);
}
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function lpText(text) {
  const bytes = utf8Nfc(text);
  try {
    return concatBytes([u32be(bytes.length), bytes]);
  } finally {
    wipe(bytes);
  }
}
function encodeLpSequence(components) {
  const parts = [];
  try {
    for (const component of components) parts.push(lpText(component));
    return concatBytes(parts);
  } finally {
    wipeAll(parts);
  }
}
function utf8Nfc(text) {
  return new TextEncoder().encode(text.normalize("NFC"));
}
function compareBytes(a, b) {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
function bytesEqual(a, b) {
  return a.length === b.length && compareBytes(a, b) === 0;
}
function isWellFormedText(value) {
  return typeof value === "string" && !LONE_SURROGATE.test(value);
}
function isNonEmptyText(value) {
  return isWellFormedText(value) && value.length > 0;
}
function isBoundedInt(value, min) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= MAX_INDEX;
}
function isBytes(value, length) {
  return value instanceof Uint8Array && value.length === length;
}
function snapshotFields(value, keys) {
  try {
    if (!isPlainObject(value)) return null;
    const out = {};
    for (const key of keys) out[key] = value[key];
    return Object.freeze(out);
  } catch {
    return null;
  }
}
var TYPED_ARRAY_NAME = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag
)?.get;
var TYPED_ARRAY_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "length"
)?.get;
function isRealUint8Array(value) {
  try {
    return TYPED_ARRAY_NAME?.call(value) === "Uint8Array";
  } catch {
    return false;
  }
}
function slotLength(value) {
  if (TYPED_ARRAY_LENGTH === void 0) throw new TypeError("no %TypedArray% length getter");
  return Reflect.apply(TYPED_ARRAY_LENGTH, value, []);
}
function lengthOf(value) {
  try {
    if (!isRealUint8Array(value)) return null;
    const length = slotLength(value);
    return typeof length === "number" ? length : null;
  } catch {
    return null;
  }
}
function headBytes(value, count) {
  try {
    const length = lengthOf(value);
    if (length === null || length < count || !isRealUint8Array(value)) return null;
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = value[i];
    return out;
  } catch {
    return null;
  }
}
function snapshotBytes(value, length) {
  try {
    if (!isRealUint8Array(value)) return null;
    if (length !== void 0 && slotLength(value) !== length) return null;
    const copy = new Uint8Array(value);
    return length === void 0 || copy.length === length ? copy : null;
  } catch {
    return null;
  }
}
function frozenRefusal(code) {
  return Object.freeze({ ok: false, code });
}
function u32be(value) {
  const out = new Uint8Array(LENGTH_PREFIX_BYTES2);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}
function lpBytes(bytes) {
  return concatBytes([u32be(bytes.length), bytes]);
}
var ProtocolRefusal = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ProtocolRefusal";
    this.code = code;
  }
};
async function importAesGcmKey(key, usage) {
  const raw = copyBytes(key);
  try {
    return await __synthaveilWebCrypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [usage]);
  } finally {
    wipe(raw);
  }
}
async function aesGcmOpen(key, nonce, aad, ciphertextAndTag) {
  try {
    const cryptoKey = await importAesGcmKey(key, "decrypt");
    const params = { name: "AES-GCM", iv: copyBytes(nonce), additionalData: copyBytes(aad) };
    const plain = await __synthaveilWebCrypto.subtle.decrypt(
      params,
      cryptoKey,
      copyBytes(ciphertextAndTag)
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
async function aesGcmSeal(key, nonce, aad, plaintext) {
  const cryptoKey = await importAesGcmKey(key, "encrypt");
  const params = { name: "AES-GCM", iv: copyBytes(nonce), additionalData: copyBytes(aad) };
  const secret = copyBytes(plaintext);
  try {
    return new Uint8Array(await __synthaveilWebCrypto.subtle.encrypt(params, cryptoKey, secret));
  } finally {
    wipe(secret);
  }
}

// ../../packages/restore-protocol/src/envelope.ts
var ENVELOPE_FORMAT_VERSION = 1;
var ALG_BYTES = { A256GCM: 1, A256GCMSIV: 2 };
var SUPPORTED_ALGS = ["A256GCM"];
var FORMAT_VERSION_OFFSET = 0;
var ALG_OFFSET = 1;
var NONCE_OFFSET = 2;
var NONCE_BYTES = 12;
var CIPHERTEXT_OFFSET = NONCE_OFFSET + NONCE_BYTES;
var HEADER_BYTES = CIPHERTEXT_OFFSET;
var GCM_TAG_BYTES2 = 16;
function frame(nonce, algByte, ciphertextAndTag) {
  const out = new Uint8Array(HEADER_BYTES + ciphertextAndTag.length);
  out[FORMAT_VERSION_OFFSET] = ENVELOPE_FORMAT_VERSION;
  out[ALG_OFFSET] = algByte;
  out.set(nonce, NONCE_OFFSET);
  out.set(ciphertextAndTag, CIPHERTEXT_OFFSET);
  return out;
}
async function sealWithNonce(input) {
  const { key, nonce, aad, plaintext, alg } = input;
  if (alg !== "A256GCM") return { ok: false, code: "UNSUPPORTED_ALGORITHM" };
  try {
    const ciphertextAndTag = await aesGcmSeal(key, nonce, aad, plaintext);
    return { ok: true, value: frame(nonce, ALG_BYTES.A256GCM, ciphertextAndTag) };
  } catch {
    return { ok: false, code: "INVALID_ENTRY" };
  }
}
async function sealEnvelope(input) {
  const nonce = __synthaveilWebCrypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return sealWithNonce({ ...input, nonce, alg: input.alg ?? "A256GCM" });
}
async function openEnvelope(envelope, key, aad) {
  if (!(envelope instanceof Uint8Array) || envelope.length < HEADER_BYTES) {
    return { ok: false, code: "INVALID_ENTRY" };
  }
  const formatVersion = envelope[FORMAT_VERSION_OFFSET];
  const algByte = envelope[ALG_OFFSET];
  if (formatVersion !== ENVELOPE_FORMAT_VERSION || algByte !== ALG_BYTES.A256GCM) {
    return { ok: false, code: "UNSUPPORTED_ALGORITHM" };
  }
  const body = envelope.subarray(CIPHERTEXT_OFFSET);
  if (body.length < GCM_TAG_BYTES2) {
    return { ok: false, code: "INVALID_ENTRY" };
  }
  const nonce = envelope.subarray(NONCE_OFFSET, CIPHERTEXT_OFFSET);
  const plaintext = await aesGcmOpen(key, nonce, aad, body);
  return plaintext === null ? { ok: false, code: "AUTH_FAILED" } : { ok: true, value: plaintext };
}

// ../../packages/restore-protocol/src/deriveKey.ts
var HKDF_SALT = "restore-protocol/hkdf-salt/v0";
var SCOPE_DEK_DOMAIN_TAG = "restore-protocol/scope-dek/v0";
var MASTER_KEY_BYTES = 32;
var DEK_BYTES = 32;
var BITS_PER_BYTE = 8;
function asBufferSource(bytes) {
  return bytes;
}
function encodeComponent2(raw) {
  return encodeLengthPrefixedText(raw);
}
function buildInfo(scopeRef) {
  const tag = encodeComponent2(SCOPE_DEK_DOMAIN_TAG);
  const scope = encodeComponent2(scopeRef);
  const out = new Uint8Array(tag.length + scope.length);
  out.set(tag, 0);
  out.set(scope, tag.length);
  return out;
}
async function hkdfSha256(ikm, salt, info) {
  const key = await __synthaveilWebCrypto.subtle.importKey("raw", asBufferSource(ikm), "HKDF", false, [
    "deriveBits"
  ]);
  const bits = await __synthaveilWebCrypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: asBufferSource(salt), info: asBufferSource(info) },
    key,
    DEK_BYTES * BITS_PER_BYTE
  );
  return new Uint8Array(bits);
}
async function deriveScopedKey(masterKey, scopeRef) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== MASTER_KEY_BYTES) {
    return { ok: false, code: "INVALID_ENTRY" };
  }
  if (typeof scopeRef !== "string" || scopeRef.length === 0) {
    return { ok: false, code: "INVALID_ENTRY" };
  }
  try {
    const salt = new TextEncoder().encode(HKDF_SALT);
    const value = await hkdfSha256(masterKey, salt, buildInfo(scopeRef));
    return { ok: true, value };
  } catch {
    return { ok: false, code: "INVALID_ENTRY" };
  }
}

// ../../packages/restore-protocol/src/deriveContainerKey.ts
var CONTAINER_DEK_DOMAIN_TAG = "restore-protocol/container-dek/v1";
function buildContainerInfo() {
  return encodeLengthPrefixedText(CONTAINER_DEK_DOMAIN_TAG);
}
async function deriveContainerKey(masterKey) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== MASTER_KEY_BYTES) {
    return { ok: false, code: "INVALID_ENTRY" };
  }
  try {
    const salt = new TextEncoder().encode(HKDF_SALT);
    const value = await hkdfSha256(masterKey, salt, buildContainerInfo());
    if (value.length !== DEK_BYTES) {
      return { ok: false, code: "INVALID_ENTRY" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, code: "INVALID_ENTRY" };
  }
}

// ../../packages/restore-protocol/src/validate.ts
var invalid = () => ({ ok: false, code: "INVALID_ENTRY" });
function snapshotProtection(input) {
  if (!isPlainObject(input)) return null;
  const { envelope, valueRef } = input;
  if (envelope !== void 0 === (valueRef !== void 0)) return null;
  if (valueRef !== void 0) {
    return typeof valueRef === "string" && valueRef !== "" ? { valueRef } : null;
  }
  return envelope instanceof Uint8Array ? { envelope: new Uint8Array(envelope) } : null;
}
function snapshotEntry(input) {
  if (!isPlainObject(input)) return null;
  const { recordRef, fieldPath, sourceVersion, protocolVersion, scopeRef, protection } = input;
  if (typeof recordRef !== "string" || typeof fieldPath !== "string") return null;
  if (typeof sourceVersion !== "string" || typeof scopeRef !== "string") return null;
  if (typeof protocolVersion !== "string" || protocolVersion === "") return null;
  const copiedProtection = snapshotProtection(protection);
  if (copiedProtection === null) return null;
  return {
    recordRef,
    fieldPath,
    sourceVersion,
    protocolVersion,
    scopeRef,
    protection: copiedProtection
  };
}
function validateEntry(input) {
  try {
    const entry = snapshotEntry(input);
    return entry === null ? invalid() : { ok: true, value: entry };
  } catch {
    return invalid();
  }
}
function snapshotEntries(input) {
  if (!Array.isArray(input)) return null;
  const length = input.length;
  const entries = [];
  for (let index = 0; index < length; index += 1) {
    const entry = snapshotEntry(input[index]);
    if (entry === null) return null;
    entries.push(entry);
  }
  return entries;
}
function normalizedTripleKey(entry) {
  return JSON.stringify(
    [entry.recordRef, entry.fieldPath, entry.sourceVersion].map((s) => s.normalize("NFC"))
  );
}
function hasDuplicateTriple(entries) {
  const seen = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const key = normalizedTripleKey(entry);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
function allEntriesShareScope(entries, containerScope) {
  const scope = containerScope.normalize("NFC");
  return entries.every((entry) => entry.scopeRef.normalize("NFC") === scope);
}
function validateContainer(input) {
  try {
    if (!isPlainObject(input)) return invalid();
    const { protocolVersion, scopeRef, entries } = input;
    if (typeof protocolVersion !== "string" || typeof scopeRef !== "string") return invalid();
    const copiedEntries = snapshotEntries(entries);
    if (copiedEntries === null) return invalid();
    if (!allEntriesShareScope(copiedEntries, scopeRef)) return invalid();
    if (hasDuplicateTriple(copiedEntries)) return invalid();
    return { ok: true, value: { protocolVersion, scopeRef, entries: copiedEntries } };
  } catch {
    return invalid();
  }
}

// ../../packages/restore-protocol/src/inventory.ts
var LONE_SURROGATE2 = /[\ud800-\udfff]/u;
function isWellFormedText2(value) {
  return typeof value === "string" && !LONE_SURROGATE2.test(value);
}
function snapshotEntry2(entry) {
  if (!isPlainObject(entry)) return null;
  const { token, original } = entry;
  if (!isWellFormedText2(token) || token === "" || !isWellFormedText2(original)) return null;
  return { token, original };
}
function snapshotEntries2(entries) {
  const out = [];
  const length = entries.length;
  for (let index = 0; index < length; index += 1) {
    const copy = snapshotEntry2(entries[index]);
    if (copy === null) return null;
    out.push(copy);
  }
  return out;
}
function findAmbiguousToken(entries) {
  const seen = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const key = entry.token.normalize("NFC");
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
function validateInventory(input) {
  if (!isPlainObject(input)) return { ok: false, code: "INVALID_ENTRY" };
  const { protocolVersion, scopeRef, entries } = input;
  if (typeof protocolVersion !== "string" || typeof scopeRef !== "string") {
    return { ok: false, code: "INVALID_ENTRY" };
  }
  const copied = Array.isArray(entries) ? snapshotEntries2(entries) : null;
  if (copied === null) return { ok: false, code: "INVALID_ENTRY" };
  if (findAmbiguousToken(copied)) return { ok: false, code: "AMBIGUOUS_VALUE" };
  return { ok: true, value: { protocolVersion, scopeRef, entries: copied } };
}

// ../../packages/restore-protocol/src/restoreStructured.ts
var PROFILE_S = "S";
var MAX_ARRAY_LENGTH = 4294967295;
function snapshotRequest(value) {
  if (!isPlainObject(value)) throw new Error("Invalid structured request");
  const { recordRef, fieldPath, sourceVersion } = value;
  if (typeof recordRef !== "string" || typeof fieldPath !== "string" || typeof sourceVersion !== "string") {
    throw new Error("Invalid structured request");
  }
  return { recordRef, fieldPath, sourceVersion };
}
function snapshotRequestSlot(requests, index) {
  const descriptor = Object.getOwnPropertyDescriptor(requests, index);
  if (!descriptor) throw new Error("Invalid structured request batch");
  let value;
  if (Object.hasOwn(descriptor, "value")) value = descriptor.value;
  else if (descriptor.get !== void 0) value = Reflect.apply(descriptor.get, requests, []);
  return snapshotRequest(value);
}
function snapshotRequests(requests) {
  if (!Array.isArray(requests)) throw new Error("Invalid structured request batch");
  const length = requests.length;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
    throw new Error("Invalid structured request batch");
  }
  const snapshots = [];
  for (let index = 0; index < length; index++) {
    snapshots.push(snapshotRequestSlot(requests, index));
  }
  return snapshots;
}
function nfcEq(a, b) {
  return a.normalize("NFC") === b.normalize("NFC");
}
function receiptEntry(r, ok, code) {
  return {
    recordRef: r.recordRef,
    fieldPath: r.fieldPath,
    sourceVersion: r.sourceVersion,
    ok,
    code
  };
}
function buildReceipt(protocolVersion, scopeRef, entries) {
  const refusedCount = entries.filter((e) => !e.ok).length;
  const restoredCount = refusedCount === 0 ? entries.length : 0;
  return {
    profile: PROFILE_S,
    protocolVersion,
    scopeRef,
    requestedCount: entries.length,
    restoredCount,
    refusedCount,
    entries
  };
}
function refuseAll(requests, code, protocolVersion, scopeRef) {
  const entries = requests.map((r) => receiptEntry(r, false, code));
  return { ok: false, code, receipt: buildReceipt(protocolVersion, scopeRef, entries) };
}
function findEntry(entries, request) {
  const byKey = entries.filter(
    (e) => nfcEq(e.recordRef, request.recordRef) && nfcEq(e.fieldPath, request.fieldPath)
  );
  if (byKey.length === 0) return { code: "MISSING_ENTRY" };
  const exact = byKey.find((e) => nfcEq(e.sourceVersion, request.sourceVersion));
  return exact ? { entry: exact } : { code: "VERSION_CONFLICT" };
}
function lifecycleCode(entry, materialState) {
  const state = materialState ? materialState(entry) : "ACTIVE";
  if (state === "EXPIRED") return "EXPIRED";
  if (state === "PURGED") return "PURGED";
  return null;
}
function resolveRequests(entries, requests, materialState) {
  return requests.map((request) => {
    const found = findEntry(entries, request);
    if ("code" in found) return { request, code: found.code };
    return { request, code: lifecycleCode(found.entry, materialState), entry: found.entry };
  });
}
function restoreStructuredImpl(container, requests, expectedScopeRef, options = {}) {
  const safeRequests = snapshotRequests(requests);
  const validated = validateContainer(container);
  if (!validated.ok) return refuseAll(safeRequests, validated.code, "", "");
  const mapContainer = validated.value;
  if (mapContainer.scopeRef !== expectedScopeRef) {
    return refuseAll(
      safeRequests,
      "SCOPE_MISMATCH",
      mapContainer.protocolVersion,
      mapContainer.scopeRef
    );
  }
  const outcomes = resolveRequests(mapContainer.entries, safeRequests, options.materialState);
  const receiptEntries = outcomes.map((o) => receiptEntry(o.request, o.code === null, o.code));
  const receipt = buildReceipt(mapContainer.protocolVersion, mapContainer.scopeRef, receiptEntries);
  const firstFailure = outcomes.find((o) => o.code !== null);
  if (firstFailure) return { ok: false, code: firstFailure.code, receipt };
  const resolved = outcomes.map((o) => ({
    recordRef: o.request.recordRef,
    fieldPath: o.request.fieldPath,
    sourceVersion: o.request.sourceVersion,
    protection: o.entry.protection
  }));
  return { ok: true, resolved, receipt };
}
function restoreStructured(container, requests, expectedScopeRef, options = {}) {
  try {
    return restoreStructuredImpl(container, requests, expectedScopeRef, options);
  } catch {
    return {
      ok: false,
      code: "INVALID_ENTRY",
      receipt: {
        profile: PROFILE_S,
        protocolVersion: "",
        scopeRef: "",
        requestedCount: 0,
        restoredCount: 0,
        refusedCount: 1,
        entries: []
      }
    };
  }
}

// ../../packages/restore-protocol/src/textReceipt.ts
var PROFILE_T = "T";
function safeInventoryShape(raw) {
  const obj = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const entries = obj.entries;
  return {
    protocolVersion: typeof obj.protocolVersion === "string" ? obj.protocolVersion : "",
    scopeRef: typeof obj.scopeRef === "string" ? obj.scopeRef : "",
    count: Array.isArray(entries) ? entries.length : 0
  };
}
function refuseWith(code, protocolVersion, scopeRef, inventoryCount) {
  return {
    ok: false,
    code,
    receipt: {
      profile: PROFILE_T,
      protocolVersion,
      scopeRef,
      inventoryCount,
      replacedCount: 0,
      refusedCount: 1,
      entries: []
    }
  };
}
function countOccurrences(entryCount, selected) {
  const counts = new Array(entryCount).fill(0);
  for (const match of selected) counts[match.idx] += 1;
  return counts;
}
function buildReceipt2(inventory, selected) {
  const occurrences = countOccurrences(inventory.entries.length, selected);
  const entries = occurrences.map((count, idx) => ({
    inventoryIndex: idx,
    occurrences: count,
    ok: true,
    code: null
  }));
  return {
    profile: PROFILE_T,
    protocolVersion: inventory.protocolVersion,
    scopeRef: inventory.scopeRef,
    inventoryCount: inventory.entries.length,
    replacedCount: selected.length,
    refusedCount: 0,
    entries
  };
}

// ../../packages/restore-protocol/src/textMatch.ts
function collectCandidates(text, tokens) {
  const out = [];
  for (const { token, idx } of tokens) {
    if (token.length === 0) continue;
    let from = 0;
    for (; ; ) {
      const pos = text.indexOf(token, from);
      if (pos === -1) break;
      out.push({ start: pos, end: pos + token.length, token, idx });
      from = pos + 1;
    }
  }
  return out;
}
function codePointLength(value) {
  return Array.from(value).length;
}
function compareCodePoints(a, b) {
  const ap = Array.from(a, (ch) => ch.codePointAt(0) ?? 0);
  const bp = Array.from(b, (ch) => ch.codePointAt(0) ?? 0);
  const shared = Math.min(ap.length, bp.length);
  for (let i = 0; i < shared; i++) {
    if (ap[i] !== bp[i]) return ap[i] - bp[i];
  }
  return ap.length - bp.length;
}
function compareCandidates(a, b) {
  const lengthDiff = codePointLength(b.token) - codePointLength(a.token);
  if (lengthDiff !== 0) return lengthDiff;
  return compareCodePoints(a.token, b.token);
}
function overlapsAny(candidate, selected) {
  return selected.some((s) => candidate.start < s.end && s.start < candidate.end);
}
function selectMatches(candidates) {
  const priority = [...candidates].sort(compareCandidates);
  const selected = [];
  for (const candidate of priority) {
    if (!overlapsAny(candidate, selected)) selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}
function splice(text, selected, originalFor) {
  let cursor = 0;
  let result = "";
  const gaps = [];
  for (const match of selected) {
    const gap = text.slice(cursor, match.start);
    gaps.push(gap);
    result += gap + originalFor(match.idx);
    cursor = match.end;
  }
  const tail = text.slice(cursor);
  gaps.push(tail);
  result += tail;
  return { text: result, gaps };
}
function spliceInputSpace(text, matches, originalFor) {
  let cursor = 0;
  let result = "";
  for (const match of matches) {
    result += text.slice(cursor, match.start) + originalFor(match.inventoryIndex);
    cursor = match.end;
  }
  return result + text.slice(cursor);
}
function containsAnyToken(haystack, tokens) {
  const normalized = haystack.normalize("NFC");
  return tokens.some((token) => token.length > 0 && normalized.includes(token));
}
var COMBINING_MARKS = new RegExp("\\p{M}", "gu");
var HAS_COMBINING_MARK = new RegExp("\\p{M}", "u");
function baseLetters(value) {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").normalize("NFC");
}
function clustersOf(value) {
  const out = [];
  for (const char of value.normalize("NFD")) {
    const last = out[out.length - 1];
    if (HAS_COMBINING_MARK.test(char) && last !== void 0) last.marks.push(char);
    else out.push({ base: HAS_COMBINING_MARK.test(char) ? "" : char, marks: [] });
  }
  return out;
}
function marksCovered(wanted, held) {
  const left = [...held];
  return wanted.every((mark) => {
    const at = left.indexOf(mark);
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}
function holdsWithExtraMarks(text, token) {
  for (let start = 0; start + token.length <= text.length; start += 1) {
    const hit = token.every((want, k) => {
      const have = text[start + k];
      return have.base === want.base && marksCovered(want.marks, have.marks);
    });
    if (hit) return true;
  }
  return false;
}
function containsMarkBrokenToken(haystack, tokens) {
  const marked = tokens.filter((token) => HAS_COMBINING_MARK.test(token.normalize("NFD")));
  const plain = tokens.filter((token) => token.length > 0 && !marked.includes(token));
  if (plain.length > 0) {
    const base = baseLetters(haystack);
    if (plain.some((token) => base.includes(baseLetters(token)))) return true;
  }
  if (marked.length === 0) return false;
  const text = clustersOf(haystack);
  return marked.some((token) => holdsWithExtraMarks(text, clustersOf(token)));
}
function hasResidual(selected, gaps, originalFor, tokens) {
  const insertedHasToken = selected.some(
    (match) => containsAnyToken(originalFor(match.idx), tokens)
  );
  if (insertedHasToken) return true;
  return gaps.some((gap) => containsAnyToken(gap, tokens));
}

// ../../packages/restore-protocol/src/planText.ts
var NORMALISATION_UNSUPPORTED = "NORMALISATION_UNSUPPORTED";
var BMP_MAX = 65535;
var ASCII_MAX = 128;
var MARK = new RegExp("\\p{M}", "u");
function refuseForInventory(inventory, code) {
  return refuseWith(code, inventory.protocolVersion, inventory.scopeRef, inventory.entries.length);
}
function validateForPlan(inventoryInput, expectedScopeRef) {
  const shape = safeInventoryShape(inventoryInput);
  const validated = validateInventory(inventoryInput);
  if (!validated.ok) {
    return refuseWith(validated.code, shape.protocolVersion, shape.scopeRef, shape.count);
  }
  const inventory = validated.value;
  if (inventory.scopeRef !== expectedScopeRef) {
    return refuseForInventory(inventory, "SCOPE_MISMATCH");
  }
  return { ok: true, inventory };
}
function checkCompleteness(tokenSet, options) {
  for (const token of options.mintedTokens ?? []) {
    if (!tokenSet.has(token.normalize("NFC"))) return "MISSING_ENTRY";
  }
  for (const token of options.observedTokens ?? []) {
    if (!tokenSet.has(token.normalize("NFC"))) return "UNKNOWN_TOKEN";
  }
  return null;
}
function stepWidth(text, index) {
  return (text.codePointAt(index) ?? 0) > BMP_MAX ? 2 : 1;
}
function clusterEnd(text, start) {
  let end = start + stepWidth(text, start);
  while (end < text.length && MARK.test(String.fromCodePoint(text.codePointAt(end) ?? 0))) {
    end += stepWidth(text, end);
  }
  return end;
}
function buildClusterMap(text) {
  const byStart = /* @__PURE__ */ new Map([[0, 0]]);
  const byEnd = /* @__PURE__ */ new Map([[0, 0]]);
  let nfcAt = 0;
  let joined = "";
  for (let i = 0; i < text.length; ) {
    const end = clusterEnd(text, i);
    const piece = end - i === 1 && text.charCodeAt(i) < ASCII_MAX ? text[i] : text.slice(i, end).normalize("NFC");
    byStart.set(nfcAt, i);
    nfcAt += piece.length;
    byEnd.set(nfcAt, end);
    joined += piece;
    i = end;
  }
  byStart.set(nfcAt, text.length);
  return joined === text.normalize("NFC") ? { byStart, byEnd } : null;
}
function toInputSpan(map, start, end) {
  const inStart = map.byStart.get(start);
  const inEnd = map.byEnd.get(end);
  if (inStart === void 0 || inEnd === void 0) return null;
  return { start: inStart, end: inEnd };
}
function toInputMatches(text, normalizedText, selected) {
  if (text === normalizedText && !MARK.test(text)) {
    return selected.map((match) => ({
      start: match.start,
      end: match.end,
      inventoryIndex: match.idx
    }));
  }
  const map = buildClusterMap(text);
  if (map === null) return null;
  const out = [];
  for (const match of selected) {
    const span = toInputSpan(map, match.start, match.end);
    if (span === null) return null;
    out.push({ start: span.start, end: span.end, inventoryIndex: match.idx });
  }
  return out;
}
function planValidatedText(input) {
  const { text, inventory, options } = input;
  const normalizedTokens = inventory.entries.map((entry) => entry.token.normalize("NFC"));
  const completenessFailure = checkCompleteness(new Set(normalizedTokens), options);
  if (completenessFailure) return refuseForInventory(inventory, completenessFailure);
  const normalizedText = text.normalize("NFC");
  const candidates = collectCandidates(
    normalizedText,
    normalizedTokens.map((token, idx) => ({ token, idx }))
  );
  const selected = selectMatches(candidates);
  const originalFor = (idx) => inventory.entries[idx].original;
  const { gaps } = splice(normalizedText, selected, originalFor);
  const markBroken = gaps.some((gap) => containsMarkBrokenToken(gap, normalizedTokens));
  if (markBroken || hasResidual(selected, gaps, originalFor, normalizedTokens)) {
    return refuseForInventory(inventory, "RESIDUAL_DETECTED");
  }
  const receipt = buildReceipt2(inventory, selected);
  if (selected.length === 0) return { ok: true, matches: [], receipt, restoredText: normalizedText };
  const matches = toInputMatches(text, normalizedText, selected);
  if (matches === null) {
    return { ...refuseForInventory(inventory, "INVALID_ENTRY"), detail: NORMALISATION_UNSUPPORTED };
  }
  const restoredText = spliceInputSpace(text, matches, originalFor).normalize("NFC");
  if (containsAnyToken(restoredText, normalizedTokens)) {
    return refuseForInventory(inventory, "RESIDUAL_DETECTED");
  }
  return { ok: true, matches, receipt, restoredText };
}
function planTextRestoreImpl(text, inventoryInput, expectedScopeRef, options) {
  const prelude = validateForPlan(inventoryInput, expectedScopeRef);
  if (!prelude.ok) return prelude;
  const planned = planValidatedText({ text, inventory: prelude.inventory, options });
  if (!planned.ok) return planned;
  return { ok: true, matches: planned.matches, receipt: planned.receipt };
}
function planTextRestore(text, inventoryInput, expectedScopeRef, options = {}) {
  try {
    return planTextRestoreImpl(text, inventoryInput, expectedScopeRef, options);
  } catch {
    return refuseWith("INVALID_ENTRY", "", "", 0);
  }
}

// ../../packages/restore-protocol/src/restoreText.ts
function restoreTextImpl(text, inventoryInput, expectedScopeRef, options) {
  const prelude = validateForPlan(inventoryInput, expectedScopeRef);
  if (!prelude.ok) return { ok: false, code: prelude.code, receipt: prelude.receipt };
  const inventory = prelude.inventory;
  const planned = planValidatedText({ text, inventory, options });
  if (!planned.ok) return { ok: false, code: planned.code, receipt: planned.receipt };
  return { ok: true, restoredText: planned.restoredText, receipt: planned.receipt };
}
function restoreText(text, inventoryInput, expectedScopeRef, options = {}) {
  try {
    return restoreTextImpl(text, inventoryInput, expectedScopeRef, options);
  } catch {
    return refuseWith("INVALID_ENTRY", "", "", 0);
  }
}

// ../../packages/restore-protocol/src/hex.ts
var HEX_RADIX = 16;
var HEX_PAIR_PATTERN = /../g;
var HEX_BYTE_WIDTH = 2;
var HEX_PAD_CHAR = "0";
function fromHex(hex) {
  const pairs = hex.match(HEX_PAIR_PATTERN) ?? [];
  return Uint8Array.from(pairs, (byte) => parseInt(byte, HEX_RADIX));
}
function toHex(bytes) {
  return Array.from(
    bytes,
    (b) => b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, HEX_PAD_CHAR)
  ).join("");
}

// ../../packages/restore-protocol/src/conformance/runFixtures.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function assertFixtures(input) {
  if (!isPlainObject(input)) throw new Error("runConformanceFixtures: fixtures must be an object");
  const vectors = input.vectors;
  const envelopeVectors = input.envelopeVectors ?? [];
  const hkdfVectors = input.hkdfVectors ?? [];
  if (!Array.isArray(vectors))
    throw new Error("runConformanceFixtures: fixtures.vectors must be an array");
  if (!Array.isArray(envelopeVectors)) {
    throw new Error("runConformanceFixtures: fixtures.envelopeVectors must be an array");
  }
  if (!Array.isArray(hkdfVectors)) {
    throw new Error("runConformanceFixtures: fixtures.hkdfVectors must be an array");
  }
  const metadata = isPlainObject(input.metadata) ? input.metadata : {};
  const protocolVersion = typeof metadata.protocolVersion === "string" ? metadata.protocolVersion : "";
  return {
    vectors,
    envelopeVectors,
    hkdfVectors,
    protocolVersion
  };
}
function judge(id, actual, expected, onSuccess) {
  if (actual.ok !== expected.ok) {
    const gotCode = actual.ok ? "" : ` code=${String(actual.code)}`;
    return {
      id,
      status: "fail",
      reason: `expected ok=${expected.ok}, got ok=${actual.ok}${gotCode}`
    };
  }
  if (!expected.ok) {
    if (actual.code !== expected.code) {
      return {
        id,
        status: "fail",
        reason: `expected code ${String(expected.code)}, got ${String(actual.code)}`
      };
    }
    return { id, status: "pass" };
  }
  const problem = onSuccess?.();
  return problem ? { id, status: "fail", reason: problem } : { id, status: "pass" };
}
function evalAadBytes(impl, v) {
  if (!impl.encodeAad)
    return { id: v.id, status: "fail", reason: "adapter does not implement encodeAad" };
  const bytes = impl.encodeAad(v.input);
  const hex = toHex(bytes);
  const expectedHex = v.expected.result.hex;
  if (hex !== expectedHex) {
    return {
      id: v.id,
      status: "fail",
      reason: `aad bytes mismatch: expected ${expectedHex}, got ${hex}`
    };
  }
  return { id: v.id, status: "pass" };
}
function wireMaterialState(list) {
  return (entry) => {
    const match = list.find(
      (m) => m.recordRef === entry.recordRef && m.fieldPath === entry.fieldPath
    );
    return match ? match.state : "ACTIVE";
  };
}
function evalStructuredRestore(impl, v) {
  const input = v.input;
  const rawMaterialState = v.input.materialState;
  const options = rawMaterialState ? { materialState: wireMaterialState(rawMaterialState) } : void 0;
  const result = impl.restoreStructured(
    input.container,
    input.requests,
    input.expectedScopeRef,
    options
  );
  return judge(v.id, result, v.expected, () => {
    const expected = v.expected.result;
    if (!expected) return null;
    const receipt = result.receipt;
    if (!receipt) return "success result missing receipt";
    if (receipt.restoredCount !== expected.restoredCount) {
      return `restoredCount ${receipt.restoredCount} !== ${expected.restoredCount}`;
    }
    if (receipt.refusedCount !== expected.refusedCount) {
      return `refusedCount ${receipt.refusedCount} !== ${expected.refusedCount}`;
    }
    return null;
  });
}
function evalTextRestore(impl, v, protocolVersion) {
  const input = v.input;
  const inventory = { protocolVersion, scopeRef: input.expectedScopeRef, entries: input.inventory };
  const options = { observedTokens: input.observedTokens, mintedTokens: input.mintedTokens };
  const result = impl.restoreText(input.text, inventory, input.expectedScopeRef, options);
  return judge(v.id, result, v.expected, () => {
    const expected = v.expected.result;
    if (!expected) return null;
    if (result.restoredText !== expected.restoredText) {
      return `restoredText mismatch: expected ${JSON.stringify(expected.restoredText)}, got ${JSON.stringify(result.restoredText)}`;
    }
    return null;
  });
}
function evalRefusal(impl, v) {
  if (!impl.validateContainer)
    return { id: v.id, status: "fail", reason: "adapter does not implement validateContainer" };
  const input = v.input;
  const result = impl.validateContainer(input.container);
  return judge(v.id, result, v.expected);
}
function evaluateVector(impl, v, protocolVersion) {
  try {
    switch (v.kind) {
      case "aad-bytes":
        return evalAadBytes(impl, v);
      case "structured-restore":
        return evalStructuredRestore(impl, v);
      case "text-restore":
        return evalTextRestore(impl, v, protocolVersion);
      case "refusal":
        return evalRefusal(impl, v);
      default:
        return { id: v.id, status: "fail", reason: `unknown vector kind ${v.kind}` };
    }
  } catch (error) {
    return { id: v.id, status: "fail", reason: `adapter threw: ${errorMessage(error)}` };
  }
}
async function evaluateEnvelopeVector(impl, v) {
  if (v.alg !== null && !impl.supportedAlgs.includes(v.alg)) {
    return { id: v.id, status: "skip", reason: `adapter does not declare support for alg ${v.alg}` };
  }
  const input = v.input;
  try {
    const result = await impl.openEnvelope(
      fromHex(input.envelopeHex),
      fromHex(input.keyHex),
      fromHex(input.aadHex)
    );
    return judge(v.id, result, v.expected, () => {
      const expected = v.expected.result;
      if (!expected) return null;
      const value = result.value;
      const text = new TextDecoder().decode(value);
      if (text !== expected.plaintextUtf8) {
        return `plaintext mismatch: expected ${JSON.stringify(expected.plaintextUtf8)}, got ${JSON.stringify(text)}`;
      }
      return null;
    });
  } catch (error) {
    return { id: v.id, status: "fail", reason: `adapter threw: ${errorMessage(error)}` };
  }
}
async function evaluateHkdfVector(impl, v) {
  if (!impl.deriveScopedKey)
    return { id: v.id, status: "fail", reason: "adapter does not implement deriveScopedKey" };
  const input = v.input;
  try {
    const result = await impl.deriveScopedKey(fromHex(input.ikmHex), input.scopeRef);
    return judge(v.id, result, v.expected, () => {
      const expected = v.expected.result;
      if (!expected) return null;
      const value = result.value;
      if (!(value instanceof Uint8Array) || value.length !== expected.byteLength) {
        return `dek byteLength mismatch: expected ${expected.byteLength}`;
      }
      const hex = toHex(value);
      if (hex !== expected.dekHex) return `dek mismatch: expected ${expected.dekHex}, got ${hex}`;
      return null;
    });
  } catch (error) {
    return { id: v.id, status: "fail", reason: `adapter threw: ${errorMessage(error)}` };
  }
}
function summarize(results) {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  return { total: results.length, passed, failed, skipped, results };
}
async function runConformanceFixtures(impl, fixtures) {
  const parsed = assertFixtures(fixtures);
  const results = parsed.vectors.map(
    (v) => evaluateVector(impl, v, parsed.protocolVersion)
  );
  for (const v of parsed.envelopeVectors) {
    results.push(await evaluateEnvelopeVector(impl, v));
  }
  if (impl.deriveScopedKey) {
    for (const v of parsed.hkdfVectors) {
      results.push(await evaluateHkdfVector(impl, v));
    }
  }
  return summarize(results);
}

// ../../packages/restore-protocol/src/keyLockingRegistry.ts
var KEY_LOCKING_METHOD_NAMESPACE = "key-locking-method-id";
var KEY_LOCKING_METHOD_HPKE_P256 = "hpke-p256-v1";
var KEY_LOCKING_METHOD_CODE_WRAP = "code-wrap-v1";
var HPKE_DOMAIN_TAG = "restore-protocol/key-locking/hpke/v1";
var CODE_WRAP_DOMAIN_TAG = "restore-protocol/key-locking/code/v1";
var HPKE_MODE_BASE = 0;
var HPKE_KEM_DHKEM_P256_HKDF_SHA256 = 16;
var HPKE_KDF_HKDF_SHA256 = 1;
var HPKE_AEAD_AES_128_GCM = 1;
var HPKE_AEAD_AES_256_GCM = 2;
var P256_UNCOMPRESSED_BYTES = 65;
var HPKE_WRAPPED_DEK_BYTES = 48;
var CODE_WRAP_CODE_BITS = 128;
var CODE_WRAP_SALT_BYTES = 32;
var CODE_WRAP_NONCE_BYTES = 12;
var CODE_WRAP_WRAPPED_BYTES = 60;
var HPKE_P256_ENTRY = Object.freeze({
  methodId: KEY_LOCKING_METHOD_HPKE_P256,
  kind: "hpke",
  mode: HPKE_MODE_BASE,
  kemId: HPKE_KEM_DHKEM_P256_HKDF_SHA256,
  kdfId: HPKE_KDF_HKDF_SHA256,
  aeadId: HPKE_AEAD_AES_256_GCM,
  encBytes: P256_UNCOMPRESSED_BYTES,
  wrappedDekBytes: HPKE_WRAPPED_DEK_BYTES,
  domainTag: HPKE_DOMAIN_TAG
});
var CODE_WRAP_ENTRY = Object.freeze({
  methodId: KEY_LOCKING_METHOD_CODE_WRAP,
  kind: "code-wrap",
  kdfId: HPKE_KDF_HKDF_SHA256,
  aeadId: HPKE_AEAD_AES_256_GCM,
  saltBytes: CODE_WRAP_SALT_BYTES,
  nonceBytes: CODE_WRAP_NONCE_BYTES,
  codeBits: CODE_WRAP_CODE_BITS,
  wrappedBytes: CODE_WRAP_WRAPPED_BYTES,
  domainTag: CODE_WRAP_DOMAIN_TAG
});
var KEY_LOCKING_METHODS = Object.freeze([
  HPKE_P256_ENTRY,
  CODE_WRAP_ENTRY
]);
function lookupKeyLockingMethod(methodId) {
  if (typeof methodId !== "string") return void 0;
  return KEY_LOCKING_METHODS.find((m) => m.methodId === methodId);
}

// ../../packages/restore-protocol/src/hpke.ts
var SHA256_BYTES = 32;
var P256_SCALAR_BITS = 256;
var AES_128_KEY_BYTES = 16;
var BYTE_BITS = 8;
var BYTE_MASK = 255;
var HKDF_MAX_BLOCKS = 255;
var HPKE_VERSION_LABEL = "HPKE-v1";
var ECDH_P256 = { name: "ECDH", namedCurve: "P-256" };
var ascii = (text) => new TextEncoder().encode(text);
function i2osp2(value) {
  return Uint8Array.from([value >> BYTE_BITS & BYTE_MASK, value & BYTE_MASK]);
}
function kemSuiteId(kemId) {
  return concatBytes([ascii("KEM"), i2osp2(kemId)]);
}
function hpkeSuiteId(suite) {
  return concatBytes([
    ascii("HPKE"),
    i2osp2(suite.kemId),
    i2osp2(suite.kdfId),
    i2osp2(suite.aeadId)
  ]);
}
async function hmacSha256(key, data) {
  const raw = copyBytes(key);
  try {
    const hmacKey = await __synthaveilWebCrypto.subtle.importKey(
      "raw",
      raw,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return new Uint8Array(await __synthaveilWebCrypto.subtle.sign("HMAC", hmacKey, data));
  } finally {
    wipe(raw);
  }
}
function hkdfExtract(salt, ikm) {
  return hmacSha256(salt.length === 0 ? new Uint8Array(SHA256_BYTES) : salt, ikm);
}
async function expandBlock(prk, previous, info, i) {
  const input = concatBytes([previous, info, Uint8Array.of(i)]);
  try {
    return await hmacSha256(prk, input);
  } finally {
    wipe(input);
  }
}
async function hkdfExpand(prk, info, length) {
  if (length > HKDF_MAX_BLOCKS * SHA256_BYTES) throw new RangeError("HKDF-Expand length too large");
  const blocks = [];
  try {
    let previous = new Uint8Array(0);
    for (let i = 1; blocks.length * SHA256_BYTES < length; i++) {
      previous = await expandBlock(prk, previous, info, i);
      blocks.push(previous);
    }
    const joined = concatBytes(blocks);
    try {
      return joined.slice(0, length);
    } finally {
      wipe(joined);
    }
  } finally {
    wipeAll(blocks);
  }
}
async function labeledExtract(suiteId, salt, label, ikm) {
  const labeled = concatBytes([ascii(HPKE_VERSION_LABEL), suiteId, ascii(label), ikm]);
  try {
    return await hkdfExtract(salt, labeled);
  } finally {
    wipe(labeled);
  }
}
function labeledExpand(suiteId, { prk, label, info, length }) {
  const labeled = concatBytes([
    i2osp2(length),
    ascii(HPKE_VERSION_LABEL),
    suiteId,
    ascii(label),
    info
  ]);
  return hkdfExpand(prk, labeled, length);
}
function importP256Point(point) {
  return __synthaveilWebCrypto.subtle.importKey("raw", copyBytes(point), ECDH_P256, false, []);
}
async function ecdhX(privateKey, point) {
  const bits = await __synthaveilWebCrypto.subtle.deriveBits(
    { name: "ECDH", public: point },
    privateKey,
    P256_SCALAR_BITS
  );
  return new Uint8Array(bits);
}
async function kemSharedSecret(dh, enc, recipientPublicKey) {
  const suiteId = kemSuiteId(HPKE_KEM_DHKEM_P256_HKDF_SHA256);
  const eaePrk = await labeledExtract(suiteId, new Uint8Array(0), "eae_prk", dh);
  const kemContext = concatBytes([enc, recipientPublicKey]);
  try {
    return await labeledExpand(suiteId, {
      prk: eaePrk,
      label: "shared_secret",
      info: kemContext,
      length: SHA256_BYTES
    });
  } finally {
    wipe(eaePrk);
  }
}
function aeadKeyBytes(suite) {
  const supportedKdf = suite.kemId === HPKE_KEM_DHKEM_P256_HKDF_SHA256 && suite.kdfId === HPKE_KDF_HKDF_SHA256;
  if (supportedKdf && suite.aeadId === HPKE_AEAD_AES_128_GCM) return AES_128_KEY_BYTES;
  if (supportedKdf && suite.aeadId === HPKE_AEAD_AES_256_GCM) return AES_256_KEY_BYTES;
  throw new RangeError("unsupported HPKE suite");
}
async function keyScheduleContextOf(suiteId, info) {
  const empty = new Uint8Array(0);
  const hashes = [];
  try {
    hashes.push(await labeledExtract(suiteId, empty, "psk_id_hash", empty));
    hashes.push(await labeledExtract(suiteId, empty, "info_hash", info));
    return concatBytes([Uint8Array.of(HPKE_MODE_BASE), ...hashes]);
  } finally {
    wipeAll(hashes);
  }
}
async function hpkeKeySchedule(suite, sharedSecret, info) {
  const nk = aeadKeyBytes(suite);
  const suiteId = hpkeSuiteId(suite);
  const keyScheduleContext = await keyScheduleContextOf(suiteId, info);
  const secret = await labeledExtract(suiteId, sharedSecret, "secret", new Uint8Array(0));
  let key = null;
  try {
    const expand = (label, length) => labeledExpand(suiteId, { prk: secret, label, info: keyScheduleContext, length });
    key = await expand("key", nk);
    const baseNonce = await expand("base_nonce", GCM_NONCE_BYTES);
    return { keyScheduleContext, secret, key, baseNonce };
  } catch (error) {
    wipe(secret);
    if (key !== null) wipe(key);
    throw error;
  }
}

// ../../packages/restore-protocol/src/keyLockingInput.ts
var HPKE_RECIPIENT_KINDS = ["owner", "company", "reader"];
var BINDING_FIELDS = [
  "orgId",
  "listId",
  "recipientKind",
  "recipientKeyId",
  "wrapVersion"
];
var UNWRAP_FIELDS = [
  "enc",
  "wrappedDek",
  "binding",
  "recipientKey",
  "recipientPublicKey"
];
var WRAP_FIELDS = ["dek", "binding", "recipientPublicKey"];
var SEC1_UNCOMPRESSED_PREFIX = 4;
function toHpkeBinding(value) {
  const kinds = HPKE_RECIPIENT_KINDS;
  const snapshot = snapshotFields(value, BINDING_FIELDS);
  if (snapshot === null) return null;
  const { orgId, listId, recipientKind, recipientKeyId, wrapVersion } = snapshot;
  if (!isNonEmptyText(orgId) || !isNonEmptyText(listId) || !isNonEmptyText(recipientKeyId)) {
    return null;
  }
  if (typeof recipientKind !== "string" || !kinds.includes(recipientKind)) return null;
  if (!isBoundedInt(wrapVersion, 1)) return null;
  return Object.freeze({ orgId, listId, recipientKind, recipientKeyId, wrapVersion });
}
function buildHpkeInfo(input) {
  const binding = toHpkeBinding(input);
  if (binding === null) throw new ProtocolRefusal("INVALID_ENTRY", "invalid HPKE binding");
  return encodeLpSequence([
    HPKE_DOMAIN_TAG,
    binding.orgId,
    binding.listId,
    binding.recipientKind,
    binding.recipientKeyId,
    String(binding.wrapVersion)
  ]);
}
function sec1Point(value) {
  const copy = snapshotBytes(value, P256_UNCOMPRESSED_BYTES);
  return copy !== null && copy[0] === SEC1_UNCOMPRESSED_PREFIX ? copy : null;
}
function isP256PrivateKey(value) {
  try {
    if (!isPlainObject(value) || value.type !== "private") return false;
    const algorithm = value.algorithm;
    if (!isPlainObject(algorithm)) return false;
    const usages = value.usages;
    return algorithm.name === "ECDH" && algorithm.namedCurve === "P-256" && Array.isArray(usages) && usages.includes("deriveBits");
  } catch {
    return false;
  }
}
function checkUnwrapShape(fields) {
  const binding = toHpkeBinding(fields.binding);
  const enc = sec1Point(fields.enc);
  const wrappedDek = snapshotBytes(fields.wrappedDek, HPKE_WRAPPED_DEK_BYTES);
  const recipientPublicKey = sec1Point(fields.recipientPublicKey);
  const recipientKey = fields.recipientKey;
  if (binding === null || enc === null || wrappedDek === null || recipientPublicKey === null) {
    return null;
  }
  if (!isP256PrivateKey(recipientKey)) return null;
  return { enc, wrappedDek, binding, recipientKey, recipientPublicKey };
}
function checkWrapShape(fields) {
  const binding = toHpkeBinding(fields.binding);
  const dek = snapshotBytes(fields.dek, AES_256_KEY_BYTES);
  const recipientPublicKey = sec1Point(fields.recipientPublicKey);
  if (dek !== null && binding !== null && recipientPublicKey !== null) {
    return { dek, binding, recipientPublicKey };
  }
  if (dek !== null) wipe(dek);
  return null;
}

// ../../packages/restore-protocol/src/keyLocking.ts
var ENTRY1_SUITE = {
  kemId: HPKE_KEM_DHKEM_P256_HKDF_SHA256,
  kdfId: HPKE_KDF_HKDF_SHA256,
  aeadId: HPKE_AEAD_AES_256_GCM
};
var X_START = 1;
var X_END = 33;
var P256_GENERATOR = fromHex(
  "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"
);
var EMPTY_AAD = new Uint8Array(0);
var INVALID = frozenRefusal("INVALID_ENTRY");
var AUTH_FAILED = frozenRefusal("AUTH_FAILED");
var UNSUPPORTED = frozenRefusal("UNSUPPORTED_ALGORITHM");
var METHOD_FIELD = ["methodId"];
function methodRefusal(input) {
  const head = snapshotFields(input, METHOD_FIELD);
  if (head === null) return INVALID;
  return head.methodId === KEY_LOCKING_METHOD_HPKE_P256 ? null : UNSUPPORTED;
}
async function publicKeyMatches(privateKey, publicKey) {
  try {
    await importP256Point(publicKey);
    const x = await ecdhX(privateKey, await importP256Point(P256_GENERATOR));
    return bytesEqual(x, publicKey.subarray(X_START, X_END));
  } catch {
    return false;
  }
}
async function importEncPoint(enc) {
  try {
    return await importP256Point(enc);
  } catch {
    return null;
  }
}
async function entry1Schedule(dh, enc, recipientPublicKey, binding) {
  let shared = null;
  try {
    shared = await kemSharedSecret(dh, enc, recipientPublicKey);
    return await hpkeKeySchedule(ENTRY1_SUITE, shared, buildHpkeInfo(binding));
  } finally {
    wipe(dh);
    if (shared !== null) wipe(shared);
  }
}
async function openWrappedDek(input, encPoint) {
  try {
    const dh = await ecdhX(input.recipientKey, encPoint);
    const s = await entry1Schedule(dh, input.enc, input.recipientPublicKey, input.binding);
    try {
      return await aesGcmOpen(s.key, s.baseNonce, EMPTY_AAD, input.wrappedDek);
    } finally {
      wipe(s.key, s.secret, s.baseNonce);
    }
  } catch {
    return null;
  }
}
async function unwrapDek(input) {
  const refusal = methodRefusal(input);
  if (refusal !== null) return refusal;
  const fields = snapshotFields(input, UNWRAP_FIELDS);
  if (fields === null) return INVALID;
  const checked = checkUnwrapShape(fields);
  if (checked === null) return INVALID;
  const encPoint = await importEncPoint(checked.enc);
  if (encPoint === null) return INVALID;
  const { recipientKey, recipientPublicKey } = checked;
  if (!await publicKeyMatches(recipientKey, recipientPublicKey)) return AUTH_FAILED;
  const dek = await openWrappedDek(checked, encPoint);
  if (dek === null) return AUTH_FAILED;
  if (dek.length !== AES_256_KEY_BYTES) {
    wipe(dek);
    return AUTH_FAILED;
  }
  return { ok: true, value: dek };
}
async function sealToRecipient(input, recipientPoint) {
  const ephemeral = await __synthaveilWebCrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const enc = new Uint8Array(await __synthaveilWebCrypto.subtle.exportKey("raw", ephemeral.publicKey));
  const dh = await ecdhX(ephemeral.privateKey, recipientPoint);
  const s = await entry1Schedule(dh, enc, input.recipientPublicKey, input.binding);
  try {
    return { enc, wrappedDek: await aesGcmSeal(s.key, s.baseNonce, EMPTY_AAD, input.dek) };
  } finally {
    wipe(s.key, s.secret, s.baseNonce);
  }
}
async function wrapDek(input) {
  const refusal = methodRefusal(input);
  if (refusal !== null) return refusal;
  const fields = snapshotFields(input, WRAP_FIELDS);
  if (fields === null) return INVALID;
  const checked = checkWrapShape(fields);
  if (checked === null) return INVALID;
  try {
    const recipientPoint = await importEncPoint(checked.recipientPublicKey);
    if (recipientPoint === null) return INVALID;
    return { ok: true, value: await sealToRecipient(checked, recipientPoint) };
  } catch {
    return INVALID;
  } finally {
    wipe(checked.dek);
  }
}

// ../../packages/restore-protocol/src/codeWrap.ts
var CODE_WRAP_KEY_KINDS = ["person", "company"];
var RECOVERY_CODE_CHARS = 27;
var DATA_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var CHECK_ALPHABET = `${DATA_ALPHABET}*~$=U`;
var DATA_CHARS = 26;
var BASE32_BITS = 5;
var PAD_BIT_COUNT = 2;
var CHECK_PRIME = 37;
var OCTET_BITS = 8;
var RECOVERY_CODE_BYTES = CODE_WRAP_CODE_BITS / OCTET_BITS;
var BITS_PER_CHAR = BigInt(BASE32_BITS);
var DIGIT_MASK = BigInt(DATA_ALPHABET.length - 1);
var PAD_BITS = BigInt(PAD_BIT_COUNT);
var PAD_MASK = (BigInt(1) << PAD_BITS) - BigInt(1);
var CHECK_MODULUS = BigInt(CHECK_PRIME);
var BYTE_BITS2 = BigInt(OCTET_BITS);
var ZERO = BigInt(0);
var BYTE_MASK2 = (BigInt(1) << BYTE_BITS2) - BigInt(1);
var BINDING_FIELDS2 = ["orgId", "keyId", "keyKind"];
var LOOK_ALIKES = { O: "0", I: "1", L: "1" };
var UNWRAP_FIELDS2 = ["code", "salt", "wrapped", "binding"];
var CREATE_FIELDS = ["privateScalar", "binding"];
var INVALID2 = frozenRefusal("INVALID_ENTRY");
var AUTH_FAILED2 = frozenRefusal("AUTH_FAILED");
function normalizeRecoveryCode(input) {
  if (typeof input !== "string") return "";
  return input.replace(/[ \t-]/g, "").replace(/[a-z]/g, (ch) => ch.toUpperCase()).replace(/[OIL]/g, (ch) => LOOK_ALIKES[ch] ?? ch);
}
function bytesToBigInt(bytes) {
  return bytes.reduce((n, byte) => n << BYTE_BITS2 | BigInt(byte), ZERO);
}
function bigIntToBytes(value, length) {
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(rest & BYTE_MASK2);
    rest >>= BYTE_BITS2;
  }
  return out;
}
function encodeRecoveryCode(codeBytes) {
  if (!isBytes(codeBytes, RECOVERY_CODE_BYTES)) throw new RangeError("code must be 16 bytes");
  const n = bytesToBigInt(codeBytes) << PAD_BITS;
  let digits = "";
  for (let i = DATA_CHARS - 1; i >= 0; i--) {
    digits += DATA_ALPHABET[Number(n >> BigInt(i) * BITS_PER_CHAR & DIGIT_MASK)];
  }
  return digits + CHECK_ALPHABET[Number(n % CHECK_MODULUS)];
}
function parseDataDigits(digits) {
  let n = ZERO;
  for (const ch of digits) {
    const value = DATA_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    n = n << BITS_PER_CHAR | BigInt(value);
  }
  return n;
}
function decodeRecoveryCode(input) {
  const code = normalizeRecoveryCode(input);
  if (code.length !== RECOVERY_CODE_CHARS) return INVALID2;
  const n = parseDataDigits(code.slice(0, DATA_CHARS));
  const check = CHECK_ALPHABET.indexOf(code[DATA_CHARS]);
  if (n === null || check < 0 || (n & PAD_MASK) !== ZERO) return INVALID2;
  if (n % CHECK_MODULUS !== BigInt(check)) return INVALID2;
  return { ok: true, value: bigIntToBytes(n >> PAD_BITS, RECOVERY_CODE_BYTES) };
}
function toCodeWrapBinding(value) {
  const kinds = CODE_WRAP_KEY_KINDS;
  const snapshot = snapshotFields(value, BINDING_FIELDS2);
  if (snapshot === null) return null;
  const { orgId, keyId, keyKind } = snapshot;
  if (!isNonEmptyText(orgId) || !isNonEmptyText(keyId)) return null;
  if (typeof keyKind !== "string" || !kinds.includes(keyKind)) return null;
  return Object.freeze({ orgId, keyId, keyKind });
}
function bindingSequence(binding) {
  return encodeLpSequence([CODE_WRAP_DOMAIN_TAG, binding.orgId, binding.keyId, binding.keyKind]);
}
async function withWrapKey(codeBytes, salt, info, operate) {
  const key = await hkdfSha256(codeBytes, salt, info);
  try {
    return await operate(key);
  } finally {
    wipe(key);
  }
}
function checkUnwrapInput(input) {
  const fields = snapshotFields(input, UNWRAP_FIELDS2);
  if (fields === null || typeof fields.code !== "string") return null;
  const salt = snapshotBytes(fields.salt, CODE_WRAP_SALT_BYTES);
  const wrapped = snapshotBytes(fields.wrapped, CODE_WRAP_WRAPPED_BYTES);
  const binding = toCodeWrapBinding(fields.binding);
  if (salt === null || wrapped === null || binding === null) return null;
  const decoded = decodeRecoveryCode(fields.code);
  return decoded.ok ? { codeBytes: decoded.value, salt, wrapped, binding } : null;
}
async function unwrapWithCode(input) {
  const checked = checkUnwrapInput(input);
  if (checked === null) return INVALID2;
  const { codeBytes, salt, wrapped, binding } = checked;
  try {
    const info = bindingSequence(binding);
    const nonce = wrapped.subarray(0, CODE_WRAP_NONCE_BYTES);
    const body = wrapped.subarray(CODE_WRAP_NONCE_BYTES);
    const scalar = await withWrapKey(
      codeBytes,
      salt,
      info,
      (key) => aesGcmOpen(key, nonce, info, body)
    );
    if (scalar === null) return AUTH_FAILED2;
    if (scalar.length !== AES_256_KEY_BYTES) {
      wipe(scalar);
      return AUTH_FAILED2;
    }
    return { ok: true, value: scalar };
  } catch {
    return AUTH_FAILED2;
  } finally {
    wipe(codeBytes);
  }
}
async function createCodeWrap(input) {
  const fields = snapshotFields(input, CREATE_FIELDS);
  if (fields === null) return INVALID2;
  const scalar = snapshotBytes(fields.privateScalar, AES_256_KEY_BYTES);
  const binding = toCodeWrapBinding(fields.binding);
  if (scalar === null || binding === null) {
    if (scalar !== null) wipe(scalar);
    return INVALID2;
  }
  const codeBytes = new Uint8Array(RECOVERY_CODE_BYTES);
  try {
    __synthaveilWebCrypto.getRandomValues(codeBytes);
    const salt = __synthaveilWebCrypto.getRandomValues(new Uint8Array(CODE_WRAP_SALT_BYTES));
    const nonce = __synthaveilWebCrypto.getRandomValues(new Uint8Array(CODE_WRAP_NONCE_BYTES));
    const info = bindingSequence(binding);
    const body = await withWrapKey(
      codeBytes,
      salt,
      info,
      (key) => aesGcmSeal(key, nonce, info, scalar)
    );
    const wrapped = concatBytes([nonce, body]);
    return { ok: true, value: { code: encodeRecoveryCode(codeBytes), salt, wrapped } };
  } catch {
    return INVALID2;
  } finally {
    wipe(codeBytes, scalar);
  }
}

// ../../packages/restore-protocol/src/lookupContainerSchema.ts
var LOOKUP_CONTAINER_DOMAIN_TAG = "restore-protocol/lookup-container/v1";
var LOOKUP_CONTAINER_FORMAT_VERSION = 1;
var MAX_PAIRS_PER_SEGMENT = 25e3;
var MAX_META_PER_SEGMENT = 1e3;
var LOOKUP_SURFACES = ["docx", "xlsx", "chat", "guard"];
var LOOKUP_ROLES = ["data_subject", "metadata"];
var PAIR_FIELDS = [
  "fake",
  "real",
  "entityType",
  "role",
  "expectedCount",
  "scope",
  "jobCode"
];
var META_FIELDS = ["part", "locator", "real", "mark"];
var AAD_FIELDS = ["orgId", "jobId", "surface", "chunkIndex", "subIndex", "listId"];
var OK = Object.freeze({ ok: true });
var INVALID3 = Object.freeze({ ok: false, code: "INVALID_ENTRY" });
var ROLES = LOOKUP_ROLES;
var SURFACES = LOOKUP_SURFACES;
function hasExactlyKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
function isAadFields(value) {
  return isPlainObject(value) && isNonEmptyText(value.orgId) && isNonEmptyText(value.jobId) && SURFACES.includes(value.surface) && isBoundedInt(value.chunkIndex, 0) && isBoundedInt(value.subIndex, 0) && isNonEmptyText(value.listId);
}
function toLookupAadFields(value) {
  const snapshot = snapshotFields(value, AAD_FIELDS);
  return isAadFields(snapshot) ? snapshot : null;
}
function validateLookupAadFields(fields) {
  return toLookupAadFields(fields) === null ? INVALID3 : OK;
}
function encodeLookupContainerAad(input) {
  const fields = toLookupAadFields(input);
  if (fields === null) throw new ProtocolRefusal("INVALID_ENTRY", "invalid lookup AAD fields");
  return encodeLpSequence([
    LOOKUP_CONTAINER_DOMAIN_TAG,
    fields.orgId,
    fields.jobId,
    fields.surface,
    String(fields.chunkIndex),
    String(fields.subIndex),
    fields.listId
  ]);
}
function isPair(value) {
  return isPlainObject(value) && hasExactlyKeys(value, PAIR_FIELDS) && isNonEmptyText(value.fake) && isNonEmptyText(value.real) && isWellFormedText(value.entityType) && ROLES.includes(value.role) && isBoundedInt(value.expectedCount, 1) && isWellFormedText(value.scope) && isWellFormedText(value.jobCode);
}
function isMeta(value) {
  return isPlainObject(value) && hasExactlyKeys(value, META_FIELDS) && isNonEmptyText(value.part) && isNonEmptyText(value.locator) && isNonEmptyText(value.real) && ROLES.includes(value.mark);
}
function fakesStrictlyAscending(pairs) {
  let previous = null;
  for (const pair of pairs) {
    const current = utf8Nfc(pair.fake);
    if (previous !== null && compareBytes(previous, current) >= 0) return false;
    previous = current;
  }
  return true;
}
function isPairList(value) {
  return Array.isArray(value) && value.length <= MAX_PAIRS_PER_SEGMENT && value.every(isPair);
}
function isMetaList(value) {
  return Array.isArray(value) && value.length <= MAX_META_PER_SEGMENT && value.every(isMeta);
}
function isLookupContainer(value) {
  return isPlainObject(value) && hasExactlyKeys(value, ["pairs", "metadata"]) && isPairList(value.pairs) && isMetaList(value.metadata) && fakesStrictlyAscending(value.pairs);
}
function isListLength(length, cap) {
  return typeof length === "number" && Number.isSafeInteger(length) && length >= 0 && length <= cap;
}
function sizedList(value, cap) {
  if (!Array.isArray(value)) return null;
  const length = value.length;
  return isListLength(length, cap) ? { list: value, length } : null;
}
function snapshotList({ list: value, length }, keys) {
  const out = [];
  for (let i = 0; i < length; i++) {
    const entry = value[i];
    if (!isPlainObject(entry) || !hasExactlyKeys(entry, keys)) return null;
    const snapshot = snapshotFields(entry, keys);
    if (snapshot === null) return null;
    out.push(snapshot);
  }
  return out;
}
function snapshotContainer(value) {
  if (!isPlainObject(value) || !hasExactlyKeys(value, ["pairs", "metadata"])) return null;
  const pairList = sizedList(value.pairs, MAX_PAIRS_PER_SEGMENT);
  const metaList = sizedList(value.metadata, MAX_META_PER_SEGMENT);
  if (pairList === null || metaList === null) return null;
  const pairs = snapshotList(pairList, PAIR_FIELDS);
  const metadata = pairs === null ? null : snapshotList(metaList, META_FIELDS);
  if (pairs === null || metadata === null) return null;
  const snapshot = { pairs: Object.freeze(pairs), metadata: Object.freeze(metadata) };
  return isLookupContainer(snapshot) ? Object.freeze(snapshot) : null;
}
function toLookupContainer(value) {
  try {
    return snapshotContainer(value);
  } catch {
    return null;
  }
}
function validateLookupContainer(container) {
  return toLookupContainer(container) === null ? INVALID3 : OK;
}

// ../../packages/restore-protocol/src/lookupContainerCodec.ts
var VERSION_BYTES = 1;
var COUNT_HEADER_BYTES = VERSION_BYTES + LENGTH_PREFIX_BYTES2;
var PAIR_COMPONENTS = 7;
var META_COMPONENTS = 4;
var CANONICAL_POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
var INVALID4 = frozenRefusal("INVALID_ENTRY");
function encodePair(p) {
  const count = String(p.expectedCount);
  return encodeLpSequence([p.fake, p.real, p.entityType, p.role, count, p.scope, p.jobCode]);
}
function encodeMeta(m) {
  return encodeLpSequence([m.part, m.locator, m.real, m.mark]);
}
function encodeLookupContainer(container) {
  const snapshot = toLookupContainer(container);
  if (snapshot === null) throw new ProtocolRefusal("INVALID_ENTRY", "invalid lookup container");
  const parts = [];
  try {
    parts.push(Uint8Array.of(LOOKUP_CONTAINER_FORMAT_VERSION), u32be(snapshot.pairs.length));
    for (const pair of snapshot.pairs) parts.push(encodePair(pair));
    parts.push(u32be(snapshot.metadata.length));
    for (const meta of snapshot.metadata) parts.push(encodeMeta(meta));
    return concatBytes(parts);
  } finally {
    wipeAll(parts);
  }
}
var Reader = class {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  offset = VERSION_BYTES;
  view;
  decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  get remaining() {
    return this.bytes.length - this.offset;
  }
  u32() {
    if (this.remaining < LENGTH_PREFIX_BYTES2) throw new ProtocolRefusal("INVALID_ENTRY", "short");
    const value = this.view.getUint32(this.offset, false);
    this.offset += LENGTH_PREFIX_BYTES2;
    return value;
  }
  text() {
    const length = this.u32();
    if (length > this.remaining) throw new ProtocolRefusal("INVALID_ENTRY", "short");
    const text = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    if (text !== text.normalize("NFC")) throw new ProtocolRefusal("INVALID_ENTRY", "not NFC");
    return text;
  }
  count(cap, components) {
    const n = this.u32();
    if (n > cap || n * components * LENGTH_PREFIX_BYTES2 > this.remaining) {
      throw new ProtocolRefusal("INVALID_ENTRY", "bad count");
    }
    return n;
  }
};
function readPair(r) {
  const [fake, real, entityType, role, count, scope, jobCode] = Array.from(
    { length: PAIR_COMPONENTS },
    () => r.text()
  );
  if (!CANONICAL_POSITIVE_DECIMAL.test(count)) {
    throw new ProtocolRefusal("INVALID_ENTRY", "bad count text");
  }
  return { fake, real, entityType, role, expectedCount: Number(count), scope, jobCode };
}
function readMeta(r) {
  const [part, locator, real, mark] = Array.from({ length: META_COMPONENTS }, () => r.text());
  return { part, locator, real, mark };
}
function readContainer(bytes) {
  const r = new Reader(bytes);
  const pairs = Array.from(
    { length: r.count(MAX_PAIRS_PER_SEGMENT, PAIR_COMPONENTS) },
    () => readPair(r)
  );
  const metadata = Array.from(
    { length: r.count(MAX_META_PER_SEGMENT, META_COMPONENTS) },
    () => readMeta(r)
  );
  if (r.remaining !== 0) throw new ProtocolRefusal("INVALID_ENTRY", "trailing bytes");
  return { pairs, metadata };
}
function headerAdmits(bytes) {
  const length = lengthOf(bytes);
  const head = headBytes(bytes, COUNT_HEADER_BYTES);
  if (length === null || head === null || head[0] !== LOOKUP_CONTAINER_FORMAT_VERSION) return false;
  const pairCount = new DataView(head.buffer).getUint32(VERSION_BYTES, false);
  const minimum = pairCount * PAIR_COMPONENTS * LENGTH_PREFIX_BYTES2;
  return pairCount <= MAX_PAIRS_PER_SEGMENT && minimum <= length - COUNT_HEADER_BYTES;
}
function decodeLookupContainer(bytes) {
  if (!headerAdmits(bytes)) return INVALID4;
  const copy = snapshotBytes(bytes);
  if (copy === null) return INVALID4;
  try {
    const container = readContainer(copy);
    return isLookupContainer(container) ? { ok: true, value: container } : INVALID4;
  } catch {
    return INVALID4;
  } finally {
    wipe(copy);
  }
}

// ../../packages/restore-protocol/src/lookupContainer.ts
var INVALID5 = frozenRefusal("INVALID_ENTRY");
var UNSUPPORTED2 = frozenRefusal("UNSUPPORTED_ALGORITHM");
var FORMAT_VERSION_OFFSET2 = 0;
var ALG_OFFSET2 = 1;
var ENVELOPE_HEADER_BYTES = ALG_OFFSET2 + 1 + GCM_NONCE_BYTES;
var SEAL_FIELDS = ["dek", "container", "aadFields"];
var OPEN_FIELDS = ["dek", "sealed", "aadFields"];
function frozen(outcome) {
  return outcome.ok ? outcome : frozenRefusal(outcome.code);
}
async function sealLookupContainer(input) {
  const fields = snapshotFields(input, SEAL_FIELDS);
  if (fields === null) return INVALID5;
  const dek = snapshotBytes(fields.dek, AES_256_KEY_BYTES);
  if (dek === null) return INVALID5;
  const aadFields = toLookupAadFields(fields.aadFields);
  const container = aadFields === null ? null : toLookupContainer(fields.container);
  if (aadFields === null || container === null) {
    wipe(dek);
    return INVALID5;
  }
  let plaintext = null;
  try {
    plaintext = encodeLookupContainer(container);
    const aad = encodeLookupContainerAad(aadFields);
    return frozen(await sealEnvelope({ key: dek, plaintext, aad }));
  } catch {
    return INVALID5;
  } finally {
    wipe(dek);
    if (plaintext !== null) wipe(plaintext);
  }
}
function envelopeHeaderRefusal(sealed) {
  const length = lengthOf(sealed);
  const header = headBytes(sealed, ENVELOPE_HEADER_BYTES);
  if (length === null || header === null) return INVALID5;
  const format = header[FORMAT_VERSION_OFFSET2];
  if (format !== ENVELOPE_FORMAT_VERSION || header[ALG_OFFSET2] !== ALG_BYTES.A256GCM) {
    return UNSUPPORTED2;
  }
  return length < ENVELOPE_HEADER_BYTES + GCM_TAG_BYTES ? INVALID5 : null;
}
async function openAndDecode(sealed, dek, aadFields) {
  const opened = await openEnvelope(sealed, dek, encodeLookupContainerAad(aadFields));
  if (!opened.ok) return frozen(opened);
  try {
    return decodeLookupContainer(opened.value);
  } finally {
    wipe(opened.value);
  }
}
async function openLookupContainer(input) {
  const fields = snapshotFields(input, OPEN_FIELDS);
  if (fields === null) return INVALID5;
  const dek = snapshotBytes(fields.dek, AES_256_KEY_BYTES);
  if (dek === null) return INVALID5;
  const aadFields = toLookupAadFields(fields.aadFields);
  const refusal = aadFields === null ? INVALID5 : envelopeHeaderRefusal(fields.sealed);
  const sealed = refusal === null ? snapshotBytes(fields.sealed) : null;
  if (aadFields === null || sealed === null) {
    wipe(dek);
    return refusal ?? INVALID5;
  }
  try {
    return await openAndDecode(sealed, dek, aadFields);
  } catch {
    return INVALID5;
  } finally {
    wipe(dek);
  }
}

// ../../packages/restore-protocol/src/lookupDigest.ts
var LOOKUP_DIGEST_DOMAIN_TAG = "restore-protocol/lookup-digest/v1";
function sortedStandInBytes(standIns) {
  if (!Array.isArray(standIns)) throw new ProtocolRefusal("INVALID_ENTRY", "stand-ins not a list");
  const values = standIns.map((s) => s);
  if (!values.every(isNonEmptyText)) throw new ProtocolRefusal("INVALID_ENTRY", "invalid stand-in");
  const encoded = values.map(utf8Nfc);
  encoded.sort(compareBytes);
  for (let i = 1; i < encoded.length; i++) {
    if (compareBytes(encoded[i - 1], encoded[i]) === 0) {
      throw new ProtocolRefusal("INVALID_ENTRY", "duplicate stand-in");
    }
  }
  return encoded;
}
async function lookupContentDigest(standIns) {
  const sorted = sortedStandInBytes(standIns);
  const parts = [encodeLengthPrefixedText(LOOKUP_DIGEST_DOMAIN_TAG)];
  for (const bytes of sorted) parts.push(lpBytes(bytes));
  return new Uint8Array(await __synthaveilWebCrypto.subtle.digest("SHA-256", concatBytes(parts)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AAD_DOMAIN_TAG,
  ALG_BYTES,
  CODE_WRAP_KEY_KINDS,
  ENVELOPE_FORMAT_VERSION,
  FAILURE_CODES,
  HPKE_RECIPIENT_KINDS,
  KEY_LOCKING_METHODS,
  KEY_LOCKING_METHOD_CODE_WRAP,
  KEY_LOCKING_METHOD_HPKE_P256,
  KEY_LOCKING_METHOD_NAMESPACE,
  LOOKUP_CONTAINER_DOMAIN_TAG,
  LOOKUP_DIGEST_DOMAIN_TAG,
  LOOKUP_ROLES,
  LOOKUP_SURFACES,
  MAX_META_PER_SEGMENT,
  MAX_PAIRS_PER_SEGMENT,
  PROTOCOL_VERSION,
  ProtocolRefusal,
  SUPPORTED_ALGS,
  buildEntryAad,
  createCodeWrap,
  decodeLookupContainer,
  decodeRecoveryCode,
  deriveContainerKey,
  deriveScopedKey,
  encodeAad,
  encodeLookupContainer,
  encodeLookupContainerAad,
  isFailureCode,
  lookupContentDigest,
  lookupKeyLockingMethod,
  normalizeRecoveryCode,
  openEnvelope,
  openLookupContainer,
  planTextRestore,
  restoreStructured,
  restoreText,
  runConformanceFixtures,
  sealEnvelope,
  sealLookupContainer,
  unwrapDek,
  unwrapWithCode,
  validateContainer,
  validateEntry,
  validateInventory,
  validateLookupAadFields,
  validateLookupContainer,
  wrapDek
});
