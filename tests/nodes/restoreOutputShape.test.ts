/**
 * FR-B / FR-C (plan 2026-09-08-n8n-restore-output): Restore keeps the record
 * whole.
 *
 * Restore used to return `{ text, restore_report }` and nothing else — the
 * record's `id`, `name`, `email`, everything Tokenize had carefully preserved,
 * was discarded at the last step. After Restore you could not say whose text
 * you were holding; restoring fifty support notes gave fifty sentences and no
 * way to route them back. The founder's UAT instinct — "do I need to add
 * another node to see the output?" — was the right one, and it should not be
 * needed.
 *
 * Now the item leaves Restore as it entered Tokenize: every field intact, the
 * configured text field restored IN PLACE (mirroring Tokenize's default
 * "Replace in place"), `restore_report` beside it, and `synthaveil_map_handle`
 * removed because the map it named is consumed. The post-consume failure row
 * keeps the record too — losing the `id` exactly when a record fails is the
 * worst version of the bug — while still carrying no sealed bytes, inventory,
 * or plaintext map entries (FR-2.5 / FR-2.6 unchanged).
 */
import { Taas } from '../../nodes/Taas/Taas.node';
import { sealContainer } from '../../nodes/Taas/sealedMap';
import { MASTER_KEY_BYTES, SCOPE_ID, VALID_HANDLE, item, mockCtx, routedHttp } from './restoreTestKit';

const RECORD = {
  id: 'T-4821',
  name: 'Alex Roe',
  email: 'alex.roe@example.org',
  synthaveil_map_handle: VALID_HANDLE,
  ai_output: 'Follow-up: spoke with Alex Roe; nothing further needed.',
};

async function sealedFor(keyFill: number): Promise<string> {
  const key = new Uint8Array(MASTER_KEY_BYTES).fill(keyFill);
  const { bytes } = await sealContainer([{ token: 'Alex Roe', original: 'Jane Doe' }], SCOPE_ID, key);
  return Buffer.from(bytes).toString('base64');
}

describe('Restore keeps the record whole (FR-B)', () => {
  it('returns every input field, restores the text field in place, drops the consumed handle', async () => {
    const http = routedHttp({
      consume: { blob: await sealedFor(0x42), run_id: null, consistency: 'stable' },
    });
    const ctx = mockCtx({
      items: [item({ ...RECORD })],
      operation: 'restore',
      itemParams: [{ mapHandle: VALID_HANDLE, textField: 'ai_output' }],
      http,
    });

    const [[out]] = await new Taas().execute.call(ctx);

    expect(out.json.id).toBe('T-4821');
    expect(out.json.name).toBe('Alex Roe');
    expect(out.json.email).toBe('alex.roe@example.org');
    expect(out.json.ai_output).toBe('Follow-up: spoke with Jane Doe; nothing further needed.');
    expect(out.json.restore_report).toEqual({ matched: 1, unmatched: 0 });
    expect(out.json).not.toHaveProperty('synthaveil_map_handle');
    expect(out.json).not.toHaveProperty('text');
  });
});

describe('Post-consume failure keeps the record too (FR-C)', () => {
  it('carries the id and the untouched text field beside failure_code, and no sealed material', async () => {
    const http = routedHttp({
      consume: { blob: await sealedFor(0x99), run_id: null, consistency: 'stable' }, // wrong key
    });
    const ctx = mockCtx({
      items: [item({ ...RECORD })],
      operation: 'restore',
      continueOnFail: true,
      itemParams: [{ mapHandle: VALID_HANDLE, textField: 'ai_output' }],
      http,
    });

    const [[out]] = await new Taas().execute.call(ctx);

    expect(out.json.failure_code).toBe('AUTH_FAILED');
    expect(out.json.id).toBe('T-4821');
    expect(out.json.ai_output).toBe(RECORD.ai_output);
    expect(out.json).not.toHaveProperty('synthaveil_map_handle');
    expect(out.json).not.toHaveProperty('inventory');
    expect(JSON.stringify(out.json)).not.toMatch(/Jane Doe/);
  });
});
