import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { applyRequestHints } from '../../nodes/Taas/requestHints';
import { DEFAULT_BASE_URL } from '../../src/constants';

/**
 * Legacy `UK` locale hint — persisted workflows (external QA on PR #629, P1).
 *
 * Node 0.2.1 changed the United Kingdom picker option from `UK` to `GB`, which
 * fixes every workflow built from 0.2.1 onwards. It does NOT fix the workflows
 * already saved: n8n stores the selected VALUE in the workflow JSON, so a
 * canvas saved under 0.2.0 still hands `country: 'UK'` to `execute()` after the
 * upgrade, and the API still answers `400`. The picker fix is invisible to
 * those users — the dropdown even renders "United Kingdom" as though it were
 * fine, because the label matches.
 *
 * So the request builder heals the persisted value on the way out
 * ({@link applyRequestHints}). These tests feed `UK` the way a saved workflow
 * does — as the node PARAMETER, never through the picker — and assert the
 * outbound body carries `GB`.
 */

interface HintParams {
  country?: string;
  scopeId?: string;
}

interface MockOptions {
  operation: 'tokenize' | 'tokenizeBatch';
  items: INodeExecutionData[];
  params: HintParams;
  http: jest.Mock;
}

function mockCtx(opts: MockOptions): IExecuteFunctions {
  const values: Record<string, unknown> = {
    resource: 'token',
    operation: opts.operation,
    'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
    country: opts.params.country ?? '',
    scopeId: opts.params.scopeId ?? '',
    outputMode: 'replaceInPlace',
    retryOnRateLimit: true,
    batchSize: 100,
  };

  return {
    getInputData: () => opts.items,
    getCredentials: jest
      .fn()
      .mockResolvedValue({ baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }),
    getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas' }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in values ? values[name] : fallback,
    continueOnFail: () => false,
    helpers: { httpRequestWithAuthentication: opts.http },
  } as unknown as IExecuteFunctions;
}

const item = (json: IDataObject): INodeExecutionData => ({ json });

/** A success envelope as the server returns it, for either operation. */
const ok = (tokenized: IDataObject) => ({
  tokenized,
  job_id: 'api-v1:org_demo:2026-09-13',
  processed_at: '2026-09-13T12:00:00.000Z',
});

/** The `country` the node actually put on the wire for its first request. */
async function outboundCountry(
  operation: 'tokenize' | 'tokenizeBatch',
  country: string,
): Promise<unknown> {
  const http = jest
    .fn()
    .mockResolvedValue(
      operation === 'tokenize'
        ? ok({ name: 'Alex Doe' })
        : { results: [ok({ name: 'Alex Doe' })], batch_size: 1 },
    );
  const ctx = mockCtx({ operation, items: [item({ name: 'Jane' })], params: { country }, http });

  await new Taas().execute.call(ctx);
  const [, reqOptions] = http.mock.calls[0];
  return reqOptions.body.country;
}

describe('a workflow saved under 0.2.0 still sends UK — the request builder heals it', () => {
  it('Tokenize (single) turns a persisted UK into GB on the wire', async () => {
    expect(await outboundCountry('tokenize', 'UK')).toBe('GB');
  });

  it('Tokenize (Batch) turns a persisted UK into GB on the wire', async () => {
    expect(await outboundCountry('tokenizeBatch', 'UK')).toBe('GB');
  });

  it('a picker-fresh GB is unchanged on both operations', async () => {
    expect(await outboundCountry('tokenize', 'GB')).toBe('GB');
    expect(await outboundCountry('tokenizeBatch', 'GB')).toBe('GB');
  });
});

describe('applyRequestHints — the alias itself', () => {
  const countryOf = (country: string): unknown => {
    const body: { country?: string } = {};
    applyRequestHints(body, { country });
    return body.country;
  };

  it.each([['UK'], ['uk'], ['Uk'], ['  UK  ']])('normalises %s to GB', (persisted) => {
    expect(countryOf(persisted)).toBe('GB');
  });

  it.each([['GB'], ['IE'], ['US'], ['CA']])('leaves the accepted code %s alone', (code) => {
    expect(countryOf(code)).toBe(code);
  });

  it('does not invent a country when the hint is absent or blank', () => {
    const body: { country?: string } = {};
    applyRequestHints(body, {});
    applyRequestHints(body, { country: '   ' });
    expect('country' in body).toBe(false);
  });

  it('leaves an unrecognised value for the API to reject, rather than guessing', () => {
    // Only the one spelling the node itself once shipped is aliased. Anything
    // else is the caller's own expression output, and a silent rewrite of it
    // would hide a real mistake behind a wrong-but-accepted locale.
    expect(countryOf('GBR')).toBe('GBR');
  });
});
