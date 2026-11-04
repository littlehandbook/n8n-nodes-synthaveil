import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Credential for the Local-restore Map Key (Task 3.1, plan Phase P3).
 *
 * Distinct from `taasApi` (the hosted API bearer key): this key never leaves
 * n8n and Synthaveil never sees it. It is the symmetric key sealed maps are
 * encrypted under (`nodes/Taas/sealedMap.ts`) — losing it makes every sealed
 * map made with it permanently unopenable (CC-17: the warning must be seen
 * BEFORE the key is entered, so `lostKeyNotice` is first in `properties`).
 *
 * The scanner's generic "-Api" naming/icon/test-property rules assume every
 * credential authenticates an HTTP connection. This one does not: it is a
 * local symmetric key that never leaves n8n, so there is no connection to
 * test and "Api" would misdescribe it. Class/field names and the display name
 * are pinned verbatim by `tests/credentials/SynthaveilMapKey.credentials.test.ts`
 * and the plan (Task 3.1) — disabled below rather than renamed.
 */
// eslint-disable-next-line @n8n/community-nodes/credential-test-required, @n8n/community-nodes/icon-validation, @n8n/community-nodes/cred-class-field-icon-missing, @n8n/community-nodes/cred-class-name-suffix, n8n-nodes-base/cred-class-name-unsuffixed -- see class doc comment above
export class SynthaveilMapKey implements ICredentialType {
  // eslint-disable-next-line n8n-nodes-base/cred-class-field-name-unsuffixed, @n8n/community-nodes/cred-class-name-field-conventions -- see class doc comment above
  name = 'synthaveilMapKey';

  // eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-miscased, n8n-nodes-base/cred-class-field-display-name-missing-api -- exact string pinned by the credential test
  displayName = 'Synthaveil Map Key (Local restore)';

  documentationUrl = 'https://synthaveil.com/docs/n8n/local-restore';

  properties: INodeProperties[] = [
    {
      displayName: 'Lost key = lost maps',
      name: 'lostKeyNotice',
      type: 'notice',
      default: '',
      description:
        'This key never leaves your n8n. Synthaveil cannot recover it. If you lose it, every sealed map made with it is gone for good. Your N8N_ENCRYPTION_KEY protects this credential at rest — back both up.',
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
}
