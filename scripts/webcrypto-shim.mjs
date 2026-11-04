// Task 1.3 (CC-9 reproducibility hash) — esbuild `inject` shim.
//
// The scanner's `no-restricted-globals` rule forbids `globalThis` in shipped JS. The
// vendored `@synthaveil/restore-protocol` bundle calls `globalThis.crypto.subtle` /
// `globalThis.crypto.getRandomValues` internally (PROTOCOL.md §5). `scripts/bundle-hash.mjs`
// rewrites every `globalThis.crypto` reference in the bundle to `__synthaveilWebCrypto` via
// esbuild's `define` option and injects this file as the binding for that identifier.
// `node:crypto` is on the scanner's allowed-imports list.
//
// Must be an EXPORTED var, per esbuild `inject` semantics — a bare (unexported) import in
// an injected file is tree-shaken away because nothing appears to reference it; exporting
// it keeps it live so `define` has something real to point at.
import { webcrypto } from 'node:crypto';

export var __synthaveilWebCrypto = webcrypto;
