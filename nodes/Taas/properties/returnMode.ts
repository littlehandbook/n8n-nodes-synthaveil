import type { INodeProperties } from 'n8n-workflow';

/**
 * `Return Mode` (M1.3) — how tokenised results find their way back to the user.
 *
 * `recordId` keeps Record ID behaviour byte-identical to v1 (the golden
 * fixtures pin this, AC15): the execute path ignores this parameter for that
 * value. `localRestore` (plan P3) seals a map on this n8n install with a key
 * that never leaves it — see `nodes/Taas/sealedMap.ts` and the Restore
 * operation, gated behind the `synthaveilMapKey` credential.
 *
 * The label is Title Case ("Return Mode", not the plan's "Return mode") because
 * n8n's own lint rule `n8n-nodes-base/node-param-display-name-miscased` is an
 * error, and that rule set is what the community-package scanner runs at publish.
 *
 * Lives in its own module because `Taas.node.ts` is at the 300-line ceiling and
 * council condition PC-1 extracts the property blocks to `properties/*.ts`
 * during the standard-layout move (plan Task 0.7). This is the first of them.
 */
export const returnModeProperty: INodeProperties = {
  displayName: 'Return Mode',
  name: 'returnMode',
  type: 'options',
  default: 'recordId',
  options: [
    {
      name: 'Record ID',
      value: 'recordId',
      description:
        'Your record ID is never tokenised and survives the AI step. No mapping is stored anywhere by anyone.',
    },
    {
      // eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased -- exact string pinned by tests/nodes/restoreExecute.test.ts
      name: 'Local restore',
      value: 'localRestore',
      // eslint-disable-next-line n8n-nodes-base/node-param-description-excess-final-period -- G5 governance sentence (CC-6), quoted verbatim
      description:
        'The map is sealed on your n8n with a key that never leaves it; Synthaveil stores bytes it cannot open and destroys them the moment it hands the map back (one-shot).',
    },
  ],
  description: 'How results come back to you',
  displayOptions: { show: { resource: ['token'] } },
};
