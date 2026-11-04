import { NodeOperationError, sleep } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';

import { BATCH_PATH, CREDENTIAL_NAME, TOKENIZE_PATH } from '../../src/constants';
import { baseUrlRefusalMessage, selectBaseUrl } from '../../src/baseUrlPolicy';
import { extractResponseBody, extractRetryAfterSeconds, extractStatusCode } from './errors';

/**
 * Central transport for every TAAS API call. Wraps
 * `httpRequestWithAuthentication` (n8n injects the bearer credential) so no op
 * hand-rolls the request shape, and adds the single 429 retry and (#619) the
 * single 409 `idempotency_conflict` resend.
 */

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_CONFLICT = 409;
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
/** 409 code: our keyed request is still being worked on server-side. */
const IDEMPOTENCY_CONFLICT_CODE = 'idempotency_conflict';
/**
 * The only endpoints that accept the key (openapi `IdempotencyKey`). An
 * allow-list here, so no future caller can put a key on /detect, /maps or
 * /usage by passing one.
 */
const KEYED_PATHS: ReadonlySet<string> = new Set([TOKENIZE_PATH, BATCH_PATH]);
const MS_PER_SECOND = 1000;
/** Wait when a 429 carries no retry hint. */
const DEFAULT_RETRY_AFTER_SECONDS = 1;
/** Clamp a (possibly hostile) retry hint so it can't hang the worker. */
const MAX_RETRY_AFTER_SECONDS = 60;

export interface TaasRequestOptions {
  /** Credential base URL (trailing slash already stripped by resolveBaseUrl). */
  baseUrl: string;
  method: IHttpRequestMethods;
  /** Path under the base URL, e.g. `/api/v1/tokenize`. */
  path: string;
  /** JSON request body (omitted for GETs). */
  body?: IDataObject;
  /**
   * Retry once on a 429, honouring the Retry-After / retry_after hint. Default
   * true — a 429 is not billed, so a single retry is safe (RAID-010).
   */
  retryOnRateLimit?: boolean;
  /**
   * #619: the `Idempotency-Key` for this request (see idempotencyKey.ts). Sent
   * only on Tokenize and Tokenize (Batch); dropped on every other path. Every
   * resend (429 retry, 409 conflict resend) carries the same key and body.
   */
  idempotencyKey?: string;
}

/**
 * Read the credential and resolve the A1/I5-safe base URL — every operation
 * and the batch path flow through here.
 *
 * Selection itself lives in {@link selectBaseUrl} (`src/baseUrlPolicy.ts`),
 * which the credential Test button calls too: one implementation, so the Test
 * button cannot report success for a credential this function refuses. The
 * rules it applies: the "Allow non-production URL" toggle relaxes the host
 * allow-list for a NON-EMPTY `baseUrlOverride` only; the stored `baseUrl` is
 * always judged against the production policy and the options list, so a
 * value that drifted from the dropdown (a workflow JSON exported before the
 * field became an options list, or hand-edited) is refused rather than
 * silently falling back to production; and the toggle on with no override is
 * refused outright rather than quietly resolving to the stored host.
 */
export async function resolveBaseUrl(ctx: IExecuteFunctions): Promise<string> {
  const credentials = await ctx.getCredentials(CREDENTIAL_NAME);
  const selection = selectBaseUrl(credentials);
  if (!selection.ok) {
    // Messages never carry credential material (see REFUSAL_MESSAGES).
    throw new NodeOperationError(ctx.getNode(), baseUrlRefusalMessage(selection.reason));
  }
  return selection.url;
}

/** Delay before a 429 retry: the server hint (clamped) or the default. */
function retryDelayMs(error: unknown): number {
  const seconds = extractRetryAfterSeconds(error) ?? DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * MS_PER_SECOND;
}

/** True for a 409 `idempotency_conflict` — the same key is still in flight. */
function isIdempotencyConflict(error: unknown): boolean {
  return extractStatusCode(error) === HTTP_CONFLICT && extractResponseBody(error)?.code === IDEMPOTENCY_CONFLICT_CODE;
}

/**
 * Delay before the 409 conflict resend: the server hint clamped to
 * MAX_RETRY_AFTER_SECONDS, and never under the default, so a zero hint cannot
 * resend straight into the same in-flight claim.
 */
function conflictDelayMs(error: unknown): number {
  const seconds = extractRetryAfterSeconds(error) ?? DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(Math.max(seconds, DEFAULT_RETRY_AFTER_SECONDS), MAX_RETRY_AFTER_SECONDS) * MS_PER_SECOND;
}

/** The request headers: the key, only on a keyed path and only when one was given. */
function keyHeaders(path: string, idempotencyKey: string | undefined): Record<string, string> | undefined {
  if (idempotencyKey === undefined || !KEYED_PATHS.has(path)) return undefined;
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey };
}

/**
 * Perform an authenticated TAAS request. Returns the parsed JSON body. Throws
 * the raw transport error unchanged — the caller maps it via
 * {@link buildApiError} / {@link mapErrorToMessage} (they need per-item context).
 */
export async function taasRequest(
  ctx: IExecuteFunctions,
  options: TaasRequestOptions,
): Promise<IDataObject> {
  const { baseUrl, method, path, body, retryOnRateLimit = true } = options;
  const headers = keyHeaders(path, options.idempotencyKey);
  const requestOptions = {
    method,
    baseURL: baseUrl,
    url: path,
    json: true,
    ...(body !== undefined ? { body } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };

  const send = (): Promise<IDataObject> =>
    ctx.helpers.httpRequestWithAuthentication.call(
      ctx,
      CREDENTIAL_NAME,
      requestOptions,
    ) as Promise<IDataObject>;

  // #619: at most ONE 429 retry and ONE 409-conflict resend, in either order
  // (409→429 and 429→409 each still get their single retry), always with the
  // same key and body. Anything else, or a second of the same kind, propagates.
  const used = { rateLimit: false, conflict: false };
  for (;;) {
    try {
      return await send();
    } catch (error) {
      const delayMs = nextRetryDelayMs(error, used, { retryOnRateLimit, keyed: headers !== undefined });
      // Propagate the raw transport error; the calling op wraps it in a
      // NodeApiError (buildApiError) with per-item context and the mapped message.
      // eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- see above
      if (delayMs === undefined) throw error;
      await sleep(delayMs);
    }
  }
}

/**
 * The wait before the one allowed retry of this kind, marking it used, or
 * undefined when the error gets no (further) retry. A 409 `idempotency_conflict`
 * is resent only on a keyed request (#619 C2); `settlement_mismatch` never is.
 */
function nextRetryDelayMs(
  error: unknown,
  used: { rateLimit: boolean; conflict: boolean },
  allow: { retryOnRateLimit: boolean; keyed: boolean },
): number | undefined {
  if (allow.retryOnRateLimit && !used.rateLimit && extractStatusCode(error) === HTTP_TOO_MANY_REQUESTS) {
    used.rateLimit = true;
    return retryDelayMs(error);
  }
  if (allow.keyed && !used.conflict && isIdempotencyConflict(error)) {
    used.conflict = true;
    return conflictDelayMs(error);
  }
  return undefined;
}
