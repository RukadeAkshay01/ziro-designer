/**
 * Typed read helpers over the S-expression AST.
 *
 * The typed document model is a *view* over the lossless AST: readers use these
 * helpers to pull named children and scalar values out of an `SList` without
 * losing the underlying node (which remains the source of truth for serializing
 * unchanged items). Nothing here mutates or discards AST nodes.
 */

import { head, isList, type SList, type SNode } from './types.js';

/** All direct child lists of `node` whose head matches `name`. */
export function childrenNamed(node: SList, name: string): SList[] {
  const out: SList[] = [];
  for (const item of node.items) {
    if (isList(item) && head(item) === name) out.push(item);
  }
  return out;
}

/** The first direct child list of `node` whose head matches `name`, if any. */
export function childNamed(node: SList, name: string): SList | undefined {
  for (const item of node.items) {
    if (isList(item) && head(item) === name) return item;
  }
  return undefined;
}

/**
 * The positional arguments of a list: its items after the head, as scalar values.
 * For `(at 161.29 109.22 180)` this is `['161.29', '109.22', '180']`. Sub-lists
 * are skipped (they are not positional scalars).
 */
export function args(node: SList): string[] {
  const out: string[] = [];
  for (let i = 1; i < node.items.length; i++) {
    const it = node.items[i]!;
    if (!isList(it)) out.push(it.value);
  }
  return out;
}

/** The raw scalar value of the nth positional argument (0-based, after the head). */
export function arg(node: SList, index: number): string | undefined {
  return args(node)[index];
}

/** The nth positional argument parsed as a finite number, or `undefined`. */
export function numArg(node: SList, index: number): number | undefined {
  const raw = arg(node, index);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A KiCad "maybe absent" boolean. KiCad encodes booleans as the tokens `yes`/`no`
 * (and tolerates legacy `true`/`false`). Returns `fallback` when the value is
 * missing or unrecognised.
 */
export function boolArg(node: SList, index: number, fallback = false): boolean {
  const raw = arg(node, index);
  if (raw === 'yes' || raw === 'true') return true;
  if (raw === 'no' || raw === 'false') return false;
  return fallback;
}

/** Convenience: read a named child's first positional argument as a string. */
export function stringField(node: SList, name: string): string | undefined {
  const child = childNamed(node, name);
  return child ? arg(child, 0) : undefined;
}

/** Convenience: read a named child's first positional argument as a number. */
export function numberField(node: SList, name: string): number | undefined {
  const child = childNamed(node, name);
  return child ? numArg(child, 0) : undefined;
}

/** Convenience: read a named yes/no child as a boolean. */
export function boolField(node: SList, name: string, fallback = false): boolean {
  const child = childNamed(node, name);
  return child ? boolArg(child, 0, fallback) : fallback;
}

/** Type guard re-export for readers that walk mixed `SNode` arrays. */
export { isList, type SNode, type SList };
