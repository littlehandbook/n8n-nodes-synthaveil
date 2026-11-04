import type { INodeProperties } from 'n8n-workflow';

/**
 * Properties for the Restore operation (Task 3.2, plan Phase P3). Extracted
 * from `Taas.node.ts` for the same reason as `returnMode.ts` — the node file
 * is at the 300-line ceiling (council condition PC-1).
 *
 * The Restore *operation option* itself (in the Operation dropdown) stays
 * inline in `Taas.node.ts` rather than living here too: the eslint plugin's
 * `node-param-operation-option-action-miscased` rule walks the dropdown's
 * `options` array expecting literal object expressions and crashes on an
 * imported identifier in that position.
 */

/** Handle for the sealed map produced by a prior Local restore Tokenize step. */
export const mapHandleProperty: INodeProperties = {
  displayName: 'Map Handle',
  name: 'mapHandle',
  type: 'string',
  default: '={{ $json.synthaveil_map_handle }}',
  description: 'Handle for the sealed map produced by a prior Local restore Tokenize step',
  displayOptions: { show: { resource: ['token'], operation: ['restore'] } },
};

/** Name of the input field holding text containing tokens to restore. */
export const restoreTextFieldProperty: INodeProperties = {
  displayName: 'Text Field',
  name: 'textField',
  type: 'string',
  default: '',
  placeholder: 'e.g. text',
  description:
    'Name of the input field holding the AI output to restore. It is restored in place: the item ' +
    'leaves this node with every other field intact and only this one changed.',
  displayOptions: { show: { resource: ['token'], operation: ['restore'] } },
};
