/**
 * The climb detector behind `mirrorSafety.test.ts`: does this source text build
 * a path that leaves the package root?
 *
 * Split out for size, and deliberately pure -- it takes TEXT and touches no
 * filesystem. `tests/` is copied verbatim into the standalone publish repo, so
 * a helper that read a monorepo path would be the exact failure the guard
 * exists to catch. It is scanned by that guard like any other mirrored file.
 *
 * The first version anchored on `__dirname` and counted whole quoted arguments
 * equal to a parent segment. Quality review of cb7ca5e3 found two ways past it:
 *
 *   1. Put the climb inside ONE argument, separated by slashes. Nothing in that
 *      argument equals a bare parent segment, so the count came out zero.
 *   2. Bind the package root to a name in one call, then climb again from that
 *      name in a second call that never mentions `__dirname` at all.
 *
 * So: climbs are counted per SEGMENT, across every path-building call, whether
 * or not `__dirname` appears in it; and a name bound to a path-producing call
 * carries that call's climb into every later call that uses it. The budget is
 * the file's own depth below the package root, passed in by the caller.
 */

/** Calls that build a path or open one, callee captured. */
const PATH_CALL = /\b(join|resolve|readFileSync|existsSync)\s*\(/g;

/** Callees returning a path, so a name bound to one is a path root. */
const PATH_PRODUCERS = ['join', 'resolve'];

/** String and template literals, as written in source. */
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** A bare identifier reference. Literals are stripped before this runs. */
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/** An interpolated expression inside a template literal. */
const INTERPOLATION = /\$\{([^}]*)\}/g;

/** Quote characters that open a literal in source. */
const QUOTES = '\'"`';

/** A binding sitting immediately left of a path call on the same line. */
const BOUND_NAME = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/;

/** The one path segment that leaves a directory. */
const PARENT_SEGMENT = '..';

/** Path separators, either platform, since both appear in checked-in code. */
const SEPARATORS = /[\\/]/;

/**
 * A module specifier's leading parent run, anchored to the start of an import
 * or require statement. Unanchored, this fires on the parent-traversal strings
 * that `boundary.test.ts` carries as positive-control fixtures.
 */
const RELATIVE_SPECIFIER =
  /^\s*(?:import[^'"]*from\s*|(?:const|let|var)[^=]*=\s*require\(\s*)['"]((?:\.\.\/)+)/gm;

/**
 * The argument text of a call whose opening parenthesis sits at `open`.
 *
 * Parenthesis matching rather than "up to the next `)`", so a nested call and a
 * call whose arguments are spread over several lines are both read whole.
 * Quotes are tracked so a parenthesis inside a string cannot end the run.
 */
function argumentsFrom(text: string, open: number): string {
  let depth = 1;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
    } else if (QUOTES.includes(char)) {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i);
    }
  }
  // Unbalanced -- an apostrophe in a trailing comment, say. Fall back to the
  // rest of the line so arguments written beside the call are still counted,
  // rather than silently scoring the call zero.
  return text.slice(open).split('\n')[0];
}

/** Parent segments in one path string, whichever separator it uses. */
function segmentClimbs(value: string): number {
  return value.split(SEPARATORS).filter((segment) => segment === PARENT_SEGMENT).length;
}

/** Parent segments written literally in a call's arguments. */
function literalClimbs(args: string): number {
  return [...args.matchAll(LITERAL)].reduce(
    (total, match) => total + segmentClimbs(match[0].slice(1, -1)),
    0,
  );
}

/**
 * A call's arguments with their literal text removed, so the identifier pass
 * below reads code only. A template literal keeps its interpolated expressions
 * -- `${ROOT}/../docs` uses ROOT exactly as an argument would, and dropping the
 * whole literal would hand back the evasion this detector exists to close --
 * but loses its static text, which is path, not names.
 */
function codeOnly(args: string): string {
  return args.replace(LITERAL, (literal) =>
    literal.startsWith('`')
      ? [...literal.matchAll(INTERPOLATION)].reduce((code, match) => `${code} ${match[1]}`, ' ')
      : ' ',
  );
}

/** Climb a call inherits from names already bound to a climbing path. */
function inheritedClimbs(args: string, roots: Map<string, number>): number {
  const code = codeOnly(args);
  const names = new Set([...code.matchAll(IDENTIFIER)].map((match) => match[0]));
  let total = 0;
  for (const name of names) total += roots.get(name) ?? 0;
  return total;
}

/**
 * Remember a name bound straight to a path-producing call, so a later call
 * using that name inherits its climb. Only a direct binding counts: wrapping
 * the call in something else (`JSON.parse`, `mkdtempSync`) yields a value that
 * is not a path, and treating it as one double-counts honest code.
 */
function bindRoot(
  roots: Map<string, number>,
  prefix: string,
  callee: string,
  climbs: number,
): void {
  if (!PATH_PRODUCERS.includes(callee)) return;
  const bound = BOUND_NAME.exec(prefix);
  if (!bound) return;
  roots.set(bound[1], Math.max(roots.get(bound[1]) ?? 0, climbs));
}

/** The furthest any single path-building call in `text` climbs. */
export function countPathClimbs(text: string): number {
  const roots = new Map<string, number>();
  let worst = 0;
  for (const call of text.matchAll(PATH_CALL)) {
    const at = call.index ?? 0;
    const args = argumentsFrom(text, at + call[0].length);
    const climbs = literalClimbs(args) + inheritedClimbs(args, roots);
    worst = Math.max(worst, climbs);
    bindRoot(roots, text.slice(text.lastIndexOf('\n', at) + 1, at), call[1], climbs);
  }
  return worst;
}

/** A path build that climbs past the package root. */
export function climbsViaPathBuild(text: string, limit: number): boolean {
  return countPathClimbs(text) > limit;
}

/** An import or require whose specifier climbs past the package root. */
export function climbsViaSpecifier(text: string, limit: number): boolean {
  return [...text.matchAll(RELATIVE_SPECIFIER)].some(
    (match) => match[1].split('/').length - 1 > limit,
  );
}
