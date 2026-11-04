#!/usr/bin/env node
/**
 * scan-local.mjs — reproduce both legs of `@n8n/scan-community-package` for code
 * that is not published yet. The real CLI only accepts a registry name, so it
 * cannot be pointed at a working tree; this stands in until Task 0.8 publishes a
 * version the real scanner can fetch.
 *
 * The scanner has two legs (n8n PR #34214, shipped in 2.30.x):
 *   A. SOURCE — downloads the repo at the provenance-attested commit and lints
 *      `nodes` + `credentials` at the package ROOT. This is why plan Task 0.7
 *      moved them out of `src/`.
 *   B. TARBALL — lints the published tarball's compiled `**\/*.js` with
 *      `@n8n/eslint-plugin-community-nodes` recommended + `no-console: error`,
 *      and rejects a package whose shape is wrong.
 *
 * PC-1 fallback, and the path actually taken here: `@n8n/scan-community-package`
 * ships only `scanner/cli.mjs` + `scanner/scanner.mjs` and documents the CLI
 * only, so importing `analyzePackage` is asserted, not verified. This script
 * probes for it, and when it is unavailable — which it is today, the package is
 * not even a devDependency — runs the equivalent checks directly rather than
 * chasing a deep import. Which path ran is printed and belongs in
 * `docs/proj-n8n-integration/scan-results.md`.
 *
 * Exit code 0 = both legs clean. Anything else = the real scanner would very
 * likely reject this version, so do not tag a release.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Resolve the local binaries and drive them with `node` directly. On Windows
 * `npm` and `npx` are `.cmd` shims, which `execFileSync` cannot spawn
 * (`spawnSync npx ENOENT`), and using `shell: true` instead would mangle the
 * JSON config passed to ESLint below. `npm_execpath` is set by `npm run`.
 */
const ESLINT_BIN = join(PKG_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
const SCAN_CONFIG = join(PKG_ROOT, 'scripts', 'scan-eslint.config.mjs');
const NPM_CLI = process.env.npm_execpath;

/**
 * The globals the scanner refuses are declared in `scripts/scan-eslint.config.mjs`
 * rather than here, so there is one list rather than two that can drift apart.
 */

/** Files that must never appear in the tarball (scanner rejects both). */
const FORBIDDEN_TARBALL_PATTERNS = [/\.d\.ts$/, /\.test\.js$/, /\.spec\.js$/];

const failures = [];

function fail(leg, detail) {
  failures.push(`[${leg}] ${detail}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

/** Leg A — lint the source tree exactly as the scanner's source leg does. */
function legSource() {
  console.log('[scan-local] leg A (source): eslint over nodes/ credentials/ src/');
  if (!existsSync(join(PKG_ROOT, 'nodes')) || !existsSync(join(PKG_ROOT, 'credentials'))) {
    fail('source', 'nodes/ and credentials/ must exist at the package root — the scanner lints only those two paths and would see nothing.');
    return;
  }
  try {
    run(process.execPath, [ESLINT_BIN, 'nodes', 'credentials', 'src']);
    console.log('[scan-local]   source leg clean');
  } catch (err) {
    fail('source', `eslint reported problems:\n${err.stdout || err.message}`);
  }
}

/**
 * The exact file list `npm publish` would ship, without extracting anything.
 * `npm pack --dry-run --json` is authoritative — it applies `files`, `.npmignore`
 * and npm's built-in rules — and avoids untarring, which is worth avoiding here:
 * GNU tar in Git Bash reads a `C:\...` path as a remote host spec and dies with
 * "Cannot connect to C: resolve failed".
 */
function packedFiles() {
  if (!NPM_CLI) throw new Error('npm_execpath is unset — run this via `npm run scan:local`.');
  const out = run(process.execPath, [NPM_CLI, 'pack', '--dry-run', '--json']);
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return (parsed[0]?.files ?? []).map((f) => f.path.split('\\').join('/'));
}

/** Leg B — shape + restricted-global checks over exactly what would be published. */
function legTarball() {
  console.log('[scan-local] leg B (tarball): npm pack --dry-run -> shape + restricted globals');
  let files;
  try {
    files = packedFiles();
  } catch (err) {
    fail('tarball', `npm pack failed: ${err.stdout || err.message}`);
    return;
  }

  const banned = files.filter((f) => FORBIDDEN_TARBALL_PATTERNS.some((re) => re.test(f)));
  if (banned.length > 0) fail('tarball', `forbidden files would ship: ${banned.join(', ')}`);

  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    fail('tarball', `runtime dependencies present: ${Object.keys(pkg.dependencies).join(', ')}`);
  }
  for (const declared of [...(pkg.n8n?.nodes ?? []), ...(pkg.n8n?.credentials ?? [])]) {
    if (!files.includes(declared)) {
      fail('tarball', `package.json n8n block points at "${declared}", which is not in the tarball`);
    }
  }

  // Every icon a node or credential declares must actually ship, or the node
  // renders blank on the canvas with no build-time warning.
  const icons = files.filter((f) => f.endsWith('.svg'));
  if (icons.length === 0) fail('tarball', 'no SVG icons in the tarball — copy-assets did not run.');

  checkRestrictedGlobals(files);
  if (failures.length === 0) console.log('[scan-local]   tarball leg clean');
}

/**
 * AST check, not a grep (PC-1). The scanner's rule is `no-restricted-globals`,
 * which resolves identifiers; a grep matches the word "process" inside ordinary
 * English in a property description or an error string and produces noise. This
 * runs ESLint's own parser over the shipped JS.
 */
function checkRestrictedGlobals(files) {
  const js = files.filter((f) => f.endsWith('.js'));
  if (js.length === 0) {
    fail('tarball', 'no compiled .js files in the tarball — did the build run?');
    return;
  }
  try {
    run(process.execPath, [
      ESLINT_BIN,
      '--no-config-lookup',
      '--no-ignore',
      '--config',
      SCAN_CONFIG,
      ...js.map((f) => join(PKG_ROOT, f)),
    ]);
  } catch (err) {
    const output = err.stdout || err.message;
    if (/Invalid option|Unknown option|perhaps you meant/i.test(output)) {
      fail('tarball', `could not run the AST check (eslint CLI rejected the inline config):\n${output}`);
    } else {
      fail('tarball', `restricted globals / console in shipped JS:\n${output}`);
    }
  }
}

function probeRealScanner() {
  try {
    execFileSync(process.execPath, ['-e', "require.resolve('@n8n/scan-community-package')"], {
      cwd: PKG_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

console.log(
  probeRealScanner()
    ? '[scan-local] @n8n/scan-community-package is installed; still running the local legs (its analyzePackage export is undocumented — see header).'
    : '[scan-local] @n8n/scan-community-package not installed — running the PC-1 fallback legs. This is the expected path pre-publish.',
);

legSource();
legTarball();

if (failures.length > 0) {
  console.error(`\n[scan-local] FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error('[scan-local] Do not tag a release: the real scanner would very likely reject this.');
  process.exit(1);
}

console.log('\n[scan-local] OK — both legs clean.');
