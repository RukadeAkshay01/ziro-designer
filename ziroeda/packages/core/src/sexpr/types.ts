/**
 * S-expression AST for KiCad-format files.
 *
 * KiCad stores schematics, symbols, boards, etc. as S-expressions. To guarantee
 * lossless round-tripping (so saving never silently drops fields ZiroEDA doesn't
 * yet model), this AST preserves *everything*:
 *
 *   - The distinction between a bare token (`yes`, `161.29`) and a quoted string
 *     (`"yes"`, `"161.29"`) is kept, because it is semantically meaningful in the
 *     format and must survive a save.
 *   - Numeric atoms are stored as their original source text, never parsed to a
 *     JS `number` at this layer. `161.29` must never come back as `161.290000001`.
 *
 * The typed document model (built later) is a *view* derived from this tree; this
 * tree remains the source of truth for serialization.
 */

/** A nested list: `( ... )`. By convention the first item is an atom naming the list. */
export interface SList {
  readonly kind: 'list';
  readonly items: SNode[];
}

/** A bare, unquoted token: a symbol (`yes`, `default`) or a number (`-1.27`). Stored as raw text. */
export interface SAtom {
  readonly kind: 'atom';
  readonly value: string;
}

/** A double-quoted string. `value` is the decoded (unescaped) content. */
export interface SString {
  readonly kind: 'string';
  readonly value: string;
}

export type SNode = SList | SAtom | SString;

export function list(...items: SNode[]): SList {
  return { kind: 'list', items };
}

export function atom(value: string): SAtom {
  return { kind: 'atom', value };
}

export function str(value: string): SString {
  return { kind: 'string', value };
}

/** The name of a list = the value of its first item, if that item is a bare atom. */
export function head(node: SList): string | undefined {
  const first = node.items[0];
  return first?.kind === 'atom' ? first.value : undefined;
}

export function isList(node: SNode | undefined): node is SList {
  return node?.kind === 'list';
}
