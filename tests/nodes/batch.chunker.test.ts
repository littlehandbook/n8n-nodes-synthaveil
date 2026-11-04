import {
  chunkItems,
  effectiveBatchSize,
  mappingsUseL3,
} from '../../nodes/Taas/batch';

/**
 * Chunker edges (C7): the fan-out that turns N items into ≤cap-sized requests.
 * Caps are pinned to `docs/api/openapi.yaml` x-taas-batch-caps (100 / 50 L3).
 */

const V1_CAP = 100;
const L3_CAP = 50;

const items = (n: number): number[] => Array.from({ length: n }, (_v, k) => k);

describe('effectiveBatchSize — cap resolution', () => {
  it('uses the V1 cap (100) with no L3 field', () => {
    expect(effectiveBatchSize(V1_CAP, false)).toBe(V1_CAP);
  });

  it('caps at 50 when any field is L3, even if a larger size is requested', () => {
    expect(effectiveBatchSize(V1_CAP, true)).toBe(L3_CAP);
  });

  it('honours a smaller requested size below the cap', () => {
    expect(effectiveBatchSize(30, false)).toBe(30);
    expect(effectiveBatchSize(30, true)).toBe(30);
  });

  it('falls back to the V1 cap for a non-positive or non-finite request', () => {
    expect(effectiveBatchSize(0, false)).toBe(V1_CAP);
    expect(effectiveBatchSize(-5, false)).toBe(V1_CAP);
    expect(effectiveBatchSize(Number.NaN, false)).toBe(V1_CAP);
  });
});

describe('mappingsUseL3', () => {
  it('detects an l3.* method among the mappings', () => {
    expect(
      mappingsUseL3([
        { fieldName: 'a', method: 'l1.token-stateless' },
        { fieldName: 'b', method: 'l3.personal-geo' },
      ]),
    ).toBe(true);
  });

  it('is false when every method is L1/L2', () => {
    expect(
      mappingsUseL3([
        { fieldName: 'a', method: 'l1.token-stateless' },
        { fieldName: 'b', method: 'l2.synthesize-name' },
      ]),
    ).toBe(false);
  });
});

describe('chunkItems — order-preserving fan-out', () => {
  it('returns no chunks for 0 items', () => {
    expect(chunkItems(items(0), V1_CAP, false)).toEqual([]);
  });

  it('returns a single 1-item chunk for 1 item', () => {
    const chunks = chunkItems(items(1), V1_CAP, false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ items: [0], startIndex: 0 });
  });

  it('returns a single full chunk at exactly the cap (100)', () => {
    const chunks = chunkItems(items(V1_CAP), V1_CAP, false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].items).toHaveLength(V1_CAP);
    expect(chunks[0].startIndex).toBe(0);
  });

  it('splits 101 items into 100 + 1 with correct start indices', () => {
    const chunks = chunkItems(items(101), V1_CAP, false);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].items).toHaveLength(V1_CAP);
    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[1].items).toEqual([100]);
    expect(chunks[1].startIndex).toBe(V1_CAP);
  });

  it('switches to the L3 cap (50): 101 items → 50 + 50 + 1', () => {
    const chunks = chunkItems(items(101), V1_CAP, true);
    expect(chunks.map((c) => c.items.length)).toEqual([L3_CAP, L3_CAP, 1]);
    expect(chunks.map((c) => c.startIndex)).toEqual([0, 50, 100]);
  });
});
