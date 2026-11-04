/**
 * A shipped example must run as shipped.
 *
 * Found during the same UAT that produced this branch: `crm-local-restore`
 * shipped two Restore nodes with no `scopeId` at all. Importing it and pressing
 * Test throws
 *
 *     preflight: scope ID is required for Local restore.
 *
 * on the very first run — the example demonstrating Local restore could not
 * perform a Local restore. Nothing caught it because no test opened the example
 * files looking for anything but the privacy claim, and the operator hitting it
 * has no way to know whether the example is wrong or their own setup is.
 *
 * The scope is not decoration: the map is sealed under it, and Restore has to
 * name the same scope to open it. So a Restore node needs a scope, and in a
 * workflow that also tokenises, it needs to be *that* scope — a valid-looking
 * but mismatched value fails just as hard, one step later.
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

/** Synthaveil nodes in this workflow performing `operation`. */
function nodesForOperation(nodes: WorkflowNode[], operation: string): WorkflowNode[] {
  return nodes.filter(
    (n) =>
      String(n.type ?? '').includes('taas') && n.parameters?.operation === operation,
  );
}

const scopeOf = (node: WorkflowNode): string => String(node.parameters?.scopeId ?? '');

describe.each(workflows.map((w) => w.file))('%s runs as shipped', (file) => {
  const nodes = workflows.find((w) => w.file === file)!.doc.nodes ?? [];
  const restores = nodesForOperation(nodes, 'restore');
  const tokenizes = nodesForOperation(nodes, 'tokenize');

  it('gives every Restore node a scope', () => {
    // `preflight` rejects an empty scope before it ever reaches the map.
    const missing = restores.filter((n) => scopeOf(n).trim() === '').map((n) => n.name);
    expect(missing).toEqual([]);
  });

  it('restores under a scope this workflow actually sealed', () => {
    if (restores.length === 0 || tokenizes.length === 0) return;
    const sealed = new Set(tokenizes.map(scopeOf));
    const mismatched = restores.filter((n) => !sealed.has(scopeOf(n))).map((n) => n.name);
    expect(mismatched).toEqual([]);
  });
});
