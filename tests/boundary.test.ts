import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PKG_ROOT = join(__dirname, '..');

/**
 * Every source tree the published package ships from. Task 0.7 moved the node
 * and credential sources to nodes/credentials at the package root (n8n's
 * scanner only lints those two paths); shared helpers stayed under src/. All
 * three are declared here — same pattern as
 * packages/engine/src/detection/eval/no-generative.test.ts's ANONYMISER_ROOTS
 * — so a future rename fails loudly instead of the guard silently scanning
 * fewer files.
 */
const PACKAGE_ROOTS = ['nodes', 'credentials', 'src'];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectTsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Monolith path aliases: wrong from anywhere in the package (sc-011). */
const FORBIDDEN_ALIASES = [
  /from\s+['"]@\//, // monolith path alias @/*
  /from\s+['"]@taas\//, // workspace packages @taas/*
  /require\(\s*['"]@\//,
  /require\(\s*['"]@taas\//,
];

/**
 * The relative-escape half, re-expressed as "how far up may a file reach
 * before it leaves the package" rather than "this path contains the word
 * src" — the old pattern fired on the package's own legitimate
 * `../../src/constants` / `../src/constants` imports. Mirrors
 * eslint.config.mjs's boundaryDeep/boundaryShallow reasoning: depth differs by
 * directory, so there are two tiers.
 *
 *   nodes/Taas/x.ts   -> package root is ../../ , so ../../../ escapes
 *   credentials/x.ts  -> package root is ../    , so ../../    escapes
 *   src/x.ts          -> package root is ../    , so ../../    escapes
 */
const ESCAPE_DEEP = [/from\s+['"](?:\.\.\/){3,}/, /require\(\s*['"](?:\.\.\/){3,}/]; // nodes/**
const ESCAPE_SHALLOW = [/from\s+['"](?:\.\.\/){2,}/, /require\(\s*['"](?:\.\.\/){2,}/]; // credentials/**, src/**

/** Which forbidden-pattern tier applies to a file, by its top-level directory. */
function escapePatternsFor(file: string): RegExp[] {
  const topDir = relative(PKG_ROOT, file).split(sep)[0];
  return topDir === 'nodes' ? ESCAPE_DEEP : ESCAPE_SHALLOW;
}

function isForbidden(text: string, file: string): boolean {
  const patterns = [...FORBIDDEN_ALIASES, ...escapePatternsFor(file)];
  return patterns.some((re) => re.test(text));
}

/**
 * Belt-and-braces companion to the ESLint boundary rule (sc-011). The node is a
 * standalone published package: it must never import the monolith. If this trips
 * without an ESLint failure, the lint config drifted.
 */
describe('monolith boundary (sc-011)', () => {
  it('every declared package root exists and is being scanned', () => {
    // A root that has been renamed or moved must fail loudly. Silently
    // scanning one of three trees is how a guard stops guarding (PC-2).
    const missing = PACKAGE_ROOTS.filter((r) => !existsSync(join(PKG_ROOT, r)));
    expect(missing).toEqual([]);
  });

  const scannedRoots = PACKAGE_ROOTS.map((r) => join(PKG_ROOT, r)).filter((abs) => existsSync(abs));
  const files = scannedRoots.flatMap((root) => collectTsFiles(root));

  it('finds a non-trivial number of source files to scan', () => {
    // An empty (or near-empty) scan must never pass silently — that is
    // exactly the failure mode this whole file exists to prevent.
    expect(files.length).toBeGreaterThan(10);
  });

  it('no source file imports across the package boundary', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (isForbidden(text, file)) offenders.push(relative(PKG_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  // Positive control: proves the check can still fail, and that it does not
  // false-positive on the package's own legitimate cross-directory import.
  describe('forbidden-pattern check (positive control)', () => {
    it('flags a relative import that escapes the package', () => {
      const fixture = "import { x } from '../../../src/lib/thing';";
      expect(ESCAPE_DEEP.some((re) => re.test(fixture))).toBe(true);
    });

    it('does not flag the package\'s own legitimate ../../src/constants import', () => {
      const fixture = "import { c } from '../../src/constants';";
      expect(ESCAPE_DEEP.some((re) => re.test(fixture))).toBe(false);
    });
  });
});
