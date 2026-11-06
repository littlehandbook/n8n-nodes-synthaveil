import { ALLOWED_BASE_URL_HOSTS, DEFAULT_BASE_URL } from './constants';

/**
 * Pure base-URL policy AND target selection, shared by every resolution path
 * (the options-bound `baseUrl` value and the `baseUrlOverride` escape hatch).
 *
 * The URL *check* was extracted here first (finding D / L14-1 follow-up) so
 * there was one implementation to enforce. Target *selection* was once
 * written twice -- a programmatic credential test and `nodes/Taas/transport.ts`
 * -- and the two copies disagreed. {@link selectBaseUrl} became the single
 * selection implementation; execution is its only caller. The credential Test
 * button is a declarative n8n expression that cannot call this module, so it
 * restates the override check as a strict subset of {@link checkBaseUrlPolicy}
 * (`src/credentialTestTarget.ts`). Change one, change the other: the subset is
 * held by `tests/credentials/TaasApi.testTargetPolicy.test.ts`.
 */

/**
 * Loopback hostnames eligible for plain-http local development. Exact names
 * only -- never 127/8 or other private ranges (council-adopted pin). WHATWG URL
 * lowercases hostnames and keeps the brackets on an IPv6 literal
 * (`new URL('http://[::1]:5678').hostname === '[::1]'`); the bare `::1` form is
 * kept as belt-and-braces.
 */
const LOOPBACK_HOSTNAMES = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Exactly a loopback name, or a `*.localhost` subdomain. */
function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.includes(hostname) || hostname.endsWith('.localhost');
}

/** Exact allow-listed host or a true subdomain of one (suffix-spoof safe). */
function isAllowedHost(hostname: string): boolean {
  return ALLOWED_BASE_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export type BaseUrlPolicyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-url' | 'https-required' | 'host-not-allowed' };

/**
 * Enforce the A1/I5 transport policy on a candidate base URL (finding D):
 * `https:` is required everywhere except plain-http to a loopback host with
 * `allowNonProduction` on; `allowNonProduction` relaxes ONLY the Synthaveil
 * host allow-list, never the https requirement.
 *
 * The loopback allowance is `http:` and nothing else (external QA round 2 of
 * PR #633). The original condition asked only "is it https, or is the host a
 * loopback name", so with the toggle on it never looked at the scheme at all:
 * `file://127.0.0.1/...`, `ftp://localhost` and `ws://localhost:5678` were
 * accepted and handed to the transport. The toggle exists to let a developer
 * reach a local n8n over plain http, not to widen the set of schemes the node
 * will speak. `wss:` is refused with the rest -- secure, but not `https:`.
 */
export function checkBaseUrlPolicy(url: string, allowNonProduction: boolean): BaseUrlPolicyResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  const isLocalDevelopmentHttp =
    parsed.protocol === 'http:' && allowNonProduction && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocalDevelopmentHttp) {
    return { ok: false, reason: 'https-required' };
  }
  if (!allowNonProduction && !isAllowedHost(parsed.hostname)) {
    return { ok: false, reason: 'host-not-allowed' };
  }
  return { ok: true };
}

/**
 * Values the credential's `baseUrl` dropdown offers. There is no staging host
 * in this product -- production is the only choice in the UI; a non-production
 * target goes through `baseUrlOverride` instead. A stored value outside this
 * list (a workflow JSON exported before the field became an options list, or
 * hand-edited) is refused rather than silently retargeted to production.
 */
const BASE_URL_OPTIONS: readonly string[] = Object.freeze([DEFAULT_BASE_URL]);

const TRAILING_SLASHES = /\/+$/;

type PolicyRefusalReason = Extract<BaseUrlPolicyResult, { ok: false }>['reason'];

/**
 * Why a credential has no usable target. The prefix names the FIELD at fault,
 * so one message table serves both callers without either re-deriving which
 * field the operator has to fix.
 */
export type BaseUrlRefusalReason =
  | `override-${PolicyRefusalReason}`
  | 'override-empty'
  | `base-url-${PolicyRefusalReason}`
  | 'base-url-not-an-option';

export type BaseUrlSelection =
  | { ok: true; url: string }
  | { ok: false; reason: BaseUrlRefusalReason };

/** The credential fields selection reads. Structural, so this module imports no n8n types. */
export type BaseUrlCredentialData = Record<string, unknown>;

/** Operator-facing text for each refusal. Never carries credential material. */
const REFUSAL_MESSAGES: Record<BaseUrlRefusalReason, string> = {
  'override-invalid-url': 'Base URL Override is not a valid URL.',
  'override-https-required':
    'Base URL Override must use https (plain-http is allowed for localhost only).',
  'override-host-not-allowed': 'Base URL Override host is not allowed.',
  'override-empty':
    '"Allow non-production URL" is on but Base URL Override is empty. Set an override, or turn ' +
    'the toggle off to use the selected production API host.',
  'base-url-invalid-url': 'Base URL is not a valid URL. Re-select the API host in the credential.',
  'base-url-https-required':
    'Base URL must use https. Plain-http is for localhost only: tick "Allow non-production URL ' +
    '(local development)" on the credential and set a loopback Base URL Override.',
  'base-url-host-not-allowed':
    'Base URL host is not an allowed host. To target a non-production host, tick "Allow ' +
    'non-production URL (local development)" on the credential and set a Base URL Override.',
  'base-url-not-an-option':
    'Base URL is not a recognised API host. Re-select the API host in the credential (or tick ' +
    '"Allow non-production URL (local development)" and set an override).',
};

/** Operator-facing message for a {@link selectBaseUrl} refusal. */
export function baseUrlRefusalMessage(reason: BaseUrlRefusalReason): string {
  return REFUSAL_MESSAGES[reason];
}

/** The `baseUrlOverride` escape hatch, under the relaxed (non-production) policy. */
function selectOverride(override: string): BaseUrlSelection {
  const url = override.replace(TRAILING_SLASHES, '');
  const policy = checkBaseUrlPolicy(url, true);
  if (!policy.ok) return { ok: false, reason: `override-${policy.reason}` };
  return { ok: true, url };
}

/**
 * The stored `baseUrl` option. Reached with the toggle off, and ALSO with the
 * toggle on but no override -- the toggle relaxes the policy for the override
 * value only, never for the stored option, so an operator who ticks the box
 * and types nothing cannot quietly widen what the dropdown is allowed to hold.
 * Its own specific refusal (bad protocol, bad host) is reported ahead of the
 * missing override, because that is the value actually on its way to the wire.
 */
function selectStoredOption(baseUrl: unknown, allowNonProduction: boolean): BaseUrlSelection {
  const url = String(baseUrl ?? '').replace(TRAILING_SLASHES, '');
  const policy = checkBaseUrlPolicy(url, false);
  if (!policy.ok) return { ok: false, reason: `base-url-${policy.reason}` };
  if (!BASE_URL_OPTIONS.includes(url)) return { ok: false, reason: 'base-url-not-an-option' };
  if (allowNonProduction) return { ok: false, reason: 'override-empty' };
  return { ok: true, url };
}

/**
 * The ONE target-selection implementation: the host this credential may talk
 * to, or why it may not talk to any. Called by execution (`transport.ts`
 * `resolveBaseUrl`); the credential Test button selects with an n8n expression
 * that never targets a host this refuses, and checks production when the
 * toggle is on but the override is empty.
 */
export function selectBaseUrl(credential: BaseUrlCredentialData): BaseUrlSelection {
  const allowNonProduction = credential.allowNonProductionUrl === true;
  const override = String(credential.baseUrlOverride ?? '').trim();
  if (allowNonProduction && override !== '') return selectOverride(override);
  return selectStoredOption(credential.baseUrl, allowNonProduction);
}
