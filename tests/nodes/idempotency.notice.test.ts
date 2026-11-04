/**
 * #619 (IT Council C7/C9) — the user-visible notice and the release identity.
 *
 * CONTRACT FOR THE IMPLEMENTER (names fixed here):
 *  - `TOKENIZE_RETRY_NOTICE` exported from nodes/Taas/requestHints.ts holds the notice text, and it
 *    is the ONLY copy in the source: the node's `batchBillingNotice` notice and the Tokenize
 *    (Batch) operation description read it from there.
 *  - The old "until server-side idempotency ships, a retry re-submits and double-bills" wording is
 *    gone from the node description.
 *  - The node description `version` stays 1 (no workflow migration); package.json moves to 0.3.0
 *    (pinned in tests/package.test.ts).
 *
 * THE WORDING IS PENDING OWNER APPROVAL. It is pinned in exactly one place — `EXPECTED_NOTICE`
 * below — so an owner edit is a one-line change here plus the one constant in requestHints.ts.
 */
import * as hints from '../../nodes/Taas/requestHints';
import { Taas } from '../../nodes/Taas/Taas.node';

const EXPECTED_NOTICE =
  'Tokenize and Tokenize (Batch) are safe to retry: with Retry On Fail on, a retry in the same run is matched to the first attempt and not billed twice. When an AI agent uses this node as a tool, turn Retry On Fail off: n8n counts each tool retry as a new call. A retry is checked for its API key, rate limit and quota before it is matched, so it can still be refused (for example 402 if the first attempt used up your quota); a refused retry is not billed. Keep Retry On Fail off for Restore and Local restore. Batches bill every record sent, including error rows, and running the workflow again or retrying it from the Executions list is a new run and bills again.';

const description = new Taas().description;
const notice = (hints as Record<string, unknown>).TOKENIZE_RETRY_NOTICE;

describe('the Retry On Fail / billing notice', () => {
  it('TOKENIZE_RETRY_NOTICE equals the approved text exactly', () => {
    expect(notice).toBe(EXPECTED_NOTICE);
  });

  it('the batch notice property shows that constant', () => {
    const prop = description.properties.find((p) => p.name === 'batchBillingNotice');
    expect(prop?.type).toBe('notice');
    expect(prop?.displayName).toBe(EXPECTED_NOTICE);
  });

  it('the stale "until server-side idempotency ships" wording is gone from the node', () => {
    const text = JSON.stringify(description);
    expect({ staleShipsWording: /until server-side idempotency ships/i.test(text) }).toEqual({ staleShipsWording: false });
    expect({ staleDoubleBillWording: /a retry re-submits and double-bills/i.test(text) }).toEqual({
      staleDoubleBillWording: false,
    });
  });
});

describe('release identity', () => {
  it('the node description version stays 1 (guard: passes today)', () => {
    expect(description.version).toBe(1);
  });
});
