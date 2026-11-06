import { DEFAULT_BASE_URL, REFUSED_OVERRIDE_BASE_URL } from './constants';

/**
 * The API key credential's declarative Test `baseURL` (owner decision 6 Nov
 * 2026, refining IT Council SA-C1): the key goes only to a host execution's
 * `checkBaseUrlPolicy` (`src/baseUrlPolicy.ts`, override branch) also allows.
 *
 * n8n resolves the Test request with its expression engine, which cannot call
 * our TypeScript, so the policy is restated as one regular expression. A regex
 * cannot reproduce WHATWG URL parsing, so it is built to be a strict SUBSET of
 * the policy, never wider: every value it accepts parses, passes the policy and
 * keeps the same host; some values the policy allows are refused here (userinfo,
 * IP literals other than the loopback names, `xn--` labels, underscores, ports
 * with leading zeros). `tests/credentials/TaasApi.testTargetPolicy.test.ts`
 * holds the subset property and lists every deliberate refusal.
 */

/** A DNS label: ASCII letters, digits and hyphens; never punycode, which WHATWG can reject. */
const LABEL = '(?!xn--)[a-z0-9-]+';

/**
 * The last label holds a letter and is not `0x`-hex, so WHATWG never tries to
 * parse the host as IPv4 (a failed IPv4 parse makes the whole URL invalid).
 */
const LAST_LABEL = '(?!xn--)(?!0x[0-9a-f]*(?![a-z0-9-]))[a-z0-9-]*[a-z][a-z0-9-]*';

/** A host name for https; a trailing dot is kept, as WHATWG keeps it. */
const HTTPS_HOST = `(?:${LABEL}\\.)*${LAST_LABEL}\\.?`;

/**
 * The loopback names `checkBaseUrlPolicy` lets through on plain http: exactly
 * `localhost`, `127.0.0.1` and `[::1]`, or a `*.localhost` subdomain. No trailing
 * dot: WHATWG keeps it, and the policy then refuses `localhost.`.
 */
const LOOPBACK_HOST = `(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|(?:${LABEL}\\.)+localhost)`;

/** An optional port, 0-65535, no leading zeros. */
const PORT =
  '(?::(?:0|[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5]))?';

/** Path, query or fragment; no whitespace or backslash (WHATWG reads `\` as `/`). */
const REST = '(?:[/?#][^\\s\\\\]*)?';

/** Values the Test may send the key to. Case-insensitive, as WHATWG lowercases scheme and host. */
export const TEST_OVERRIDE_ACCEPTED = new RegExp(
  `^(?:https://${HTTPS_HOST}${PORT}${REST}|http://${LOOPBACK_HOST}${PORT}${REST})$`,
  'i',
);

/** The override as execution reads it: trimmed (`selectBaseUrl`). `String()` does not resolve in n8n. */
const OVERRIDE = "($credentials.baseUrlOverride || '').trim()";

/** The override if the policy subset accepts it, otherwise the reserved `.invalid` host. */
const CHECKED_OVERRIDE = `(/${TEST_OVERRIDE_ACCEPTED.source}/i.test(${OVERRIDE}) ? ${OVERRIDE} : '${REFUSED_OVERRIDE_BASE_URL}')`;

/**
 * Toggle on and override set: the checked override. Toggle off, or toggle on
 * with an empty override: production, the host that issued the key.
 */
export const TEST_BASE_URL_EXPRESSION = `={{ $credentials.allowNonProductionUrl === true && ${OVERRIDE} ? ${CHECKED_OVERRIDE} : '${DEFAULT_BASE_URL}' }}`;
