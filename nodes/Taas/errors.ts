import {
  NodeApiError,
  NodeOperationError,
  type INode,
  type INodeExecutionData,
  type JsonObject,
} from 'n8n-workflow';

import { COMMERCIAL_DPA_PATH, HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from '../../src/constants';
import {
  extractResponseBody,
  extractRetryAfterSeconds,
  extractStatusCode,
  toSeconds,
} from './errorIntrospection';
import { scrubCredentialMaterial } from './errorScrubbing';
import { mapLegacyErrorCodeToMessage } from './legacyMessages';

/**
 * Error mapping for the TAAS node.
 *
 * The hosted API emits TWO error shapes (documented in `docs/api/openapi.yaml`):
 *   - `application/problem+json` (RFC 7807) with a machine `code` — auth/gating
 *     errors from `api-auth.ts` (unauthorized, insufficient_scope, dpa_required,
 *     plan_required, plan_has_no_api_access, quota_exceeded, rate_limit_exceeded,
 *     not_found, service_unavailable).
 *   - legacy `{ error, message? }` — route/L3-gate errors (l3_unavailable,
 *     invalid_text, geo_*) and body-validation messages.
 *
 * This module turns either shape into a single operator-facing message. When no
 * body is present it falls back to a per-HTTP-status message (the credential-test
 * cases, C5). A missing/unmapped status yields `undefined` so the caller keeps
 * the original error text.
 */

const HTTP_NOT_FOUND = 404;

/** HTTP status → operator-facing message (C5 credential-adjacent fallback). */
const STATUS_MESSAGES: Record<number, string> = {
  [HTTP_UNAUTHORIZED]: 'Invalid API key.',
  [HTTP_FORBIDDEN]: 'API key valid but missing tokenize:read scope.',
  [HTTP_NOT_FOUND]: 'TAAS API not enabled at this base URL (check Base URL / API availability).',
};

// Error introspection (status, body, retry hint) lives in errorIntrospection.ts.
export { extractResponseBody, extractRetryAfterSeconds, extractStatusCode };

// ---------------------------------------------------------------------------
// Message tables — one entry per taxonomy code (docs/api/openapi.yaml).
// ---------------------------------------------------------------------------

/** Portal URL an operator visits to sign the DPA (council P3). */
function portalDpaUrl(baseUrl?: string): string {
  return baseUrl
    ? `${baseUrl}${COMMERCIAL_DPA_PATH}`
    : `the commercial portal (${COMMERCIAL_DPA_PATH})`;
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

/** problem+json `code` → message. Some read the body (`upgrade_url`, `retry_after`). */
const PROBLEM_MESSAGES: Record<
  string,
  (body: Record<string, unknown>, baseUrl?: string) => string
> = {
  not_found: () => STATUS_MESSAGES[HTTP_NOT_FOUND],
  unauthorized: () => STATUS_MESSAGES[HTTP_UNAUTHORIZED],
  service_unavailable: () =>
    'The TAAS service is temporarily unavailable. Please try again shortly.',
  insufficient_scope: () =>
    'API key is missing a required scope. Re-issue it in the portal with tokenize:read and tokenize:write, plus restore for the Restore operation.',
  dpa_required: (_body, baseUrl) =>
    `Your organisation must sign the Data Processing Agreement before tokenising. Sign your DPA in the portal: ${portalDpaUrl(baseUrl)}`,
  plan_required: (body) => {
    const upgradeUrl = stringField(body, 'upgrade_url');
    return `Your organisation has no active plan, so its API keys are paused. They work again as soon as a plan is active.${upgradeUrl ? ` Choose a plan: ${upgradeUrl}` : ' Choose a plan in the portal.'}`;
  },
  plan_has_no_api_access: () =>
    'Your plan does not include API keys. Move to a plan that includes them in the portal.',
  quota_exceeded: (body) => {
    const upgradeUrl = stringField(body, 'upgrade_url');
    return `Monthly quota exceeded.${upgradeUrl ? ` Upgrade your plan: ${upgradeUrl}` : ' Upgrade your plan in the portal.'}`;
  },
  rate_limit_exceeded: (body) => {
    const seconds = toSeconds(body.retry_after);
    const hint = seconds === undefined ? '' : ` Retry after ${seconds}s.`;
    return `Rate limit exceeded.${hint} Enable "Retry On Rate Limit" to retry automatically.`;
  },
  // #619 Idempotency-Key answers (IT Council C2/C7; wording goes to the owner).
  // Reaches the user only after the transport's one bounded resend also got a 409.
  idempotency_conflict: () =>
    'Synthaveil is still finishing an earlier try of this request, so this try was not billed. Running the workflow again starts a new run, which is billed.',
  idempotency_key_reused: () =>
    'The safe-retry key was reused for different data. Nothing was billed for this call. Please report this to Synthaveil support.',
  settlement_mismatch: () =>
    'Synthaveil matched this request to an earlier, different one and stopped it. Nothing was billed for this call. Please report this to Synthaveil support.',
};

/** True when `s` looks like a machine code (snake_case token), not a sentence. */
function isMachineCode(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(s);
}

export { mapLegacyErrorCodeToMessage };

/**
 * Map an error to a friendly operator message, or `undefined` when nothing
 * specialises it (the caller then keeps the original message).
 *
 * @param baseUrl - credential base URL, used to build the DPA portal link.
 */
export function mapErrorToMessage(error: unknown, baseUrl?: string): string | undefined {
  const body = extractResponseBody(error);
  if (body) {
    const code = stringField(body, 'code');
    if (code && PROBLEM_MESSAGES[code]) return PROBLEM_MESSAGES[code](body, baseUrl);

    const legacy = stringField(body, 'error');
    if (legacy) {
      const mapped = mapLegacyErrorCodeToMessage(legacy);
      if (mapped) return mapped;
      // A legacy `error` that is a human validation message (400/422) — surface
      // it verbatim. An unmapped machine code is not shown (falls to status).
      const message = stringField(body, 'message');
      if (message) return message;
      if (!isMachineCode(legacy)) return legacy;
    }
  }

  const status = extractStatusCode(error);
  return status === undefined ? undefined : STATUS_MESSAGES[status];
}

function isN8nError(error: unknown): error is NodeOperationError | NodeApiError {
  return error instanceof NodeOperationError || error instanceof NodeApiError;
}

/**
 * A real transport failure arrives already wrapped as a NodeApiError (body on
 * `context.data`) carrying n8n's generic text. Put our mapped operator copy on
 * it (#619); an unmapped error keeps n8n's text.
 */
function withMappedMessage(error: NodeApiError, baseUrl?: string): NodeApiError {
  const mapped = mapErrorToMessage(error, baseUrl);
  if (mapped === undefined) return error;
  error.message = mapped;
  // n8n renders `description ?? message`: n8n's own description (the raw body
  // title/detail) would otherwise hide the mapped copy, so it is cleared.
  error.description = undefined;
  return error;
}

function safeScrub(error: unknown): unknown {
  try {
    return scrubCredentialMaterial(error);
  } catch {
    return undefined;
  }
}

function fallbackApiError(scrubbed: unknown, message: string | undefined): Error {
  const hasMessage = typeof scrubbed === 'object' && scrubbed !== null && 'message' in scrubbed;
  const original = hasMessage ? String((scrubbed as { message?: unknown }).message ?? '') : undefined;
  return new Error(message ?? (original || 'TAAS API request failed.'));
}

/**
 * Builds a `NodeApiError` carrying the mapped message, falling back to a plain
 * `Error` if `NodeApiError` construction throws — n8n bug #14742, where certain
 * error payloads break the constructor. Keeps the node from crashing the run.
 *
 * The raw error is scrubbed of credential material first (A1/I5): the wrapped
 * error's message, own props, and cause chain must never carry the key.
 *
 * An error that is ALREADY a proper n8n error is never re-wrapped: a
 * `NodeOperationError` from the request builder is returned unchanged, and a
 * `NodeApiError` (how n8n's HTTP helper really fails) gets our mapped message
 * when its code has one (#619), else keeps n8n's own.
 */
export function buildApiError(
  node: INode,
  error: unknown,
  itemIndex: number,
  baseUrl?: string,
): Error {
  if (error instanceof NodeApiError) return withMappedMessage(error, baseUrl);
  if (isN8nError(error)) return error;
  // Guarded: a hostile error object with a throwing getter must degrade to the
  // generic message, never escape buildApiError (same net as the wrap below).
  const scrubbed = safeScrub(error);
  const message = mapErrorToMessage(scrubbed, baseUrl);
  try {
    return new NodeApiError(node, scrubbed as JsonObject, { message, itemIndex });
  } catch {
    return fallbackApiError(scrubbed, message);
  }
}

/**
 * Aggregate a batch's per-record `{ error }` slots (a 200 response, not a thrown
 * transport error) into one `NodeApiError` that names the failed item indices.
 * Used when `continueOnFail` is off, so a single bad record aborts the run with
 * an actionable message. Falls back to a plain `Error` (n8n bug #14742).
 */
export function buildBatchError(
  node: INode,
  failedIndices: number[],
  messages: string[],
  itemIndex: number,
): Error {
  const firstError = messages[0] ?? 'record error';
  const message =
    `Batch tokenisation failed for ${failedIndices.length} record(s) ` +
    `(items: ${failedIndices.join(', ')}). First error: ${firstError}`;
  try {
    return new NodeApiError(node, { message } as unknown as JsonObject, { message, itemIndex });
  } catch {
    return new Error(message);
  }
}

/** Continue-On-Fail error row for one item in the single-item execute loop. */
export function perItemErrorRow(
  error: unknown,
  itemIndex: number,
  baseUrl: string,
): INodeExecutionData {
  const message =
    mapErrorToMessage(error, baseUrl) ?? (error as Error)?.message ?? 'Request failed';
  // Continue On Fail puts this string into the item, so it travels to the next
  // node and into the execution log. The unmapped branch above is the raw
  // transport message, which routinely embeds the request's Authorization
  // header (QA review of PR #523, finding 8). The throwing path already
  // scrubbed; this one did not.
  const scrubbed = scrubCredentialMaterial(message);
  return {
    json: { error: typeof scrubbed === 'string' ? scrubbed : message },
    pairedItem: { item: itemIndex },
  };
}
