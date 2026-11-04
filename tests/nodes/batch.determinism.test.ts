import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataObject, INode } from 'n8n-workflow';

import { buildBatchBody } from '../../nodes/Taas/batch';

/**
 * INV-001 parity (sc-010) for the batch builder: the request body the node
 * builds for a batch must be byte-for-byte equivalent — under canonical JSON
 * (recursively key-sorted) — to the golden batch request an API client would
 * send for the same items. Records preserve input order; ONE shared
 * policy/country/scope applies to the whole request. The live cross-check runs
 * on staging in 1f.
 */

const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as unknown as INode;

const golden = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'v1', 'batch-request.golden.json'), 'utf8'),
);

/** Recursively sort object keys so key ORDER never affects equality. Arrays keep order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const params = {
  fields: [
    { fieldName: 'full_name', method: 'l2.synthesize-name' },
    { fieldName: 'email', method: 'l2.synthesize-email' },
  ],
  country: 'GB',
  scopeId: 'crm-sync',
};

describe('batch body — INV-001 determinism parity', () => {
  it('builds a body canonically equal to the golden batch request fixture', () => {
    const items: IDataObject[] = [
      { full_name: 'Jane Smith', email: 'jane@example.com', internal_id: 1 },
      { full_name: 'John Doe', email: 'john@example.com', internal_id: 2 },
    ];

    const { body } = buildBatchBody(node, params, items, 0);

    expect(canonicalJson(body)).toBe(canonicalJson(golden.body));
  });

  it('preserves record order (records map 1:1 to input items in order)', () => {
    const items: IDataObject[] = [
      { full_name: 'Jane Smith', email: 'jane@example.com' },
      { full_name: 'John Doe', email: 'john@example.com' },
    ];
    const { body } = buildBatchBody(node, params, items, 0);
    expect(body.records[0]).toEqual({ full_name: 'Jane Smith', email: 'jane@example.com' });
    expect(body.records[1]).toEqual({ full_name: 'John Doe', email: 'john@example.com' });
  });

  it('is insensitive to field mapping order (same canonical body)', () => {
    const items: IDataObject[] = [{ full_name: 'Jane Smith', email: 'jane@example.com' }];
    const forward = buildBatchBody(node, params, items, 0).body;
    const reversed = buildBatchBody(
      node,
      {
        fields: [
          { fieldName: 'email', method: 'l2.synthesize-email' },
          { fieldName: 'full_name', method: 'l2.synthesize-name' },
        ],
        country: 'GB',
        scopeId: 'crm-sync',
      },
      items,
      0,
    ).body;
    expect(canonicalJson(forward)).toBe(canonicalJson(reversed));
  });

  it('omits country and scope_id when not provided', () => {
    const { body } = buildBatchBody(
      node,
      { fields: [{ fieldName: 'a', method: 'l1.token-stateless' }] },
      [{ a: 'x' }],
      0,
    );
    expect(body).not.toHaveProperty('country');
    expect(body).not.toHaveProperty('scope_id');
  });
});
