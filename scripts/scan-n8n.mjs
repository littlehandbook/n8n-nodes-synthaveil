#!/usr/bin/env node
/**
 * scan-n8n.mjs — run n8n's real `@n8n/scan-community-package` checker (Task
 * 2.1, r4 FSD-C4). Source leg lints the provenance-attested GitHub tree;
 * tarball leg lints what `npm publish` would ship. Never trusts a scanner
 * exit code — only `passed`, via `scanN8nLib.aggregateLegs`.
 * Installed standalone into a fresh temp npm prefix every run, never as our
 * own devDependency: inside our tree its nested `@typescript-eslint/parser`
 * hoists next to OUR `typescript` and crashes (it needs its own TypeScript).
 * Usage: npm run scan:n8n [-- --tag <dist-tag|x.y.z>]. No args installs
 * DEFAULT_SCANNER_VERSION honouring `min-release-age` (npm >= 11.10 only);
 * `--tag t` overrides release age for that one install — this dev tool is
 * never shipped, and n8n cuts scanner releases every few days.
 * In Windows PowerShell call `npm.cmd run scan:n8n -- --tag latest`: npm.ps1
 * loses the `--`, so npm takes `--tag` for itself and the default version runs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_SCANNER_VERSION, aggregateLegs, formatScannerVersion, npmEnforcesReleaseAge, parseArgs, scannerEntryUrl } from './scanN8nLib.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARBALL_FILE_PATTERNS = ['**/*.js', 'package.json'];
const RELEASE_AGE_DAYS = 7;
const RELEASE_AGE_OVERRIDE = 0;
const NPM_CLI = process.env.npm_execpath;

function runNpm(args, opts) {
  if (!NPM_CLI) throw new Error('npm_execpath is unset — run this via `npm run scan:n8n`.');
  return execFileSync(process.execPath, [NPM_CLI, ...args], { cwd: PKG_ROOT, encoding: 'utf8', ...opts });
}

function scannerPackageJson(entryUrl) {
  const scannerDir = dirname(fileURLToPath(entryUrl));
  return JSON.parse(readFileSync(join(scannerDir, '..', 'package.json'), 'utf8'));
}

/** Older npm drops `--min-release-age` without a word; say so instead. */
function warnIfReleaseAgeIgnored() {
  const version = runNpm(['--version']).trim();
  if (!npmEnforcesReleaseAge(version)) {
    console.warn(`⚠ min-release-age not enforced by npm ${version} — use npm ≥ 11.10`);
  }
}

async function installScanner(spec, minReleaseAge) {
  const prefix = mkdtempSync(join(tmpdir(), 'scan-n8n-'));
  // --ignore-scripts: no lifecycle script from the scanner's dependency tree runs, here or in CI.
  const install = ['install', `@n8n/scan-community-package@${spec}`, '--prefix', prefix, '--no-save', '--ignore-scripts'];
  runNpm([...install, `--min-release-age=${minReleaseAge}`], { cwd: prefix, stdio: 'inherit' });
  const entry = scannerEntryUrl(prefix, existsSync);
  console.log(formatScannerVersion(scannerPackageJson(entry)));
  return { prefix, scanner: await import(entry) };
}

async function sourceLeg(scanner) {
  return { name: 'source', ...(await scanner.analyzePackage(PKG_ROOT, scanner.SOURCE_FILE_PATTERNS)) };
}

async function tarballLeg(scanner) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-n8n-tarball-'));
  try {
    runNpm(['run', 'build'], { stdio: 'inherit' });
    const packed = JSON.parse(runNpm(['pack', '--json', '--pack-destination', dir]));
    execFileSync('tar', ['-xzf', join(dir, packed[0].filename), '-C', dir]);
    const result = await scanner.analyzePackage(join(dir, 'package'), TARBALL_FILE_PATTERNS);
    return { name: 'tarball', ...result };
  } catch (error) {
    return { name: 'tarball', error };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { tag } = parseArgs(process.argv.slice(2));
  const spec = tag ?? DEFAULT_SCANNER_VERSION;
  const minReleaseAge = tag ? RELEASE_AGE_OVERRIDE : RELEASE_AGE_DAYS;
  if (!tag) warnIfReleaseAgeIgnored();
  let legs, prefix;
  try {
    const installed = await installScanner(spec, minReleaseAge);
    prefix = installed.prefix;
    legs = await Promise.all([sourceLeg(installed.scanner), tarballLeg(installed.scanner)]);
  } finally {
    if (prefix) rmSync(prefix, { recursive: true, force: true });
  }
  for (const leg of legs) console.log(`[${leg.name}]`, leg.details ?? leg.message ?? leg.error ?? 'passed');
  const { passed, exitCode } = aggregateLegs(legs);
  console.log(passed ? '✓ scan:n8n passed' : '✗ scan:n8n failed');
  process.exit(exitCode);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
export { installScanner, main, sourceLeg, tarballLeg };
