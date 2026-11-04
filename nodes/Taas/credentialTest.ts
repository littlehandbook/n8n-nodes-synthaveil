import type {
  ICredentialsDecrypted,
  ICredentialTestFunctions,
  IDataObject,
  INodeCredentialTestResult,
} from 'n8n-workflow';

import { baseUrlRefusalMessage, selectBaseUrl } from '../../src/baseUrlPolicy';
import { USAGE_PATH } from '../../src/constants';
import { extractStatusCode } from './errors';

/**
 * Programmatic credential test (SA-C1 / IT Council PR #633).
 *
 * A DECLARATIVE `test.request.baseURL` can only be a static expression — there
 * is no way to refuse an unsafe `baseUrlOverride` before n8n builds and sends
 * the request, so an override of `http://169.254.169.254` would have the
 * Bearer key sent to it. This function runs the SAME policy `resolveBaseUrl`
 * (`transport.ts`) enforces at execution time, and returns an `Error` result
 * WITHOUT making any HTTP call when that policy refuses the target.
 *
 * Target selection is NOT decided here. `selectBaseUrl` (`src/baseUrlPolicy.ts`)
 * is the one implementation, called by this function and by `resolveBaseUrl`
 * at execution time, so the Test button and execution can never target
 * different hosts for the same credential, and never report success for a
 * credential execution would refuse.
 */

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** Maps a thrown transport error's HTTP status to the existing C5 messages. */
function statusMessage(status: number | undefined): string {
  if (status === HTTP_UNAUTHORIZED) {
    return 'This API key is invalid or revoked. Create a key in the Synthaveil commercial portal.';
  }
  if (status === HTTP_FORBIDDEN) {
    return (
      'This API key is missing the tokenize:read scope needed for the connection test. ' +
      'Re-issue it in the portal with tokenize:read and tokenize:write.'
    );
  }
  if (status === HTTP_NOT_FOUND) {
    return 'No TAAS API found at this Base URL. Check the API host selection — the API may not be enabled on this environment.';
  }
  return 'Could not reach the TAAS API at this Base URL.';
}

/** `methods.credentialTest.taasApiTest` — registered via `testedBy` in `nodeCredentials.ts`. */
export async function taasApiTest(
  this: ICredentialTestFunctions,
  credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
  const data = (credential.data ?? {}) as IDataObject;
  const target = selectBaseUrl(data);
  if (!target.ok) return { status: 'Error', message: baseUrlRefusalMessage(target.reason) };

  try {
    // ICredentialTestFunctions.helpers exposes ONLY `request` (n8n-workflow
    // Interfaces.d.ts) — `httpRequest` is not on this narrower interface, so
    // the deprecation warning does not have an alternative to move to here.
    // eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
    await this.helpers.request({
      method: 'GET',
      uri: `${target.url}${USAGE_PATH}`,
      headers: { Authorization: `Bearer ${String(data.apiKey ?? '')}` },
      json: true,
    });
    return { status: 'OK', message: 'Connection successful!' };
  } catch (error) {
    return { status: 'Error', message: statusMessage(extractStatusCode(error)) };
  }
}
