/** Credential redaction for heterogeneous errors thrown by n8n transports. */

// `idempotency-key` (#619): the key is a hash of record values, so it is kept
// out of error rows and logs like the credential headers are.
const SENSITIVE_KEYS = /^(authorization|proxy-authorization|x-api-key|api[-_]?key|idempotency-key)$/i;
const BEARER_TOKEN = /bearer\s+[\w~+/.=-]+/gi;
/** A raw `Idempotency-Key: <value>` header line (a request's `_header` string) or its JSON-style
 *  text form (`"idempotency-key":"<value>"`, `idempotency-key=<value>`) (#619). */
const IDEMPOTENCY_KEY_LINE = /idempotency-key["']?\s*[:=]\s*["']?[^\s"',}]+/gi;
const REDACTED = '[redacted]';

function scrubArray(value: unknown[], memo: Map<object, unknown>): unknown[] {
  const copy: unknown[] = [];
  memo.set(value, copy);
  for (const entry of value) copy.push(scrubCredentialMaterial(entry, memo));
  return copy;
}

function scrubObject(value: object, memo: Map<object, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  memo.set(value, copy);
  for (const key of Object.getOwnPropertyNames(value)) {
    const raw = (value as Record<string, unknown>)[key];
    copy[key] = SENSITIVE_KEYS.test(key) ? REDACTED : scrubCredentialMaterial(raw, memo);
  }
  return copy;
}

/**
 * Deep-copy an error while preserving shared references and cycles. Objects are
 * memoized before recursion, so every alias resolves to the same scrubbed copy.
 */
export function scrubCredentialMaterial(
  value: unknown,
  memo = new Map<object, unknown>(),
): unknown {
  if (typeof value === 'string') {
    return value.replace(BEARER_TOKEN, REDACTED).replace(IDEMPOTENCY_KEY_LINE, `Idempotency-Key: ${REDACTED}`);
  }
  if (typeof value !== 'object' || value === null) return value;
  const existing = memo.get(value);
  if (existing !== undefined) return existing;
  return Array.isArray(value) ? scrubArray(value, memo) : scrubObject(value, memo);
}
