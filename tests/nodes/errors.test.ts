import { buildApiError, extractStatusCode, mapErrorToMessage } from '../../nodes/Taas/errors';

describe('extractStatusCode', () => {
  it.each([
    [{ httpCode: 404 }, 404],
    [{ statusCode: 401 }, 401],
    [{ response: { statusCode: 403 } }, 403],
    [{ response: { status: 429 } }, 429],
  ])('reads the status from %j', (error, expected) => {
    expect(extractStatusCode(error)).toBe(expected);
  });

  it('returns undefined when no status is present', () => {
    expect(extractStatusCode(new Error('network down'))).toBeUndefined();
    expect(extractStatusCode({})).toBeUndefined();
  });
});

describe('mapErrorToMessage (C5 credential-adjacent cases)', () => {
  it('maps 404 to an API-not-enabled hint', () => {
    expect(mapErrorToMessage({ statusCode: 404 })).toMatch(/not enabled at this base url/i);
  });
  it('maps 401 to an invalid-key message', () => {
    expect(mapErrorToMessage({ statusCode: 401 })).toMatch(/invalid api key/i);
  });
  it('maps 403 to a missing-scope message naming tokenize:read', () => {
    expect(mapErrorToMessage({ statusCode: 403 })).toMatch(/tokenize:read/);
  });
  it('returns undefined for unmapped statuses (caller keeps original message)', () => {
    expect(mapErrorToMessage({ statusCode: 500 })).toBeUndefined();
    expect(mapErrorToMessage(new Error('boom'))).toBeUndefined();
  });
});

describe('buildApiError', () => {
  const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as never;

  it('returns an Error carrying the mapped message for a known status', () => {
    const err = buildApiError(node, { statusCode: 401 }, 0);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/invalid api key/i);
  });

  it('never throws while constructing (bug #14742 fallback)', () => {
    // A hostile/circular error object must not blow up error construction.
    const circular: Record<string, unknown> = { statusCode: 403 };
    circular.self = circular;
    expect(() => buildApiError(node, circular, 1)).not.toThrow();
  });

  it('a cyclic 403 error still maps to the missing-scope message (finding E pin)', () => {
    // Companion to the cycle-safety pin above: cycle handling must not cost the
    // mapped message. Today the cycle only drops the second visit (`self`), so
    // the top-level statusCode survives and 403 maps to STATUS_MESSAGES[403]
    // ('API key valid but missing tokenize:read scope.'). The memoizing-scrubber
    // fix (cyclic copy) must keep this exact behaviour.
    const circular: Record<string, unknown> = { statusCode: 403 };
    circular.self = circular;
    const err = buildApiError(node, circular, 1);
    expect(err.message).toMatch(/tokenize:read/);
  });
});
