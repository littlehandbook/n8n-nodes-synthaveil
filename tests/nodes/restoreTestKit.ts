/**
 * Shared test kit for the Restore-operation suites: a mock IExecuteFunctions,
 * an item helper and a tiny routed fake of the TAAS API. Moved out of
 * restoreExecute.test.ts verbatim (plan 2026-09-08-n8n-restore-output, Task
 * 1.1) so restoreOutputShape.test.ts and restoreHints.test.ts can share it
 * instead of copying it, and so that 517-line file shrinks.
 *
 * Crypto in the suites that use this is real (sealContainer); nothing here
 * stubs WebCrypto.
 */
import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, INodeExecutionData } from 'n8n-workflow';

import { DEFAULT_BASE_URL } from '../../src/constants';

export const MASTER_KEY_BYTES = 32;
export const MAP_KEY = Buffer.from(new Uint8Array(MASTER_KEY_BYTES).fill(0x42)).toString('base64');
export const SCOPE_ID = 'crm-sync';
export const VALID_HANDLE = 'svh1-' + 'a'.repeat(22);

export const item = (json: IDataObject): INodeExecutionData => ({ json });

export interface ItemParams {
  mapHandle?: string;
  textField?: string;
}

export interface MockOptions {
  items: INodeExecutionData[];
  operation: 'tokenize' | 'restore' | 'tokenizeBatch';
  returnMode?: 'recordId' | 'localRestore';
  scopeId?: string;
  retryOnFail?: boolean;
  continueOnFail?: boolean;
  executionId?: string;
  itemParams?: ItemParams[]; // per-item override, for restore isolation tests
  /** Attached by default: n8n only reaches execute() once credentials are set. */
  mapKeyAttached?: boolean;
  http: jest.Mock;
}

export function mockCtx(opts: MockOptions): IExecuteFunctions {
  const shared: Record<string, unknown> = {
    resource: 'token',
    operation: opts.operation,
    returnMode: opts.returnMode ?? 'recordId',
    scopeId: opts.scopeId ?? SCOPE_ID,
    fieldsToTokenize: { field: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
    'fieldsToTokenize.field': [{ fieldName: 'name', method: 'l2.synthesize-name' }],
    country: '',
    outputMode: 'replaceInPlace',
    retryOnRateLimit: true,
    textField: 'text',
  };

  return {
    getInputData: () => opts.items,
    getCredentials: jest.fn((name: string) => {
      if (name === 'synthaveilMapKeyApi') return Promise.resolve({ mapKey: MAP_KEY });
      return Promise.resolve({ baseUrl: DEFAULT_BASE_URL, apiKey: 'k' });
    }),
    getNode: () => ({
      name: 'Synthaveil (TAAS)',
      type: 'taas',
      retryOnFail: opts.retryOnFail ?? false,
      credentials:
        opts.mapKeyAttached === false
          ? { taasApi: { id: '1', name: 'Synthaveil account' } }
          : {
              taasApi: { id: '1', name: 'Synthaveil account' },
              synthaveilMapKeyApi: { id: '2', name: 'Map key' },
            },
    }),
    getNodeParameter: (name: string, i: number, fallback?: unknown) => {
      const override = opts.itemParams?.[i];
      if (override && name in override) return (override as Record<string, unknown>)[name];
      return name in shared ? shared[name] : fallback;
    },
    continueOnFail: () => opts.continueOnFail ?? false,
    // Every-run maps are bound to the execution that sealed them, so restore
    // compares the consumed map's run_id against this.
    getExecutionId: () => opts.executionId ?? 'exec-1',
    helpers: { httpRequestWithAuthentication: opts.http },
  } as unknown as IExecuteFunctions;
}

/** Routes the shared http mock by request path, like a tiny fake TAAS API. */
export function routedHttp(routes: {
  tokenize?: IDataObject | ((body: IDataObject) => IDataObject);
  putMap?: IDataObject;
  consume?: IDataObject | Record<string, IDataObject>; // per-handle when a Record
}): jest.Mock {
  return jest.fn(
    async (
      _credName: string,
      req: { method: IHttpRequestMethods; url: string; body?: IDataObject },
    ) => {
      if (req.url === '/api/v1/tokenize' && routes.tokenize) {
        return typeof routes.tokenize === 'function' ? routes.tokenize(req.body ?? {}) : routes.tokenize;
      }
      if (req.url === '/api/v1/maps' && req.method === 'PUT' && routes.putMap) {
        return routes.putMap;
      }
      if (req.url?.startsWith('/api/v1/maps/') && req.url.endsWith('/consume')) {
        if (routes.consume && 'blob' in routes.consume) return routes.consume;
        const handle = req.url.split('/')[4];
        const byHandle = routes.consume as Record<string, IDataObject> | undefined;
        if (byHandle?.[handle]) return byHandle[handle];
        throw { statusCode: 404, response: { body: { code: 'map_consumed' } } };
      }
      throw new Error(`unmocked route: ${req.method} ${req.url}`);
    },
  );
}
