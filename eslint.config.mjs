import { config } from '@n8n/node-cli/eslint';

/**
 * The upstream `@n8n/node-cli` flat config targets the conventional root
 * `./credentials/**` and `./nodes/**` layout. Since plan Task 0.7 this package
 * uses exactly that layout, so the config applies as shipped — the previous
 * `remapLayer()` helper, which re-pointed those rule layers at `src/credentials`
 * and `src/nodes`, is gone. Nothing to keep in step with an upstream bump.
 *
 * Why the layout moved: `@n8n/scan-community-package` downloads the source at
 * the provenance-attested commit and lints `nodes` + `credentials` at the
 * package root. Sources under `src/` were invisible to that leg of the scan.
 */

/** Monolith couplings that are wrong from anywhere in the package (sc-011). */
const FORBIDDEN_ALIASES = [
  {
    group: ['@/*', '@/**'],
    message:
      'Boundary (sc-011): do not import monolith path aliases (@/*). The node uses the hosted /api/v1 surface over HTTP only.',
  },
  {
    group: ['@taas/*', '@taas/**'],
    message:
      'Boundary (sc-011): do not import workspace packages (@taas/*). The node is a standalone published package.',
  },
];

const ESCAPE_MESSAGE =
  'Boundary (sc-011): this relative path leaves the package. The node is standalone and published on its own; it must reach the platform over HTTP, never across the filesystem.';

/**
 * Boundary guard (sc-011): the node is a standalone, publishable community
 * package. It must talk to the hosted `/api/v1` surface over HTTP only and must
 * never import the monolith.
 *
 * The relative half of this rule is expressed as "how far up may a file reach
 * before it is outside the package", not as a pattern matching the word `src` —
 * which is what the pre-Task-0.7 version did, and which now produces a false
 * positive on the package's own `src/constants.ts`. Depth differs per directory,
 * so there are two layers:
 *
 *   nodes/Taas/x.ts        -> package root is ../../ , so ../../../ escapes
 *   credentials/x.ts       -> package root is ../    , so ../../    escapes
 *   src/x.ts               -> package root is ../    , so ../../    escapes
 *
 * `tests/boundary.test.ts` double-checks the same property with a grep; this
 * rule is the fast feedback loop.
 */
const boundaryDeep = {
  name: 'n8n-nodes-synthaveil/boundary-nodes',
  files: ['nodes/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [...FORBIDDEN_ALIASES, { group: ['../../../*', '../../../**'], message: ESCAPE_MESSAGE }] },
    ],
  },
};

const boundaryShallow = {
  name: 'n8n-nodes-synthaveil/boundary-root-dirs',
  files: ['credentials/**/*.ts', 'src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [...FORBIDDEN_ALIASES, { group: ['../../*', '../../**'], message: ESCAPE_MESSAGE }] },
    ],
  },
};

export default [
  ...config,
  boundaryDeep,
  boundaryShallow,
  { ignores: ['dist', 'tests', 'node_modules', 'coverage', 'examples', 'scripts'] },
];
