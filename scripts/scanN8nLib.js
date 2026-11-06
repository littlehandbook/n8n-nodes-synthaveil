'use strict';

/**
 * Pure, side-effect-free helpers behind `scan-n8n.mjs` (Task 2.1 of the
 * n8n submission-readiness plan, r4, FSD-C4).
 *
 * CommonJS on purpose — see the header comment in `tests/scanN8n.test.ts` for
 * why: jest cannot `import()` a real ESM `.mjs` file from this package's
 * ts-jest/CommonJS config, so the pure logic lives here and `scan-n8n.mjs`
 * (real ESM, run only via `node scripts/scan-n8n.mjs`) imports the same file.
 * Node's ESM loader accepts a CJS module's `module.exports` via
 * `cjs-module-lexer`, so nothing is duplicated.
 *
 * No CLI wiring, no `process.exit`, no network or filesystem access here —
 * those live in `scan-n8n.mjs`.
 */

const SCANNER_PACKAGE_SEGMENTS = ['node_modules', '@n8n', 'scan-community-package'];

/**
 * Where the scanner keeps its entry point. 0.42.0 moved it from
 * `scanner/scanner.mjs` to `dist/scanner.js`; the exports we use did not change.
 */
const SCANNER_ENTRY_LAYOUTS = [
  ['dist', 'scanner.js'],
  ['scanner', 'scanner.mjs'],
];

/**
 * `@n8n/scan-community-package` is never a devDependency of THIS package
 * (r4, QA ruling 2026-09-24): installing it inside our tree hoists its
 * nested `@typescript-eslint/parser@8.70.0` next to our own `typescript`
 * devDependency, which crashes ("typescript-eslint does not support TS
 * 7.0.") because the scanner's own `typescript@7.0.2` no longer sits beside
 * it. Every leg installs the scanner standalone into a fresh temp npm
 * prefix instead — the newest version confirmed (registry-measured) to
 * clear the 7-day `min-release-age` gate as of 2026-11-05 (published
 * 2026-10-28). `latest` is run with `--tag latest`.
 */
const DEFAULT_SCANNER_VERSION = '0.41.1';

/**
 * Never lets a passing exit code launder a failing (or thrown) leg into a
 * pass — the plan's "the CLI can exit 0 on failure — trust `passed`, not the
 * exit code" rule, applied to our own aggregation of the source/tarball legs.
 */
function aggregateLegs(legs) {
  const passed = legs.length > 0 && legs.every((leg) => leg.passed === true && !leg.error);
  return { passed, exitCode: passed ? 0 : 1 };
}

const USAGE = 'usage: scan-n8n.mjs [--tag <dist-tag|x.y.z>]';

/**
 * The `--tag` value is spliced into `npm install @n8n/scan-community-package@<tag>`,
 * so only a plain dist-tag or an exact semver gets through — never anything npm
 * would read as a URL, path, git spec, alias (`:`, `/`, `@`) or second argument.
 */
const DIST_TAG_PATTERN = /^[a-z][a-z0-9.-]*$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9a-z.-]+)?$/i;

/** `['--tag', 'beta']` -> `{ tag: 'beta' }`; `[]` -> `{ tag: undefined }`. */
function parseArgs(argv) {
  if (argv.length === 0) return { tag: undefined };
  if (argv[0] !== '--tag') {
    throw new Error(`${USAGE} (unrecognized argument: ${argv[0]})`);
  }
  const tag = argv[1];
  if (tag === undefined) throw new Error(USAGE);
  if (argv.length > 2) throw new Error(`${USAGE} (unexpected extra arguments: ${argv.slice(2).join(' ')})`);
  if (!DIST_TAG_PATTERN.test(tag) && !SEMVER_PATTERN.test(tag)) {
    throw new Error(`${USAGE} (not a dist-tag or semver: ${JSON.stringify(tag)})`);
  }
  return { tag };
}

/** npm ignores `min-release-age` silently before this release. */
const MIN_RELEASE_AGE_NPM = [11, 10, 0];

/**
 * Whether npm `version` honours `min-release-age`. An unreadable version is
 * `false`, so the caller warns rather than assumes the gate held.
 */
function npmEnforcesReleaseAge(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let i = 0; i < MIN_RELEASE_AGE_NPM.length; i += 1) {
    if (parts[i] !== MIN_RELEASE_AGE_NPM[i]) return parts[i] > MIN_RELEASE_AGE_NPM[i];
  }
  return true;
}

function formatScannerVersion(pkgJson) {
  if (!pkgJson?.version) {
    throw new Error('formatScannerVersion: pkgJson.version is missing or empty');
  }
  return `scanner version ${pkgJson.version}`;
}

/**
 * The `file:` URL of the scanner entry point that every leg installs into a
 * fresh temp npm prefix (see `DEFAULT_SCANNER_VERSION`). Imported by path, so
 * nothing can resolve a stray copy from this package's own `node_modules`.
 * The caller passes `fileExists`, which keeps this module free of filesystem
 * access. An unknown layout throws rather than guessing a path.
 */
function scannerEntryUrl(prefixDir, fileExists) {
  const { join } = require('node:path');
  const { pathToFileURL } = require('node:url');
  const candidates = SCANNER_ENTRY_LAYOUTS.map((layout) => join(prefixDir, ...SCANNER_PACKAGE_SEGMENTS, ...layout));
  const entry = candidates.find((candidate) => fileExists(candidate));
  if (!entry) throw new Error(`scannerEntryUrl: no scanner entry point found, looked for ${candidates.join(', ')}`);
  return pathToFileURL(entry).href;
}

module.exports = {
  DEFAULT_SCANNER_VERSION,
  aggregateLegs,
  formatScannerVersion,
  npmEnforcesReleaseAge,
  parseArgs,
  scannerEntryUrl,
};
