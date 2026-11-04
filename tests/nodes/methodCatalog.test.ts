import {
  HIDDEN_UNTIL_PRODUCTION,
  HOSTED_REJECTED,
  METHOD_OPTIONS,
  TAAS_METHODS,
  TAAS_METHOD_VALUES,
} from '../../nodes/Taas/methodCatalog';

/**
 * The catalog assertions that hold WITHOUT the monorepo around them.
 *
 * This suite used to read `docs/api/openapi.yaml` four directories up to pin
 * the catalog to the contract SSOT. That file does not exist beside the
 * package in the standalone publish mirror, which `scripts/sync-n8n-mirror.mjs`
 * fills by copying `tests/` verbatim, so the read threw ENOENT there and took
 * the mirror's `npm test` down with it (external QA round 2 of PR #633 -- the
 * same defect it reported in the bundle-drift-trigger suite, which moved to
 * `tests/ci/n8nPackageDriftTrigger.test.ts` in the monorepo for this reason).
 *
 * The spec pin now lives at `tests/api/openapi-parity.n8n-mirror.test.ts` in
 * the monorepo, beside the hosted-rejected parity assertion that was already
 * there for exactly this reason (see methodCatalog.ts's own note: a mirror
 * cannot verify itself against a file it does not have). Nothing was dropped --
 * the enum equality is asserted there, against the same catalog bytes.
 *
 * What stays here is what the published package can check on its own ground:
 * the catalog is well formed, carries operator-facing labels, and offers no
 * method the hosted API is known to refuse.
 */

describe('method catalog -- shape and labels (mirror-safe)', () => {
  const catalogValues = TAAS_METHODS.map((m) => m.value);

  it('offers a non-trivial number of methods (guard is not vacuous)', () => {
    expect(catalogValues.length).toBeGreaterThan(10);
  });

  it('excludes every hosted-rejected method', () => {
    for (const rejected of HOSTED_REJECTED) {
      expect(catalogValues).not.toContain(rejected);
    }
  });

  it('every entry carries a plain-English name and description (P4)', () => {
    for (const method of TAAS_METHODS) {
      expect(method.name.length).toBeGreaterThan(0);
      expect(method.description.length).toBeGreaterThan(0);
      // Labels must not just echo the raw method key.
      expect(method.name).not.toBe(method.value);
    }
  });

  it('has no duplicate values', () => {
    expect(new Set(catalogValues).size).toBe(catalogValues.length);
  });
});

describe('method catalog -- methods production does not serve yet are hidden', () => {
  it('Synthetic Town (l2.synthesize-locality, #902) is on the hidden list', () => {
    expect(HIDDEN_UNTIL_PRODUCTION).toContain('l2.synthesize-locality');
  });

  it('no hidden method is offered in the dropdown or accepted as a catalog value', () => {
    const dropdownValues = METHOD_OPTIONS.map((option) => option.value);
    for (const hidden of HIDDEN_UNTIL_PRODUCTION) {
      expect(dropdownValues).not.toContain(hidden);
      expect(TAAS_METHOD_VALUES.has(hidden)).toBe(false);
    }
  });

  it('no dropdown label advertises Synthetic Town', () => {
    for (const option of METHOD_OPTIONS) {
      expect(option.name).not.toMatch(/Synthetic Town/);
    }
  });
});
