/**
 * QA review P0-1 regression: the published tarball must actually LOAD.
 *
 * `singleExecute.ts` imports `../../vendor/restore-protocol`. From
 * `nodes/Taas/` that is `<pkg>/vendor/restore-protocol` in source, but `tsc`
 * emits to `dist/` with `rootDir: "."`, so the compiled require resolves to
 * `dist/vendor/restore-protocol` — a path nothing was writing. Every unit test
 * passed (they run the TypeScript through ts-jest, never the build output),
 * while the real published node died at import with MODULE_NOT_FOUND.
 *
 * These tests therefore exercise the BUILD OUTPUT, not the sources: the class
 * of bug they catch is "compiles and unit-tests fine, cannot be loaded". A
 * cheap static assertion plus a real `npm pack` → install → require cycle.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PKG_ROOT = join(__dirname, '..', '..');
const DIST = join(PKG_ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));

/** `npm run build` is a prerequisite; say so rather than failing cryptically. */
function requireBuilt(): void {
  if (!existsSync(DIST)) {
    throw new Error('dist/ is missing — run `npm run build` in this package before this suite.');
  }
}

describe('build output is loadable (QA P0-1)', () => {
  it('emits the vendored protocol bundle next to the compiled requires', () => {
    requireBuilt();
    // The compiled node does `require('../../vendor/restore-protocol')` from
    // dist/nodes/Taas/, so the bundle must exist at dist/vendor/.
    expect(existsSync(join(DIST, 'vendor', 'restore-protocol.js'))).toBe(true);
  });

  it('resolves every relative require in the compiled entrypoints', () => {
    requireBuilt();
    for (const entry of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
      expect(existsSync(join(PKG_ROOT, entry))).toBe(true);
    }
    // Loading the node executes its whole relative-import graph, which is the
    // actual failure mode: a missing vendor bundle throws MODULE_NOT_FOUND here.
    const nodeEntry = join(PKG_ROOT, pkg.n8n.nodes[0]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(nodeEntry) as Record<string, unknown>;
    expect(typeof loaded.Taas).toBe('function');
  });

  it('ships the vendor bundle inside the packed tarball and loads it clean', () => {
    requireBuilt();
    // Stage inside this package's own node_modules so Node resolves the
    // `n8n-workflow` PEER dependency by walking up, exactly as it does when n8n
    // installs a community node beside its own copy. Extracting to the OS temp
    // dir instead would fail on the peer import and tell us nothing about our
    // packaging.
    const staging = mkdtempSync(join(PKG_ROOT, 'node_modules', '.taas-pack-'));
    try {
      // `npm pack` honours the manifest's `files` allowlist, so this asserts
      // what customers actually download — not what happens to sit in the
      // working tree.
      // Windows needs `shell: true` to spawn npm's `.cmd` shim, and a shell
      // does not quote arguments — so the destination is passed RELATIVE to
      // PKG_ROOT. An absolute path here would be split on the space in the
      // checkout directory ("Code Repro") and npm would look in the wrong place.
      const relativeStaging = relative(PKG_ROOT, staging).split(sep).join('/');
      const packed = execFileSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['pack', '--pack-destination', relativeStaging, '--ignore-scripts'],
        { cwd: PKG_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
      )
        .trim()
        .split('\n')
        .pop() as string;

      // Extract with the tarball named RELATIVELY from inside the staging
      // directory: GNU tar (the one on PATH under Git Bash on Windows) reads a
      // leading `C:` as a remote host and fails with "Cannot connect to C".
      execFileSync('tar', ['-xzf', packed], { cwd: staging, encoding: 'utf8' });

      const extracted = join(staging, 'package');
      expect(existsSync(join(extracted, 'dist', 'vendor', 'restore-protocol.js'))).toBe(true);

      // Require the node straight out of the extracted tarball: no node_modules
      // of ours is reachable from there, so anything it pulls in must have been
      // shipped. This is the MODULE_NOT_FOUND the review hit.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require(join(extracted, pkg.n8n.nodes[0])) as Record<string, unknown>;
      expect(typeof loaded.Taas).toBe('function');
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }, 180_000);
});
