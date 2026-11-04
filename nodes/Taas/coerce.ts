import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INode } from 'n8n-workflow';

/**
 * The outbound `record` is a flat map of string → string (the hosted API's
 * `TokenizeRequest.record`). Item values arrive as arbitrary JSON, so each
 * selected field is coerced to a string here:
 *   - string           → passed through
 *   - number / boolean  → String(v)
 *   - null / undefined  → field SKIPPED (excluded from the record) + a warning
 *   - object / array    → hard error (NodeOperationError) naming the field —
 *                         silently stringifying `[object Object]` would ship
 *                         garbage to the tokeniser.
 */

export interface CoercionResult {
  /** The coerced string→string record to send. */
  record: Record<string, string>;
  /** Human-readable notes about fields skipped because they were empty. */
  warnings: string[];
}

export function coerceRecordValues(
  node: INode,
  json: IDataObject,
  fieldNames: readonly string[],
  itemIndex: number,
): CoercionResult {
  const record: Record<string, string> = {};
  const warnings: string[] = [];

  for (const name of fieldNames) {
    const value = json[name];

    if (value === null || value === undefined) {
      warnings.push(`Field "${name}" is empty on this item and was skipped.`);
      continue;
    }

    if (typeof value === 'string') {
      record[name] = value;
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      record[name] = String(value);
      continue;
    }

    // object / array — refuse rather than ship `[object Object]`.
    const kind = Array.isArray(value) ? 'a list' : 'an object';
    throw new NodeOperationError(
      node,
      `Field "${name}" is ${kind}; select a scalar (text/number) field to tokenise.`,
      { itemIndex },
    );
  }

  return { record, warnings };
}
