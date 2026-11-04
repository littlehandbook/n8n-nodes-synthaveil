import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { DEFAULT_BASE_URL } from '../../src/constants';

/**
 * Batch operation, exercised through the node's execute() (C4/C7): fan-out,
 * result→item mapping in order, per-record error slots, whole-request 503
 * poisoning a chunk, and a 429 mid fan-out (retry honoured, then clean failure).
 */

interface BatchParams {
  fields: Array<{ fieldName: string; method: string }>;
  country?: string;
  scopeId?: string;
  outputMode?: string;
  retryOnRateLimit?: boolean;
  batchSize?: number;
}

interface MockOptions {
  items: INodeExecutionData[];
  params: BatchParams;
  http: jest.Mock;
  continueOnFail?: boolean;
}

function mockCtx(opts: MockOptions): IExecuteFunctions {
  const values: Record<string, unknown> = {
    resource: 'token',
    operation: 'tokenizeBatch',
    'fieldsToTokenize.field': opts.params.fields,
    country: opts.params.country ?? '',
    scopeId: opts.params.scopeId ?? '',
    outputMode: opts.params.outputMode ?? 'replaceInPlace',
    retryOnRateLimit: opts.params.retryOnRateLimit ?? true,
    batchSize: opts.params.batchSize ?? 100,
  };

  return {
    getInputData: () => opts.items,
    getCredentials: jest
      .fn()
      .mockResolvedValue({ baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }),
    getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in values ? values[name] : fallback,
    continueOnFail: () => opts.continueOnFail ?? false,
    helpers: { httpRequestWithAuthentication: opts.http },
  } as unknown as IExecuteFunctions;
}

const item = (json: IDataObject): INodeExecutionData => ({ json });
const batchResponse = (results: unknown[]) => ({ results, batch_size: results.length });
/** A success slot as the server actually returns it: the row INSIDE an envelope. */
const ok = (tokenized: IDataObject) => ({
  tokenized,
  job_id: 'api-v1:org_demo:2026-07-10',
  processed_at: '2026-07-10T12:00:00.000Z',
});
/** A 429 with a zero-second retry hint so the single retry is instant in tests. */
const rateLimited = () => ({
  statusCode: 429,
  response: { headers: { 'retry-after': '0' }, body: { code: 'rate_limit_exceeded' } },
});

const NAME_FIELD = [{ fieldName: 'name', method: 'l2.synthesize-name' }];

describe('Taas node — Tokenize (Batch)', () => {
  it('sends one request with all records and maps results back in order', async () => {
    const http = jest.fn().mockResolvedValue(
      batchResponse([ok({ name: 'Alex Doe' }), ok({ name: 'Sam Roe' })]),
    );
    const ctx = mockCtx({
      items: [item({ name: 'Jane', keep: 1 }), item({ name: 'John', keep: 2 })],
      params: { fields: NAME_FIELD },
      http,
    });

    const out = await new Taas().execute.call(ctx);

    expect(http).toHaveBeenCalledTimes(1);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions).toMatchObject({ method: 'POST', url: '/api/v1/tokenize/batch' });
    expect(reqOptions.body.records).toEqual([{ name: 'Jane' }, { name: 'John' }]);
    expect(out[0][0].json).toEqual({ name: 'Alex Doe', keep: 1 });
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
    expect(out[0][1].json).toEqual({ name: 'Sam Roe', keep: 2 });
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
  });

  it('chunks by batchSize and preserves global item order across chunks', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(batchResponse([ok({ name: 'A1' })]))
      .mockResolvedValueOnce(batchResponse([ok({ name: 'A2' })]));
    const ctx = mockCtx({
      items: [item({ name: 'one' }), item({ name: 'two' })],
      params: { fields: NAME_FIELD, batchSize: 1 },
      http,
    });

    const out = await new Taas().execute.call(ctx);

    expect(http).toHaveBeenCalledTimes(2);
    expect(out[0].map((d) => d.json.name)).toEqual(['A1', 'A2']);
    expect(out[0].map((d) => d.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('maps a per-record error slot to an item error under continueOnFail', async () => {
    const http = jest.fn().mockResolvedValue(
      batchResponse([ok({ name: 'Alex Doe' }), { error: 'record rejected' }]),
    );
    const ctx = mockCtx({
      items: [item({ name: 'Jane' }), item({ name: 'John' })],
      params: { fields: NAME_FIELD },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);

    expect(out[0][0].json).toEqual({ name: 'Alex Doe' });
    expect(out[0][1].json).toEqual({ error: 'record rejected' });
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
  });

  it('maps a company-key refusal slot to an actionable item message', async () => {
    const http = jest.fn().mockResolvedValue(
      batchResponse([{ error: 'company_entity_key_missing' }]),
    );
    const ctx = mockCtx({
      items: [item({ name: 'No Registration Ltd' })],
      params: { fields: NAME_FIELD },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);

    expect(out[0][0].json.error).toMatch(/registration identifier/i);
    expect(out[0][0].json.error).not.toBe('company_entity_key_missing');
  });

  it('throws an aggregate error naming failed indices when not continuing', async () => {
    const http = jest.fn().mockResolvedValue(
      batchResponse([ok({ name: 'Alex Doe' }), { error: 'record rejected' }]),
    );
    const ctx = mockCtx({
      items: [item({ name: 'Jane' }), item({ name: 'John' })],
      params: { fields: NAME_FIELD },
      http,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/items: 1/);
  });

  it('a whole-request 503 poisons the chunk (all items fail) under continueOnFail', async () => {
    const http = jest.fn().mockRejectedValue({
      statusCode: 503,
      response: { body: { error: 'l3_unavailable' } },
    });
    const ctx = mockCtx({
      items: [item({ name: 'Jane' }), item({ name: 'John' })],
      params: { fields: [{ fieldName: 'name', method: 'l3.personal-geo' }] },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0]).toHaveLength(2);
    expect(out[0][0].json.error).toMatch(/L3/i);
    expect(out[0][1].json.error).toMatch(/L3/i);
  });

  it('honours one retry on a 429 mid fan-out, then fails the second chunk cleanly', async () => {
    // Chunk 1 (item 0) succeeds; chunk 2 (item 1) 429s, retries once, 429s again.
    const http = jest
      .fn()
      .mockResolvedValueOnce(batchResponse([ok({ name: 'A1' })]))
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited());
    const ctx = mockCtx({
      items: [item({ name: 'one' }), item({ name: 'two' })],
      params: { fields: NAME_FIELD, batchSize: 1 },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);

    // 1 success call + 2 calls for the second chunk (initial + single retry).
    expect(http).toHaveBeenCalledTimes(3);
    expect(out[0][0].json).toEqual({ name: 'A1' });
    expect(out[0][1].json.error).toMatch(/rate limit/i);
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
  });

  it('subObject mode nests each tokenised record under "tokenized"', async () => {
    const http = jest.fn().mockResolvedValue(batchResponse([ok({ name: 'Alex Doe' })]));
    const ctx = mockCtx({
      items: [item({ name: 'Jane', keep: 'x' })],
      params: { fields: NAME_FIELD, outputMode: 'subObject' },
      http,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json).toEqual({ name: 'Jane', keep: 'x', tokenized: { name: 'Alex Doe' } });
  });

  it('never leaks the raw value, envelope metadata, or the bare slot into the output', async () => {
    // Regression for the P0: the slot itself (envelope) must never be merged
    // into the item — only its `tokenized` row.
    const http = jest.fn().mockResolvedValue(batchResponse([ok({ name: 'Alex Doe' })]));
    const ctx = mockCtx({
      items: [item({ name: 'Jane' })],
      params: { fields: NAME_FIELD },
      http,
    });

    const out = await new Taas().execute.call(ctx);
    const json = out[0][0].json;
    expect(json).toEqual({ name: 'Alex Doe' });
    expect(json.name).not.toBe('Jane');
    expect(json).not.toHaveProperty('tokenized');
    expect(json).not.toHaveProperty('job_id');
    expect(json).not.toHaveProperty('processed_at');
  });

  it('treats a tokenised row containing a column named "error" as a success', async () => {
    // Envelope-first classification: only a slot WITHOUT `tokenized` is an error.
    const http = jest
      .fn()
      .mockResolvedValue(batchResponse([ok({ name: 'Alex Doe', error: 'tok_err_col' })]));
    const ctx = mockCtx({
      items: [item({ name: 'Jane', error: 'raw' })],
      params: {
        fields: [...NAME_FIELD, { fieldName: 'error', method: 'l1.token-stateless' }],
      },
      http,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json).toEqual({ name: 'Alex Doe', error: 'tok_err_col' });
  });

  it('excludes all-empty records from the request and remaps slots by outbound index', async () => {
    // Item 1 is all-empty: NOT sent, fails locally. The server sees 2 records
    // and returns 2 slots (one success, one error) — they must land on items
    // 0 and 2, not 0 and 1 (review RF-2 + RF-1 collision case).
    const http = jest.fn().mockResolvedValue(
      batchResponse([ok({ name: 'Alex Doe' }), { error: 'tokenize_failed' }]),
    );
    const ctx = mockCtx({
      items: [item({ name: 'Jane' }), item({ name: null }), item({ name: 'John' })],
      params: { fields: NAME_FIELD },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);

    expect(http).toHaveBeenCalledTimes(1);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions.body.records).toEqual([{ name: 'Jane' }, { name: 'John' }]);
    expect(out[0][0].json).toEqual({ name: 'Alex Doe' });
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
    expect(out[0][1].json.error).toMatch(/empty on this item/i);
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
    expect(out[0][2].json).toEqual({ error: 'tokenize_failed' });
    expect(out[0][2].pairedItem).toEqual({ item: 2 });
  });

  it('skips the HTTP call entirely when every record in the chunk is empty', async () => {
    const http = jest.fn();
    const ctx = mockCtx({
      items: [item({ name: null }), item({ name: undefined })],
      params: { fields: NAME_FIELD },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);

    expect(http).not.toHaveBeenCalled();
    expect(out[0]).toHaveLength(2);
    expect(out[0][0].json.error).toMatch(/empty on this item/i);
    expect(out[0][1].json.error).toMatch(/empty on this item/i);
  });

  it('aggregates excluded-empty items into the batch error when not continuing', async () => {
    const http = jest.fn().mockResolvedValue(batchResponse([ok({ name: 'Alex Doe' })]));
    const ctx = mockCtx({
      items: [item({ name: 'Jane' }), item({ name: null })],
      params: { fields: NAME_FIELD },
      http,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/items: 1/);
  });

  it('fails an item whose slot is unrecognised (neither envelope nor error)', async () => {
    const http = jest.fn().mockResolvedValue(batchResponse([{ name: 'raw-row-shape' }]));
    const ctx = mockCtx({
      items: [item({ name: 'Jane' })],
      params: { fields: NAME_FIELD },
      http,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json.error).toMatch(/unrecognised result/i);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
  });
});
