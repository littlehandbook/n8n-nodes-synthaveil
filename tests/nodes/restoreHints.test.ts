/**
 * FR-A (plan 2026-09-08-n8n-restore-output): the Restore hints are advice, and
 * must look like advice.
 *
 * `RESTORE_RETRY_HINT` shipped as `type: 'danger'` behind an always-on display
 * condition, so EVERY successful Restore rendered a red banner above its
 * output. In UAT the founder read a fully green round trip as "one last
 * error" because of it — a red box on a run that worked is crying wolf, and
 * it stops meaning anything on the day something does break. The hard guard
 * (`assertRetryOnFailOffForRestore`) is what actually stops a retry; the hint
 * cannot see node settings at all (n8n evaluates `displayCondition` against
 * parameters only), so it can never be more than a reminder.
 */
import { Taas } from '../../nodes/Taas/Taas.node';

describe('Restore hints are advisory and rendered as such (FR-A)', () => {
  const hints = new Taas().description.hints ?? [];

  it('declares both Restore hints', () => {
    expect(hints).toHaveLength(2);
  });

  it('never uses the danger severity — that colour is for a run that has failed', () => {
    expect(hints.map((h) => h.type)).toEqual(['warning', 'warning']);
  });

  it('shows them only on the Restore operation', () => {
    for (const hint of hints) {
      expect(hint.displayCondition).toContain('"restore"');
    }
  });
});
