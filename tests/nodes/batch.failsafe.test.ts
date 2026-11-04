import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INode } from 'n8n-workflow';

import { buildBatchBody } from '../../nodes/Taas/batch';

/**
 * P4 FAIL-SAFE (sc-013) in BATCH mode: a field the operator did NOT map is never
 * sent to the API, on ANY record of the batch — no silent raw pass-through of
 * PII. Own file so `jest --testPathPatterns failsafe` proves it in isolation.
 */

const node = { name: 'Synthaveil (TAAS)', type: 'taas' } as unknown as INode;

describe('batch body — unmapped-field fail-safe (P4)', () => {
  it('excludes unmapped PII from every record in the batch', () => {
    const items: IDataObject[] = [
      { name: 'Jane Smith', ssn: '111-11-1111', email: 'jane@example.com' },
      { name: 'John Doe', ssn: '222-22-2222', account_balance: 4200 },
    ];

    const { body } = buildBatchBody(
      node,
      { fields: [{ fieldName: 'name', method: 'l2.synthesize-name' }] },
      items,
      0,
    );

    expect(body.records).toEqual([{ name: 'Jane Smith' }, { name: 'John Doe' }]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('111-11-1111');
    expect(serialized).not.toContain('222-22-2222');
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('4200');
    expect(body.policy.fields).toEqual({ name: { method: 'l2.synthesize-name' } });
  });

  it('drops a mapped-but-empty field from a record without leaking null', () => {
    const items: IDataObject[] = [
      { name: 'Jane', nickname: 'J' },
      { name: 'John', nickname: null },
    ];
    const { body } = buildBatchBody(
      node,
      {
        fields: [
          { fieldName: 'name', method: 'l2.synthesize-name' },
          { fieldName: 'nickname', method: 'l1.token-stateless' },
        ],
      },
      items,
      0,
    );
    expect(body.records[0]).toEqual({ name: 'Jane', nickname: 'J' });
    expect(body.records[1]).toEqual({ name: 'John' });
  });

  it('rejects a MAPPED object field rather than shipping [object Object]', () => {
    const items: IDataObject[] = [{ address: { line1: '1 High St' } }];
    expect(() =>
      buildBatchBody(node, { fields: [{ fieldName: 'address', method: 'l3.personal-geo' }] }, items, 0),
    ).toThrow(NodeOperationError);
  });

  it('errors when no fields are mapped (empty policy is never sent)', () => {
    expect(() => buildBatchBody(node, { fields: [] }, [{ a: 'x' }], 0)).toThrow(/at least one field/i);
  });
});
