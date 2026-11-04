import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INode } from 'n8n-workflow';

import { V1_DETECT_MAX_CHARS } from '../../src/constants';

/**
 * Pure input resolution for the Scan Text operation. Reads the named text field
 * off one input item and validates it against the hosted `/api/v1/detect`
 * contract (non-empty string, ≤100000 chars) BEFORE any network call, so the
 * operator gets a clear per-item error instead of a raw 400. Side-effect-free so
 * the failsafe/oversize cases can be exercised directly.
 */

/** The shape emitted per item, mirroring `docs/api/openapi.yaml` DetectResponse. */
export interface ScanResult {
  spans: unknown[];
  countsByType: IDataObject;
  rulesetVersion: unknown;
}

/**
 * Look up + validate the text to scan. Throws a `NodeOperationError` (carrying
 * `itemIndex`) when the field is unset, is not a string, is empty, or exceeds
 * the API's character cap.
 */
export function resolveScanText(
  node: INode,
  itemJson: IDataObject,
  textField: string,
  itemIndex: number,
): string {
  const field = (textField ?? '').trim();
  if (field === '') {
    throw new NodeOperationError(node, 'Set the name of the text field to scan.', { itemIndex });
  }

  const value = itemJson[field];
  if (typeof value !== 'string') {
    throw new NodeOperationError(
      node,
      `Field "${field}" is not text; Scan Text needs a string field.`,
      { itemIndex },
    );
  }
  if (value.length === 0) {
    throw new NodeOperationError(node, `Field "${field}" is empty; there is nothing to scan.`, {
      itemIndex,
    });
  }
  if (value.length > V1_DETECT_MAX_CHARS) {
    throw new NodeOperationError(
      node,
      `Text is too long (${value.length} characters); the API scans at most ${V1_DETECT_MAX_CHARS}.`,
      { itemIndex },
    );
  }
  return value;
}

/** Normalise the raw detect response into the item's output JSON. */
export function shapeScanResult(response: IDataObject): ScanResult {
  return {
    spans: Array.isArray(response.spans) ? (response.spans as unknown[]) : [],
    countsByType: (response.countsByType as IDataObject) ?? {},
    rulesetVersion: response.rulesetVersion,
  };
}
