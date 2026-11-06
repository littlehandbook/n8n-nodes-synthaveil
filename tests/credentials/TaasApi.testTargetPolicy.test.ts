import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

import { checkBaseUrlPolicy } from '../../src/baseUrlPolicy';
import { REFUSED_OVERRIDE_BASE_URL } from '../../src/constants';
import { TEST_BASE_URL_EXPRESSION, TEST_OVERRIDE_ACCEPTED } from '../../src/credentialTestTarget';
import { renderTestRequest } from './testTargetKit';

/**
 * The Test button's override rule (`src/credentialTestTarget.ts`) must be a
 * strict subset of execution's `checkBaseUrlPolicy` (owner decision 6 Nov 2026,
 * refining SA-C1): anything it accepts, execution accepts with the same host.
 * Every check below runs the rule through n8n-workflow's real expression engine.
 */

/** Both refuse. */
const REFUSED_BY_BOTH = [
  'http://169.254.169.254',
  'http://169.254.169.254/latest/meta-data/',
  'http://example.com',
  'http://localhost.:7781',
  'http://LOCALHOST.',
  'ftp://localhost',
  'ws://localhost:5678',
  'wss://example.com',
  'file://127.0.0.1/etc/passwd',
  'http://localhost@evil.example',
  'http://localhost:80@evil.example',
  'https://1.2.3.999',
  'https://a.b.0x1a',
  'https://exa mple.com',
  'https://',
  'not a url',
  'https://example.com:65536',
];

/** Both accept, with the same host. */
const ACCEPTED_BY_BOTH = [
  'https://taas.self-hosted.example.com',
  'https://API.SYNTHAVEIL.COM.',
  'https://api.synthaveil.com.',
  'HTTPS://Example.COM:8443/base',
  'https://example.com/',
  'https://example.com?x=1',
  'https://example.com#f',
  'https://1.example.com',
  'https://0x1a.example.com',
  'https://localhost:65535',
  'https://example.com:0',
  'http://localhost',
  'http://localhost:7781',
  'HTTP://LOCALHOST:7781',
  'http://127.0.0.1:5678',
  'http://[::1]:5678',
  'http://dev.localhost:3000',
];

/**
 * The policy allows these, the Test rule refuses them: forms a regex cannot
 * parse the way WHATWG does, refused rather than guessed. Execution still runs
 * with them; only the Test button declines to send the key. Adding to this list
 * is a decision, not a fix.
 */
const STRICTER_THAN_POLICY = [
  'https://api.synthaveil.com@evil.example', // userinfo
  'https://user:pw@example.com', // userinfo
  'https://10.0.0.5', // IP literal
  'https://169.254.169.254', // IP literal
  'https://[2001:db8::1]', // IPv6 literal
  'https://xn--bcher-kva.example', // punycode label
  'https://my_host.example', // underscore
  'https://example.com:0080', // port with leading zeros
  'https://example.com/a b', // whitespace in the path
  'http://127.1:5678', // shortened IPv4 WHATWG expands to 127.0.0.1
  'http://localhost\\@evil.example', // WHATWG reads the backslash as a slash
];

const rendered = (override: string): unknown =>
  renderTestRequest({
    baseUrl: 'https://api.synthaveil.com',
    apiKey: 'sk-taas-FAKE-subset-000',
    allowNonProductionUrl: true,
    baseUrlOverride: override,
  } as ICredentialDataDecryptedObject).baseURL;

const hostOf = (url: string): string => new URL(url).host;

describe('Test override rule — runs under the real n8n expression engine', () => {
  it.each([...REFUSED_BY_BOTH, ...ACCEPTED_BY_BOTH, ...STRICTER_THAN_POLICY])(
    '%s: the engine gives the override or the .invalid host, exactly as the rule says',
    (override) => {
      const expected = TEST_OVERRIDE_ACCEPTED.test(override.trim()) ? override.trim() : REFUSED_OVERRIDE_BASE_URL;
      expect(rendered(override)).toBe(expected);
    },
  );

  it('the expression has exactly one {{ ... }} pair, so the regex cannot end it early', () => {
    expect(TEST_BASE_URL_EXPRESSION.match(/\{\{/g)).toHaveLength(1);
    expect(TEST_BASE_URL_EXPRESSION.match(/\}\}/g)).toHaveLength(1);
  });
});

describe('Test override rule — a strict subset of checkBaseUrlPolicy', () => {
  it.each(REFUSED_BY_BOTH)('%s: refused by both, so the Test goes to .invalid', (override) => {
    expect(checkBaseUrlPolicy(override, true).ok).toBe(false);
    expect(rendered(override)).toBe(REFUSED_OVERRIDE_BASE_URL);
  });

  it.each(ACCEPTED_BY_BOTH)('%s: accepted by both, same host', (override) => {
    expect(checkBaseUrlPolicy(override, true).ok).toBe(true);
    expect(rendered(override)).toBe(override);
    expect(hostOf(String(rendered(override)))).toBe(hostOf(override));
  });

  it.each(STRICTER_THAN_POLICY)('%s: policy allows, the Test refuses (deliberate)', (override) => {
    expect(checkBaseUrlPolicy(override, true).ok).toBe(true);
    expect(rendered(override)).toBe(REFUSED_OVERRIDE_BASE_URL);
  });

  it('the refusal host is reserved by RFC 6761 and never resolves', () => {
    expect(new URL(REFUSED_OVERRIDE_BASE_URL).hostname.endsWith('.invalid')).toBe(true);
  });
});
