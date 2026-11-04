/**
 * The tokenisation methods offered in the node UI.
 *
 * `value` strings are checked-in copies of the engine's registered method keys
 * (`@taas/engine` `REGISTERED_L1/L2/L3_METHODS`), surfaced to the operator via
 * `docs/api/openapi.yaml`'s `PolicyMethod` enum -- the contract SSOT. The
 * pinning test is `tests/api/openapi-parity.n8n-mirror.test.ts` IN THE
 * MONOREPO: the spec is not available beside the published mirror, exactly as
 * described for {@link HOSTED_REJECTED} below, so the package's own suite can
 * no longer hold this assertion. It asserts these values equal that enum
 * exactly, so a method added/removed in the engine fails the build until the
 * catalog is updated. `name`/`description` are the plain-English labels shown in
 * the dropdown (council P4): the operator never sees a raw `l2.synthesize-*` key.
 *
 * `l1.token-stateful` and `l0.remove` are registered by the engine but REJECTED
 * on the hosted surface (`x-taas-hosted-rejected`), so they are intentionally
 * absent here — see {@link HOSTED_REJECTED}.
 */

/** One selectable method: the engine key plus its operator-facing labels. */
export interface TaasMethodOption {
  /** Engine method key sent to the API (must match the openapi PolicyMethod enum). */
  value: string;
  /** Short plain-English dropdown label. */
  name: string;
  /** One-line explanation of what the method does. */
  description: string;
}

/**
 * Methods the engine registers but the hosted API rejects — never offered in the
 * catalog. Mirrors `docs/api/openapi.yaml` `x-taas-hosted-rejected.methods`.
 *
 * This package is published from a one-way mirror repo, so `openapi.yaml` is not
 * available beside it and the local tests can only check this list against
 * itself. The real parity assertion lives in the monorepo, at
 * `tests/api/openapi-parity.n8n-mirror.test.ts` — that is what fails when the
 * hosted surface starts refusing another method. Do not "simplify" it away by
 * adding a local test: a mirror cannot verify itself.
 */
export const HOSTED_REJECTED: readonly string[] = ['l1.token-stateful', 'l0.remove'];

/**
 * Method keys staging accepts but production does not yet, so they are kept out
 * of {@link TAAS_METHODS} on main. Plain strings, not catalog entries: the
 * monorepo parity test reads every `value:` literal in this file as offered.
 */
export const HIDDEN_UNTIL_PRODUCTION: readonly string[] = ['l2.synthesize-locality'];

/** All 22 methods the production hosted API accepts, grouped L1 → L2 → L3, in enum order. */
export const TAAS_METHODS: readonly TaasMethodOption[] = [
  // --- L1: deterministic, format-agnostic tokenisation ---
  {
    value: 'l1.token-stateless',
    name: 'L1 — Redact (Stateless Token)',
    description: 'Replaces the value with an opaque deterministic token',
  },
  {
    value: 'l1.pseudonym',
    name: 'L1 — Pseudonym',
    description: 'Replaces the value with a consistent stand-in (same input gives the same pseudonym)',
  },
  {
    value: 'l1.keyed-hash',
    name: 'L1 — Keyed Hash',
    description: 'Replaces the value with a keyed one-way hash — irreversible but matchable across records',
  },

  // --- L2: format-preserving synthetic values ---
  {
    value: 'l2.synthesize-name',
    name: 'L2 — Synthetic Name',
    description: 'Realistic locale-aware replacement name; format preserved',
  },
  {
    value: 'l2.synthesize-email',
    name: 'L2 — Synthetic Email',
    description: 'Realistic replacement email address',
  },
  {
    value: 'l2.synthesize-phone',
    name: 'L2 — Synthetic Phone Number',
    description: 'Realistic replacement phone number; format preserved',
  },
  {
    value: 'l2.synthesize-address',
    name: 'L2 — Synthetic Address',
    description: 'Realistic replacement street address',
  },
  {
    value: 'l2.synthesize-postcode',
    name: 'L2 — Synthetic Postcode',
    description: 'Realistic replacement postal/zip code; format preserved',
  },
  {
    value: 'l2.synthesize-dob',
    name: 'L2 — Synthetic Date of Birth',
    description: 'Realistic replacement date of birth (optionally age-banded)',
  },
  {
    value: 'l2.synthesize-company-name',
    name: 'L2 — Synthetic Company Name',
    description: 'Realistic replacement company name',
  },
  {
    value: 'l2.synthesize-crn',
    name: 'L2 — Synthetic Company Number',
    description: 'Realistic replacement company registration number; format preserved',
  },
  {
    value: 'l2.synthesize-vat',
    name: 'L2 — Synthetic VAT Number',
    description: 'Realistic replacement VAT registration number; format preserved',
  },
  {
    value: 'l2.synthesize-sic',
    name: 'L2 — Synthetic SIC Code',
    description: 'Realistic replacement Standard Industrial Classification code',
  },
  {
    value: 'l2.synthesize-lei',
    name: 'L2 — Synthetic LEI',
    description: 'Realistic replacement Legal Entity Identifier; format preserved',
  },
  {
    value: 'l2.synthesize-iban',
    name: 'L2 — Synthetic IBAN',
    description: 'Realistic replacement bank account number (IBAN); format preserved',
  },
  {
    value: 'l2.synthesize-payment-card-pan',
    name: 'L2 — Synthetic Card Number',
    description: 'Realistic replacement payment card number that passes format checks',
  },
  {
    value: 'l2.synthesize-national-id',
    name: 'L2 — Synthetic National ID',
    description: 'Realistic replacement national identification number; format preserved',
  },
  // `l2.synthesize-locality` ("L2 — Synthetic Town", #902) is deliberately NOT
  // offered on main: production's /api/v1 does not accept it yet (the endpoint
  // ships on staging only). See HIDDEN_UNTIL_PRODUCTION above; to re-enable,
  // copy the entry back from origin/staging's catalog once production serves it.

  // --- L3: statistically realistic, population-data-backed values ---
  {
    value: 'l3.personal-name-first',
    name: 'L3 — Realistic First Name',
    description: 'Statistically realistic first name drawn from population data',
  },
  {
    value: 'l3.personal-name-surname',
    name: 'L3 — Realistic Surname',
    description: 'Statistically realistic surname drawn from population data',
  },
  {
    value: 'l3.personal-name-full',
    name: 'L3 — Realistic Full Name',
    description: 'Statistically realistic full name drawn from population data',
  },
  {
    value: 'l3.personal-geo',
    name: 'L3 — Realistic Location',
    description: 'Replaces a location with a nearby realistic one that preserves area characteristics',
  },
  {
    value: 'l3.company',
    name: 'L3 — Realistic Company',
    description: 'Statistically realistic company drawn from real company data',
  },
];

/** The set of catalog method values, for membership checks. */
export const TAAS_METHOD_VALUES: ReadonlySet<string> = new Set(
  TAAS_METHODS.map((m) => m.value),
);

/** Dropdown options for the per-field method picker in `Taas.node.ts`. */
export const METHOD_OPTIONS: Array<{ name: string; value: string; description: string }> =
  TAAS_METHODS.map((m) => ({ name: m.name, value: m.value, description: m.description }));
