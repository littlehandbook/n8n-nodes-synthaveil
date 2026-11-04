import type { INodePropertyOptions } from 'n8n-workflow';

import { TaasApi } from '../../credentials/TaasApi.credentials';
import { resolveBaseUrl } from '../../nodes/Taas/transport';
import { DEFAULT_BASE_URL } from '../../src/constants';

/**
 * L14-1 / L08-1 (Medium/Low) — SHIPPED (header corrected 2026-09-14; it used to
 * credit option (b) alone for what is really both halves).
 *
 * HEAD ships BOTH halves the register names: **option (a)**, the programmatic
 * credential test plus the shared policy module, and **option (b)**, the
 * options-bound `baseUrl` with the `baseUrlOverride` escape hatch. Both
 * resolve their target through the one `selectBaseUrl` in
 * `src/baseUrlPolicy.ts`.
 *
 * `baseUrl` is `type: 'options'` with exactly one entry, the production host
 * (`DEFAULT_BASE_URL`) — there is no staging host in this product, so no free
 * text is possible in the UI and a stored value has nowhere to drift to except
 * that one option. A `baseUrlOverride` free-text property exists for a
 * self-hosted or test endpoint, shown ONLY when the `allowNonProductionUrl`
 * toggle is on. `selectBaseUrl` — called by `resolveBaseUrl` at execution time
 * and by `taasApiTest` behind the credential Test button, so the two can never
 * disagree about a credential:
 *   - uses `baseUrlOverride` (still run through `checkBaseUrlPolicy`) when the
 *     toggle is on and the override is non-empty;
 *   - otherwise refuses a stored `baseUrl` value that is not the option value
 *     (e.g. edited directly in a workflow JSON export, or a pre-upgrade
 *     credential) with a re-select message, rather than silently falling back
 *     to production;
 *   - refuses outright when the toggle is on and no override is set — the
 *     toggle relaxes the host policy for the override value only.
 */

const ALLOW_FIELD = 'allowNonProductionUrl';

function byName(properties: { name: string }[]) {
  return Object.fromEntries(properties.map((p) => [p.name, p])) as Record<string, any>;
}

/**
 * IT Council SA-C1 (QA review of PR #633) superseded the declarative
 * expression this suite used to evaluate: a static `={{ ... }}` expression
 * cannot refuse an unsafe `baseUrlOverride` before n8n builds the request, so
 * an override of `http://169.254.169.254` would still get the Bearer key. The
 * connection check is now the programmatic `taasApiTest`
 * (`nodes/Taas/credentialTest.ts`, registered via `testedBy` in
 * `nodeCredentials.ts`) — see `tests/nodes/credentialTest.test.ts` for its
 * target-selection, zero-request-on-refusal, and status-message coverage.
 */
describe('TaasApi.test — superseded by the programmatic taasApiTest (SA-C1)', () => {
  it('has no declarative test block', () => {
    expect('test' in new TaasApi()).toBe(false);
  });
});

describe('TaasApi.baseUrl — restricted to an options list (L14-1)', () => {
  const cred = new TaasApi();
  const props = byName(cred.properties);

  it('baseUrl is type "options", not free text', () => {
    expect(props.baseUrl.type).toBe('options');
  });

  it('baseUrl options are exactly the production host (no staging host exists)', () => {
    const options = (props.baseUrl.options ?? []) as INodePropertyOptions[];
    const values = options.map((o) => o.value);
    expect(values).toEqual([DEFAULT_BASE_URL]);
  });

  it('baseUrl still defaults to production', () => {
    expect(props.baseUrl.default).toBe(DEFAULT_BASE_URL);
  });
});

describe('TaasApi.baseUrlOverride — free-text escape hatch, shown only with the toggle on (L14-1/L08-1)', () => {
  const cred = new TaasApi();
  const props = byName(cred.properties);

  it('exists as a plain string property', () => {
    expect(props.baseUrlOverride).toBeDefined();
    expect(props.baseUrlOverride.type).toBe('string');
  });

  it('is shown only when allowNonProductionUrl is true', () => {
    expect(props.baseUrlOverride.displayOptions?.show).toEqual({ [ALLOW_FIELD]: [true] });
  });

  it('defaults to empty', () => {
    expect(props.baseUrlOverride.default).toBe('');
  });
});

describe('resolveBaseUrl — refuses a stored baseUrl outside the options list (L14-1)', () => {
  function ctxWith(credentials: Record<string, unknown>) {
    return {
      getCredentials: jest.fn().mockResolvedValue(credentials),
      getNode: jest.fn().mockReturnValue({ name: 'Synthaveil (TAAS)', type: 'taas' }),
      helpers: { httpRequestWithAuthentication: jest.fn() },
    } as any;
  }

  it('rejects a tampered/legacy baseUrl value that is not in the options list, toggle off', async () => {
    // e.g. a workflow JSON exported before this change, or hand-edited, still
    // carries an old allow-listed-but-not-in-the-list host.
    const ctx = ctxWith({ baseUrl: 'https://legacy.synthaveil.com', apiKey: 'k' });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/re-select|select/i);
  });

  it('never silently falls back to production for an unrecognised stored value', async () => {
    const ctx = ctxWith({ baseUrl: 'https://legacy.synthaveil.com', apiKey: 'k' });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/re-select|select/i);
  });

  it('still accepts the production option value', async () => {
    const ctx = ctxWith({ baseUrl: DEFAULT_BASE_URL, apiKey: 'k' });
    await expect(resolveBaseUrl(ctx)).resolves.toBe(DEFAULT_BASE_URL);
  });

  it('refuses an https value that is not in the list, toggle off', async () => {
    const ctx = ctxWith({ baseUrl: 'https://staging.synthaveil.com', apiKey: 'k' });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/re-select|select/i);
  });

  it('refuses an off-list stored baseUrl even with the toggle on when baseUrlOverride is empty', async () => {
    const ctx = ctxWith({
      baseUrl: 'https://legacy.synthaveil.com',
      apiKey: 'k',
      [ALLOW_FIELD]: true,
      baseUrlOverride: '',
    });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/re-select|select/i);
  });
});

describe('resolveBaseUrl — override path is used when the toggle is on, and still enforced (L14-1/L08-1)', () => {
  function ctxWith(credentials: Record<string, unknown>) {
    return {
      getCredentials: jest.fn().mockResolvedValue(credentials),
      getNode: jest.fn().mockReturnValue({ name: 'Synthaveil (TAAS)', type: 'taas' }),
      helpers: { httpRequestWithAuthentication: jest.fn() },
    } as any;
  }

  it('resolves to baseUrlOverride (not baseUrl) when the toggle is on and override is a valid loopback URL', async () => {
    const ctx = ctxWith({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: 'k',
      [ALLOW_FIELD]: true,
      baseUrlOverride: 'http://localhost:5678',
    });
    await expect(resolveBaseUrl(ctx)).resolves.toBe('http://localhost:5678');
  });

  it('the override path still refuses http://169.254.169.254 even with the toggle on (SSRF metadata endpoint)', async () => {
    const ctx = ctxWith({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: 'k',
      [ALLOW_FIELD]: true,
      baseUrlOverride: 'http://169.254.169.254',
    });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });

  it('the override path still refuses http://10.0.0.5 even with the toggle on (private-network SSRF target)', async () => {
    const ctx = ctxWith({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: 'k',
      [ALLOW_FIELD]: true,
      baseUrlOverride: 'http://10.0.0.5',
    });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });
});

describe('resolveBaseUrl — SSRF targets already refused with the toggle off (regression pin, already passing)', () => {
  function ctxWith(credentials: Record<string, unknown>) {
    return {
      getCredentials: jest.fn().mockResolvedValue(credentials),
      getNode: jest.fn().mockReturnValue({ name: 'Synthaveil (TAAS)', type: 'taas' }),
      helpers: { httpRequestWithAuthentication: jest.fn() },
    } as any;
  }

  it('rejects http://169.254.169.254 with the toggle off', async () => {
    const ctx = ctxWith({ baseUrl: 'http://169.254.169.254', apiKey: 'k' });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });

  it('rejects http://10.0.0.5 with the toggle off', async () => {
    const ctx = ctxWith({ baseUrl: 'http://10.0.0.5', apiKey: 'k' });
    await expect(resolveBaseUrl(ctx)).rejects.toThrow(/https/i);
  });
});
