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

import type { Schematic, SchLine, SchJunction, Vec2 } from '../types.js';
import { makeWireWithUuid, makeBus, makeJunction, newUuid } from './build.js';
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
  first: SchLine,
  second: SchLine,
  junctions: readonly SchJunction[],
  checkJunctions: boolean,
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
    colinear =
      (otherStart.y - leftmostStart.y) * dx === (otherStart.x - leftmostStart.x) * dy &&
      (otherEnd.y - leftmostStart.y) * dx === (otherEnd.x - leftmostStart.x) * dy;
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
/** Is `p` strictly interior to segment a-b (collinear, between the ends)? */
function onSegInterior(p: Vec2, a: Vec2, b: Vec2): boolean {
  if (eq(p, a) || eq(p, b)) return false;
  if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot > 0 && dot < len2;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}
/** Canonical direction key for a segment leaving `p` toward `q` (reduced integer vector). */
function dirKey(dx: number, dy: number): string {
  const g = gcd(dx, dy);
  return `${dx / g},${dy / g}`;
}

/**
 * Whether a junction dot is needed at `p` (ignoring existing junctions), ported
 * from KiCad's JUNCTION_HELPERS::AnalyzePoint: count the distinct directions wires
 * leave `p` — an endpoint there contributes one direction, a wire passing through
 * contributes two (both ways). Three or more distinct directions is a junction, so
 * collinear overlaps (2 directions) and L-corners are not, but tees and crosses are.
 */
function junctionNeeded(lines: readonly SchLine[], p: Vec2): boolean {
  const dirs = new Set<string>();
  for (const l of lines) {
    if (l.kind !== 'wire') continue; // buses use separate bus junctions
    if (eq(l.start, p)) dirs.add(dirKey(l.end.x - p.x, l.end.y - p.y));
    else if (eq(l.end, p)) dirs.add(dirKey(l.start.x - p.x, l.start.y - p.y));
    else if (onSegInterior(p, l.start, l.end)) {
      dirs.add(dirKey(l.end.x - p.x, l.end.y - p.y));
      dirs.add(dirKey(l.start.x - p.x, l.start.y - p.y));
    }
  }
  return dirs.size >= 3;
}

/** True if any junction or third-wire endpoint sits strictly inside span [s,e]. */
function vertexInside(
  lines: readonly SchLine[],
  junctions: readonly SchJunction[],
  a: SchLine,
  b: SchLine,
  s: Vec2,
  e: Vec2,
): boolean {
  for (const j of junctions) if (onSegInterior(j.at, s, e)) return true;
  for (const l of lines) {
    if (l === a || l === b) continue;
    if (onSegInterior(l.start, s, e) || onSegInterior(l.end, s, e)) return true;
  }
  return false;
}

/**
 * KiCad-faithful wire cleanup after an edit (SCHEMATIC::CleanUp): split wires where
 * another wire tees into their middle, add junction dots where three wires meet or
 * a tee forms, drop unneeded junctions and zero-length wires, and merge colinear
 * wires that are not separated by a junction/vertex. Wires are kept whole through a
 * tee (KiCad does not split them); a junction marks the connection instead.
 */
export function mergeColinearWires(sch: Schematic): Schematic {
  let lines: SchLine[] = sch.lines.slice();
  const junctions: SchJunction[] = sch.junctions.slice();
  let changed = true;
  let any = false;
  const mark = () => {
    changed = true;
    any = true;
  };

  while (changed) {
    changed = false;

    // 1. Drop zero-length wires/buses.
    const zi = lines.findIndex(
      (l) => (l.kind === 'wire' || l.kind === 'bus') && eq(l.start, l.end),
    );
    if (zi >= 0) {
      lines.splice(zi, 1);
      mark();
      continue;
    }

    // 2. Junctions: add where needed, remove where no longer needed (auto-managed).
    const ji = junctions.findIndex((j) => !junctionNeeded(lines, j.at));
    if (ji >= 0) {
      junctions.splice(ji, 1);
      mark();
      continue;
    }
    const need = new Set(junctions.map((j) => `${j.at.x},${j.at.y}`));
    let added = false;
    for (const l of lines) {
      if (l.kind !== 'wire') continue;
      for (const p of [l.start, l.end]) {
        if (!need.has(`${p.x},${p.y}`) && junctionNeeded(lines, p)) {
          junctions.push(makeJunction(p));
          need.add(`${p.x},${p.y}`);
          added = true;
        }
      }
    }
    if (added) {
      mark();
      continue;
    }

    // 3. Merge two colinear same-layer wires when nothing (junction/third end) lies
    //    between them (mergeOverlap already refuses to bridge a junction touch-point).
    let merged = false;
    outer: for (let a = 0; a < lines.length; a++) {
      const first = lines[a]!;
      if (first.kind !== 'wire' && first.kind !== 'bus') continue;
      for (let b = a + 1; b < lines.length; b++) {
        const second = lines[b]!;
        if (second.kind !== 'wire' && second.kind !== 'bus') continue;
        if (!sameLayer(first, second) || !strokeEquivalent(first, second)) continue;

        const dup =
          (eq(first.start, second.start) && eq(first.end, second.end)) ||
          (eq(first.start, second.end) && eq(first.end, second.start));
        if (dup) {
          lines.splice(b, 1);
          merged = true;
          break outer;
        }

        const span = mergeOverlap(first, second, junctions, true);
        if (span && !vertexInside(lines, junctions, first, second, span.start, span.end)) {
          const m = mergedLine(first, span);
          lines = lines.filter((l) => l !== first && l !== second);
          lines.push(m);
          merged = true;
          break outer;
        }
      }
    }
    if (merged) {
      mark();
    }
  }

  return any ? { ...sch, lines, junctions } : sch;
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
