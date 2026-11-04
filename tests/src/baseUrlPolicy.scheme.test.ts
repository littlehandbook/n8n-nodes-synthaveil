import { checkBaseUrlPolicy, selectBaseUrl } from '../../src/baseUrlPolicy';
import { DEFAULT_BASE_URL } from '../../src/constants';

/**
 * The loopback allowance relaxes the https requirement for `http:` ONLY
 * (external QA round 2 of PR #633, finding P2).
 *
 * The original condition was "not https AND not (allowNonProduction AND
 * loopback host)", which asks nothing at all about the scheme once the host is
 * a loopback name. So with the credential's "Allow non-production URL" toggle
 * on, `file://127.0.0.1/...`, `ftp://localhost` and `ws://localhost:5678` were
 * all accepted as base URLs and handed to the transport. The toggle exists to
 * let a developer point the node at a local n8n over plain http, not to widen
 * the set of URL schemes the node will talk.
 *
 * `wss:` is refused with the rest: it is a secure scheme, but it is not
 * `https:` and this transport does not speak it.
 */

/** Non-http(s) schemes on a loopback host -- refused even with the toggle on. */
const NON_HTTP_LOOPBACK_URLS = [
  'file://127.0.0.1/etc/passwd',
  'file://localhost/tmp/payload',
  'ftp://localhost',
  'ws://localhost:5678',
  'wss://localhost:5678',
  'ftp://[::1]:5678',
];

describe('checkBaseUrlPolicy -- the loopback allowance covers http: only', () => {
  it.each(NON_HTTP_LOOPBACK_URLS)('refuses %s with allowNonProduction on', (url) => {
    expect(checkBaseUrlPolicy(url, true)).toEqual({ ok: false, reason: 'https-required' });
  });

  it.each(NON_HTTP_LOOPBACK_URLS)('refuses %s with allowNonProduction off', (url) => {
    expect(checkBaseUrlPolicy(url, false)).toEqual({ ok: false, reason: 'https-required' });
  });
});

describe('checkBaseUrlPolicy -- the schemes that were always meant to pass', () => {
  it.each(['http://localhost:5678', 'http://127.0.0.1:5678', 'http://n8n.localhost:5678'])(
    'still allows %s with allowNonProduction on',
    (url) => {
      expect(checkBaseUrlPolicy(url, true)).toEqual({ ok: true });
    },
  );

  it('still allows https to a loopback host with allowNonProduction on', () => {
    expect(checkBaseUrlPolicy('https://localhost:5678', true)).toEqual({ ok: true });
  });

  it('still allows https to the production host with the toggle off', () => {
    expect(checkBaseUrlPolicy(DEFAULT_BASE_URL, false)).toEqual({ ok: true });
  });

  it('still refuses plain http to a loopback host with allowNonProduction off', () => {
    expect(checkBaseUrlPolicy('http://localhost:5678', false)).toEqual({
      ok: false,
      reason: 'https-required',
    });
  });

  it('still refuses plain http to a non-loopback host with allowNonProduction on', () => {
    expect(checkBaseUrlPolicy('http://evil.example.com', true)).toEqual({
      ok: false,
      reason: 'https-required',
    });
  });
});

describe('selectBaseUrl -- a non-http override reaches no transport', () => {
  it.each(NON_HTTP_LOOPBACK_URLS)('refuses %s as a Base URL Override', (url) => {
    expect(
      selectBaseUrl({
        baseUrl: DEFAULT_BASE_URL,
        allowNonProductionUrl: true,
        baseUrlOverride: url,
      }),
    ).toEqual({ ok: false, reason: 'override-https-required' });
  });

  it('still selects a plain-http loopback override', () => {
    expect(
      selectBaseUrl({
        baseUrl: DEFAULT_BASE_URL,
        allowNonProductionUrl: true,
        baseUrlOverride: 'http://localhost:5678',
      }),
    ).toEqual({ ok: true, url: 'http://localhost:5678' });
  });
});
