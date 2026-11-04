/**
 * 0.3.1 — the vendored restore-protocol 0.2.0 refuses text it cannot map back.
 *
 * Before 0.2.0, a combining mark bound to a stand-in's last character (here
 * U+0301, a combining acute) was spliced in NFC space and the mark silently
 * re-bound to the restored name. 0.2.0 refuses it as `INVALID_ENTRY`; the node
 * passes that refusal through with its generic message and leaves the text
 * untouched. README "What changed in 0.3.1" tells users.
 */
import { Taas } from '../../nodes/Taas/Taas.node';
import { sealContainer } from '../../nodes/Taas/sealedMap';
import { MASTER_KEY_BYTES, SCOPE_ID, VALID_HANDLE, item, mockCtx, routedHttp } from './restoreTestKit';

const COMBINING_ACUTE = '\u0301';
/** Ends in Q, which has no precomposed acute form, so NFC keeps the mark separate. */
const STANDIN = 'Protected Person 0001-K7Q';

describe('restore-protocol 0.2.0 refusal surfaces through Restore (0.3.1)', () => {
  it('refuses INVALID_ENTRY when a combining mark follows a stand-in, leaving the text as it was', async () => {
    const masterKey = new Uint8Array(MASTER_KEY_BYTES).fill(0x42);
    const { bytes } = await sealContainer([{ token: STANDIN, original: 'Jane Doe' }], SCOPE_ID, masterKey);
    const text = `Hello ${STANDIN}${COMBINING_ACUTE}, welcome.`;
    const http = routedHttp({
      consume: { blob: Buffer.from(bytes).toString('base64'), run_id: null, consistency: 'stable' },
    });
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text })],
      operation: 'restore',
      continueOnFail: true,
      http,
    });

    const out = await new Taas().execute.call(ctx);

    const json = out[0][0].json;
    expect(json.failure_code).toBe('INVALID_ENTRY');
    expect(json.error).toBe('The map could not be applied to this text.');
    expect(json.text).toBe(text);
    expect(JSON.stringify(json)).not.toMatch(/Jane Doe/);
  });
});
