/**
 * QA review (PR #523, finding 10) regression: this package must be
 * clean-installable from the registry by anyone who is not us.
 *
 * The manifest declared `@synthaveil/restore-protocol@^0.1.0` as a
 * devDependency. That package has never been published, and — unlike
 * `packages/*` — this directory is NOT a workspace of the root manifest, so
 * npm resolves the name against the registry and a clean `npm install` here
 * fails with E404. Nothing in the package actually needed it: the protocol is
 * *vendored* (`vendor/restore-protocol.js`, bundled at build time by
 * `scripts/bundle-hash.mjs` straight from the workspace source), its types come
 * from `vendor/restore-protocol.d.ts`, and the one test that imports the
 * package by name is a spike that skips itself when the module is absent.
 *
 * These assertions are static so they cost nothing and run everywhere. They
 * encode the rule that matters: a dependency this package declares must be one
 * a stranger can actually resolve.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));

/** Scopes this repo owns that have nothing published under them yet. */
const UNPUBLISHED_SCOPES = ['@synthaveil/'];

const allDeclaredDeps = (): string[] => [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
];

describe('package is installable by a stranger (QA finding 10)', () => {
  it('declares no dependency from a scope that has nothing published', () => {
    const unresolvable = allDeclaredDeps().filter((name) =>
      UNPUBLISHED_SCOPES.some((scope) => name.startsWith(scope)),
    );

    expect(unresolvable).toEqual([]);
  });

  it('has no runtime dependencies at all — the protocol is vendored, not installed', () => {
    // The zero-runtime-dependency posture is a security claim in the OWASP
    // record (A06), not just a packaging preference.
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('ships the vendored bundle it depends on instead of resolving it', () => {
    expect(pkg.files).toContain('vendor/restore-protocol.js');
    expect(pkg.files).toContain('vendor/HASH');
  });
});
