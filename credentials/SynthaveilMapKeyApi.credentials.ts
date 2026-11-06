import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

import { DEFAULT_BASE_URL, HEALTH_PATH, REDIRECT_REFUSED_RULES } from '../src/constants';

/**
 * Credential for the Local Restore Map Key (Task 3.1, plan Phase P3).
 *
 * Distinct from `taasApi` (the hosted API bearer key): this key never leaves
 * n8n and Synthaveil never sees it. It is the symmetric key sealed maps are
 * encrypted under (`nodes/Taas/sealedMap.ts`) — losing it makes every sealed
 * map made with it permanently unopenable (CC-17: the warning must be seen
 * BEFORE the key is entered, so `lostKeyNotice` is first in `properties`).
 *
 * Named, iconed and tested the way n8n's checker requires of every credential,
 * following the verified `n8n-nodes-nostr` precedent for a local
 * secret with no endpoint of its own: an `Api` suffix, an icon, and a
 * declarative `test` that sends NO secret. The class deliberately has no
 * `authenticate`, so n8n attaches nothing from this credential to the Test
 * request: it is a plain GET to the public health endpoint on the fixed
 * production host, and proves only that Synthaveil is reachable. The key's
 * shape is checked where it is used (`readMapKey`, `sealedMap.ts`).
 */
export class SynthaveilMapKeyApi implements ICredentialType {
  name = 'synthaveilMapKeyApi';

  displayName = 'Synthaveil Map Key (Local Restore) API';

  documentationUrl = 'https://synthaveil.com/docs/n8n/local-restore';

  // Same themed SVG as the Synthaveil API credential (copy-assets.mjs puts it in dist).
  icon: Icon = { light: 'file:taas.svg', dark: 'file:taas.dark.svg' };

  properties: INodeProperties[] = [
    {
      displayName: 'Lost key = lost maps',
      name: 'lostKeyNotice',
      type: 'notice',
      default: '',
      description:
        'This key never leaves your n8n. Synthaveil cannot recover it. If you lose it, every sealed map made with it is gone for good. Your N8N_ENCRYPTION_KEY protects this credential at rest — back both up. ' +
        'The Test button only checks that Synthaveil can be reached; your key is never sent.',
    },
    {
      displayName: 'Map key (32 bytes, base64)',
      name: 'mapKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Generate: macOS/Linux `openssl rand -base64 32` · Windows PowerShell `$b=[byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`',
    },
  ];

  /** Reachability check that sends nothing from this credential — see the class doc comment. */
  test: ICredentialTestRequest = {
    request: {
      baseURL: DEFAULT_BASE_URL,
      url: HEALTH_PATH,
      method: 'GET',
      disableFollowRedirect: true,
    },
    rules: REDIRECT_REFUSED_RULES,
  };
}
