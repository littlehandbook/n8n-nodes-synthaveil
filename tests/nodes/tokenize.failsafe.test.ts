import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INode } from 'n8n-workflow';

import { buildTokenizeBody } from '../../nodes/Taas/tokenize';

/**
 * P4 FAIL-SAFE (sc-013): a field the operator did NOT map is never sent to the
 * API — no silent raw pass-through of PII. This is the single most important
 * privacy guarantee of the node; it gets its own test file so `jest
 * --testPathPattern failsafe` proves it in isolation.
 */

const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as unknown as INode;

describe('tokenize body — unmapped-field fail-safe (P4)', () => {
  it('never includes an unmapped PII field in the outbound record', () => {
    const itemJson: IDataObject = {
      name: 'Jane Smith',
      ssn: '123-45-6789', // sensitive, UNMAPPED — must never leave n8n
      email: 'jane@example.com', // sensitive, UNMAPPED
      account_balance: 4200, // UNMAPPED
    };

    const { body } = buildTokenizeBody(
      node,
      { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      itemJson,
      0,
    );

    // Only the mapped field is present anywhere in the request.
    expect(body.record).toEqual({ name: 'Jane Smith' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('4200');
    expect(body.policy.fields).toEqual({ name: { method: 'l2.synthesize-name' } });
  });

  it('excludes an unmapped object field without erroring (only mapped fields are read)', () => {
    // An unmapped object must not trip the object-guard — the guard only inspects
    // MAPPED fields. This proves unmapped fields are ignored entirely, not coerced.
    const itemJson: IDataObject = {
      name: 'Jane',
      address: { line1: '1 High St', city: 'London' }, // unmapped object
    };

    const { body } = buildTokenizeBody(
      node,
      { fields: [{ fieldName: 'name', method: 'l1.token-stateless' }] },
      itemJson,
      0,
    );

    expect(body.record).toEqual({ name: 'Jane' });
    expect(JSON.stringify(body)).not.toContain('High St');
  });

  it('rejects a MAPPED object field rather than shipping [object Object]', () => {
    const itemJson: IDataObject = { address: { line1: '1 High St' } };
    expect(() =>
      buildTokenizeBody(
        node,
        { fields: [{ fieldName: 'address', method: 'l3.personal-geo' }] },
        itemJson,
        0,
      ),
    ).toThrow(NodeOperationError);
  });

  it('drops a mapped-but-empty field from the record (no null leak)', () => {
    const itemJson: IDataObject = { name: 'Jane', nickname: null };
    const { body } = buildTokenizeBody(
      node,
      {
        fields: [
          { fieldName: 'name', method: 'l2.synthesize-name' },
          { fieldName: 'nickname', method: 'l2.synthesize-name' },
        ],
      },
      itemJson,
      0,
    );
    expect(body.record).toEqual({ name: 'Jane' });
    expect(body.policy.fields).toEqual({ name: { method: 'l2.synthesize-name' } });
  });

  it('errors when no fields are mapped (empty policy is never sent)', () => {
    expect(() => buildTokenizeBody(node, { fields: [] }, { a: 'x' }, 0)).toThrow(
      /at least one field/i,
    );
  });
});
