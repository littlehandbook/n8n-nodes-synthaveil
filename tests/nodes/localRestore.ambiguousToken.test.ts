/**
 * Review on #1622 — Local restore must never store a one-shot map that Restore
 * refuses after consuming it. The vendored restore-protocol inventory check
 * (`validateInventory`, run inside `restoreText`) refuses:
 *  - an empty token (INVALID_ENTRY);
 *  - ANY two entries whose tokens are equal after NFC (AMBIGUOUS_VALUE), even
 *    when their originals are identical.
 * Tokens are deterministic per value and scope, so two fields with the same
 * value can share a token. Sealing drops an exact duplicate pair (restoring it
 * once gives the same text) and refuses the cases Restore cannot handle.
 */
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { openContainer, restorableEntries, sealContainer } from '../../nodes/Taas/sealedMap';
import { restoreText, PROTOCOL_VERSION } from '../../vendor/restore-protocol';
import { ctxFor, routedHttp, sent, type SentRequest } from './idempotencyTestKit';

const SCOPE = 'crm-sync';
const MASTER_KEY = new Uint8Array(32).fill(7);
const inventory = (entries: Array<{ token: string; original: string }>) => ({
  protocolVersion: PROTOCOL_VERSION,
  scopeRef: SCOPE,
  entries,
});

describe('what restore-protocol refuses (the rule sealing mirrors)', () => {
  it('a duplicated token is AMBIGUOUS_VALUE even when both originals are identical', () => {
    const dup = inventory([
      { token: 'tok_A', original: 'Avery' },
      { token: 'tok_A', original: 'Avery' },
    ]);
    expect(restoreText('hi tok_A', dup, SCOPE)).toMatchObject({ ok: false, code: 'AMBIGUOUS_VALUE' });
  });

  it('an empty token is INVALID_ENTRY', () => {
    expect(restoreText('hi', inventory([{ token: '', original: 'Avery' }]), SCOPE)).toMatchObject({
      ok: false,
      code: 'INVALID_ENTRY',
    });
  });
});

describe('restorableEntries', () => {
  it('drops an exact duplicate pair (same token, same value)', () => {
    const out = restorableEntries([
      { token: 'tok_A', original: 'Avery' },
      { token: 'tok_A', original: 'Avery' },
      { token: 'tok_B', original: 'Blake' },
    ]);
    expect(out).toEqual([
      { token: 'tok_A', original: 'Avery' },
      { token: 'tok_B', original: 'Blake' },
    ]);
  });

  it('refuses one token for two different values', () => {
    expect(() =>
      restorableEntries([
        { token: 'tok_A', original: 'Avery' },
        { token: 'tok_A', original: 'Blake' },
      ]),
    ).toThrow(/same token/);
  });

  it('refuses tokens that only differ by Unicode normalisation (restore compares them after NFC)', () => {
    expect(() =>
      restorableEntries([
        { token: 'tok_é', original: 'Avery' },
        { token: 'tok_é', original: 'Avery' },
      ]),
    ).toThrow(/same token/);
  });

  it('refuses an empty token', () => {
    expect(() => restorableEntries([{ token: '', original: 'Avery' }])).toThrow(/empty token/);
  });
});

describe('sealContainer only stores maps Restore accepts', () => {
  it('two fields with the same value and token: sealed once, and the map restores', async () => {
    const entries = [
      { token: 'tok_A', original: 'Avery Testperson' },
      { token: 'tok_A', original: 'Avery Testperson' },
    ];
    const { bytes } = await sealContainer(entries, SCOPE, MASTER_KEY);
    const opened = await openContainer(bytes, SCOPE, MASTER_KEY);
    if (!opened.ok) throw new Error(`open failed: ${opened.code}`);
    expect(opened.inventory.entries).toHaveLength(1);
    expect(restoreText('Dear tok_A,', opened.inventory, SCOPE)).toMatchObject({
      ok: true,
      restoredText: 'Dear Avery Testperson,',
    });
  });

  it('refuses one token for two different values before anything is sealed', async () => {
    const entries = [
      { token: 'tok_A', original: 'Avery' },
      { token: 'tok_A', original: 'Blake' },
    ];
    await expect(sealContainer(entries, SCOPE, MASTER_KEY)).rejects.toThrow(/same token/);
  });
});

/** The routed fake, but /tokenize answers with the given tokens per field. */
function httpWithTokens(tokens: Record<string, string>): jest.Mock {
  const base = routedHttp();
  return jest.fn(async (cred: string, req: SentRequest) =>
    req.url === '/api/v1/tokenize'
      ? { tokenized: tokens, job_id: 'api-v1:org_1:2026-10-14', processed_at: '2026-10-14T00:00:00.000Z' }
      : base(cred, req),
  );
}

describe('Tokenize with Local restore — shared tokens', () => {
  const twoFields = {
    returnMode: 'localRestore',
    scopeId: SCOPE,
    'fieldsToTokenize.field': [
      { fieldName: 'name', method: 'l1.token-stateless' },
      { fieldName: 'billing_name', method: 'l1.token-stateless' },
    ],
  };
  const item = (json: IDataObject): INodeExecutionData => ({ json });

  it('same value in two fields, same token: the map is stored', async () => {
    const http = httpWithTokens({ name: 'tok_A', billing_name: 'tok_A' });
    const ctx = ctxFor({ items: [item({ name: 'Avery', billing_name: 'Avery' })], params: twoFields, http });
    await new Taas().execute.call(ctx);
    expect(sent(http).map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/v1/tokenize', 'PUT /api/v1/maps']);
  });

  it('different values, same token: refused before the map PUT', async () => {
    const http = httpWithTokens({ name: 'tok_A', billing_name: 'tok_A' });
    const ctx = ctxFor({ items: [item({ name: 'Avery', billing_name: 'Blake' })], params: twoFields, http });
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/same token/);
    expect(sent(http).map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/v1/tokenize']);
  });
});
