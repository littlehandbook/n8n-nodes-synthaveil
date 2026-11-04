/**
 * Task 1.3 (CC-9 reproducibility hash) -- `scripts/bundle-hash.mjs` bundles
 * `@synthaveil/restore-protocol` into `vendor/restore-protocol.js` and writes
 * `vendor/HASH`, so the node ships zero runtime deps (bundled at build time) while CI can
 * still verify the bundle wasn't tampered with.
 *
 * EXPECTED STATE: RED -- `scripts/bundle-hash.mjs` does not exist yet, so neither
 * `vendor/restore-protocol.js` nor `vendor/HASH` exist.
 *
 * (PC-5 bundle half / TA-SA R2): tonight's bundle is cut from the workspace package (the
 * npm registry version doesn't exist yet), so `vendor/HASH` is marked `provisional` on its
 * own line until a post-publish step re-bundles against the registry tarball.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_ROOT = join(__dirname, '..', '..');
const BUNDLE_HASH_SCRIPT = join(PACKAGE_ROOT, 'scripts', 'bundle-hash.mjs');
const VENDOR_BUNDLE = join(PACKAGE_ROOT, 'vendor', 'restore-protocol.js');
const VENDOR_HASH = join(PACKAGE_ROOT, 'vendor', 'HASH');
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Branch review finding 8 (2026-08-31): the ORIGINAL version of this suite ran
 * `bundle-hash.mjs` first (regenerating both `vendor/restore-protocol.js` and
 * `vendor/HASH`) and only afterwards compared them -- a tautology that cannot
 * detect a tampered COMMITTED bundle, since the committed files were
 * overwritten before anything was ever read from git.
 *
 * This block runs FIRST and reads nothing but the files already on disk
 * (i.e. the committed versions, before any regeneration in this test file
 * touches them): it hashes the committed `vendor/restore-protocol.js` and
 * asserts it equals the committed `vendor/HASH` line 1. That is the actual
 * tamper/drift check the script header and this file's docblock claim CI
 * performs. The regeneration block below it is a SEPARATE, additional check
 * (source drift: does re-bundling from source still match?) -- it does not
 * replace this one.
 */
describe('vendor/restore-protocol.js -- the COMMITTED bundle matches the COMMITTED HASH (verify-only, no regeneration)', () => {
  it('sha256(committed vendor/restore-protocol.js) === committed vendor/HASH line 1', () => {
    expect(existsSync(VENDOR_BUNDLE)).toBe(true);
    expect(existsSync(VENDOR_HASH)).toBe(true);

    const committedBundle = readFileSync(VENDOR_BUNDLE);
    const committedHashLines = readFileSync(VENDOR_HASH, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.length > 0);
    const committedHashLine = committedHashLines.find((l) => SHA256_HEX_PATTERN.test(l));

    expect(committedHashLine).toBeDefined();
    expect(createHash('sha256').update(committedBundle).digest('hex')).toBe(committedHashLine);
  });
});

describe('scripts/bundle-hash.mjs (Task 1.3) -- RED until the script lands', () => {
  it('exists', () => {
    expect(existsSync(BUNDLE_HASH_SCRIPT)).toBe(true);
  });
});

/**
 * The `--out-dir` REGENERATION check is not a Jest suite in either repository.
 * It lives in `.github/workflows/n8n-package.yml` as three steps: re-bundle
 * into a scratch directory, then `cmp` the result against the committed
 * `vendor/restore-protocol.js` and against the committed `vendor/HASH`. Byte
 * equality covers every assertion the deleted suite made about the REGENERATED
 * output, and `bundle-hash.mjs` already refuses its own output when a
 * `__require(` or a `globalThis` survives the define/inject rewrite. The one
 * property the workflow cannot observe is the suite's last one -- that the run
 * left the tracked `vendor/` files untouched -- and there is no code path to
 * regress into: `resolveOutDir()` returns a single `VENDOR_DIR`, so the bundle
 * is written to the scratch dir or to `vendor/`, never to both.
 *
 * It cannot be a suite HERE because re-bundling cannot work in the standalone
 * publish mirror that `scripts/sync-n8n-mirror.mjs` fills: `resolveEntryPoint()`
 * throws there by design, because `packages/restore-protocol` sits above a
 * repository with no such parent and `@synthaveil/restore-protocol` is not
 * installed either -- this package ships zero runtime dependencies. The mirror
 * gets the committed bundle and HASH exactly so it never rebuilds them, so the
 * block's `beforeAll` threw and took the mirror's whole `npm test` down.
 *
 * It was briefly a monorepo-root suite instead (external QA round 2 of PR
 * #633), and was removed there too: `integrations/` is not a root workspace, so
 * the root `npm ci --ignore-scripts` never installs this package's
 * devDependencies and `esbuild` did not resolve -- ERR_MODULE_NOT_FOUND, all
 * six tests red in CI, green only on a developer machine with a stale
 * `node_modules`. `tests/ci/n8nPackageDriftTrigger.test.ts` pins the workflow's
 * path filters, so every commit that can alter the bundle still runs the
 * workflow check above.
 *
 * What remains here is what the published package can prove on its own ground,
 * and it is the more valuable half in the mirror: the bundle it ships hashes to
 * the HASH it ships.
 */

describe('package.json has zero runtime dependencies (strict pin)', () => {
  it('pkg.dependencies is undefined, not just empty', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined();
  });
});
