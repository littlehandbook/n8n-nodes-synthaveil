import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { MAP_CONSISTENCY_EVERY_RUN } from '../../src/constants';
import { restoreText } from '../../vendor/restore-protocol';
import { base64ToBytes } from './base64';
import { openContainer } from './sealedMap';

const MAP_GONE_MESSAGE =
  "The map is gone — it has already been used, expired, or the key doesn't match; it can't be restored again.";

/**
 * Refusal when the consumed map was sealed for a DIFFERENT execution.
 *
 * Deliberately does not suggest retrying: the map has already been consumed
 * and is gone, so the only useful instruction is to check where the handle
 * came from.
 */
const RUN_ID_MISMATCH_MESSAGE =
  'This sealed map was created by a different workflow run, so it was not used to restore this item. Check that the Map Handle comes from the Tokenize node in this same execution.';
const RESTORE_FAILED_MESSAGE = 'The map could not be applied to this text.';

/**
 * The output item is the INPUT item with a patch applied — never a fresh
 * object. Restore used to emit `{ text, restore_report }` alone, discarding
 * the record's id and every field Tokenize had preserved, so after Restore
 * nothing could say whose text it was (D-RM-11). `synthaveil_map_handle` is
 * dropped on the way through: the map it named has just been consumed, and a
 * dead handle only invites a second Restore that can fail one way.
 */
function keepRecord(itemJson: IDataObject, patch: IDataObject): IDataObject {
  const rest: IDataObject = { ...itemJson };
  delete rest.synthaveil_map_handle;
  return { ...rest, ...patch };
}

/**
 * Turn a consumed map into restored text, written back into `textField` in
 * place so the item leaves Restore in the shape it entered Tokenize.
 *
 * Split out of `restoreItem` (which now only gathers inputs and consumes) so
 * both stay inside the house size limits. Every failure here returns a row
 * rather than throwing: the map is already destroyed by the time this runs, so
 * "it did not work" is an outcome to report, not an exception to retry. No
 * failure path carries sealed bytes or the entry inventory (FR-2.5), and every
 * path — failure included — keeps the rest of the record (FR-C).
 */
export async function applyConsumedMap(
  ctx: IExecuteFunctions,
  input: {
    consumeResponse: IDataObject;
    mapKeyB64: string;
    scopeId: string;
    text: string;
    itemJson: IDataObject;
    textField: string;
  },
): Promise<IDataObject> {
  const { consumeResponse, mapKeyB64, scopeId, text, itemJson, textField } = input;

  // The store records which run a map was sealed for, and nothing was checking
  // it. Two maps in the same scope are cryptographically interchangeable by
  // design (PROTOCOL.md 5a records that trade-off and names the store's run_id
  // as the binding), so a stale or swapped handle from another execution opens
  // perfectly well and would silently restore another record's real names into
  // this item's text. The scope check cannot catch that; only this can.
  const mapRunId = consumeResponse.run_id;
  if (
    consumeResponse.consistency === MAP_CONSISTENCY_EVERY_RUN &&
    typeof mapRunId === 'string' &&
    mapRunId !== ctx.getExecutionId()
  ) {
    return keepRecord(itemJson, { failure_code: 'RUN_ID_MISMATCH', error: RUN_ID_MISMATCH_MESSAGE });
  }

  const masterKey = base64ToBytes(mapKeyB64);
  const bytes = base64ToBytes(String(consumeResponse.blob ?? ''));
  const opened = await openContainer(bytes, scopeId, masterKey);
  if (!opened.ok) {
    return keepRecord(itemJson, { failure_code: opened.code, error: MAP_GONE_MESSAGE });
  }

  const result = restoreText(text, opened.inventory, scopeId);
  if (!result.ok) {
    return keepRecord(itemJson, { failure_code: result.code, error: RESTORE_FAILED_MESSAGE });
  }

  const matched = result.receipt.entries.filter((e) => e.occurrences > 0).length;
  const unmatched = result.receipt.entries.filter((e) => e.occurrences === 0).length;
  return keepRecord(itemJson, {
    [textField]: result.restoredText,
    restore_report: { matched, unmatched },
  });
}
