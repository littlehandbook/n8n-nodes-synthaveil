/**
 * Hand-written type surface for the vendored `@synthaveil/restore-protocol`
 * bundle (`restore-protocol.js` — the package ships bundled at build time,
 * Task 1.3/CC-9). There is no `node_modules/@synthaveil/restore-protocol`
 * during tests/build (the spike in `tests/spikes/dualPackageImport.spike.test.ts`
 * probes that path and is skipped when absent), so this sibling declaration
 * file is what gives the bundle's CommonJS export a type at the import site.
 * Declares only the members this package's Local-restore code actually uses;
 * the runtime bundle exports more (see `index_exports` in `restore-protocol.js`).
 */

export type FailureCode =
  | 'VERSION_CONFLICT'
  | 'UNKNOWN_TOKEN'
  | 'MISSING_ENTRY'
  | 'SCOPE_MISMATCH'
  | 'EXPIRED'
  | 'PURGED'
  | 'RESIDUAL_DETECTED'
  | 'AMBIGUOUS_VALUE'
  | 'UNSUPPORTED_ALGORITHM'
  | 'AUTH_FAILED'
  | 'INVALID_ENTRY';

export const PROTOCOL_VERSION: string;

export interface SealInput {
  key: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
  alg?: string;
}
export type EnvelopeResult<T> = { ok: true; value: T } | { ok: false; code: FailureCode };
export function sealEnvelope(input: SealInput): Promise<EnvelopeResult<Uint8Array>>;
export function openEnvelope(
  envelope: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array,
): Promise<EnvelopeResult<Uint8Array>>;

export type DeriveContainerKeyResult =
  | { ok: true; value: Uint8Array }
  | { ok: false; code: FailureCode };
export function deriveContainerKey(masterKey: Uint8Array): Promise<DeriveContainerKeyResult>;

export interface InventoryEntry {
  token: string;
  original: string;
}
export interface TextInventory {
  protocolVersion: string;
  scopeRef: string;
  entries: InventoryEntry[];
}

export interface TextRestoreOptions {
  observedTokens?: readonly string[];
  mintedTokens?: readonly string[];
}
export interface TextReceiptEntry {
  inventoryIndex: number;
  occurrences: number;
  ok: boolean;
  code: FailureCode | null;
}
export interface TextReceipt {
  profile: 'T';
  protocolVersion: string;
  scopeRef: string;
  inventoryCount: number;
  replacedCount: number;
  refusedCount: number;
  entries: TextReceiptEntry[];
}
export type TextResult =
  | { ok: true; restoredText: string; receipt: TextReceipt }
  | { ok: false; code: FailureCode; receipt: TextReceipt };
export function restoreText(
  text: string,
  inventoryInput: unknown,
  expectedScopeRef: string,
  options?: TextRestoreOptions,
): TextResult;
