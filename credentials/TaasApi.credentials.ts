import type { Icon, IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';

import { DEFAULT_BASE_URL } from '../src/constants';

/**
 * Credential for the Synthaveil (TAAS) hosted API.
 *
 * Auth is a bearer API key issued in the commercial portal with explicit scopes
 * (`tokenize:read`, `tokenize:write`); tokenising additionally requires a signed
 * DPA. The connection check hits the side-effect-free `GET /api/v1/usage`
 * (`tokenize:read`, skips the DPA + quota gates) — it proves the base URL + key
 * connect, but cannot by itself prove write scope or DPA state. Those are
 * surfaced through error mapping + the README funnel (council conditions P3/C5),
 * with a server `GET /api/v1/whoami` backlogged as the proper fix.
 *
 * There is deliberately NO declarative `test` block here (IT Council SA-C1,
 * QA review of PR #633): a declarative `test.request.baseURL` can only be a
 * static expression, so it cannot refuse an unsafe `baseUrlOverride` (e.g.
 * `http://169.254.169.254`) before n8n builds and sends the request — the
 * Bearer key would go straight to it. The connection check instead runs
 * programmatically as `nodes/Taas/credentialTest.ts`'s `taasApiTest`,
 * registered via `testedBy: 'taasApiTest'` on the credential descriptor in
 * `nodes/Taas/nodeCredentials.ts`, which enforces the same base-URL policy
 * `resolveBaseUrl` uses at execution time before making any request.
 *
 * The `credential-test-required` lint rule's static check only recognises an
 * inline `credentials: [ ... ]` array literal in the node file; `Taas.node.ts`
 * references the imported `TAAS_CREDENTIALS` constant instead
 * (`nodeCredentials.ts`, pre-existing size-budget split), so the rule cannot
 * see the real `testedBy: 'taasApiTest'` entry there and reports a false
 * positive — disabled below with that reasoning.
 */
// eslint-disable-next-line @n8n/community-nodes/credential-test-required -- see class doc comment above; tested via testedBy in nodeCredentials.ts, not visible to this rule's static check
export class TaasApi implements ICredentialType {
  name = 'taasApi';

  displayName = 'Synthaveil API';

  documentationUrl = 'https://docs.synthaveil.com/api';

  // Themed SVG (copied to dist next to this file by scripts/copy-assets.mjs).
  // Placeholder shield mark; final branding may be refreshed at publish (1f).
  icon: Icon = { light: 'file:taas.svg', dark: 'file:taas.dark.svg' };

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'options',
      // Production default (FG-2, plan Task 0.3). There is no staging host in
      // this product — the option list has exactly one entry. A non-production
      // target (self-hosted, test) goes through `baseUrlOverride` below.
      options: [{ name: 'Production (api.synthaveil.com)', value: DEFAULT_BASE_URL }],
      default: DEFAULT_BASE_URL,
      description: 'API host to send requests to. Leave this as it is unless you have been given a different one.',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      required: true,
      default: '',
      description:
        'Activation requires your own Synthaveil API key. Create one in the Synthaveil portal (API Keys) — the node never works without it. ' +
        'Tick tokenize:read (usage, scan and this credential test) and tokenize:write (tokenise) when you create the key, and restore only if this credential runs a Restore step.',
    },
    {
      // A1/I5 escape hatch: relaxes ONLY the synthaveil.com host allow-list
      // (finding D — never the https requirement; plain-http stays limited to
      // loopback hosts). Deliberately visible (never hidden) so the operator
      // makes an explicit choice; transport.ts resolveBaseUrl is the
      // execution-time enforcement seam.
      displayName: 'Allow non-production URL (local development)',
      name: 'allowNonProductionUrl',
      type: 'boolean',
      default: false,
      description:
        'Permit a non-synthaveil.com base URL over https, or plain-http for localhost only. Enforced at execution time; leave off in production.',
    },
    {
      // The free-text escape hatch for a self-hosted or test endpoint, shown
      // only once the toggle above is on — "Base URL" itself stays a closed
      // options list so a workflow JSON can't smuggle in an arbitrary host.
      displayName: 'Base URL Override (self-hosted / test only)',
      name: 'baseUrlOverride',
      type: 'string',
      default: '',
      displayOptions: { show: { allowNonProductionUrl: [true] } },
      description:
        'Only for a self-hosted or test endpoint. Used instead of Base URL when set; still checked at execution time (https required except for localhost).',
    },
  ];

  /**
   * n8n injects these into every request. The property is `headers` (plural) —
   * this is the shape of `IRequestOptionsSimplifiedAuth` and of n8n's own
   * bearer-credential template. A singular `header` is an unknown key n8n
   * silently ignores, dropping the token (council condition P2's stated intent —
   * see the credential unit test, which pins the working form).
   */
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };
}
