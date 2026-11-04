import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataObject, INode } from 'n8n-workflow';

import { buildTokenizeBody } from '../../nodes/Taas/tokenize';

/**
 * INV-001 parity (sc-010): the request body the node builds must be byte-for-byte
 * equivalent — under canonical JSON (recursively key-sorted) — to the golden
 * tokenize request an API client would send for the same input. A drift in how
 * the node assembles record/policy/scope fails here before it can desync from the
 * engine's determinism contract. The live cross-check runs on staging in 1f.
 */

const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as unknown as INode;

const golden = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'v1', 'tokenize-request.golden.json'), 'utf8'),
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

describe('tokenize body — INV-001 determinism parity', () => {
  it('builds a body canonically equal to the golden request fixture', () => {
    const itemJson: IDataObject = {
      full_name: 'Jane Smith',
      email: 'jane@example.com',
      internal_id: 999, // unmapped — must not appear
      note: { source: 'crm' }, // unmapped object — must not appear or throw
    };

    const { body } = buildTokenizeBody(
      node,
      {
        fields: [
          { fieldName: 'full_name', method: 'l2.synthesize-name' },
          { fieldName: 'email', method: 'l2.synthesize-email' },
        ],
        country: 'GB',
        scopeId: 'crm-sync',
      },
      itemJson,
      0,
    );

    expect(canonicalJson(body)).toBe(canonicalJson(golden.body));
  });

  it('is insensitive to field mapping order (same canonical body)', () => {
    const itemJson: IDataObject = { full_name: 'Jane Smith', email: 'jane@example.com' };
    const forward = buildTokenizeBody(
      node,
      {
        fields: [
          { fieldName: 'full_name', method: 'l2.synthesize-name' },
          { fieldName: 'email', method: 'l2.synthesize-email' },
        ],
        country: 'GB',
        scopeId: 'crm-sync',
      },
      itemJson,
      0,
    ).body;
    const reversed = buildTokenizeBody(
      node,
      {
        fields: [
          { fieldName: 'email', method: 'l2.synthesize-email' },
          { fieldName: 'full_name', method: 'l2.synthesize-name' },
        ],
        country: 'GB',
        scopeId: 'crm-sync',
      },
      itemJson,
      0,
    ).body;

    expect(canonicalJson(forward)).toBe(canonicalJson(reversed));
  });

  it('omits country and scope_id when not provided', () => {
    const { body } = buildTokenizeBody(
      node,
      { fields: [{ fieldName: 'a', method: 'l1.token-stateless' }] },
      { a: 'x' },
      0,
    );
    expect(body).not.toHaveProperty('country');
    expect(body).not.toHaveProperty('scope_id');
  });
});
