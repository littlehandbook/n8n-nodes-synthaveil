#!/usr/bin/env node
/**
 * sync-n8n-mirror.mjs — copy this package from the monorepo into the public
 * publish mirror `littlehandbook/n8n-nodes-synthaveil`.
 *
 * Council condition PC-3 (SPEC->PLAN gate 2026-08-30). The monorepo copy is
 * CANONICAL: it is the only place the node is edited, reviewed and tested. The
 * public repo exists solely because n8n's community scanner fetches the source
 * at the provenance-attested commit, which requires a public GitHub repo. It is
 * a mirror, filled only by this script, and the sync is ONE-WAY. A mirror that
 * has diverged is repaired by re-running this, never by merging it back.
 *
 * The mirror commit message records the monorepo SHA. Without it, npm provenance
 * attests a mirror commit that cannot be traced back to reviewed code — which is
 * the entire point of the attestation. `vendor/HASH` is copied for the same
 * reason: the bundled restore-protocol hash is computed in the monorepo and
 * verified against the mirror.
 *
 * Usage:
 *   node scripts/sync-n8n-mirror.mjs --mirror ../n8n-nodes-synthaveil [--tag v0.2.1] [--dry-run]
 *
 * This script does NOT push and does NOT publish. It stages a commit in the
 * mirror working tree; a human pushes the tag, and the founder approves the
 * staged npm release with a 2FA code (plan Task 0.8).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Everything the mirror needs to build, test, scan and publish. `nodes` and
 * `credentials` must sit at the mirror's ROOT — that is the whole reason plan
 * Task 0.7 moved them out of `src/`; the scanner's source leg lints only those
 * two paths and would otherwise see nothing.
 */
const MIRRORED = [
  'nodes',
  'credentials',
  'src',
  'scripts',
  'tests',
  'examples',
  'vendor',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'jest.config.js',
  'eslint.config.mjs',
  '.prettierrc.json',
  '.gitignore',
  'README.md',
  'LICENSE',
];

/** Never mirrored: build output, installed modules, local scratch. */
const NEVER = new Set(['dist', 'node_modules', 'coverage', '.git']);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function main() {
  const mirror = arg('--mirror');
  const tag = arg('--tag');
  const dryRun = process.argv.includes('--dry-run');

  if (!mirror) {
    console.error('Usage: node scripts/sync-n8n-mirror.mjs --mirror <path> [--tag v0.2.1] [--dry-run]');
    process.exit(2);
  }
  if (!existsSync(join(mirror, '.git'))) {
    console.error(`[sync] ${mirror} is not a git working tree. Clone the mirror repo first.`);
    process.exit(1);
  }

  const sha = git(['rev-parse', 'HEAD'], PKG_ROOT);
  const dirty = git(['status', '--porcelain', '--', '.'], PKG_ROOT);
  if (dirty) {
    console.error('[sync] the monorepo package has uncommitted changes. The mirror must record a\n' +
      '       real monorepo SHA, so commit first:\n' + dirty);
    process.exit(1);
  }

  const version = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;

  for (const entry of MIRRORED) {
    const from = join(PKG_ROOT, entry);
    if (!existsSync(from)) continue; // vendor/ does not exist until P1 Task 1.3
    const to = join(mirror, entry);
    if (dryRun) {
      console.log(`[sync] would copy ${entry}`);
      continue;
    }
    rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, {
      recursive: true,
      filter: (src) => !NEVER.has(src.split(/[\\/]/).pop()),
    });
  }

  // The publish workflow lives ONLY in the mirror (PC-3). In the monorepo it is
  // parked at `.github-publish/publish.yml`, which is not a workflow path, so it
  // can never fire from there.
  const workflowSrc = join(PKG_ROOT, '.github-publish', 'publish.yml');
  const workflowDest = join(mirror, '.github', 'workflows', 'publish.yml');
  if (existsSync(workflowSrc) && !dryRun) {
    mkdirSync(dirname(workflowDest), { recursive: true });
    cpSync(workflowSrc, workflowDest);
  }

  const hashFile = join(PKG_ROOT, 'vendor', 'HASH');
  if (!existsSync(hashFile)) {
    console.warn('[sync] note: vendor/HASH not present yet (it arrives with P1 Task 1.3).');
  }

  if (dryRun) {
    console.log(`[sync] dry run complete. Would record monorepo SHA ${sha}.`);
    return;
  }

  const message =
    `chore: sync ${version} from monorepo ${sha}` +
    (tag ? ` (tag ${tag})` : '') +
    '\n\n' +
    'Mirror commit produced by scripts/sync-n8n-mirror.mjs. Do not edit this repo\n' +
    'by hand — the monorepo copy is canonical (PC-3, ADR-0051 section 4).\n' +
    `sync from monorepo ${sha}\n`;

  git(['add', '-A'], mirror);
  const staged = git(['status', '--porcelain'], mirror);
  if (!staged) {
    console.log('[sync] mirror already matches the monorepo — nothing to commit.');
    return;
  }
  git(['commit', '-m', message], mirror);
  console.log(`[sync] committed to the mirror, recording monorepo SHA ${sha}.`);
  console.log('[sync] NOT pushed and NOT published. Push, then tag, then have the founder');
  console.log('[sync] approve the staged npm release with a 2FA code (plan Task 0.8).');
}

main();
