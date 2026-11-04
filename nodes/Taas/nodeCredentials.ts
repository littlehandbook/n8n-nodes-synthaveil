import type { IExecuteFunctions, INodeCredentialDescription } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { CREDENTIAL_NAME, MAP_KEY_CREDENTIAL_NAME } from '../../src/constants';

/**
 * Credential descriptors for the Taas node.
 *
 * Extracted from `Taas.node.ts` to keep that file under the 300-line house cap
 * once the Map Key needed its own display rule.
 *
 * Deliberately NOT under `properties/`, where the other extracted declaration
 * blocks live: the sc-011 boundary rule (tests/boundary.test.ts and its ESLint
 * twin) treats any `../../../` from `nodes/**` as an escape from the package,
 * which is correct for `nodes/Taas/*.ts` but one hop short for a file nested a
 * directory deeper. `properties/*.ts` therefore cannot reach the package's own
 * `src/constants`, and this module needs the credential names from there. The
 * boundary rule is the thing worth keeping strict, so the file moved instead.
 *
 * EXACTLY ONE descriptor per credential name. That is a hard runtime
 * constraint, not a style preference: n8n resolves a credential with
 *
 *     nodeType.description.credentials.find((c) => c.name === type)
 *
 * (n8n-core, `_getCredentials`) and then evaluates `NodeHelpers.displayParameter`
 * against THAT descriptor alone, throwing `Credentials not found` when it does
 * not match. A second descriptor sharing the name is dead at runtime: the
 * editor renders its field, the operator fills it in, and the node still fails.
 *
 * PR #523 shipped two Map Key descriptors on the belief that a single `show`
 * block cannot express the OR between the two journeys that need the key
 * (Tokenize with Return Mode "Local restore", and Restore). The premise is
 * right about `show` and wrong about the remedy: the second descriptor never
 * ran, so every Restore threw `Credentials not found` with a correctly
 * configured credential sitting on screen. The union of those journeys is
 * exactly the Token resource, so one descriptor keyed on `resource` covers
 * both without needing an OR.
 *
 * `required` is therefore false, and has to be: the descriptor is now also on
 * screen for Tokenize with Return Mode "Record ID", which needs no map key at
 * all, and `required: true` would raise a blocking node issue on that journey.
 * The cost is that n8n's own missing-credential path degrades to the unhelpful
 * "Node does not require credentials" — `readMapKey` below replaces it.
 */
export const TAAS_CREDENTIALS: INodeCredentialDescription[] = [
  {
    name: CREDENTIAL_NAME,
    required: true,
    // Programmatic connection check (IT Council SA-C1) — see
    // `credentialTest.ts`'s `taasApiTest`, wired up via `methods.credentialTest`
    // on `Taas.node.ts`. Replaces a declarative `test` block, which cannot
    // refuse an unsafe `baseUrlOverride` before the request is built.
    testedBy: 'taasApiTest',
  },
  {
    name: MAP_KEY_CREDENTIAL_NAME,
    required: false,
    displayOptions: { show: { resource: ['token'] } },
  },
];

const MAP_KEY_MISSING =
  'No Map Key credential is set on this node. Both "Local restore" tokenizing and the ' +
  'Restore operation seal and open the map with a key that never leaves your n8n, so ' +
  'this node cannot run without one.';

/**
 * Read the sealed-map key, failing with a message that names the real problem.
 *
 * Guards BEFORE `getCredentials` rather than catching its throw, so a genuine
 * decryption or lookup failure still surfaces as itself.
 */
export async function readMapKey(ctx: IExecuteFunctions): Promise<string> {
  if (!ctx.getNode().credentials?.[MAP_KEY_CREDENTIAL_NAME]) {
    throw new NodeOperationError(ctx.getNode(), MAP_KEY_MISSING, { level: 'warning' });
  }

  const credentials = await ctx.getCredentials(MAP_KEY_CREDENTIAL_NAME);
  return String(credentials.mapKey ?? '');
}
