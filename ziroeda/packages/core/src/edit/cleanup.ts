/**
 * Post-edit schematic cleanup, ported from KiCad's `SCHEMATIC::CleanUp` and
 * `SCH_LINE::MergeOverlap` (eeschema/schematic.cpp, eeschema/sch_line.cpp).
 *
 * KiCad runs this after every edit (as part of `RecalculateConnections`): it
 * merges pairs of wires that are colinear, the same layer/stroke, and either
 * overlap or touch end-to-end with no junction at the touch point — so two
 * segments drawn or dragged into a straight line become a single wire, exactly
 * as in the desktop app. This is the model side; the caller applies it after a
 * move/draw commit.
 *
 * Only the wire/bus merge is ported here (the user-visible "two wires in a line
 * stay separate" bug); junction/no-connect de-duplication is a separate concern.
 */

import type { Schematic, SchLine, SchJunction, Vec2 } from '../model/types.js';
import { makeWireWithUuid, makeBus, newUuid } from './build.js';
import type { EditCommand } from './command.js';

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** KiCad's `less`: order points left-to-right, then bottom-to-top (x, then y). */
function less(a: Vec2, b: Vec2): boolean {
  if (a.x === b.x) return a.y < b.y;
  return a.x < b.x;
}

/** True if there is an explicit junction dot exactly at `p`. */
function junctionAt(junctions: readonly SchJunction[], p: Vec2): boolean {
  return junctions.some((j) => eq(j.at, p));
}

/** Two lines share a layer if they are the same kind (wire vs bus). */
function sameLayer(a: SchLine, b: SchLine): boolean {
  return a.kind === b.kind;
}

/** KiCad's SCH_LINE::IsStrokeEquivalent: equal width and equal (or both default) style. */
function strokeEquivalent(a: SchLine, b: SchLine): boolean {
  const wa = a.stroke?.width ?? 0;
  const wb = b.stroke?.width ?? 0;
  if (wa !== wb) return false;
  const ta = a.stroke?.type ?? 'default';
  const tb = b.stroke?.type ?? 'default';
  return ta === tb;
}

/**
 * Faithful port of `SCH_LINE::MergeOverlap`: if `first` and `second` are colinear
 * and overlap (or touch end-to-end with no junction at the touch point), return
 * the merged span [start,end]; otherwise null. `aCheckJunctions` mirrors KiCad.
 */
function mergeOverlap(
  first: SchLine, second: SchLine, junctions: readonly SchJunction[], checkJunctions: boolean,
): { start: Vec2; end: Vec2 } | null {
  if (first === second || !sameLayer(first, second)) return null;

  let leftmostStart = second.start;
  let leftmostEnd = second.end;
  let rightmostStart = first.start;
  let rightmostEnd = first.end;

  // Place each line's start to the left-and-below its end.
  if (!eq(leftmostStart, less(leftmostStart, leftmostEnd) ? leftmostStart : leftmostEnd)) {
    [leftmostStart, leftmostEnd] = [leftmostEnd, leftmostStart];
  }
  if (!eq(rightmostStart, less(rightmostStart, rightmostEnd) ? rightmostStart : rightmostEnd)) {
    [rightmostStart, rightmostEnd] = [rightmostEnd, rightmostStart];
  }

  // leftmost = the line starting farthest left; swap if needed.
  if (less(rightmostStart, leftmostStart)) {
    [leftmostStart, rightmostStart] = [rightmostStart, leftmostStart];
    [leftmostEnd, rightmostEnd] = [rightmostEnd, leftmostEnd];
  }

  const otherStart = rightmostStart;
  const otherEnd = rightmostEnd;

  if (less(rightmostEnd, leftmostEnd)) {
    rightmostStart = leftmostStart;
    rightmostEnd = leftmostEnd;
  }

  // End one before the beginning of the other -> no overlap possible.
  if (less(leftmostEnd, otherStart)) return null;

  // Trivial case: identical span.
  if (eq(leftmostStart, otherStart) && eq(leftmostEnd, otherEnd)) {
    return { start: leftmostStart, end: leftmostEnd };
  }

  // Colinearity test (KiCad's exact integer form).
  let colinear = false;
  if (leftmostStart.y === leftmostEnd.y && otherStart.y === otherEnd.y) {
    colinear = leftmostStart.y === otherStart.y; // horizontal
  } else if (leftmostStart.x === leftmostEnd.x && otherStart.x === otherEnd.x) {
    colinear = leftmostStart.x === otherStart.x; // vertical
  } else {
    const dx = leftmostEnd.x - leftmostStart.x;
    const dy = leftmostEnd.y - leftmostStart.y;
    colinear = (otherStart.y - leftmostStart.y) * dx === (otherStart.x - leftmostStart.x) * dy
      && (otherEnd.y - leftmostStart.y) * dx === (otherEnd.x - leftmostStart.x) * dy;
  }
  if (!colinear) return null;

  // True overlap always merges; colinear touching segments only merge if there is
  // no junction where they meet.
  const touching = eq(leftmostEnd, rightmostStart);
  if (touching && checkJunctions && junctionAt(junctions, leftmostEnd)) return null;

  return { start: leftmostStart, end: rightmostEnd };
}

/** Build a merged wire/bus over `span`, preserving `template`'s kind, with a fresh uuid. */
function mergedLine(template: SchLine, span: { start: Vec2; end: Vec2 }): SchLine {
  return template.kind === 'bus'
    ? makeBus(span.start, span.end)
    : makeWireWithUuid(span.start, span.end, newUuid());
}

/**
 * Merge all colinear touching/overlapping wires and buses, looping until stable
 * (KiCad's `while( changed )` in CleanUp). Returns a new schematic; unchanged if
 * nothing merged.
 */
export function mergeColinearWires(sch: Schematic): Schematic {
  let lines: SchLine[] = sch.lines.slice();
  let changed = true;
  let didMerge = false;

  while (changed) {
    changed = false;
    // Only wires/buses participate.
    const idx = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.kind === 'wire' || l.kind === 'bus');

    outer: for (let a = 0; a < idx.length; a++) {
      const first = idx[a]!.l;
      for (let b = a + 1; b < idx.length; b++) {
        const second = idx[b]!.l;
        if (!sameLayer(first, second) || !strokeEquivalent(first, second)) continue;

        // Remove an exact duplicate outright.
        const dup = (eq(first.start, second.start) && eq(first.end, second.end))
          || (eq(first.start, second.end) && eq(first.end, second.start));
        if (dup) {
          lines = lines.filter((l) => l !== second);
          changed = true;
          didMerge = true;
          break outer;
        }

        const span = mergeOverlap(first, second, sch.junctions, true);
        if (span) {
          const merged = mergedLine(first, span);
          lines = lines.filter((l) => l !== first && l !== second);
          lines.push(merged);
          changed = true;
          didMerge = true;
          break outer;
        }
      }
    }
  }

  return didMerge ? { ...sch, lines } : sch;
}

/**
 * Wrap a command so post-edit cleanup (wire merge) runs as part of the same
 * undoable step, mirroring KiCad where `RecalculateConnections`/`CleanUp` is part
 * of the edit's commit. Undo restores the exact pre-edit document (a snapshot,
 * like KiCad's PICKED_ITEMS_LIST), since a merge is not reversible field-by-field.
 */
export function withCleanup(cmd: EditCommand): EditCommand {
  return {
    label: cmd.label,
    apply: (doc) => mergeColinearWires(cmd.apply(doc)),
    invert: (before) => restoreTo(before, cmd.label),
  };
}

function restoreTo(target: Schematic, label: string): EditCommand {
  return {
    label,
    apply: () => target,
    invert: (current) => restoreTo(current, label),
  };
}
