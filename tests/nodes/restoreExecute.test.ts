/**
 * Task 3.2/3.4 — Local restore wiring through the node's execute(): the Return
 * Mode option, the Restore operation, the tokenize-side seal + PUT, the
 * restore-side consume + open + restoreText, the Retry-On-Fail hard guard
 * (AC13), and per-item error isolation (PC-12, rm-43).
 *
 * Crypto is real (sealContainer from `nodes/Taas/sealedMap`), matching the
 * house rule for these Task 3.3/3.4 tests — no stubbed WebCrypto.
 *
 * EXPECTED STATE: RED — `nodes/Taas/sealedMap.ts` does not exist yet, and
 * Taas.node.ts does not yet wire Local restore / the Restore operation.
 *
 * Golden guard (AC15): `tests/nodes/tokenize.determinism.test.ts` already pins
 * Record ID mode's request body byte-for-byte against
 * `tests/fixtures/v1/tokenize-request.golden.json`, and that code path
 * (`buildTokenizeBody`) is untouched by Local restore (P3 is additive only) —
 * skipped here rather than duplicated.
 */
import type { IDataObject, INode, INodeExecutionData, INodeParameters } from 'n8n-workflow';
import { NodeHelpers } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { sealContainer } from '../../nodes/Taas/sealedMap';

import { MAP_KEY, MASTER_KEY_BYTES, SCOPE_ID, VALID_HANDLE, item, mockCtx, routedHttp } from './restoreTestKit';

describe('Return Mode gains Local restore + Restore operation (Task 3.2)', () => {
  it('offers a Local restore option on Return Mode', () => {
    const properties = new Taas().description.properties;
    const returnMode = properties.find((p) => p.name === 'returnMode') as
      | { options?: Array<{ name: string; value: string }> }
      | undefined;
    expect(returnMode?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Local Restore', value: 'localRestore' })]),
    );
  });

  it('offers a Restore operation on the token resource', () => {
    const properties = new Taas().description.properties;
    const tokenOperation = properties.find(
      (p) =>
        p.name === 'operation' &&
        (p as { displayOptions?: { show?: { resource?: string[] } } }).displayOptions?.show?.resource?.includes(
          'token',
        ),
    ) as { options?: Array<{ name: string; value: string }> } | undefined;
    expect(tokenOperation?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Restore', value: 'restore' })]),
    );
  });

  it('mapHandle defaults to an expression reading synthaveil_map_handle off the input item', () => {
    const properties = new Taas().description.properties;
    const mapHandle = properties.find((p) => p.name === 'mapHandle');
    expect(mapHandle?.default).toBe('={{ $json.synthaveil_map_handle }}');
  });
});

describe('Local restore — tokenize path seals and PUTs, emits the protected record + handle (FR-2.3)', () => {
  // QA review P0-2: this previously asserted the item was REPLACED by the bare
  // handle. That silently broke the whole point of Local restore — the next
  // node in the chain (the AI step, in every shipped example) reads the
  // protected fields off the item, and got `undefined`. The map and its entries
  // must still never be emitted; the tokenized record is not the map.
  it('emits the protected record alongside the handle — never the map or entries', async () => {
    const http = routedHttp({
      tokenize: { tokenized: { name: 'Alex Doe' }, job_id: 'x', processed_at: 'x' },
      putMap: { handle: VALID_HANDLE, expires_at: '2026-09-01T00:00:00.000Z' },
    });
    const ctx = mockCtx({
      items: [item({ name: 'Jane Doe' })],
      operation: 'tokenize',
      returnMode: 'localRestore',
      http,
    });

    const out = await new Taas().execute.call(ctx);

    // Same shape Record ID mode emits (outputMode replaceInPlace), plus the handle.
    expect(out[0][0].json).toEqual({ name: 'Alex Doe', synthaveil_map_handle: VALID_HANDLE });
    expect(out[0][0].json).not.toHaveProperty('map');
    expect(out[0][0].json).not.toHaveProperty('entries');
    // The original value must not survive on the item under replaceInPlace.
    expect(JSON.stringify(out[0][0].json)).not.toContain('Jane Doe');

    const putCall = http.mock.calls.find(([, req]) => req.url === '/api/v1/maps');
    expect(putCall).toBeDefined();
    expect(putCall?.[1].method).toBe('PUT');
    // The bytes PUT to the store must be opaque sealed bytes, not the plaintext.
    const putBody = putCall?.[1].body as IDataObject;
    expect(JSON.stringify(putBody)).not.toMatch(/Jane Doe|Alex Doe/);
  });
});

describe('Retry-On-Fail hard guard (AC13) — refuses before preflight, before any network call', () => {
  it('throws NodeOperationError naming "Retry On Fail" and makes zero requests', async () => {
    const http = jest.fn();
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'hello' })],
      operation: 'restore',
      retryOnFail: true,
      http,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/retry on fail/i);
    expect(http).not.toHaveBeenCalled();
  });
});

describe('Restore happy path (CC-13, rm-45)', () => {
  it('consumes, opens, restores the text field in place, and adds restore_report', async () => {
    const masterKey = new Uint8Array(MASTER_KEY_BYTES).fill(0x42);
    const entries = [{ token: 'Alex Roe', original: 'Jane Doe' }];
    const { bytes } = await sealContainer(entries, SCOPE_ID, masterKey);

    const http = routedHttp({
      consume: {
        blob: Buffer.from(bytes).toString('base64'),
        run_id: null,
        consistency: 'stable',
      },
    });
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'Hello Alex Roe, welcome.' })],
      operation: 'restore',
      http,
    });

    const out = await new Taas().execute.call(ctx);

    expect(out[0][0].json.text).toBe('Hello Jane Doe, welcome.');
    const report = out[0][0].json.restore_report as { matched: number; unmatched: number };
    expect(report.matched).toBe(1);
    expect(report.unmatched).toBe(0);
  });
});

describe('Post-consume failure (FR-2.5) — the map is gone, never sealed bytes/inventory', () => {
  it('AUTH_FAILED after a successful consume states the map is gone and carries no sealed material', async () => {
    const wrongKeyBytes = (
      await sealContainer(
        [{ token: 'Alex Roe', original: 'Jane Doe' }],
        SCOPE_ID,
        new Uint8Array(MASTER_KEY_BYTES).fill(0x99), // sealed under a DIFFERENT key than MAP_KEY
      )
    ).bytes;

    const http = routedHttp({
      consume: { blob: Buffer.from(wrongKeyBytes).toString('base64'), run_id: null, consistency: 'stable' },
    });
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'Hello Alex Roe.' })],
      operation: 'restore',
      continueOnFail: true,
      http,
    });

    const out = await new Taas().execute.call(ctx);

    const json = out[0][0].json;
    expect(json.failure_code).toBe('AUTH_FAILED');
    expect(String(json.error ?? '')).toMatch(/map is gone|no longer available/i);
    // The record travels through a failure too (FR-C, D-RM-11): the tokenised
    // input text is still there, untouched. The ORIGINAL must never be.
    expect(json.text).toBe('Hello Alex Roe.');
    expect(JSON.stringify(json)).not.toMatch(/Jane Doe/);
    expect(json).not.toHaveProperty('inventory');
  });
});

describe('PC-12 — per-item error isolation on Restore (rm-43)', () => {
  it('item 2 (bad handle) fails without sealed bytes; items 1 and 3 still restore', async () => {
    const masterKey = new Uint8Array(MASTER_KEY_BYTES).fill(0x42);
    const entries1 = [{ token: 'Tok One', original: 'Orig One' }];
    const entries3 = [{ token: 'Tok Three', original: 'Orig Three' }];
    const bytes1 = (await sealContainer(entries1, SCOPE_ID, masterKey)).bytes;
    const bytes3 = (await sealContainer(entries3, SCOPE_ID, masterKey)).bytes;
    const handle1 = 'svh1-' + '1'.repeat(22);
    const handle3 = 'svh1-' + '3'.repeat(22);

    const http = routedHttp({
      consume: {
        [handle1]: { blob: Buffer.from(bytes1).toString('base64'), run_id: null, consistency: 'stable' },
        [handle3]: { blob: Buffer.from(bytes3).toString('base64'), run_id: null, consistency: 'stable' },
      },
    });

    const ctx = mockCtx({
      items: [item({}), item({}), item({})],
      operation: 'restore',
      continueOnFail: true,
      http,
      itemParams: [
        { mapHandle: handle1, textField: 'text1' },
        { mapHandle: 'not-a-valid-handle', textField: 'text2' }, // fails preflight
        { mapHandle: handle3, textField: 'text3' },
      ],
    });
    // per-item text lookup: give each item its own text field content
    (ctx.getInputData() as INodeExecutionData[])[0].json.text1 = 'Hi Tok One.';
    (ctx.getInputData() as INodeExecutionData[])[1].json.text2 = 'irrelevant';
    (ctx.getInputData() as INodeExecutionData[])[2].json.text3 = 'Hi Tok Three.';

    const out = await new Taas().execute.call(ctx);

    expect(out[0]).toHaveLength(3);
    expect(out[0][0].json.text1).toBe('Hi Orig One.');
    expect(out[0][2].json.text3).toBe('Hi Orig Three.');

    const failedItem = out[0][1].json;
    expect(failedItem.error ?? failedItem.failure_code).toBeDefined();
    expect(JSON.stringify(failedItem)).not.toMatch(/Orig One|Orig Three|Tok One|Tok Three/);
    expect(failedItem).not.toHaveProperty('inventory');

    expect(out[0][0].pairedItem).toEqual({ item: 0 });
    expect(out[0][1].pairedItem).toEqual({ item: 1 });
    expect(out[0][2].pairedItem).toEqual({ item: 2 });
  });
});

describe('Batch + Local restore refuses loudly (chairman ruling, batch sealing deferred)', () => {
  it('throws NodeOperationError naming Local restore and Batch, making zero requests', async () => {
    const http = jest.fn();
    const ctx = mockCtx({
      items: [item({ name: 'Jane Doe' })],
      operation: 'tokenizeBatch',
      returnMode: 'localRestore',
      http,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/local restore/i);
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/batch/i);
    expect(http).not.toHaveBeenCalled();
  });
});

describe('QA review findings 3, 4, 9 — scope handling and credential visibility', () => {
  // Finding 9: tokenize trims the scope before sealing (branch review 6), but
  // restore read it raw. A scope typed with stray whitespace therefore sealed
  // under "crm-sync" and restored under " crm-sync ": the consume SUCCEEDS and
  // deletes the one-shot map, and only then does openContainer refuse
  // SCOPE_MISMATCH. The map is gone and the plaintext is unrecoverable.
  it('trims the scope on restore so a padded scope cannot consume-then-mismatch', async () => {
    const http = routedHttp({
      tokenize: { tokenized: { name: 'Alex Doe' }, job_id: 'x', processed_at: 'x' },
      putMap: { handle: VALID_HANDLE, expires_at: '2026-09-01T00:00:00.000Z' },
    });
    // Seal under the trimmed scope, exactly as the tokenize path does.
    const sealed = await sealContainer(
      [{ token: 'Alex Doe', original: 'Jane Doe' }],
      SCOPE_ID,
      new Uint8Array(Buffer.from(MAP_KEY, 'base64')),
    );
    http.mockImplementation(async (_cred: unknown, req: { url: string; method: string }) => {
      if (req.url.endsWith('/consume')) {
        return { blob: Buffer.from(sealed.bytes).toString('base64'), scope_id: SCOPE_ID };
      }
      throw new Error('unexpected request ' + req.method + ' ' + req.url);
    });

    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'note about Alex Doe' })],
      operation: 'restore',
      scopeId: '  ' + SCOPE_ID + '  ',
      http,
    });

    const out = await new Taas().execute.call(ctx);

    // The padded scope must behave exactly like the trimmed one.
    expect(JSON.stringify(out[0][0].json)).toContain('Jane Doe');
  });

  // Finding 3: the default Local restore journey billed and then failed. An
  // empty scope is accepted by tokenize (where scope is optional), the quota
  // unit is spent, and only then does the map PUT reject the empty scope --
  // which is REQUIRED on that surface. Refuse before spending anything.
  it('refuses Local restore with an empty scope before any request is made', async () => {
    const http = jest.fn();
    const ctx = mockCtx({
      items: [item({ name: 'Jane Doe' })],
      operation: 'tokenize',
      returnMode: 'localRestore',
      scopeId: '   ',
      http,
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/scope/i);
    expect(http).not.toHaveBeenCalled();
  });
});

describe('the Map Key credential resolves the way n8n really resolves it', () => {
  const description = new Taas().description;
  const credentials = description.credentials ?? [];

  /**
   * n8n-core `_getCredentials` takes the FIRST descriptor whose name matches
   * and evaluates `displayParameter` against that one alone. The predecessor
   * of this block asked whether SOME descriptor covered each journey, which is
   * how two descriptors shipped and every Restore threw `Credentials not found`
   * with the credential filled in on screen. Drive n8n's own resolver instead,
   * so the test fails for the same reason the product fails.
   */
  const resolves = (parameters: INodeParameters): boolean => {
    const descriptor = credentials.find((c) => c.name === 'synthaveilMapKeyApi');
    if (!descriptor) return false;
    const node = { parameters } as unknown as INode;
    return NodeHelpers.displayParameter(parameters, descriptor, node, description, parameters);
  };

  it('declares each credential exactly once, because a duplicate name is unreachable', () => {
    const names = credentials.map((c) => c.name);
    expect(names).toHaveLength(new Set(names).size);
  });

  it('resolves for the Restore operation', () => {
    expect(resolves({ resource: 'token', operation: 'restore', textField: 'ai_output' })).toBe(true);
  });

  it('resolves for Tokenize with Return Mode Local restore', () => {
    expect(resolves({ resource: 'token', operation: 'tokenize', returnMode: 'localRestore' })).toBe(true);
  });

  it('resolves on a Restore node that stored no returnMode at all', () => {
    // `getPropertyValues` reads stored parameters with no fallback to the
    // property default, and an imported workflow carries only what it set, so
    // a rule keyed on returnMode would read undefined here and refuse.
    expect(resolves({ resource: 'token', operation: 'restore' })).toBe(true);
  });

  it('is not offered on the Account or Text resources', () => {
    expect(resolves({ resource: 'account', operation: 'getUsage' })).toBe(false);
    expect(resolves({ resource: 'text', operation: 'scanText' })).toBe(false);
  });

  it('stays optional, so Return Mode Record ID is not blocked by a key it never uses', () => {
    const descriptor = credentials.find((c) => c.name === 'synthaveilMapKeyApi');
    expect(descriptor?.required).toBe(false);
  });

  it('names the real problem when the key is missing, instead of n8n default text', async () => {
    // `required: false` makes n8n say "Node does not require credentials",
    // which points the operator at entirely the wrong thing.
    const ctx = mockCtx({
      items: [item({ text: 'hello' })],
      operation: 'restore',
      mapKeyAttached: false,
      itemParams: [{ mapHandle: VALID_HANDLE, textField: 'text' }],
      http: routedHttp({}),
    });

    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/Map Key credential is set/i);
  });
});

describe('QA review finding 9 — a map from another run is refused, not silently applied', () => {
  // Two maps in the same scope are cryptographically interchangeable by design
  // (PROTOCOL.md 5a records that trade-off and names the store's run_id as the
  // binding). So a stale or swapped handle opens perfectly well: without this
  // check the node would restore ANOTHER record's real names into this item's
  // text, which is worse than failing.
  const sealedFor = async (scope: string) =>
    sealContainer(
      [{ token: 'Alex Doe', original: 'Jane Doe' }],
      scope,
      new Uint8Array(Buffer.from(MAP_KEY, 'base64')),
    );

  // Use the file's own router so the request shape matches every other test here.
  const consumeReturning = (blobBytes: Uint8Array, extra: IDataObject) =>
    routedHttp({
      consume: { blob: Buffer.from(blobBytes).toString('base64'), ...extra },
    });

  it('refuses RUN_ID_MISMATCH when the map was sealed for a different execution', async () => {
    const { bytes } = await sealedFor(SCOPE_ID);
    const http = consumeReturning(bytes, {
      consistency: 'every_run',
      run_id: 'some-other-execution',
    });
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'note about Alex Doe' })],
      operation: 'restore',
      http,
    });

    const out = await new Taas().execute.call(ctx);

    expect(out[0][0].json.failure_code).toBe('RUN_ID_MISMATCH');
    // The real name must not reach the item on this path.
    expect(JSON.stringify(out[0][0].json)).not.toContain('Jane Doe');
  });

  it('restores normally when the run_id matches this execution', async () => {
    const { bytes } = await sealedFor(SCOPE_ID);
    const http = consumeReturning(bytes, { consistency: 'every_run', run_id: 'exec-1' });
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'note about Alex Doe' })],
      operation: 'restore',
      http,
    });

    const out = await new Taas().execute.call(ctx);

    expect(JSON.stringify(out[0][0].json)).toContain('Jane Doe');
  });

  it('does not apply the check to stable maps, which are not run-bound', async () => {
    const { bytes } = await sealedFor(SCOPE_ID);
    const http = consumeReturning(bytes, { consistency: 'stable', run_id: 'a-much-older-run' });
    const ctx = mockCtx({
      items: [item({ synthaveil_map_handle: VALID_HANDLE, text: 'note about Alex Doe' })],
      operation: 'restore',
      http,
    });

    const out = await new Taas().execute.call(ctx);

    expect(JSON.stringify(out[0][0].json)).toContain('Jane Doe');
  });
});
