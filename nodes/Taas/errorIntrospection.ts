/**
 * Error introspection for the TAAS node: n8n's HTTP helper throws heterogeneous
 * error shapes. A bare transport error carries `response`. The real
 * `httpRequestWithAuthentication` failure is a NodeApiError wrapping the
 * AxiosError: the status is on `httpCode` and the parsed JSON body on
 * `context.data`, while the AxiosError itself (and so the response headers) is
 * dropped — n8n-workflow's ExecutionBaseError keeps `cause` only for non-Error
 * causes (#619 quality review). All of these shapes are read here.
 */

/** The parts of a failed HTTP response the node reads. */
interface FailedResponse {
  body?: unknown;
  data?: unknown;
  headers?: Record<string, unknown>;
}

/** Reads an HTTP status code from the various shapes n8n's HTTP helper throws. */
export function extractStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as {
    httpCode?: unknown;
    statusCode?: unknown;
    status?: unknown;
    response?: { statusCode?: unknown; status?: unknown };
  };
  const candidates = [
    e.httpCode,
    e.statusCode,
    e.status,
    e.response?.statusCode,
    e.response?.status,
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Parse a JSON string, returning undefined on failure. */
function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Pulls the response body (problem+json or legacy) from the thrown error. */
function parseResponseBody(candidate: unknown): Record<string, unknown> | undefined {
  if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
  return typeof candidate === 'string' ? tryParseJson(candidate) : undefined;
}

/**
 * The failed response: on the error itself, on an error `cause`, or — for a
 * NodeApiError wrapping an AxiosError — only its body, kept on `context.data`.
 */
function responseOf(error: object): FailedResponse | undefined {
  const e = error as { response?: FailedResponse; cause?: { response?: FailedResponse }; context?: { data?: unknown } };
  return e.response ?? e.cause?.response ?? (e.context?.data !== undefined ? { data: e.context.data } : undefined);
}

export function extractResponseBody(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = responseOf(error);
  for (const candidate of [response?.body, response?.data, (error as { body?: unknown }).body]) {
    const parsed = parseResponseBody(candidate);
    if (parsed) return parsed;
  }
  return undefined;
}

/** Case-insensitive header lookup from the thrown error's response. */
function lookupHeader(error: unknown, name: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  const headers = responseOf(error)?.headers;
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

/** Coerce a header/body value to a non-negative integer number of seconds. */
export function toSeconds(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * The retry hint for a 429/503: the `Retry-After` header (503 l3_unavailable) or
 * the `retry_after` body extension (429 rate_limit_exceeded), in seconds.
 */
export function extractRetryAfterSeconds(error: unknown): number | undefined {
  const fromHeader = toSeconds(lookupHeader(error, 'retry-after'));
  if (fromHeader !== undefined) return fromHeader;
  return toSeconds(extractResponseBody(error)?.retry_after);
}
