/**
 * Codex review on #1622 — Local restore must never store a one-shot map that
 * Restore would refuse. The vendored restore-protocol inventory check refuses a
 * lone UTF-16 surrogate as INVALID_ENTRY, and Restore only runs it AFTER the
 * map has been consumed, so such a value has to be refused before the map PUT
 * (and, at the node level, before the tokenize request, so no quota is spent).
 */
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import { Taas } from '../../nodes/Taas/Taas.node';
import { isRestorableText, sealContainer } from '../../nodes/Taas/sealedMap';
import { ctxFor, routedHttp, sent } from './idempotencyTestKit';

const LONE_HIGH = 'Avery \ud83d Testperson';
const LONE_LOW = 'Avery \ude00 Testperson';
const EMOJI = 'Avery 😀 Testperson';
const item = (json: IDataObject): INodeExecutionData => ({ json });
const LOCAL_RESTORE = { returnMode: 'localRestore', scopeId: 'crm-sync' };

describe('isRestorableText', () => {
  it.each([
    ['plain text', 'Avery Testperson', true],
    ['a valid surrogate pair (emoji)', EMOJI, true],
    ['a lone high surrogate', LONE_HIGH, false],
    ['a lone low surrogate', LONE_LOW, false],
  ])('%s -> %s', (_label, value, expected) => {
    expect(isRestorableText(value)).toBe(expected);
  });
});

describe('sealContainer refuses what restore would refuse', () => {
  const masterKey = new Uint8Array(32).fill(7);

  it('throws on a lone surrogate in an original value', async () => {
    await expect(sealContainer([{ token: 'tok_1', original: LONE_HIGH }], 'crm-sync', masterKey)).rejects.toThrow(
      /unpaired surrogate/,
    );
  });

  it('throws on a lone surrogate in a token', async () => {
    await expect(sealContainer([{ token: LONE_LOW, original: 'Avery' }], 'crm-sync', masterKey)).rejects.toThrow(
      /unpaired surrogate/,
    );
  });

  it('still seals a valid surrogate pair', async () => {
    const sealed = await sealContainer([{ token: 'tok_1', original: EMOJI }], 'crm-sync', masterKey);
    expect(sealed.bytes.length).toBeGreaterThan(0);
  });
});

describe('Tokenize with Local restore', () => {
  it('refuses a lone surrogate before ANY request: no tokenize call, no map PUT', async () => {
    const http = routedHttp();
    const ctx = ctxFor({ items: [item({ name: LONE_HIGH })], params: LOCAL_RESTORE, http });
    await expect(new Taas().execute.call(ctx)).rejects.toThrow(/unpaired surrogate/);
    expect(http).not.toHaveBeenCalled();
  });

  it('names the field but never echoes the value', async () => {
    const ctx = ctxFor({ items: [item({ name: LONE_HIGH })], params: LOCAL_RESTORE, http: routedHttp() });
    const error = await new Taas().execute.call(ctx).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error?.message).toContain('"name"');
    expect(error?.message).not.toContain('Avery');
  });

  it('a valid emoji still tokenizes and stores its map', async () => {
    const http = routedHttp();
    await new Taas().execute.call(ctxFor({ items: [item({ name: EMOJI })], params: LOCAL_RESTORE, http }));
    const urls = sent(http).map((r) => `${r.method} ${r.url}`);
    expect(urls).toEqual(['POST /api/v1/tokenize', 'PUT /api/v1/maps']);
  });

  it('Record ID mode is unaffected (no map is stored, so nothing to protect)', async () => {
    const http = routedHttp();
    await new Taas().execute.call(ctxFor({ items: [item({ name: LONE_HIGH })], params: {}, http }));
    expect(http).toHaveBeenCalledTimes(1);
  });
});
