import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { Taas } from '../../nodes/Taas/Taas.node';
import { DEFAULT_BASE_URL } from '../../src/constants';

const usageFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'v1', 'usage-200.json'), 'utf8'),
);
const USAGE_BODY = usageFixture.body;

interface MockOptions {
  items: INodeExecutionData[];
  response?: unknown;
  reject?: unknown;
  continueOnFail?: boolean;
}

function mockCtx(opts: MockOptions): {
  ctx: IExecuteFunctions;
  http: jest.Mock;
} {
  const http = jest.fn();
  if (opts.reject !== undefined) http.mockRejectedValue(opts.reject);
  else http.mockResolvedValue(opts.response);

  const ctx = {
    getInputData: () => opts.items,
    getCredentials: jest
      .fn()
      .mockResolvedValue({ baseUrl: DEFAULT_BASE_URL, apiKey: 'fake-key-for-tests' }),
    getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    // Get Usage lives on the Account resource; the node reads resource/operation
    // once to dispatch. Tokenize has its own test file with a richer mock.
    getNodeParameter: (name: string) => (name === 'resource' ? 'account' : 'getUsage'),
    continueOnFail: () => opts.continueOnFail ?? false,
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;

  return { ctx, http };
}

const item = (json: IDataObject = {}): INodeExecutionData => ({ json });

// Codex review on #1622: the fixture must be a body the production route can emit, not a fiction.
describe('usage-200 fixture — shape the production route emits', () => {
  it('has only the UsageResponse usage fields, with percentage = used / limit to 2 decimals', () => {
    const { used, limit, percentage, ...extra } = USAGE_BODY.usage;
    expect(extra).toEqual({});
    expect(percentage).toBe(Number(((used / limit) * 100).toFixed(2)));
  });

  it('carries only the top-level fields the route sends', () => {
    expect(Object.keys(USAGE_BODY).sort()).toEqual(
      ['active_scopes', 'period', 'quota_warning', 'rate_limit', 'tier', 'usage'].sort(),
    );
  });
});

describe('Taas node — Get Usage', () => {
  it('returns the usage body once per input item with correct pairedItem', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ a: 1 }), item({ b: 2 })],
      response: USAGE_BODY,
    });

    const out = await new Taas().execute.call(ctx);

    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
    expect(out[0][0].json).toEqual(USAGE_BODY);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
    // GET /api/v1/usage against the credential base URL.
    expect(http).toHaveBeenCalledTimes(2);
    const [credName, reqOptions] = http.mock.calls[0];
    expect(credName).toBe('taasApi');
    expect(reqOptions).toMatchObject({ method: 'GET', url: '/api/v1/usage' });
    expect(reqOptions.baseURL).toBe(DEFAULT_BASE_URL);
  });

  it('surfaces a 403 as an item-level error under continueOnFail', async () => {
    const { ctx } = mockCtx({
      items: [item()],
      reject: { statusCode: 403 },
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);

    expect(out[0]).toHaveLength(1);
    expect(out[0][0].json.error).toMatch(/tokenize:read/);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
  });

  it('throws a mapped error when continueOnFail is off (401 → invalid key)', async () => {
    const { ctx } = mockCtx({
      items: [item()],
      reject: { statusCode: 401 },
      continueOnFail: false,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/invalid api key/i);
  });

  it('maps 404 to an API-not-enabled hint', async () => {
    const { ctx } = mockCtx({
      items: [item()],
      reject: { statusCode: 404 },
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json.error).toMatch(/not enabled at this base url/i);
  });

  it('declares Account/getUsage and is usable as an agent tool', () => {
    const desc = new Taas().description;
    expect(desc.name).toBe('taas');
    expect(desc.displayName).toBe('Synthaveil');
    expect(desc.usableAsTool).toBe(true);
    expect(desc.credentials?.[0]).toMatchObject({ name: 'taasApi', required: true });
  });

  // Task 0.2: the canvas label a freshly dropped node shows drops "(TAAS)" too.
  it("defaults.name is the plain 'Synthaveil' canvas label", () => {
    expect(new Taas().description.defaults.name).toBe('Synthaveil');
  });
});

// Task 0.4 (M1.3): the Return mode setting. Only "Record ID" ships this
// version — Local restore (sealed map) is a v1.1 addition (P3).
describe('Taas node — Return mode property', () => {
  const properties = new Taas().description.properties;
  const returnModeIndex = properties.findIndex((p) => p.name === 'returnMode');
  const scopeIdIndex = properties.findIndex((p) => p.name === 'scopeId');
  const returnMode = properties.find((p) => p.name === 'returnMode') as
    | {
        type: string;
        default: unknown;
        description?: string;
        options?: Array<{ name: string; value: string; description?: string }>;
        displayOptions?: { show?: { resource?: string[] } };
      }
    | undefined;

  it('exists as an options property defaulting to recordId', () => {
    expect(returnMode?.type).toBe('options');
    expect(returnMode?.default).toBe('recordId');
  });

  // P3 (plan Task 3.2) adds the Local restore option — Record ID's own
  // no-stored-mapping guarantee is unaffected by an additional option existing.
  it('offers Record ID, guaranteeing no stored mapping', () => {
    const options = returnMode?.options ?? [];
    const recordId = options.find((o) => o.value === 'recordId');
    expect(recordId?.name).toBe('Record ID');
    expect(recordId?.description).toContain('No mapping is stored anywhere by anyone');
  });

  it('also offers Local restore, now that P3 has shipped it', () => {
    const options = returnMode?.options ?? [];
    const localRestore = options.find((o) => o.value === 'localRestore');
    expect(localRestore?.name).toBe('Local Restore');
    expect(localRestore?.description).toContain('sealed on your n8n');
  });

  it('is shown for the token resource', () => {
    expect(returnMode?.displayOptions?.show?.resource ?? []).toContain('token');
  });

  it('appears after scopeId in the properties array (UX ordering)', () => {
    expect(scopeIdIndex).toBeGreaterThan(-1);
    expect(returnModeIndex).toBeGreaterThan(scopeIdIndex);
  });
});
