import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';

import { V1_BATCH_MAX_RECORDS } from '../../src/constants';
import { taasApiTest } from './credentialTest';
import { buildApiError, perItemErrorRow } from './errors';
import { METHOD_OPTIONS } from './methodCatalog';
import { consistencyProperty } from './properties/consistency';
import { mapHandleProperty, restoreTextFieldProperty } from './properties/restore';
import { returnModeProperty } from './properties/returnMode';
import { TAAS_CREDENTIALS } from './nodeCredentials';
import { RESTORE_CONTINUE_ON_FAIL_HINT, RESTORE_RETRY_HINT, TOKENIZE_RETRY_NOTICE } from './requestHints';
import { dispatchBeforeItemLoop } from './preDispatch';
import { runOperation } from './singleExecute';
import { resolveBaseUrl } from './transport';

const CONSISTENCY_EXPLAINER =
  'Same scope gives the same tokens for the same values across runs. Leave empty and tokens rotate daily.';

/** Token-resource operations that share the field/scope/country/output controls. */
const TOKENIZE_OPS = ['tokenize', 'tokenizeBatch'];
/** Token-resource operations whose scope must match a prior seal (adds Restore). */
const SCOPE_AWARE_OPS = [...TOKENIZE_OPS, 'restore'];

export class Taas implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Synthaveil',
    name: 'taas',
    icon: { light: 'file:taas.svg', dark: 'file:taas.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description:
      'Anonymise personal data fields before sending them to an LLM or third party. ' +
      'Deterministic, consistent synthetic replacements (L1/L2/L3) that preserve format ' +
      'and analytics, via the Synthaveil hosted API.',
    defaults: {
      name: 'Synthaveil',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: TAAS_CREDENTIALS,
    hints: [RESTORE_RETRY_HINT, RESTORE_CONTINUE_ON_FAIL_HINT],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Account', value: 'account' },
          { name: 'Text', value: 'text' },
          { name: 'Token', value: 'token' },
        ],
        default: 'account',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['account'] } },
        options: [
          {
            name: 'Get Usage',
            value: 'getUsage',
            description: 'Read the current period usage, quota and tier',
            action: 'Get usage and quota',
          },
        ],
        default: 'getUsage',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['token'] } },
        options: [
          {
            name: 'Restore',
            value: 'restore',
            description:
              'Restore the original values inside text using a sealed map from a prior ' +
              'Local restore Tokenize step. Turn off "Retry On Fail" for this node — the ' +
              'map is destroyed on first hand-over.',
            action: 'Restore original values from a sealed map',
          },
          {
            name: 'Tokenize',
            value: 'tokenize',
            description: 'Protect selected fields of a record',
            action: 'Tokenize a record',
          },
          {
            name: 'Tokenize (Batch)',
            value: 'tokenizeBatch',
            description:
              // Retry/billing notice (#619): one copy, in requestHints.ts.
              'Protect selected fields across many records in one request. ' + TOKENIZE_RETRY_NOTICE,
            action: 'Tokenize a batch of records',
          },
        ],
        default: 'tokenize',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['text'] } },
        options: [
          {
            name: 'Scan Text',
            value: 'scanText',
            description: 'Finds personal data in free text. Does not auto-configure tokenization.',
            action: 'Scan text for personal data',
          },
        ],
        default: 'scanText',
      },
      {
        displayName: 'Text Field',
        name: 'textField',
        type: 'string',
        default: '',
        placeholder: 'e.g. notes',
        description:
          'Name of the input field holding the free text to scan (up to 100,000 characters). ' +
          'Read-only: this finds personal data, it does not change or tokenise the text.',
        displayOptions: { show: { resource: ['text'], operation: ['scanText'] } },
      },
      {
        displayName:
          'Only the fields you map below are sent to the API. Any other field on the item is left untouched and never leaves n8n.',
        name: 'unmappedFieldsNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['token'], operation: TOKENIZE_OPS } },
      },
      {
        displayName: 'Fields to Tokenize',
        name: 'fieldsToTokenize',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['token'], operation: TOKENIZE_OPS } },
        options: [
          {
            name: 'field',
            displayName: 'Field',
            values: [
              {
                displayName: 'Field Name',
                name: 'fieldName',
                type: 'string',
                default: '',
                placeholder: 'e.g. email',
                description: 'Name of the field on the input item to protect',
              },
              {
                displayName: 'Method',
                name: 'method',
                type: 'options',
                options: METHOD_OPTIONS,
                default: 'l1.token-stateless',
                description: 'How to protect this field',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Scope ID',
        name: 'scopeId',
        type: 'string',
        default: '',
        placeholder: 'e.g. crm-sync',
        description: CONSISTENCY_EXPLAINER,
        displayOptions: { show: { resource: ['token'], operation: SCOPE_AWARE_OPS } },
      },
      consistencyProperty,
      returnModeProperty,
      mapHandleProperty,
      restoreTextFieldProperty,
      {
        displayName: 'Country',
        name: 'country',
        type: 'options',
        options: [
          { name: 'Canada', value: 'CA' },
          { name: 'Ireland', value: 'IE' },
          { name: 'Not Set (Server Default)', value: '' },
          { name: 'United Kingdom', value: 'GB' },
          { name: 'United States', value: 'US' },
        ],
        default: '',
        description: 'Locale hint for realistic replacements',
        displayOptions: { show: { resource: ['token'], operation: TOKENIZE_OPS } },
      },
      {
        displayName: 'Output Mode',
        name: 'outputMode',
        type: 'options',
        options: [
          {
            name: 'Replace in Place',
            value: 'replaceInPlace',
            description: 'Overwrite the mapped fields with their tokenised values',
          },
          {
            name: 'Sub-Object',
            value: 'subObject',
            description: 'Add the tokenised record under a "tokenized" key, keeping originals',
          },
        ],
        default: 'replaceInPlace',
        displayOptions: { show: { resource: ['token'], operation: TOKENIZE_OPS } },
      },
      {
        displayName: 'Retry on Rate Limit',
        name: 'retryOnRateLimit',
        type: 'boolean',
        default: true,
        description: 'Whether to retry once when the API returns a 429 (a rate-limited request is not billed)',
        displayOptions: { show: { resource: ['token'], operation: TOKENIZE_OPS } },
      },
      {
        displayName: 'Batch Size',
        name: 'batchSize',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: V1_BATCH_MAX_RECORDS },
        default: V1_BATCH_MAX_RECORDS,
        description:
          'Records per API request (max 100; automatically capped at 50 when any field uses an L3 method)',
        displayOptions: { show: { resource: ['token'], operation: ['tokenizeBatch'] } },
      },
      {
        displayName: TOKENIZE_RETRY_NOTICE,
        name: 'batchBillingNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['token'], operation: ['tokenizeBatch'] } },
      },
    ],
  };

  // Registered via `testedBy: 'taasApiTest'` on the credential descriptor
  // (`nodeCredentials.ts`) — see `credentialTest.ts` for why this is
  // programmatic rather than the credential's own declarative `test`.
  methods = {
    credentialTest: { taasApiTest },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const baseUrl = await resolveBaseUrl(this);
    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;

    // Restore's retry guard and Batch's whole-input fan-out both dispatch
    // before the per-item loop (throws or returns a full result set).
    const special = await dispatchBeforeItemLoop(this, resource, operation, baseUrl);
    if (special) return special;

    for (let i = 0; i < items.length; i++) {
      try {
        const json = await runOperation(this, { resource, operation, baseUrl, itemIndex: i });
        returnData.push({ json, pairedItem: { item: i } });
      } catch (error) {
        if (!this.continueOnFail()) {
          throw buildApiError(this.getNode(), error, i, baseUrl);
        }
        returnData.push(perItemErrorRow(error, i, baseUrl));
      }
    }

    return [returnData];
  }
}
