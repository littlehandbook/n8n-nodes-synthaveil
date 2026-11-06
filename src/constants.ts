import type { IAuthenticateRuleResponseCode } from 'n8n-workflow';

/**
 * Package-wide constants for the Synthaveil (TAAS) n8n node.
 *
 * Endpoint paths mirror the hosted contract in `docs/api/openapi.yaml`
 * (the source of truth). Kept here as named constants so no route string is
 * hand-typed at a call site.
 */

/** Base path for all hosted v1 endpoints. */
export const API_V1 = '/api/v1';

/** GET usage/quota snapshot — the credential-test target and Get Usage op. */
export const USAGE_PATH = `${API_V1}/usage`;

/**
 * GET public health probe — the Map Key credential's Test target. Called with
 * NO Authorization header, so nothing from that credential is ever sent.
 */
export const HEALTH_PATH = `${API_V1}/health`;

/** POST single-record tokenise. */
export const TOKENIZE_PATH = `${API_V1}/tokenize`;

/** POST multi-record tokenise (one policy/country/scope per request). */
export const BATCH_PATH = `${API_V1}/tokenize/batch`;

/** POST free-text personal-data scan (read-only span detection). */
export const DETECT_PATH = `${API_V1}/detect`;

/**
 * Max characters accepted by `POST /api/v1/detect`. Pins
 * `docs/api/openapi.yaml` `DetectRequest.text.maxLength`; used to pre-empt a 400
 * `invalid_text` client-side.
 */
export const V1_DETECT_MAX_CHARS = 100000;

/**
 * Max records per batch request. Pins `docs/api/openapi.yaml`
 * `x-taas-batch-caps.records` (= `V1_BATCH_MAX_RECORDS` server-side); used to
 * chunk input client-side and pre-empt a 422.
 */
export const V1_BATCH_MAX_RECORDS = 100;

/**
 * Max records per batch request when any field uses an `l3.*` method. Pins
 * `docs/api/openapi.yaml` `x-taas-batch-caps.l3Records` (= `L3_BATCH_MAX_RECORDS`
 * server-side) — L3 synthesis is heavier, so the batch is capped lower.
 */
export const L3_BATCH_MAX_RECORDS = 50;

/**
 * Max fields per record. Pins `docs/api/openapi.yaml`
 * `TokenizeRequest.record.maxProperties`; used to pre-empt a 422 client-side.
 */
export const MAX_RECORD_FIELDS = 200;

/**
 * Portal path an operator visits to sign the Data Processing Agreement. Appended
 * to the credential base URL in the `dpa_required` error message (council P3).
 */
export const COMMERCIAL_DPA_PATH = '/commercial/dpa';

/**
 * Default credential base URL. Production, sequenced by the founder at FG-2
 * (plan Task 0.3 / D-RM-8): a published community node has to point at a host a
 * new user can actually reach, and a staging default dead-ends both them and the
 * n8n verification reviewer. `ALLOWED_BASE_URL_HOSTS` is unchanged — staging
 * remains reachable as a subdomain of the same allow-listed root.
 *
 * `api.synthaveil.com` (attached 2026-09-02): the apex serves the marketing
 * site, which answers `/api/v1/*` with an HTML 200 — a silent dead end for a
 * fresh install. The API host is a true subdomain of the allow-listed root.
 */
export const DEFAULT_BASE_URL = 'https://api.synthaveil.com';

/**
 * Where the API key credential's Test button goes when the operator turned the
 * override on but its value fails the base-URL policy. `.invalid` is reserved by
 * RFC 6761 and never resolves, so the Test fails locally and the key reaches
 * neither the refused override nor production.
 */
export const REFUSED_OVERRIDE_BASE_URL = 'https://override-refused.invalid';

/**
 * Host allow-list roots for the credential base URL (A1/I5). For each entry the
 * exact host or any true subdomain is accepted; anything else needs the explicit
 * "Allow non-production URL (local development)" credential toggle — which
 * relaxes ONLY this host check, never the https requirement (finding D).
 * FG-2 seam — add a second apex here if one is ever launched.
 */
export const ALLOWED_BASE_URL_HOSTS = Object.freeze(['synthaveil.com'] as const);

/** n8n credential type name referenced by the node and by `httpRequestWithAuthentication`. */
export const CREDENTIAL_NAME = 'taasApi';

/**
 * n8n credential type name for the Local-restore Map Key (P3). Never sent to
 * the hosted API — used only to seal/open maps client-side (`sealedMap.ts`).
 */
export const MAP_KEY_CREDENTIAL_NAME = 'synthaveilMapKeyApi';

/** HTTP 401 — the credential Test rule for a key the API does not accept. */
export const HTTP_UNAUTHORIZED = 401;

/** HTTP 403 — the credential Test rule for a key without `tokenize:read`. */
export const HTTP_FORBIDDEN = 403;

/**
 * Every redirect status a credential Test request can meet. Both credential
 * tests set `disableFollowRedirect`, so each of these ends the Test with
 * {@link REDIRECT_REFUSED_MESSAGE} instead of following the redirect.
 */
export const HTTP_REDIRECT_STATUSES = Object.freeze([301, 302, 303, 307, 308] as const);

/** Shown when the API answers a credential Test with a redirect. */
export const REDIRECT_REFUSED_MESSAGE =
  'The API answered with a redirect; nothing was sent onward. Check that this n8n can reach api.synthaveil.com directly.';

/** One `responseCode` Test rule per redirect status, shared by both credentials. */
export const REDIRECT_REFUSED_RULES: IAuthenticateRuleResponseCode[] = HTTP_REDIRECT_STATUSES.map(
  (value) => ({
    type: 'responseCode',
    properties: { value, message: REDIRECT_REFUSED_MESSAGE },
  }),
);

/** PUT the sealed map / POST consume it (Local restore, P3). */
export const MAPS_PATH = `${API_V1}/maps`;

/** `consistency` value sent on a sealed map PUT under Consistency: Stable. */
export const MAP_CONSISTENCY = 'stable';

/**
 * `consistency` value sent on a sealed map PUT under Consistency: Every run
 * (branch review finding 7, 2026-08-31) — mirrors migration 0204's
 * `CHECK (consistency IN ('stable','every_run'))`.
 */
export const MAP_CONSISTENCY_EVERY_RUN = 'every_run';
