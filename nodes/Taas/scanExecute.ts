import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';

import { DETECT_PATH } from '../../src/constants';
import { resolveScanText, shapeScanResult } from './scan';
import { taasRequest } from './transport';
import type { OperationContext } from './singleExecute';

/**
 * Per-item execution glue for the Scan operation. Kept out of
 * `Taas.node.ts` (declaration + dispatch only) and out of `singleExecute.ts`
 * (which owns the token/account ops), mirroring the builder/glue split used
 * across the package.
 */

const HTTP_POST: IHttpRequestMethods = 'POST';

/** POST /api/v1/detect for one input item — validate, scan, shape the result. */
export async function scanTextItem(
  ctx: IExecuteFunctions,
  op: OperationContext,
): Promise<IDataObject> {
  const { baseUrl, itemIndex } = op;
  const itemJson = ctx.getInputData()[itemIndex].json;
  const textField = ctx.getNodeParameter('textField', itemIndex, '') as string;
  const retryOnRateLimit = ctx.getNodeParameter('retryOnRateLimit', itemIndex, true) as boolean;

  const text = resolveScanText(ctx.getNode(), itemJson, textField, itemIndex);
  const response = await taasRequest(ctx, {
    baseUrl,
    method: HTTP_POST,
    path: DETECT_PATH,
    body: { text } as IDataObject,
    retryOnRateLimit,
  });

  // ScanResult is a named interface (no index signature) but all members are
  // JSON-safe; bridge it to the transport/runOperation IDataObject contract.
  return shapeScanResult(response) as unknown as IDataObject;
}
