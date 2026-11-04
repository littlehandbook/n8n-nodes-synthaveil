/**
 * Shared kit for the #619 client-side Idempotency-Key suites (not a spec: no `.test.ts` suffix).
 *
 * `referenceKey` is the IT Council #619 (C4) n8n key formula written out ONCE, independently of
 * the node, so the wire tests compare what the node sends against it rather than against the
 * node's own `deriveIdempotencyKey`:
 *
 *   key = 'n8n1_' + hex(sha256('n8n1' | instanceId | executionId | node.id | runIndex | endpoint | index | hex(sha256(JSON.stringify(body)))))
 *
 * `instanceId` is n8n's getInstanceId() (Codex review: two installs sharing one credential must not
 * collide). `runIndex` is the node's `$thisRunIndex` (Codex review on #1622: a loop or an agent calling the
 * node twice in one execution must not replay the first call).
 *
 * `index` is the item index for Tokenize and `chunk.startIndex` for Tokenize (Batch); `body` is the
 * request body object the node hands the transport (n8n serialises it with JSON.stringify).
 */
import { createHash } from 'node:crypto';
import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, INodeExecutionData } from 'n8n-workflow';

import { DEFAULT_BASE_URL } from '../../src/constants';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const KEY_SHAPE = /^n8n1_[0-9a-f]{64}$/;
/** Stand-in for an absent header, so a missing key fails with a readable message. */
export const NO_HEADER = '<no Idempotency-Key header sent>';
export const NODE_ID = '3b0c6c1e-6f2a-4d5e-9a7b-000000000619';
export const EXECUTION_ID = 'exec-619-0001';
export const INSTANCE_ID = 'f3a1c0de5b7e4d2a9c8b6e1f0a2d4c6e8b0a1c3e5f7d9b2a4c6e8f0a1b3c5d7e';
export const RUN_INDEX = 0;
const MAP_KEY = Buffer.alloc(32, 7).toString('base64');

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function referenceKey(
  instanceId: string,
  executionId: string,
  nodeId: string,
  endpoint: string,
  index: number,
  body: unknown,
  runIndex: number = RUN_INDEX,
): string {
  const digest = sha256Hex(JSON.stringify(body));
  const parts = ['n8n1', instanceId, executionId, nodeId, String(runIndex), endpoint, String(index), digest];
  return 'n8n1_' + sha256Hex(parts.join('|'));
}

export interface SentRequest {
  method: IHttpRequestMethods;
  url: string;
  body?: IDataObject;
  headers?: Record<string, string>;
}

/** The Idempotency-Key header on one recorded request, case-insensitively; undefined when absent. */
export function keyOf(req: SentRequest): string | undefined {
  const headers = req.headers ?? {};
  const name = Object.keys(headers).find((h) => h.toLowerCase() === IDEMPOTENCY_HEADER.toLowerCase());
  return name === undefined ? undefined : headers[name];
}

/** A tiny routed fake of the TAAS API covering every path the node can call. */
export function routedHttp(): jest.Mock {
  return jest.fn(async (_cred: string, req: SentRequest) => {
    if (req.url === '/api/v1/tokenize') {
      const record = (req.body?.record ?? {}) as Record<string, string>;
      const tokenized = Object.fromEntries(Object.keys(record).map((k) => [k, `tok_${k}`]));
      return { tokenized, job_id: 'api-v1:org_1:2026-10-14', processed_at: '2026-10-14T00:00:00.000Z' };
    }
    if (req.url === '/api/v1/tokenize/batch') {
      const records = (req.body?.records ?? []) as Array<Record<string, string>>;
      return {
        results: records.map((r) => ({
          tokenized: Object.fromEntries(Object.keys(r).map((k) => [k, `tok_${k}`])),
          job_id: 'api-v1:org_1:2026-10-14',
          processed_at: '2026-10-14T00:00:00.000Z',
        })),
        batch_size: records.length,
      };
    }
    if (req.url === '/api/v1/maps' && req.method === 'PUT') {
      return { handle: 'svh1-' + 'b'.repeat(22), expires_at: '2026-10-15T00:00:00.000Z' };
    }
    if (req.url === '/api/v1/detect') return { entities: [], text_length: 0 };
    if (req.url === '/api/v1/usage') return { tier: 'standard', usage: { used: 0, limit: 10 } };
    throw new Error(`unmocked route: ${req.method} ${req.url}`);
  });
}

export interface CtxOptions {
  items: INodeExecutionData[];
  params: Record<string, unknown>;
  http: jest.Mock;
  executionId?: string | undefined;
  instanceId?: string | undefined;
  /** ``; `null` simulates a context with no workflow data proxy. */
  runIndex?: number | null;
  nodeId?: string;
  nodeName?: string;
  retryOnFail?: boolean;
}

export function ctxFor(opts: CtxOptions): IExecuteFunctions {
  const values: Record<string, unknown> = {
    resource: 'token',
    operation: 'tokenize',
    'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
    country: '',
    scopeId: '',
    outputMode: 'replaceInPlace',
    retryOnRateLimit: true,
    returnMode: 'recordId',
    consistency: 'stable',
    ...opts.params,
  };
  const executionId = 'executionId' in opts ? opts.executionId : EXECUTION_ID;
  const instanceId = 'instanceId' in opts ? opts.instanceId : INSTANCE_ID;
  return {
    getInputData: () => opts.items,
    getCredentials: jest.fn(async (name: string) =>
      name === 'synthaveilMapKey' ? { mapKey: MAP_KEY } : { baseUrl: DEFAULT_BASE_URL, apiKey: 'taas_sk_test_fake' },
    ),
    getNode: () => ({
      id: opts.nodeId ?? NODE_ID,
      name: opts.nodeName ?? 'Synthaveil',
      type: 'taas',
      retryOnFail: opts.retryOnFail ?? false,
      credentials: {
        taasApi: { id: '1', name: 'Synthaveil account' },
        synthaveilMapKey: { id: '2', name: 'Map key' },
      },
    }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) => (name in values ? values[name] : fallback),
    getExecutionId: () => executionId,
    getInstanceId: () => instanceId,
    ...(opts.runIndex === null ? {} : { getWorkflowDataProxy: () => ({ $thisRunIndex: opts.runIndex ?? RUN_INDEX }) }),
    continueOnFail: () => false,
    helpers: { httpRequestWithAuthentication: opts.http },
  } as unknown as IExecuteFunctions;
}

/** Every request the routed fake received, in order. */
export function sent(http: jest.Mock): SentRequest[] {
  return http.mock.calls.map((call) => call[1] as SentRequest);
}
