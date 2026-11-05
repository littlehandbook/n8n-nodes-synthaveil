import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_NAME } from '../src/constants';
import { Taas } from '../nodes/Taas/Taas.node';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

describe('package manifest', () => {
  // Task 0.2 (public rename): the published package identity moves to
  // n8n-nodes-synthaveil. Internal ids (below) do NOT move with it.
  // 0.2.0 -> 0.2.1 on 2026-09-13: the United Kingdom locale hint sent `UK`,
  // which the API has never accepted.
  // 0.2.1 -> 0.3.0 for #619 (IT Council C9): Tokenize and Tokenize (Batch) now send an
  // Idempotency-Key, so Retry On Fail inside one run no longer double-bills. Node version stays 1.
  // 0.3.0 -> 0.3.1 (EU10): the vendored restore-protocol 0.2.0 refuses INVALID_ENTRY on text it
  // cannot map back (a combining mark after a stand-in, conjoining-jamo Hangul).
  // 0.3.1 -> 0.4.0 on 2026-10-18 (#902): new method `l2.synthesize-locality`.
  it('is named n8n-nodes-synthaveil at 0.0.1 under MIT', () => {
    expect(pkg.name).toBe('n8n-nodes-synthaveil');
    expect(pkg.version).toBe('0.0.1');
    expect(pkg.license).toBe('MIT');
  });

  it('points repository.url at the synthaveil-named public mirror', () => {
    expect(pkg.repository.url).toBe('https://github.com/littlehandbook/n8n-nodes-synthaveil.git');
  });

  it('advertises the n8n community-node keyword', () => {
    expect(pkg.keywords).toContain('n8n-community-node-package');
  });

  it('keeps the "taas" keyword through the rename', () => {
    expect(pkg.keywords).toContain('taas');
  });

  it('declares the n8n block pointing at compiled dist artifacts', () => {
    expect(pkg.n8n.n8nNodesApiVersion).toBe(1);
    expect(pkg.n8n.strict).toBe(true);
    expect(pkg.n8n.credentials).toEqual([
      'dist/credentials/TaasApi.credentials.js',
      'dist/credentials/SynthaveilMapKey.credentials.js',
    ]);
    expect(pkg.n8n.nodes).toEqual(['dist/nodes/Taas/Taas.node.js']);
  });

  // CC-8 pin: the dist paths above reference file/class names that must never
  // rename, because they are baked into every saved customer workflow.
  it('CC-8: keeps the internal node/credential ids stable through the rename', () => {
    expect(pkg.n8n.nodes[0]).toBe('dist/nodes/Taas/Taas.node.js');
    expect(pkg.n8n.credentials[0]).toBe('dist/credentials/TaasApi.credentials.js');
    expect(new Taas().description.name).toBe('taas');
    expect(CREDENTIAL_NAME).toBe('taasApi');
  });

  it('peers on n8n-workflow', () => {
    expect(pkg.peerDependencies['n8n-workflow']).toBeDefined();
  });

  it('has ZERO runtime dependencies (verification rule)', () => {
    // The node must be self-contained and pull nothing at install time beyond
    // the n8n-provided peer. Any runtime dep is a supply-chain + isolation risk.
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});

// #902 release notes follow the package version (plan Task 4.4): #619 took 0.3.0 on staging,
// so the locality method ships as the next unused minor, 0.4.0, tagged v0.4.0. The changelog
// checks live in the monorepo (tests/ci/n8nReleaseNotes.test.ts): the changelog is not mirrored,
// and this suite runs in the public mirror's publish workflow (Codex P1 on PR #1336).
describe('release notes for 0.4.0 (#902)', () => {
  const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf8');

  // On main the locality method is hidden (production does not serve it yet), so the
  // README must announce it only as coming soon, never as a shipped 0.4.0 method.
  it('announces the locality method only as coming soon in the README "What\'s new" entry', () => {
    expect(readme).toMatch(/\*\*0\.4\.0\*\* — /);
    expect(readme).not.toMatch(/\*\*0\.4\.0\*\* — new method \*\*L2 — Synthetic Town\*\*/);
    expect(readme).toMatch(/\*\*Coming soon:\*\* a new method, \*\*L2 — Synthetic Town\*\*/);
    expect(readme).not.toMatch(/l2\.synthesize-locality/);
    expect(readme).not.toMatch(/\*\*0\.3\.0\*\* — new method/);
  });
});

// Task 0.7 (n8n standard layout, PC-2): n8n's community-package scanner only
// lints `nodes/**` and `credentials/**` at the package root — it currently sees
// nothing under `src/`. The move is src/nodes -> nodes, src/credentials ->
// credentials; shared helpers stay under src/. Compiled dist/ paths (CC-8,
// pinned above) must not change.
describe('package layout — n8n standard nodes/credentials at package root', () => {
  const root = join(__dirname, '..');

  it('has nodes/Taas/Taas.node.ts at the package root', () => {
    expect(existsSync(join(root, 'nodes', 'Taas', 'Taas.node.ts'))).toBe(true);
  });

  it('has credentials/TaasApi.credentials.ts at the package root', () => {
    expect(existsSync(join(root, 'credentials', 'TaasApi.credentials.ts'))).toBe(true);
  });

  it('no longer has the old src/nodes location (proves a move, not a copy)', () => {
    expect(existsSync(join(root, 'src', 'nodes'))).toBe(false);
  });

  it('no longer has the old src/credentials location (proves a move, not a copy)', () => {
    expect(existsSync(join(root, 'src', 'credentials'))).toBe(false);
  });

  it('keeps shared helpers under src/', () => {
    expect(existsSync(join(root, 'src', 'constants.ts'))).toBe(true);
  });

  it('pkg.files still ships dist', () => {
    expect(pkg.files).toContain('dist');
  });
});
