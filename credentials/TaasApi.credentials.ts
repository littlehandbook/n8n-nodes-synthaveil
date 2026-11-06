import type {
  Icon,
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

import {
  DEFAULT_BASE_URL,
  HTTP_FORBIDDEN,
  HTTP_UNAUTHORIZED,
  REDIRECT_REFUSED_RULES,
  USAGE_PATH,
} from '../src/constants';
import { TEST_BASE_URL_EXPRESSION } from '../src/credentialTestTarget';

/**
 * Credential for the Synthaveil (TAAS) hosted API.
 *
 * Auth is a bearer API key issued in the commercial portal with explicit scopes
 * (`tokenize:read`, `tokenize:write`); tokenising additionally requires a signed
 * DPA. The connection check hits the side-effect-free `GET /api/v1/usage`
 * (`tokenize:read`, skips the DPA + quota gates) — it proves the key connects,
 * but cannot by itself prove write scope or DPA state. Those are surfaced
 * through error mapping + the README funnel (council conditions P3/C5), with a
 * server `GET /api/v1/whoami` backlogged as the proper fix.
 *
 * The declarative `test` below sends the key only to the server the operator
 * chose (owner decision, 6 Nov 2026, Codex P1 on PR #1741, refining IT Council
 * SA-C1 of 24 Sep 2026, which had locked it to `DEFAULT_BASE_URL`). With "Allow
 * non-production URL" on and a non-empty `baseUrlOverride`, the Test targets the
 * override, but only when it passes a strict subset of execution's
 * `checkBaseUrlPolicy`; a refused override goes to the reserved
 * `REFUSED_OVERRIDE_BASE_URL` (`.invalid`) and fails without sending the key
 * anywhere. Otherwise, including toggle on with an empty override, production.
 * See `src/credentialTestTarget.ts`. `url` stays a relative path, n8n's generic
 * `authenticate` adds only the Authorization header, and `disableFollowRedirect`
 * stops a redirect from carrying the key anywhere else. `$credentials.baseUrl`
 * is not read: its only option is `DEFAULT_BASE_URL`.
 */
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
        'Tick tokenize:read (usage, scan and this credential test) and tokenize:write (tokenise) when you create the key, and restore only if this credential runs a Restore step. ' +
        'The Test button sends the key only to the server you chose: api.synthaveil.com, or your Base URL Override when that is on.',
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
      // SA-2: keyed on the toggle alone, not on `baseUrlOverride`, so it is
      // also shown while the override is still empty.
      displayName:
        'The Test button checks your key against the override below, and sends your key only there. While the override is empty it checks api.synthaveil.com instead. An override that is not https (plain http only for localhost) fails the Test without your key being sent anywhere, and the workflow refuses to run with it.',
      name: 'overrideTestNotice',
      type: 'notice',
      default: '',
      displayOptions: { show: { allowNonProductionUrl: [true] } },
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

  /** Connection check against the chosen server — see the class doc comment. */
  test: ICredentialTestRequest = {
    request: {
      baseURL: TEST_BASE_URL_EXPRESSION,
      url: USAGE_PATH,
      method: 'GET',
      disableFollowRedirect: true,
    },
    rules: [
      {
        type: 'responseCode',
        properties: {
          value: HTTP_UNAUTHORIZED,
          message:
            'API key not accepted by api.synthaveil.com. Check the key in the Synthaveil portal (API Keys). ' +
            'With a Base URL Override on, the key was checked against the override instead.',
        },
      },
      {
        type: 'responseCode',
        properties: {
          value: HTTP_FORBIDDEN,
          message:
            'This API key lacks the tokenize:read scope needed for the connection test. ' +
            'Re-issue it in the portal with tokenize:read and tokenize:write.',
        },
      },
      ...REDIRECT_REFUSED_RULES,
    ],
  };
}
