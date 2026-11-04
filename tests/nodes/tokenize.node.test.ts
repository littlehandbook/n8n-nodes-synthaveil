import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { DEFAULT_BASE_URL } from '../../src/constants';

interface TokenizeParams {
  fields: Array<{ fieldName: string; method: string }>;
  country?: string;
  scopeId?: string;
  outputMode?: string;
  retryOnRateLimit?: boolean;
}

interface MockOptions {
  items: INodeExecutionData[];
  params: TokenizeParams;
  response?: unknown;
  reject?: unknown;
  continueOnFail?: boolean;
}

function mockCtx(opts: MockOptions): { ctx: IExecuteFunctions; http: jest.Mock } {
  const http = jest.fn();
  if (opts.reject !== undefined) http.mockRejectedValue(opts.reject);
  else http.mockResolvedValue(opts.response);

  const values: Record<string, unknown> = {
    resource: 'token',
    operation: 'tokenize',
    'fieldsToTokenize.field': opts.params.fields,
    country: opts.params.country ?? '',
    scopeId: opts.params.scopeId ?? '',
    outputMode: opts.params.outputMode ?? 'replaceInPlace',
    retryOnRateLimit: opts.params.retryOnRateLimit ?? true,
  };

  const ctx = {
    getInputData: () => opts.items,
    getCredentials: jest
      .fn()
      .mockResolvedValue({ baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }),
    getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in values ? values[name] : fallback,
    continueOnFail: () => opts.continueOnFail ?? false,
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;

  return { ctx, http };
}

const item = (json: IDataObject): INodeExecutionData => ({ json });
const tokenizeResponse = (tokenized: IDataObject) => ({
  tokenized,
  job_id: 'api-v1:org_1:2026-07-10',
  processed_at: '2026-07-10T00:00:00.000Z',
});

describe('Taas node — Tokenize', () => {
  it('replaceInPlace overwrites mapped fields and preserves the rest', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ name: 'Jane', keep: 'as-is' })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      response: tokenizeResponse({ name: 'Alex Doe' }),
    });

    const out = await new Taas().execute.call(ctx);

    expect(out[0][0].json).toEqual({ name: 'Alex Doe', keep: 'as-is' });
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions).toMatchObject({ method: 'POST', url: '/api/v1/tokenize' });
    expect(reqOptions.body.record).toEqual({ name: 'Jane' });
    expect(reqOptions.body.policy.fields).toEqual({ name: { method: 'l2.synthesize-name' } });
  });

  it('subObject nests the tokenised record and keeps originals', async () => {
    const { ctx } = mockCtx({
      items: [item({ name: 'Jane', keep: 'as-is' })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }], outputMode: 'subObject' },
      response: tokenizeResponse({ name: 'Alex Doe' }),
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json).toEqual({ name: 'Jane', keep: 'as-is', tokenized: { name: 'Alex Doe' } });
  });

  it('sends country and scope_id when set', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ email: 'j@x.com' })],
      params: {
        fields: [{ fieldName: 'email', method: 'l2.synthesize-email' }],
        country: 'GB',
        scopeId: 'crm',
      },
      response: tokenizeResponse({ email: 'a@y.com' }),
    });

    await new Taas().execute.call(ctx);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions.body.country).toBe('GB');
    expect(reqOptions.body.scope_id).toBe('crm');
  });

  it('surfaces a 403 insufficient_scope as an item error under continueOnFail', async () => {
    const { ctx } = mockCtx({
      items: [item({ name: 'Jane' })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      reject: { statusCode: 403, response: { body: { code: 'insufficient_scope' } } },
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json.error).toMatch(/scope/i);
  });

  it('pre-empts the 200-field cap with a clear error (continueOnFail)', async () => {
    const fields = Array.from({ length: 201 }, (_v, k) => ({
      fieldName: `f${k}`,
      method: 'l1.token-stateless',
    }));
    const json: IDataObject = {};
    for (const f of fields) json[f.fieldName] = 'x';

    const { ctx } = mockCtx({
      items: [item(json)],
      params: { fields },
      response: tokenizeResponse({}),
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json.error).toMatch(/too many fields/i);
  });

  it('fails locally when all mapped fields are empty (continueOnFail off)', async () => {
    // An all-empty record must never reach the API — it would consume quota
    // while protecting nothing (review RF-2).
    const { ctx, http } = mockCtx({
      items: [item({ name: null, keep: 'x' })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      response: tokenizeResponse({}),
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/empty on this item/i);
    expect(http).not.toHaveBeenCalled();
  });

  it('fails the item per-item on an all-empty record under continueOnFail', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ name: null })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      response: tokenizeResponse({}),
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(http).not.toHaveBeenCalled();
    expect(out[0][0].json.error).toMatch(/all mapped fields \(name\) are empty/i);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
  });

  it('throws when a 2xx response is missing the tokenized envelope (continueOnFail off)', async () => {
    // A success response without `tokenized` must NEVER emit the original item
    // as if protected (P0 regression, council cond 1).
    const { ctx } = mockCtx({
      items: [item({ name: 'Jane' })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      response: { job_id: 'api-v1:org_1:2026-07-10' },
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/missing the tokenized record/i);
  });

  it('fails the item (not the run) on a missing envelope under continueOnFail', async () => {
    const { ctx } = mockCtx({
      items: [item({ name: 'Jane' })],
      params: { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      response: { job_id: 'api-v1:org_1:2026-07-10' },
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json.error).toMatch(/missing the tokenized record/i);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
    expect(out[0][0].json).not.toHaveProperty('name');
  });
});

describe('Taas node — the Locale hint picker offers only values the API accepts', () => {
  /** The `country` option list as the node declares it. */
  function countryOptions(): Array<{ name: string; value: string }> {
    const property = new Taas().description.properties.find((p) => p.name === 'country');
    return (property?.options ?? []) as Array<{ name: string; value: string }>;
  }

  // 2026-09-13: the picker sent `UK` for United Kingdom, which the API has
  // never accepted (`country must be one of GB, US, CA, IE (exact case)`), so
  // that one choice 400'd every call. Per-value assertions rather than a
  // snapshot of the whole list, so adding a country later does not fail them.
  it('offers GB for the United Kingdom and no longer offers UK', () => {
    const values = countryOptions().map((o) => o.value);
    expect(values).toContain('GB');
    expect(values).not.toContain('UK');
  });

  it('every non-empty option is one of the four the API accepts', () => {
    const accepted = ['GB', 'US', 'CA', 'IE'];
    const offered = countryOptions()
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(offered.every((v) => accepted.includes(v))).toBe(true);
    expect(offered.length).toBe(accepted.length);
  });

  it('United Kingdom is the label on the GB option, not on some other value', () => {
    expect(countryOptions().find((o) => o.name === 'United Kingdom')?.value).toBe('GB');
  });
});
