import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { climbsViaPathBuild, climbsViaSpecifier } from './mirrorSafety.scan';

/**
 * Nothing under the mirrored `tests/` tree may read outside the package root
 * (external QA round 2 of PR #633, finding P1).
 *
 * `scripts/sync-n8n-mirror.mjs` copies `tests/` verbatim into the standalone
 * publish repo `littlehandbook/n8n-nodes-synthaveil`, whose own publish
 * workflow runs `npm test`. That repo has no parent monorepo: there is no
 * `.github/workflows/n8n-package.yml` and no `docs/api/openapi.yaml` two
 * directories up, so a suite reaching for one throws ENOENT and the publish
 * fails. Two suites did exactly that, and both were invisible here because the
 * monorepo checkout always has the files.
 *
 * A skip-when-absent guard was rejected deliberately: it passes SILENTLY in the
 * mirror, which is the one place the assertion still needs to mean something.
 * Monorepo-only checks live in the monorepo (`tests/ci/`, `tests/api/`); this
 * guard is what stops another one being written here by accident.
 *
 * Scope is `tests/` -- the files the mirror's `npm test` actually loads.
 * `scripts/capture-fixtures.mjs` is mirrored and does walk to the repo root,
 * but it is a manual fixture-capture tool that no test or CI job runs.
 *
 * The climb detector itself lives in `mirrorSafety.scan.ts`, for size and
 * because it is pure text work. That helper is mirrored and scanned like any
 * other file here; only THIS file is exempt, because its regex sources and its
 * positive-control fixtures below contain the very literals it searches for.
 */

const PKG_ROOT = join(__dirname, '..');
const SYNC_SCRIPT = join(PKG_ROOT, 'scripts', 'sync-n8n-mirror.mjs');

/** Source extensions the mirror's Jest run can load. */
const SCANNED_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'];

/** A name the monorepo root is conventionally bound to. Never valid here. */
const REPO_ROOT_IDENTIFIER = /\bREPO_ROOT\b/;

/**
 * The destination the sync script copies the parked publish workflow to.
 *
 * The monorepo-side check that the two workflows ignore the same test paths
 * (`tests/ci/n8nPackageDriftTrigger.test.ts`) compares
 * `.github-publish/publish.yml` against `.github/workflows/n8n-package.yml`,
 * and neither path exists in the mirror -- which is why that comparison cannot
 * live in this file. This is the half that can.
 *
 * Scope, stated honestly: this pins the STRING WIRING in the sync script, so a
 * deleted or retargeted copy step fails here. It does NOT prove the workflow
 * file exists -- the copy is guarded by an existence check, and reading
 * `.github-publish/` from this file would be the very monorepo-only reach the
 * suite forbids (and would pass its own depth check, since the path sits
 * inside the package root). That existence is covered in the monorepo instead:
 * the root suite parses the file to compare the two commands.
 */
const PUBLISH_WORKFLOW_DEST = ['.github', 'workflows', 'publish.yml'];

/** The entries `sync-n8n-mirror.mjs` copies into the standalone repo. */
function mirroredEntries(): string[] {
  const source = readFileSync(SYNC_SCRIPT, 'utf8');
  const declaration = /const MIRRORED = \[([^\]]*)\]/.exec(source);
  // Throw rather than return []: a renamed constant must fail the gate, not
  // quietly satisfy every assertion below against an empty list.
  if (!declaration) throw new Error(`MIRRORED declaration not found in ${SYNC_SCRIPT}`);
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectSourceFiles(full);
    return SCANNED_EXTENSIONS.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

/**
 * How many `..` segments a file may climb before it leaves the package. A file
 * in `tests/` reaches the package root with one; one in `tests/nodes/` needs
 * two. Anything beyond its own depth is outside the mirror.
 */
function allowedDepth(file: string): number {
  return relative(PKG_ROOT, file).split(sep).length - 1;
}

function escapesPackageRoot(file: string): boolean {
  const text = readFileSync(file, 'utf8');
  const limit = allowedDepth(file);
  return (
    REPO_ROOT_IDENTIFIER.test(text) ||
    climbsViaPathBuild(text, limit) ||
    climbsViaSpecifier(text, limit)
  );
}

describe('mirrored tests must not read outside the package root', () => {
  it('the sync script still copies tests/ into the mirror (scan target is mirrored)', () => {
    const mirrored = mirroredEntries();
    expect(mirrored).toContain('tests');
    // A near-empty extraction must never pass silently.
    expect(mirrored.length).toBeGreaterThan(5);
  });

  it('the sync script still wires the publish workflow across to the mirror', () => {
    const source = readFileSync(SYNC_SCRIPT, 'utf8');
    for (const segment of PUBLISH_WORKFLOW_DEST) {
      expect(source).toContain(`'${segment}'`);
    }
    expect(source).toContain(`'.github-publish'`);
  });

  // This file itself is exempt: its regex sources and positive-control
  // fixtures below contain the very literals it searches for.
  const files = collectSourceFiles(__dirname).filter((file) => file !== __filename);

  it('finds a non-trivial number of files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('the climb detector is one of the files being scanned', () => {
    // The helper is mirrored too, so it has to obey the rule it enforces.
    // Exempting it would leave the one file nobody checks.
    expect(files.map((file) => relative(PKG_ROOT, file))).toContain(
      join('tests', 'mirrorSafety.scan.ts'),
    );
  });

  it('no mirrored test file reaches above the package root', () => {
    const offenders = files.filter(escapesPackageRoot).map((file) => relative(PKG_ROOT, file));
    expect(offenders).toEqual([]);
  });

  describe('detector positive control', () => {
    it('flags a __dirname build that climbs past the package root', () => {
      expect(climbsViaPathBuild("join(__dirname, '..', '..', '..', '..', 'docs')", 2)).toBe(true);
    });

    it('does not flag a __dirname build that stops at the package root', () => {
      expect(climbsViaPathBuild("join(__dirname, '..', '..')", 2)).toBe(false);
    });

    // Evasion 1 (quality review of cb7ca5e3): the whole climb lives inside one
    // quoted argument, so counting discrete '..' tokens scored it zero.
    it('flags a climb hidden inside one slash-separated argument', () => {
      expect(climbsViaPathBuild("join(__dirname, '../../docs/api/openapi.yaml')", 1)).toBe(true);
    });

    it('flags a climb hidden inside one backslash-separated argument', () => {
      expect(climbsViaPathBuild(String.raw`join(__dirname, '..\..\docs')`, 1)).toBe(true);
    });

    it('flags a climb hidden inside a template literal argument', () => {
      expect(climbsViaPathBuild('join(__dirname, `../../docs/${name}`)', 1)).toBe(true);
    });

    // Evasion 2: the climb is split across two calls, and the second one never
    // mentions __dirname, so a __dirname-anchored detector never sees it.
    it('flags a two-hop climb through an identifier bound to the package root', () => {
      const fixture = [
        "const ROOT = join(__dirname, '..');",
        "const spec = readFileSync(join(ROOT, '..', 'docs', 'api', 'openapi.yaml'), 'utf8');",
      ].join('\n');
      expect(climbsViaPathBuild(fixture, 1)).toBe(true);
    });

    it('flags a two-hop climb that reaches the bound name through interpolation', () => {
      const fixture = [
        "const ROOT = join(__dirname, '..');",
        'const spec = readFileSync(`${ROOT}/../docs/api/openapi.yaml`, \'utf8\');',
      ].join('\n');
      expect(climbsViaPathBuild(fixture, 1)).toBe(true);
    });

    it('flags a climb chained through two identifiers', () => {
      const fixture = [
        "const ONE = join(__dirname, '..');",
        "const TWO = join(ONE, '..');",
        "existsSync(join(TWO, 'docs'));",
      ].join('\n');
      expect(climbsViaPathBuild(fixture, 1)).toBe(true);
    });

    it('flags a climb split across lines inside one call', () => {
      const fixture = ['join(', "  __dirname,", "  '..',", "  '..',", ')'].join('\n');
      expect(climbsViaPathBuild(fixture, 1)).toBe(true);
    });

    // Negative controls: the shapes the package's own suites really use. If one
    // of these flips to true the guard starts failing honest tests, which is
    // how a guard gets deleted instead of fixed.
    it('does not flag the package-root build that mirrored suites legitimately do', () => {
      const fixture = [
        "const PKG_ROOT = join(__dirname, '..');",
        "const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));",
        "existsSync(join(PKG_ROOT, 'nodes', 'Taas', 'Taas.node.ts'));",
      ].join('\n');
      expect(climbsViaPathBuild(fixture, 1)).toBe(false);
    });

    it('does not flag a fixture read from a nested tests/ directory', () => {
      const fixture =
        "readFileSync(join(__dirname, '..', 'fixtures', 'v1', 'usage-200.json'), 'utf8')";
      expect(climbsViaPathBuild(fixture, 2)).toBe(false);
    });

    it('does not flag a parent-traversal string outside any path call', () => {
      const fixture = 'const f = "import { x } from \'../../../src/thing\';";';
      expect(climbsViaPathBuild(fixture, 1)).toBe(false);
    });

    it('flags an import specifier that climbs past the package root', () => {
      expect(climbsViaSpecifier("import { x } from '../../../src/thing';", 2)).toBe(true);
    });

    it('does not flag a parent-traversal string inside a quoted fixture', () => {
      const fixture = 'const f = "import { x } from \'../../../src/thing\';";';
      expect(climbsViaSpecifier(fixture, 2)).toBe(false);
    });
  });
});
