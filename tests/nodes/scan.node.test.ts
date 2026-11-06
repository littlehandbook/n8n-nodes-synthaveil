import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { DEFAULT_BASE_URL } from '../../src/constants';

const detectFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'v1', 'detect-200.json'), 'utf8'),
);
const DETECT_BODY = detectFixture.body;

interface ScanParams {
  textField?: string;
}

interface MockOptions {
  items: INodeExecutionData[];
  params?: ScanParams;
  response?: unknown;
  reject?: unknown;
  continueOnFail?: boolean;
}

function mockCtx(opts: MockOptions): { ctx: IExecuteFunctions; http: jest.Mock } {
  const http = jest.fn();
  if (opts.reject !== undefined) http.mockRejectedValue(opts.reject);
  else http.mockResolvedValue(opts.response);

  const values: Record<string, unknown> = {
    resource: 'text',
    operation: 'scanText',
    textField: opts.params?.textField ?? 'notes',
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

describe('Taas node — Scan', () => {
  it('POSTs the chosen field to /detect and emits spans + countsByType + rulesetVersion', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ notes: 'Jane Smith called', other: 'keep' })],
      params: { textField: 'notes' },
      response: DETECT_BODY,
    });

    const out = await new Taas().execute.call(ctx);

    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions).toMatchObject({ method: 'POST', url: '/api/v1/detect' });
    expect(reqOptions.body).toEqual({ text: 'Jane Smith called' });
    expect(out[0][0].json).toEqual({
      spans: DETECT_BODY.spans,
      countsByType: DETECT_BODY.countsByType,
      rulesetVersion: DETECT_BODY.rulesetVersion,
    });
  });

  it('keeps pairedItem integrity across multiple items', async () => {
    const { ctx } = mockCtx({
      items: [item({ notes: 'first' }), item({ notes: 'second' })],
      params: { textField: 'notes' },
      response: DETECT_BODY,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0]).toHaveLength(2);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
  });

  it('rejects text over the 100k character cap with an itemIndex error', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ notes: 'x'.repeat(100001) })],
      params: { textField: 'notes' },
      response: DETECT_BODY,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/too long/i);
    expect(http).not.toHaveBeenCalled();
  });

  it('errors when the chosen field is not a string', async () => {
    const { ctx, http } = mockCtx({
      items: [item({ notes: { nested: true } })],
      params: { textField: 'notes' },
      response: DETECT_BODY,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/not text/i);
    expect(http).not.toHaveBeenCalled();
  });

  it('surfaces a validation failure as an item error under continueOnFail', async () => {
    const { ctx } = mockCtx({
      items: [item({ notes: 42 })],
      params: { textField: 'notes' },
      response: DETECT_BODY,
      continueOnFail: true,
    });

    const out = await new Taas().execute.call(ctx);
    expect(out[0][0].json.error).toMatch(/not text/i);
    expect(out[0][0].pairedItem).toEqual({ item: 0 });
  });
});
