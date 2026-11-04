import { NodeOperationError } from 'n8n-workflow';
import type { INode } from 'n8n-workflow';

import { coerceRecordValues } from '../../nodes/Taas/coerce';

const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as unknown as INode;

describe('coerceRecordValues — value coercion matrix', () => {
  it('passes strings through unchanged', () => {
    const { record, warnings } = coerceRecordValues(node, { a: 'hello' }, ['a'], 0);
    expect(record).toEqual({ a: 'hello' });
    expect(warnings).toEqual([]);
  });

  it('stringifies numbers and booleans', () => {
    const json = { n: 42, f: 3.5, b: true, z: false };
    const { record } = coerceRecordValues(node, json, ['n', 'f', 'b', 'z'], 0);
    expect(record).toEqual({ n: '42', f: '3.5', b: 'true', z: 'false' });
  });

  it('skips null/undefined fields and records a warning for each', () => {
    const { record, warnings } = coerceRecordValues(
      node,
      { a: null, b: undefined, c: 'keep' },
      ['a', 'b', 'c'],
      0,
    );
    expect(record).toEqual({ c: 'keep' });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/"a".*skipped/i);
    expect(warnings[1]).toMatch(/"b".*skipped/i);
  });

  it('skips a mapped field that is absent from the item (undefined lookup)', () => {
    const { record, warnings } = coerceRecordValues(node, { present: 'x' }, ['missing'], 0);
    expect(record).toEqual({});
    expect(warnings[0]).toMatch(/"missing".*skipped/i);
  });

  it('throws a NodeOperationError naming an object field', () => {
    expect(() => coerceRecordValues(node, { addr: { city: 'X' } }, ['addr'], 3)).toThrow(
      NodeOperationError,
    );
    try {
      coerceRecordValues(node, { addr: { city: 'X' } }, ['addr'], 3);
    } catch (e) {
      expect((e as Error).message).toMatch(/"addr".*object/i);
    }
  });

  it('throws a NodeOperationError naming a list/array field', () => {
    expect(() => coerceRecordValues(node, { tags: ['a', 'b'] }, ['tags'], 0)).toThrow(
      /"tags".*list/i,
    );
  });

  it('only includes the named fields (unnamed fields never leak in)', () => {
    const { record } = coerceRecordValues(node, { a: '1', secret: 'raw-pii' }, ['a'], 0);
    expect(record).toEqual({ a: '1' });
    expect(record).not.toHaveProperty('secret');
  });
});
