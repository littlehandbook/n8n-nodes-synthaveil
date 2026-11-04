#!/usr/bin/env node
/**
 * Copy non-TypeScript node assets (SVG icons) into dist/, mirroring the source
 * directory structure so n8n resolves `file:*.svg` icon paths next to each
 * compiled node/credential. `tsc` does not copy non-code files, so the build
 * script runs this immediately after compilation. Zero external dependencies.
 *
 * Since plan Task 0.7 the package uses the n8n standard layout, so there are
 * three source roots rather than one: `nodes/` and `credentials/` at the package
 * root (where the icons live) and `src/` for shared helpers. `tsconfig.json` has
 * `rootDir: "."`, so each root maps to `dist/<root>/…` and the relative
 * `file:taas.svg` reference resolves next to the compiled file.
 *
 * A missing icon is silent at build time and only shows up as a blank node on
 * the n8n canvas, so this script fails loudly if a declared root disappears or
 * an expected icon does not arrive in dist/.
 *
 * The vendored restore-protocol bundle is copied here for the same reason.
 * `nodes/Taas/singleExecute.ts` imports `../../vendor/restore-protocol`, which
 * `tsc` (rootDir ".") rewrites into a require for `dist/vendor/restore-protocol`
 * — a path nothing populated, so the published node threw MODULE_NOT_FOUND on
 * load while every ts-jest unit test passed against the sources (QA review
 * P0-1). `tests/packaging/loadable.test.ts` is the regression net.
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PKG_ROOT, 'dist');

/** Source roots that may contain assets, mirrored 1:1 into dist/. */
const ASSET_ROOTS = ['nodes', 'credentials', 'src'];
const ASSET_EXTENSIONS = ['.svg', '.png'];

/**
 * Runtime files that live outside the TypeScript source roots and so are never
 * emitted by `tsc`, copied to the location the COMPILED requires resolve to.
 * `restore-protocol.js` is the bundle itself; `HASH` travels beside it so the
 * shipped copy carries its own provenance record.
 */
const VENDOR_FILES = ['restore-protocol.js', 'HASH'];

/** Icons that must exist in dist/ afterwards — the blank-node canary. */
const REQUIRED_ICONS = [
  'nodes/Taas/taas.svg',
  'nodes/Taas/taas.dark.svg',
  'credentials/taas.svg',
  'credentials/taas.dark.svg',
];

if (!existsSync(DIST)) {
  console.error('[copy-assets] dist/ not found — run tsc first.');
  process.exit(1);
}

for (const root of ASSET_ROOTS) {
  const from = join(PKG_ROOT, root);
  if (!existsSync(from)) {
    console.error(`[copy-assets] declared source root "${root}" does not exist.`);
    process.exit(1);
  }
  cpSync(from, join(DIST, root), {
    recursive: true,
    filter: (source) => {
      // Descend into directories; copy only asset files, skip everything else (.ts).
      if (statSync(source).isDirectory()) return true;
      return ASSET_EXTENSIONS.includes(extname(source));
    },
  });
}

for (const name of VENDOR_FILES) {
  const from = join(PKG_ROOT, 'vendor', name);
  if (!existsSync(from)) {
    console.error(`[copy-assets] vendor/${name} is missing — run \`node scripts/bundle-hash.mjs\`.`);
    process.exit(1);
  }
  mkdirSync(join(DIST, 'vendor'), { recursive: true });
  cpSync(from, join(DIST, 'vendor', name));
}

const missing = REQUIRED_ICONS.filter((rel) => !existsSync(join(DIST, rel)));
if (missing.length > 0) {
  console.error(`[copy-assets] icons missing from dist/: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(
  `[copy-assets] copied SVG/PNG assets from ${ASSET_ROOTS.join(', ')} and ` +
    `vendor/{${VENDOR_FILES.join(',')}} to dist/`,
);
