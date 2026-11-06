import { Expression } from 'n8n-workflow';
import type { ICredentialDataDecryptedObject, ICredentialType } from 'n8n-workflow';

import { TaasApi } from '../../credentials/TaasApi.credentials';

/**
 * Renders the API key credential's declarative Test request the way n8n does:
 * a `=`-prefixed value is an expression, resolved by n8n-workflow's own engine
 * with the credential's decrypted data as `$credentials`. No n8n runtime is
 * needed for that, so these tests run the real resolver, not a stand-in.
 */
function render(value: unknown, credentials: ICredentialDataDecryptedObject): unknown {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  return Expression.resolveWithoutWorkflow(value.slice(1), { $credentials: credentials });
}

/** Joins base and path as axios does: one slash between them. */
function joinUrl(baseURL: string, url: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

export type RenderedTestRequest = {
  baseURL: unknown;
  /** The absolute URL the Test request goes to. */
  href: string;
  /** The Authorization header n8n's generic `authenticate` adds to it. */
  authorization: unknown;
};

/** The Test request n8n would send for these credential values. */
export function renderTestRequest(credentials: ICredentialDataDecryptedObject): RenderedTestRequest {
  const cred = new TaasApi() as ICredentialType;
  const request = cred.test?.request ?? {};
  const baseURL = render(request.baseURL, credentials);
  const headers = (cred.authenticate as { properties: { headers: Record<string, string> } })
    .properties.headers;
  return {
    baseURL,
    href: joinUrl(String(baseURL), String(request.url)),
    authorization: render(headers.Authorization, credentials),
  };
}
