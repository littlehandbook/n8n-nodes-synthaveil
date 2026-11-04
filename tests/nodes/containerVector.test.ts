/**
 * Frozen container golden vector (PROTOCOL.md §5a).
 *
 * The behavioural suites in `sealedMap.test.ts` seal and open in the same
 * process, so they stay green under ANY self-consistent change to the container
 * format — including one that silently breaks compatibility. That matters here
 * because sealed maps outlive the node that wrote them: a map sealed by one
 * released version sits in the customer store for up to its TTL and is opened
 * by whatever version is installed at restore time. A header-shape or framing
 * change between those two versions is unrecoverable customer data loss.
 *
 * This vector is the wall against that. The bytes below were sealed once, with
 * the all-0x42 master key, and are committed verbatim; they must keep opening
 * to the same entries forever. If this test goes red, the container format
 * changed — that is a deliberate, breaking, version-bumping decision, not a
 * refactor, and the fix is NOT to regenerate the vector.
 *
 * The QA review of PR #523 (finding 15) is why this exists: §5a claimed
 * container seal/open vectors were "committed alongside the §10 conformance
 * fixtures", and no such vector had ever been written.
 */
import { openContainer, sealContainer } from '../../nodes/Taas/sealedMap';

const MASTER_KEY = new Uint8Array(32).fill(0x42);
const SCOPE = 'crm-sync';

/** Sealed 2026-08-31 with MASTER_KEY under SCOPE. Never regenerate. */
const FROZEN_CONTAINER_B64 =
  'AVj5b9fcZtaUEkaoRQpMtiwBAWobaivc0KkosUW9unbfJRFoLTfGnSQeVgQx6lDH49dws3UAt2KMj/Mc' +
  'GurtpzIYLLn4Z+xLMoMWNoD5OB6tDLmGaOQ2Fcj4mP/bMe/2xdK5wjyZcSUpipsdX6mP2IAvetNmiPOS' +
  'ZubDLLbuj6tTLvZptOxV2Kvo3nPxZo0ZLhGSuDbRnl7K/pqgam+LuyfxQBXJ+afVcxupHmKGNt/3p8OR' +
  'eppHinG1qGMpkFzUQiAymSt9/oFleP/A/QnhImM0htX54FX7BTcOS8djEAIN6gg=';

const EXPECTED_ENTRIES = [
  { token: 'Alex Doe', original: 'Jane Testerson' },
  { token: 'a@b.example', original: 'jane.testerson@example.com' },
];

const frozenBytes = (): Uint8Array => new Uint8Array(Buffer.from(FROZEN_CONTAINER_B64, 'base64'));

describe('container golden vector (PROTOCOL.md §5a)', () => {
  it('opens a container sealed by an earlier build to the exact entries it carried', async () => {
    const opened = await openContainer(frozenBytes(), SCOPE, MASTER_KEY);

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.inventory.entries).toEqual(EXPECTED_ENTRIES);
    expect(opened.inventory.scopeRef).toBe(SCOPE);
  });

  it('pins the wire frame: version 0x01 then a 16-byte containerId', () => {
    const bytes = frozenBytes();
    expect(bytes[0]).toBe(0x01);
    // version(1) + containerId(16) + envelope(nonce 12 + ciphertext + tag 16)
    expect(bytes.length).toBeGreaterThan(1 + 16 + 12 + 16);
  });

  it('still refuses SCOPE_MISMATCH on the frozen bytes under the wrong scope', async () => {
    const opened = await openContainer(frozenBytes(), 'some-other-scope', MASTER_KEY);

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe('SCOPE_MISMATCH');
    // The error contract §5a pins: never the inventory, never a partial entry.
    expect(JSON.stringify(opened)).not.toContain('Jane Testerson');
  });

  it('still refuses AUTH_FAILED on the frozen bytes under a different master key', async () => {
    const opened = await openContainer(frozenBytes(), SCOPE, new Uint8Array(32).fill(0x43));

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe('AUTH_FAILED');
  });

  it('a container sealed now is byte-different but opens identically (fresh containerId + IV)', async () => {
    const { bytes } = await sealContainer(EXPECTED_ENTRIES, SCOPE, MASTER_KEY);

    expect(Buffer.from(bytes).toString('base64')).not.toBe(FROZEN_CONTAINER_B64);
    const opened = await openContainer(bytes, SCOPE, MASTER_KEY);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.inventory.entries).toEqual(EXPECTED_ENTRIES);
  });
});
