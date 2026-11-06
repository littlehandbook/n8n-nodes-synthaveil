import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { consistencyProperty } from '../../nodes/Taas/properties/consistency';
import { Taas } from '../../nodes/Taas/Taas.node';
import { openContainer } from '../../nodes/Taas/sealedMap';
import { base64ToBytes } from '../../nodes/Taas/base64';
import { DEFAULT_BASE_URL } from '../../src/constants';

/**
 * TDD RED — Consistency node property + execute-level `run_id` wiring
 * (PLAN.md Phase P5 Task 5.2, AC8/AC9 node half, criterion rm-24).
 *
 * Two halves:
 *  1. Property shape — `nodes/Taas/properties/consistency.ts` (follows the
 *     `returnMode.ts` module shape: a single exported `INodeProperties`).
 *     RED today because the module does not exist.
 *  2. Execute wiring — `everyRun` ⇒ the node sends `run_id:
 *     this.getExecutionId()` on tokenize, batch, and the Local-restore `PUT
 *     /maps` call; `stable` ⇒ no `run_id` field at all; two different
 *     execution ids ⇒ two different `run_id` values sent (AC9).
 *
 * Mirrors the `mockCtx` house pattern from tokenize.node.test.ts /
 * batch.node.test.ts (getNodeParameter table + a mocked
 * httpRequestWithAuthentication), extended with `getExecutionId`.
 */

function mockTokenizeCtx(opts: {
  items: INodeExecutionData[];
  consistency?: string;
  executionId?: string;
  response?: unknown;
}): { ctx: IExecuteFunctions; http: jest.Mock } {
  const http = jest.fn().mockResolvedValue(
    opts.response ?? {
      tokenized: { name: 'Alex Doe' },
      job_id: 'api-v1:org_1:2026-07-10',
      processed_at: '2026-07-10T00:00:00.000Z',
    }
  );

  const values: Record<string, unknown> = {
    resource: 'token',
    operation: 'tokenize',
    'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
    country: '',
    scopeId: '',
    outputMode: 'replaceInPlace',
    retryOnRateLimit: true,
    consistency: opts.consistency ?? 'stable',
  };

  const ctx = {
    getInputData: () => opts.items,
    getCredentials: jest.fn().mockImplementation(async (name: string) =>
      name === 'synthaveilMapKeyApi'
        ? // Chairman fix: a real 32-byte base64 key so deriveContainerKey's
          // fail-closed length check passes in the PUT-/maps sub-test.
          { mapKey: Buffer.alloc(32, 7).toString('base64') }
        : { baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }
    ),
    getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas', credentials: { taasApi: { id: '1', name: 'acct' }, synthaveilMapKeyApi: { id: '2', name: 'map key' } } }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in values ? values[name] : fallback,
    getExecutionId: () => opts.executionId ?? 'exec-1',
    continueOnFail: () => false,
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;

  return { ctx, http };
}

function mockBatchCtx(opts: {
  items: INodeExecutionData[];
  consistency?: string;
  executionId?: string;
  response?: unknown;
}): { ctx: IExecuteFunctions; http: jest.Mock } {
  const http = jest.fn().mockResolvedValue(
    opts.response ?? {
      results: opts.items.map(() => ({
        tokenized: { name: 'Alex Doe' },
        job_id: 'api-v1:org_1:2026-07-10',
        processed_at: '2026-07-10T00:00:00.000Z',
      })),
      batch_size: opts.items.length,
    }
  );

  const values: Record<string, unknown> = {
    resource: 'token',
    operation: 'tokenizeBatch',
    'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
    country: '',
    scopeId: '',
    outputMode: 'replaceInPlace',
    retryOnRateLimit: true,
    batchSize: 100,
    consistency: opts.consistency ?? 'stable',
  };

  const ctx = {
    getInputData: () => opts.items,
    getCredentials: jest.fn().mockImplementation(async (name: string) =>
      name === 'synthaveilMapKeyApi'
        ? // Chairman fix: a real 32-byte base64 key so deriveContainerKey's
          // fail-closed length check passes in the PUT-/maps sub-test.
          { mapKey: Buffer.alloc(32, 7).toString('base64') }
        : { baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }
    ),
    getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas', credentials: { taasApi: { id: '1', name: 'acct' }, synthaveilMapKeyApi: { id: '2', name: 'map key' } } }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in values ? values[name] : fallback,
    getExecutionId: () => opts.executionId ?? 'exec-1',
    continueOnFail: () => false,
    helpers: { httpRequestWithAuthentication: http },
  } as unknown as IExecuteFunctions;

  return { ctx, http };
}

const item = (json: IDataObject): INodeExecutionData => ({ json });

describe('consistencyProperty — shape (rm-24, Task 5.2)', () => {
  it('is an options field named "consistency" defaulting to "stable"', () => {
    expect(consistencyProperty.name).toBe('consistency');
    expect(consistencyProperty.type).toBe('options');
    expect(consistencyProperty.default).toBe('stable');
  });

  it('offers Stable and "Every run" (value everyRun)', () => {
    const values = (consistencyProperty.options as Array<{ value: string }>).map((o) => o.value);
    expect(values).toContain('stable');
    expect(values).toContain('everyRun');
  });

  it('the everyRun option description contains the literal Helen sentence fragment (AC8, rm-24)', () => {
    const everyRun = (
      consistencyProperty.options as Array<{ value: string; description?: string }>
    ).find((o) => o.value === 'everyRun');
    expect(everyRun).toBeDefined();
    expect(everyRun?.description).toMatch(/different fake name the next time/);
  });

  it('is shown only for resource "token"', () => {
    expect(consistencyProperty.displayOptions?.show?.resource).toEqual(['token']);
  });
});

describe('execute — consistency: everyRun sends run_id on tokenize (Task 5.2 AC9)', () => {
  it('sends run_id: this.getExecutionId() when consistency is everyRun', async () => {
    const { ctx, http } = mockTokenizeCtx({
      items: [item({ name: 'Helen' })],
      consistency: 'everyRun',
      executionId: 'exec-abc',
    });
    await new Taas().execute.call(ctx);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions.body.run_id).toBe('exec-abc');
  });

  it('sends NO run_id field at all when consistency is stable', async () => {
    const { ctx, http } = mockTokenizeCtx({
      items: [item({ name: 'Helen' })],
      consistency: 'stable',
      executionId: 'exec-abc',
    });
    await new Taas().execute.call(ctx);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions.body).not.toHaveProperty('run_id');
  });

  it('two different execution ids produce two different run_id values (AC9)', async () => {
    const first = mockTokenizeCtx({
      items: [item({ name: 'Helen' })],
      consistency: 'everyRun',
      executionId: 'exec-run-1',
    });
    await new Taas().execute.call(first.ctx);

    const second = mockTokenizeCtx({
      items: [item({ name: 'Helen' })],
      consistency: 'everyRun',
      executionId: 'exec-run-2',
    });
    await new Taas().execute.call(second.ctx);

    const runId1 = first.http.mock.calls[0][1].body.run_id;
    const runId2 = second.http.mock.calls[0][1].body.run_id;
    expect(runId1).toBe('exec-run-1');
    expect(runId2).toBe('exec-run-2');
    expect(runId1).not.toBe(runId2);
  });
});

describe('execute — consistency: everyRun sends run_id on batch (Task 5.2 AC9)', () => {
  it('sends run_id: this.getExecutionId() on the batch request body when everyRun', async () => {
    const { ctx, http } = mockBatchCtx({
      items: [item({ name: 'Helen' }), item({ name: 'Mary' })],
      consistency: 'everyRun',
      executionId: 'exec-batch-1',
    });
    await new Taas().execute.call(ctx);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions.body.run_id).toBe('exec-batch-1');
  });

  it('sends no run_id field on the batch request body when stable', async () => {
    const { ctx, http } = mockBatchCtx({
      items: [item({ name: 'Helen' })],
      consistency: 'stable',
      executionId: 'exec-batch-1',
    });
    await new Taas().execute.call(ctx);
    const [, reqOptions] = http.mock.calls[0];
    expect(reqOptions.body).not.toHaveProperty('run_id');
  });
});

/**
 * `PUT /maps` half of AC9 (Local restore, Task 3.4/5.2 overlap). Local
 * restore's execute wiring (sealContainer → `PUT /maps`) is plan Task 3.4
 * (Phase P3), not yet landed as of this test-writing pass — this suite
 * still pins the contract so it goes green the moment P3's PUT /maps call
 * lands, rather than silently missing coverage. RED today because no
 * `/maps` request is made at all in `returnMode: 'localRestore'`.
 */
describe('execute — consistency: everyRun sends run_id on the Local-restore PUT /maps call (Task 5.2 AC9, depends on P3 Task 3.4)', () => {
  it('the PUT to /api/v1/maps carries run_id when consistency is everyRun', async () => {
    const http = jest.fn().mockImplementation((_ctx, opts: { url: string; method: string }) => {
      if (opts.method === 'PUT' && opts.url.includes('/maps')) {
        return Promise.resolve({ handle: 'svh1-fixture', expires_at: '2026-08-01T00:00:00.000Z' });
      }
      return Promise.resolve({
        tokenized: { name: 'Alex Doe' },
        job_id: 'api-v1:org_1:2026-07-10',
        processed_at: '2026-07-10T00:00:00.000Z',
      });
    });

    const values: Record<string, unknown> = {
      resource: 'token',
      operation: 'tokenize',
      'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
      country: '',
      // Local restore requires a scope: the sealed map is stored against it.
      scopeId: 'consistency-demo',
      outputMode: 'replaceInPlace',
      retryOnRateLimit: true,
      returnMode: 'localRestore',
      consistency: 'everyRun',
    };

    const ctx = {
      getInputData: () => [item({ name: 'Helen' })],
      getCredentials: jest.fn().mockImplementation(async (name: string) =>
        name === 'synthaveilMapKeyApi'
          ? // Chairman fix: real 32-byte key for the sealing path.
            { mapKey: Buffer.alloc(32, 7).toString('base64') }
          : { baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }
      ),
      getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas', retryOnFail: false, credentials: { taasApi: { id: '1', name: 'acct' }, synthaveilMapKeyApi: { id: '2', name: 'map key' } } }),
      getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
        name in values ? values[name] : fallback,
      getExecutionId: () => 'exec-maps-1',
      continueOnFail: () => false,
      helpers: { httpRequestWithAuthentication: http },
    } as unknown as IExecuteFunctions;

    await new Taas().execute.call(ctx);

    const mapsPutCall = http.mock.calls.find(
      ([, opts]) => opts?.method === 'PUT' && String(opts?.url ?? '').includes('/maps')
    );
    expect(mapsPutCall).toBeDefined();
    expect(mapsPutCall?.[1].body.run_id).toBe('exec-maps-1');
    // Branch review finding 7: the node's own `consistency` parameter must
    // drive the PUT body's `consistency` field, not a hardcoded 'stable'.
    expect(mapsPutCall?.[1].body.consistency).toBe('every_run');
  });

  it('the PUT to /api/v1/maps carries consistency "stable" when the node consistency is stable (branch review finding 7)', async () => {
    const http = jest.fn().mockImplementation((_ctx, opts: { url: string; method: string }) => {
      if (opts.method === 'PUT' && opts.url.includes('/maps')) {
        return Promise.resolve({ handle: 'svh1-fixture', expires_at: '2026-08-01T00:00:00.000Z' });
      }
      return Promise.resolve({
        tokenized: { name: 'Alex Doe' },
        job_id: 'api-v1:org_1:2026-07-10',
        processed_at: '2026-07-10T00:00:00.000Z',
      });
    });

    const values: Record<string, unknown> = {
      resource: 'token',
      operation: 'tokenize',
      'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
      country: '',
      // Local restore requires a scope: the sealed map is stored against it.
      scopeId: 'consistency-demo',
      outputMode: 'replaceInPlace',
      retryOnRateLimit: true,
      returnMode: 'localRestore',
      consistency: 'stable',
    };

    const ctx = {
      getInputData: () => [item({ name: 'Helen' })],
      getCredentials: jest.fn().mockImplementation(async (name: string) =>
        name === 'synthaveilMapKeyApi'
          ? { mapKey: Buffer.alloc(32, 7).toString('base64') }
          : { baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }
      ),
      getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas', retryOnFail: false, credentials: { taasApi: { id: '1', name: 'acct' }, synthaveilMapKeyApi: { id: '2', name: 'map key' } } }),
      getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
        name in values ? values[name] : fallback,
      getExecutionId: () => 'exec-maps-2',
      continueOnFail: () => false,
      helpers: { httpRequestWithAuthentication: http },
    } as unknown as IExecuteFunctions;

    await new Taas().execute.call(ctx);

    const mapsPutCall = http.mock.calls.find(
      ([, opts]) => opts?.method === 'PUT' && String(opts?.url ?? '').includes('/maps')
    );
    expect(mapsPutCall).toBeDefined();
    expect(mapsPutCall?.[1].body.consistency).toBe('stable');
  });
});

/**
 * Branch review finding 6 (2026-08-31): scope-identity drift between the
 * tokenize leg (which trims scope_id, requestHints.ts:61) and the Local
 * restore PUT + sealContainer leg (which previously sent/sealed the raw,
 * untrimmed value). Both legs must use the SAME trimmed scope_id.
 */
describe('execute — Local restore trims scope_id once, consistently, for both the PUT body and the sealed container (branch review finding 6)', () => {
  it('a scope_id with leading/trailing whitespace is trimmed identically in the PUT body and the sealed container', async () => {
    const RAW_SCOPE = '  crm-sync  ';
    const TRIMMED_SCOPE = 'crm-sync';
    const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

    let putBody: { blob?: string; scope_id?: string } | undefined;
    const http = jest.fn().mockImplementation((_ctx, opts: { url: string; method: string; body?: unknown }) => {
      if (opts.method === 'PUT' && opts.url.includes('/maps')) {
        putBody = opts.body as { blob?: string; scope_id?: string };
        return Promise.resolve({ handle: 'svh1-fixture', expires_at: '2026-08-01T00:00:00.000Z' });
      }
      return Promise.resolve({
        tokenized: { name: 'Alex Doe' },
        job_id: 'api-v1:org_1:2026-07-10',
        processed_at: '2026-07-10T00:00:00.000Z',
      });
    });

    const values: Record<string, unknown> = {
      resource: 'token',
      operation: 'tokenize',
      'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
      country: '',
      scopeId: RAW_SCOPE,
      outputMode: 'replaceInPlace',
      retryOnRateLimit: true,
      returnMode: 'localRestore',
      consistency: 'stable',
    };

    const ctx = {
      getInputData: () => [item({ name: 'Helen' })],
      getCredentials: jest.fn().mockImplementation(async (name: string) =>
        name === 'synthaveilMapKeyApi'
          ? { mapKey: MASTER_KEY }
          : { baseUrl: DEFAULT_BASE_URL, apiKey: 'k' }
      ),
      getNode: () => ({ name: 'Synthaveil (TAAS)', type: 'taas', retryOnFail: false, credentials: { taasApi: { id: '1', name: 'acct' }, synthaveilMapKeyApi: { id: '2', name: 'map key' } } }),
      getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
        name in values ? values[name] : fallback,
      getExecutionId: () => 'exec-scope-trim',
      continueOnFail: () => false,
      helpers: { httpRequestWithAuthentication: http },
    } as unknown as IExecuteFunctions;

    await new Taas().execute.call(ctx);

    expect(putBody?.scope_id).toBe(TRIMMED_SCOPE);

    // Decode the sealed container and confirm its scopeRef is ALSO the
    // trimmed value — openContainer refuses (SCOPE_MISMATCH) unless the
    // scope passed in matches the one sealed inside.
    const bytes = base64ToBytes(String(putBody?.blob ?? ''));
    const masterKeyBytes = base64ToBytes(MASTER_KEY);
    const opened = await openContainer(bytes, TRIMMED_SCOPE, masterKeyBytes);
    expect(opened.ok).toBe(true);
  });
});
