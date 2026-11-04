// Task 1.3 (CC-9 reproducibility hash) — bundle @synthaveil/restore-protocol into
// vendor/restore-protocol.js so this package ships zero runtime dependencies (bundled at
// build time), and write vendor/HASH so CI can verify the bundle wasn't tampered with.
//
// (TA/SA R2) Tonight's bundle is cut from the WORKSPACE package — the npm registry
// version does not exist yet — so vendor/HASH is marked `provisional`. A post-publish
// step re-bundles against the registry tarball and re-asserts the hash before v0.3.0.
//
// (PC-5, bundle half) esbuild options pinned: format 'cjs', platform 'node', target
// 'node20'. The `globalThis.crypto` define + inject shim keeps the scanner's
// `no-restricted-globals` rule green (see webcrypto-shim.mjs). After writing, this
// script verifies the output itself contains neither `__require(` nor `globalThis` and
// fails loudly if it does — esbuild's own CJS interop helper can reintroduce
// `__require`, and a define that doesn't fully cover every `globalThis` use would
// silently leave one behind.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SCRIPT_DIR, '..');
const MONOREPO_ENTRY = join(PACKAGE_ROOT, '..', '..', 'packages', 'restore-protocol', 'src', 'index.ts');

/**
 * Resolve the bundle's entry point.
 *
 * This package is published from two places: the monorepo (where the protocol
 * sources sit two directories up) and the standalone public mirror created by
 * `scripts/sync-n8n-mirror.mjs`, where `packages/restore-protocol` does not
 * exist at all. Hard-coding the monorepo path meant the mirror could not
 * re-bundle and failed with a bare ENOENT on a path that is not part of that
 * repository (QA review of PR #523, finding 10).
 *
 * The mirror does not need to re-bundle: `vendor/restore-protocol.js` and its
 * HASH are committed and copied across by the sync script precisely so the
 * mirror ships identical bytes. So the honest behaviour there is to refuse
 * clearly and say why, rather than to appear broken. If the published package
 * is installed, that is used instead — which is also the post-publish
 * re-derivation path referenced in the header above.
 */
function resolveEntryPoint() {
  if (existsSync(MONOREPO_ENTRY)) return MONOREPO_ENTRY;

  const installed = join(PACKAGE_ROOT, 'node_modules', '@synthaveil', 'restore-protocol');
  for (const candidate of [join(installed, 'src', 'index.ts'), join(installed, 'dist', 'index.js')]) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    [
      'bundle-hash: cannot find the restore-protocol sources to bundle.',
      `  looked for the monorepo checkout at: ${MONOREPO_ENTRY}`,
      `  and an installed copy at:            ${installed}`,
      '',
      'Re-bundling needs either the monorepo (run this from the monorepo checkout)',
      'or an installed @synthaveil/restore-protocol. In the standalone mirror neither',
      'is present by design: vendor/restore-protocol.js and vendor/HASH are committed',
      'there and must be regenerated in the monorepo, then synced.',
    ].join('\n'),
  );
}

/**
 * `--out-dir <dir>` (CI reproducibility check, L14-3): write the bundle and
 * HASH there instead of `vendor/`, so CI can re-bundle into a scratch
 * directory and `cmp` it against the committed `vendor/` output without ever
 * overwriting what's committed. Default behaviour (no flag) is unchanged.
 */
function resolveOutDir() {
  const flagIndex = process.argv.indexOf('--out-dir');
  if (flagIndex === -1) return join(PACKAGE_ROOT, 'vendor');
  const dir = process.argv[flagIndex + 1];
  if (!dir) {
    throw new Error('bundle-hash: --out-dir requires a directory argument');
  }
  return dir;
}

const ENTRY_POINT = resolveEntryPoint();
const SHIM_PATH = join(SCRIPT_DIR, 'webcrypto-shim.mjs');
const VENDOR_DIR = resolveOutDir();
const BUNDLE_PATH = join(VENDOR_DIR, 'restore-protocol.js');
const HASH_PATH = join(VENDOR_DIR, 'HASH');
const PROVISIONAL_MARKER = 'provisional';

/** Fails loudly if a restricted-global leak survives the define/inject rewrite. */
function assertNoRestrictedGlobals(bundle) {
  if (bundle.includes('__require(')) {
    throw new Error('vendor/restore-protocol.js contains __require( — scanner would reject it');
  }
  if (bundle.includes('globalThis')) {
    throw new Error('vendor/restore-protocol.js contains globalThis — scanner would reject it');
  }
}

async function buildBundle() {
  if (!existsSync(ENTRY_POINT)) {
    throw new Error(`entry point not found: ${ENTRY_POINT}`);
  }
  const result = await esbuild.build({
    entryPoints: [ENTRY_POINT],
    outfile: BUNDLE_PATH,
    bundle: true,
    minify: false,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    define: { 'globalThis.crypto': '__synthaveilWebCrypto' },
    inject: [SHIM_PATH],
    write: true,
  });
  if (result.errors.length > 0) {
    throw new Error(`esbuild reported errors: ${JSON.stringify(result.errors)}`);
  }
}

function writeHashFile() {
  const bundle = readFileSync(BUNDLE_PATH);
  const hash = createHash('sha256').update(bundle).digest('hex');
  writeFileSync(HASH_PATH, `${hash}\n${PROVISIONAL_MARKER}\n`, 'utf8');
  return hash;
}

async function main() {
  mkdirSync(VENDOR_DIR, { recursive: true });
  await buildBundle();
  const bundle = readFileSync(BUNDLE_PATH, 'utf8');
  assertNoRestrictedGlobals(bundle);
  const hash = writeHashFile();
  console.log(`vendor/restore-protocol.js written — sha256 ${hash} (provisional)`);
}

await main();
