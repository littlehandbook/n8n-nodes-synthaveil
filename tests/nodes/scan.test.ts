import { NodeOperationError } from 'n8n-workflow';
import type { INode } from 'n8n-workflow';

import { resolveScanText, shapeScanResult } from '../../nodes/Taas/scan';

const NODE = { name: 'Synthaveil (TAAS)', type: 'taas' } as unknown as INode;

describe('resolveScanText', () => {
  it('returns the string value of the named field', () => {
    expect(resolveScanText(NODE, { notes: 'hello' }, 'notes', 0)).toBe('hello');
  });

  it('trims the field name before lookup', () => {
    expect(resolveScanText(NODE, { notes: 'hello' }, '  notes  ', 0)).toBe('hello');
  });

  it('throws when no field name is set', () => {
    expect(() => resolveScanText(NODE, { notes: 'hello' }, '', 3)).toThrow(NodeOperationError);
  });

  it('throws when the field is missing or not a string', () => {
    expect(() => resolveScanText(NODE, {}, 'notes', 0)).toThrow(/not text/i);
    expect(() => resolveScanText(NODE, { notes: 5 }, 'notes', 0)).toThrow(/not text/i);
    expect(() => resolveScanText(NODE, { notes: { a: 1 } }, 'notes', 0)).toThrow(/not text/i);
  });

  it('throws on an empty string', () => {
    expect(() => resolveScanText(NODE, { notes: '' }, 'notes', 0)).toThrow(/empty/i);
  });

  it('accepts text at the cap and rejects one over', () => {
    const atCap = 'x'.repeat(100000);
    expect(resolveScanText(NODE, { notes: atCap }, 'notes', 0)).toBe(atCap);
    expect(() => resolveScanText(NODE, { notes: atCap + 'y' }, 'notes', 0)).toThrow(/too long/i);
  });

  it('carries the itemIndex on the thrown error', () => {
    try {
      resolveScanText(NODE, { notes: 9 }, 'notes', 7);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { context?: { itemIndex?: number } }).context?.itemIndex).toBe(7);
    }
  });
});

describe('shapeScanResult', () => {
  it('maps the detect response fields through', () => {
    expect(
      shapeScanResult({
        // Real staging span shape (verified 2026-07-11): entityType/layer/
        // confidence, not `type`. The node forwards spans verbatim.
        spans: [{ start: 0, end: 4, text: 'Jane', entityType: 'PERSON', layer: 'ner', confidence: 0.7 }],
        countsByType: { PERSON: 1 },
        rulesetVersion: 'r1',
      }),
    ).toEqual({
      spans: [{ start: 0, end: 4, text: 'Jane', entityType: 'PERSON', layer: 'ner', confidence: 0.7 }],
      countsByType: { PERSON: 1 },
      rulesetVersion: 'r1',
    });
  });

  it('defaults spans and countsByType when the response omits them', () => {
    expect(shapeScanResult({ rulesetVersion: 'v1' })).toEqual({
      spans: [],
      countsByType: {},
      rulesetVersion: 'v1',
    });
  });
});
