/**
 * Legacy `{ error }` machine codes and their operator-facing copy.
 *
 * Split out of errors.ts so that table can grow with the API surface without
 * pushing that module past the 300-line limit.
 */

/** legacy `{ error }` machine code → message (docs/api/openapi.yaml x-taas-legacy-error-codes). */
const LEGACY_MESSAGES: Record<string, string> = {
  invalid_text: 'The text to scan is missing, empty, or longer than 100,000 characters.',
  l3_unavailable:
    'L3 (realistic-data) methods are not enabled for your tenant right now. Try again later, or choose an L1/L2 method.',
  geo_unresolvable_input:
    'The location value could not be resolved for L3 geo synthesis. Check the address/postcode field.',
  geo_privacy_floor_refusal:
    'The L3 location request was refused to protect privacy (too few nearby areas to choose from).',
  company_entity_key_missing:
    'L3 company synthesis requires a usable company registration identifier. Add a company number/CRN field and retry.',
  side_effects_failed:
    'Tokenisation completed but a follow-up write failed. Retry, or contact support with the request ID.',
  usage_write_failed:
    'Tokenisation completed but the usage counter update failed. Retry, or contact support with the request ID.',
  locale_required:
    'Your policy does not say which country the data is from, and we never pick one for you — an unchosen country would silently give everyone in the file British names. Set `policy.locale` (for example `en-GB`), or ask an admin to choose the country under "Where your data is from" in settings.',
};

/** Map a legacy machine code, including a per-record batch slot, to friendly copy. */
export function mapLegacyErrorCodeToMessage(code: string): string | undefined {
  return LEGACY_MESSAGES[code];
}
