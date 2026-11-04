/**
 * QA review (PR #523, finding 11): a shipped example must not contradict its
 * own privacy claim.
 *
 * `crm-roundtrip-by-record-id` tokenised `name` and `email`, then passed an
 * untouched `body` field — "Jane called about her invoice being wrong again." —
 * straight into the AI step, whose comment told the reader "It never sees Jane,
 * Ahmed or Priya." It did. Examples are the first thing a customer copies, so a
 * wrong mental model here propagates into real workflows: the lesson people
 * take away must be that free text needs protecting too, not that tokenising
 * two structured columns is sufficient.
 *
 * This test derives the identities from the workflow itself — whatever values
 * sit in the fields the workflow protects — and then asserts no *other* literal
 * in the file repeats them. It therefore keeps working as the examples change.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXAMPLES_DIR = join(__dirname, '..', 'examples');

interface WorkflowNode {
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
}

const workflows = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    file: f,
    doc: JSON.parse(readFileSync(join(EXAMPLES_DIR, f), 'utf8')) as { nodes?: WorkflowNode[] },
  }));

/** Field names the Synthaveil node protects anywhere in this workflow. */
function protectedFieldNames(nodes: WorkflowNode[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    if (!String(node.type ?? '').includes('taas')) continue;
    const fields = (node.parameters?.fieldsToTokenize as { field?: { fieldName?: string }[] })
      ?.field;
    for (const f of fields ?? []) if (f.fieldName) names.add(f.fieldName);
  }
  return names;
}

/** Literal values assigned to those fields anywhere in the workflow — the identities. */
function protectedValues(nodes: WorkflowNode[], fields: Set<string>): string[] {
  const values: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const key = record.name;
      if (typeof key === 'string' && fields.has(key) && typeof record.value === 'string') {
        values.push(record.value);
      }
      Object.values(record).forEach(walk);
    }
  };
  nodes.forEach((n) => walk(n.parameters));

  // The code-node examples build their records in JS rather than Set nodes, so
  // also pick up `name: 'Jane Testerson'` style literals out of jsCode.
  for (const node of nodes) {
    const code = node.parameters?.jsCode;
    if (typeof code !== 'string') continue;
    for (const field of fields) {
      const pattern = new RegExp(`${field}\\s*:\\s*'([^']+)'`, 'g');
      for (const match of code.matchAll(pattern)) values.push(match[1]);
    }
  }
  return values;
}

/**
 * The identity tokens worth hunting for: the parts of a protected value that
 * would identify a person if they resurfaced in prose. Short/common fragments
 * ("+44", a tier name) are excluded to keep this from crying wolf.
 */
function identityTokens(values: string[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    // Only the identifying half of an address: `jane.testerson` out of
    // `jane.testerson@example.com`. The domain is shared infrastructure, not an
    // identity, and flagging `example` would drown the real signal.
    const identifyingPart = value.split('@')[0];
    for (const part of identifyingPart.split(/[\s.]+/)) {
      // Lower-cased so `Jane` (prose) and `jane` (email) are one token.
      if (part.length >= 4 && /^[A-Za-z]+$/.test(part)) tokens.add(part.toLowerCase());
    }
  }
  return [...tokens];
}

describe.each(workflows.map((w) => w.file))('%s keeps its privacy promise', (file) => {
  const { doc } = workflows.find((w) => w.file === file)!;
  const nodes = doc.nodes ?? [];
  const fields = protectedFieldNames(nodes);
  const values = protectedValues(nodes, fields);

  it('protects at least one field (otherwise this file proves nothing)', () => {
    // Restore-only workflows legitimately protect nothing; skip the claim there.
    if (fields.size === 0) return;
    expect(values.length).toBeGreaterThan(0);
  });

  it('repeats no protected identity in an unprotected field', () => {
    if (values.length === 0) return;
    const tokens = identityTokens(values);
    expect(tokens.length).toBeGreaterThan(0);

    // Everything in the file EXCEPT the assignments of the protected fields.
    const serialised = JSON.stringify(doc).toLowerCase();
    const offenders = tokens.filter((token) => {
      const needle = token.toLowerCase();
      const occurrences = serialised.split(needle).length - 1;
      const legitimate = values.filter((v) => v.toLowerCase().includes(needle)).length;
      return occurrences > legitimate;
    });

    expect(offenders).toEqual([]);
  });
});
