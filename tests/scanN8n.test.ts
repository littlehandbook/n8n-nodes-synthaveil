/* eslint-disable @n8n/community-nodes/no-restricted-globals, @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-require-imports -- test file, never shipped or scanned */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Task 2.1 (n8n submission-readiness plan, r4, FSD-C4) —
 * `scripts/scan-n8n.mjs` runs n8n's real `@n8n/scan-community-package`
 * checker (source leg + tarball leg) and must exit non-zero whenever either leg's
 * `passed` is `false`, even if nothing threw and the CLI itself would have exited 0.
 *
 * WHY THE LOGIC LIVES IN `scripts/scanN8nLib.js`, NOT IN `scan-n8n.mjs` DIRECTLY
 * (documented here because no test in this package has imported a `scripts/*.mjs`
 * file before — `tests/bundling/bundleHash.test.ts` and `tests/mirrorSafety.test.ts`
 * only read `.mjs` scripts as TEXT via `readFileSync` + regex, they never `import`
 * or `require` one):
 *   - `jest.config.js` has `moduleFileExtensions: ['ts', 'js', 'json']` (no `mjs`)
 *     and transforms only `^.+\.ts$` via ts-jest.
 *   - `tsconfig.json` compiles with `"module": "commonjs"`, under which TypeScript
 *     downlevels a dynamic `import()` inside a `.ts` test to a `require()` call —
 *     which cannot load a real ESM `.mjs` file (`ERR_REQUIRE_ESM`).
 *   - Neither this package's jest config nor its scripts enable
 *     `--experimental-vm-modules` or `extensionsToTreatAsEsm`.
 * So the pure, side-effect-free helpers below are specified to live in a sibling
 * plain-CommonJS file, `scripts/scanN8nLib.js` (`module.exports = { ... }`, no
 * `"type": "module"` at the package level, so `.js` here is unambiguously CJS).
 * Jest requires it directly with zero ESM handling. `scan-n8n.mjs` (real ESM,
 * run only via `node scripts/scan-n8n.mjs`) imports the SAME file — Node's ESM
 * loader accepts a CJS module's `module.exports` as its default/named exports via
 * `cjs-module-lexer`, so nothing has to be duplicated. `scan-n8n.mjs` itself stays
 * a thin CLI wrapper (argv → lib calls → analyzePackage calls → console output →
 * `process.exit`) behind an entry guard; this file therefore never needs to
 * `import`/`require` `scan-n8n.mjs` and pins its shape as TEXT instead, exactly
 * like `mirrorSafety.test.ts` does for `sync-n8n-mirror.mjs`.
 *
 * HELPER API CONTRACT (`scripts/scanN8nLib.js`, CommonJS, `module.exports = {...}`):
 *   - `aggregateLegs(legs: Array<{ name: string, passed?: boolean, error?: unknown }>)
 *        -> { passed: boolean, exitCode: 0 | 1 }`
 *     `passed` is true only if every leg has `passed === true` AND no `error`.
 *     A leg carrying BOTH `passed: true` and an `error` is still treated as failed
 *     — a leg that threw must never be laundered into a pass by a stray `passed`
 *     field (this is the exact "the CLI can exit 0 on failure — never trust its
 *     exit code, trust `passed`" rule from the plan, applied to our own aggregation
 *     too).
 *   - `parseArgs(argv: string[]) -> { tag: string | undefined }`
 *     `argv` is CLI args with the node/script path already stripped (i.e.
 *     `process.argv.slice(2)`). `['--tag', 'beta']` -> `{ tag: 'beta' }`; `[]` ->
 *     `{ tag: undefined }`. Throws an `Error` whose message matches `/usage/i` for
 *     `--tag` with no following value, any flag other than `--tag`, trailing extra
 *     arguments, or a value that is neither a dist-tag nor an exact semver.
 *   - `npmEnforcesReleaseAge(version: string) -> boolean`
 *     Whether that npm version honours `min-release-age` (>= 11.10); unreadable
 *     versions are `false`.
 *   - `formatScannerVersion(pkgJson: { version?: string }) -> string`
 *     Returns `` `scanner version ${pkgJson.version}` ``. Throws if `version` is
 *     missing/empty.
 *   - `scannerEntryUrl(prefixDir: string, fileExists: (path) => boolean) -> string`
 *     A `file:` URL string (via `url.pathToFileURL`) pointing at the scanner entry
 *     under `<prefixDir>/node_modules/@n8n/scan-community-package/`: `dist/scanner.js`
 *     from 0.42.0, `scanner/scanner.mjs` before it. That is the file `--tag <dist-tag>`
 *     installs into a temp npm prefix and imports by path (FSD-C4: `npm exec`/a bare
 *     specifier resolves to the pinned devDependency copy, not the tagged one).
 *     Throws when neither exists.
 */
// require(), not `import`, so TS never tries to statically resolve/typecheck a
// plain CJS .js module (no-require-imports is off in the file header).
const scanN8nLib = require('../scripts/scanN8nLib');

const PKG_ROOT = join(__dirname, '..');
const SCAN_N8N_SCRIPT = join(PKG_ROOT, 'scripts', 'scan-n8n.mjs');

describe('scanN8nLib.aggregateLegs — never trusts a passing exit code over a failing leg', () => {
  it('both legs passed -> passed true, exitCode 0', () => {
    const result = scanN8nLib.aggregateLegs([
      { name: 'source', passed: true },
      { name: 'tarball', passed: true },
    ]);
    expect(result).toEqual({ passed: true, exitCode: 0 });
  });

  it('source leg passed:false -> passed false, exitCode 1', () => {
    const result = scanN8nLib.aggregateLegs([
      { name: 'source', passed: false },
      { name: 'tarball', passed: true },
    ]);
    expect(result).toEqual({ passed: false, exitCode: 1 });
  });

  it('tarball leg passed:false -> passed false, exitCode 1', () => {
    const result = scanN8nLib.aggregateLegs([
      { name: 'source', passed: true },
      { name: 'tarball', passed: false },
    ]);
    expect(result).toEqual({ passed: false, exitCode: 1 });
  });

  it('a leg that threw (carries an error, passed omitted) -> passed false, exitCode 1', () => {
    const result = scanN8nLib.aggregateLegs([
      { name: 'source', passed: true },
      { name: 'tarball', error: new Error('npm pack failed') },
    ]);
    expect(result).toEqual({ passed: false, exitCode: 1 });
  });

  it('a leg claiming passed:true alongside an error is still a failure (never laundered)', () => {
    const result = scanN8nLib.aggregateLegs([{ name: 'source', passed: true, error: new Error('boom') }]);
    expect(result).toEqual({ passed: false, exitCode: 1 });
  });

  it('an empty leg list is not a silent pass (aggregation must not default-succeed)', () => {
    const result = scanN8nLib.aggregateLegs([]);
    expect(result).toEqual({ passed: false, exitCode: 1 });
  });
});

describe('scanN8nLib.parseArgs', () => {
  it('--tag beta -> { tag: "beta" }', () => {
    expect(scanN8nLib.parseArgs(['--tag', 'beta'])).toEqual({ tag: 'beta' });
  });

  it('no args -> { tag: undefined }', () => {
    expect(scanN8nLib.parseArgs([])).toEqual({ tag: undefined });
  });

  it('--tag with no following value throws a usage error', () => {
    expect(() => scanN8nLib.parseArgs(['--tag'])).toThrow(/usage/i);
  });

  it('an unrecognized flag throws a usage error', () => {
    expect(() => scanN8nLib.parseArgs(['--bogus'])).toThrow(/usage/i);
  });

  it('trailing arguments after --tag <value> throw a usage error (never silently ignored)', () => {
    expect(() => scanN8nLib.parseArgs(['--tag', 'beta', 'extra'])).toThrow(/usage/i);
    expect(() => scanN8nLib.parseArgs(['--tag', 'beta', '--tag', 'latest'])).toThrow(/usage/i);
  });

  it.each(['latest', 'beta', 'next', 'rc.1', '0.37.0', '1.0.0-beta.1'])(
    'accepts the dist-tag or semver %s',
    (tag) => {
      expect(scanN8nLib.parseArgs(['--tag', tag])).toEqual({ tag });
    },
  );

  // The value is spliced into `npm install @n8n/scan-community-package@<tag>`:
  // anything npm would read as a URL, path, git spec, alias or second argument
  // must be refused before npm ever sees it.
  it.each([
    'file:../evil',
    'github:someone/scanner',
    'https://evil.example/x.tgz',
    '../evil',
    'npm:other@1.0.0',
    '@scope/x',
    'beta latest',
    '--registry=https://evil.example',
    '',
    '1.0',
  ])('rejects the non-tag, non-semver value %p with a usage error', (tag) => {
    expect(() => scanN8nLib.parseArgs(['--tag', tag])).toThrow(/usage/i);
  });
});

describe('scanN8nLib.npmEnforcesReleaseAge — min-release-age needs npm >= 11.10', () => {
  it.each(['11.10.0', '11.10.1', '11.17.0', '12.0.0'])('%s enforces it', (version) => {
    expect(scanN8nLib.npmEnforcesReleaseAge(version)).toBe(true);
  });

  it.each(['11.5.1', '11.9.9', '10.9.2', '9.0.0'])('%s silently ignores it', (version) => {
    expect(scanN8nLib.npmEnforcesReleaseAge(version)).toBe(false);
  });

  it.each(['', 'not-a-version', undefined])('an unreadable version %p is treated as not enforcing', (version) => {
    expect(scanN8nLib.npmEnforcesReleaseAge(version)).toBe(false);
  });
});

describe('scanN8nLib.formatScannerVersion', () => {
  it('formats "scanner version <version>"', () => {
    expect(scanN8nLib.formatScannerVersion({ version: '0.38.0' })).toBe('scanner version 0.38.0');
  });

  it('throws if version is missing', () => {
    expect(() => scanN8nLib.formatScannerVersion({})).toThrow();
  });

  it('throws if version is an empty string', () => {
    expect(() => scanN8nLib.formatScannerVersion({ version: '' })).toThrow();
  });
});

describe('scanN8nLib.scannerEntryUrl', () => {
  const prefix = join(PKG_ROOT, '.tmp-scan-n8n-beta-fixture');
  const entryPath = (...layout: string[]): string =>
    join(prefix, 'node_modules', '@n8n', 'scan-community-package', ...layout);

  it('resolves the 0.42.0+ layout, dist/scanner.js', () => {
    const expected = pathToFileURL(entryPath('dist', 'scanner.js')).href;
    expect(scanN8nLib.scannerEntryUrl(prefix, (path: string) => path === entryPath('dist', 'scanner.js'))).toBe(expected);
  });

  it('resolves the layout before 0.42.0, scanner/scanner.mjs', () => {
    const expected = pathToFileURL(entryPath('scanner', 'scanner.mjs')).href;
    expect(scanN8nLib.scannerEntryUrl(prefix, (path: string) => path === entryPath('scanner', 'scanner.mjs'))).toBe(expected);
  });

  it('returns a file: URL string, not a URL object (the CLI imports it directly)', () => {
    expect(typeof scanN8nLib.scannerEntryUrl(prefix, () => true)).toBe('string');
  });

  it('throws on an unknown layout rather than guessing a path', () => {
    expect(() => scanN8nLib.scannerEntryUrl(prefix, () => false)).toThrow(/no scanner entry point/);
  });
});

describe('requiring scanN8nLib.js has no side effects (pure logic module, no CLI/process.exit)', () => {
  it('does not call process.exit merely by being required', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) must not be called on require`);
    }) as never);
    jest.resetModules();
    expect(() => require('../scripts/scanN8nLib')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('scripts/scan-n8n.mjs (the CLI) — wiring and entry-guard, source-text pins', () => {
  it('exists', () => {
    expect(existsSync(SCAN_N8N_SCRIPT)).toBe(true);
  });

  it('imports its pure logic from scanN8nLib.js rather than reimplementing it inline', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    expect(source).toMatch(/from\s+['"]\.\/scanN8nLib(\.js)?['"]/);
  });

  it('gates main() behind an entry guard, so importing it for its exports alone has no side effects', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    // ESM entry-guard idiom: only the process's own entry file triggers main().
    expect(source).toMatch(/import\.meta\.url\s*===/);
    expect(source).toMatch(/\bmain\s*\(\s*\)/);
  });

  it('never trusts the scanner CLI exit code — exits based on aggregateLegs, not a try/catch around the CLI alone', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    expect(source).toMatch(/aggregateLegs/);
    expect(source).toMatch(/process\.exit\(/);
  });

  it('supports --tag <dist-tag> for the beta leg (FSD-C4)', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    expect(source).toMatch(/parseArgs/);
    expect(source).toMatch(/scannerEntryUrl/);
    expect(source).toMatch(/formatScannerVersion/);
  });

  // r4 follow-up (QA ruling 2026-09-24): the scanner is never our own
  // devDependency (see tests/package.test.ts) — every leg, including the
  // no-args default, installs it standalone into a fresh temp npm prefix via
  // `--prefix`, never resolving a copy already nested in our own node_modules.
  it('installs the scanner into a fresh npm prefix for every leg, never from our own node_modules', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    expect(source).toMatch(/--prefix/);
  });

  // Quality review: the scanner and its dependency tree install at run time,
  // in CI too, so none of their lifecycle scripts may run. The flag must sit
  // in the same argument list as the `install` verb.
  it('installs the scanner with --ignore-scripts', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    const install = /\[\s*'install'[^\]]*\]/.exec(source)?.[0] ?? '';
    expect(install).toMatch(/'--ignore-scripts'/);
  });

  it('a rejected main() prints the error and exits 1 (no unhandled-rejection exit path)', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    expect(source).toMatch(/main\(\)\.catch\(/);
    expect(source).toMatch(/process\.exit\(1\)/);
  });

  it('warns on the default leg when the running npm ignores min-release-age', () => {
    const source = readFileSync(SCAN_N8N_SCRIPT, 'utf8');
    expect(source).toMatch(/npmEnforcesReleaseAge/);
    expect(source).toMatch(/min-release-age not enforced by npm/);
  });
});

describe('scanN8nLib.DEFAULT_SCANNER_VERSION', () => {
  it('is 0.41.1 — clears the 7-day release-age gate as of 2026-11-05', () => {
    expect(scanN8nLib.DEFAULT_SCANNER_VERSION).toBe('0.41.1');
  });
});
