/**
 * Hit-testing for selection, grounded in KiCad's `HitTest(point, accuracy)`:
 * lines test segment proximity within a tolerance, junctions/labels/symbols test
 * against their shape/bounding box. `accuracy` is a world-space tolerance the
 * caller derives from a pixel radius (so selection feels the same at any zoom).
 */

import type { Schematic, SchSymbol, LibSymbol, Vec2 } from '../model/types.js';
import { contains, inflate, labelBox, symbolBodyBBox } from './bbox.js';

/** A reference to a top-level, selectable schematic item. */
export interface ItemRef {
  kind: 'symbol' | 'line' | 'junction' | 'label';
  /** Stable identity: the item's uuid, or `idx:<n>` when one is absent. */
  id: string;
}

export function refId(kind: ItemRef['kind'], uuid: string | undefined, index: number): string {
  return uuid ?? `${kind}:idx:${index}`;
}

/** Distance from point p to segment ab. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Find the top-most selectable item at a world point, within `accuracy` (world
 * units). Priority roughly follows KiCad: small/precise items (junctions, labels,
 * wires) win over the larger symbol body they may overlap.
 */
export function hitTest(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  p: Vec2,
  accuracy: number,
): ItemRef | null {
  for (let i = 0; i < sch.junctions.length; i++) {
    const j = sch.junctions[i]!;
    const r = (j.diameter > 0 ? j.diameter : 9000) / 2 + accuracy;
    if (Math.hypot(p.x - j.at.x, p.y - j.at.y) <= r) return { kind: 'junction', id: refId('junction', j.uuid, i) };
  }

  for (let i = 0; i < sch.labels.length; i++) {
    const l = sch.labels[i]!;
    if (contains(inflate(labelBox(l), accuracy), p))
      return { kind: 'label', id: refId('label', l.uuid, i) };
  }

  for (let i = 0; i < sch.lines.length; i++) {
    const ln = sch.lines[i]!;
    const tol = accuracy + (ln.stroke && ln.stroke.width > 0 ? ln.stroke.width / 2 : 0);
    if (distToSegment(p, ln.start, ln.end) <= tol) return { kind: 'line', id: refId('line', ln.uuid, i) };
  }

  for (let i = 0; i < sch.symbols.length; i++) {
    const s = sch.symbols[i]!;
    const box = inflate(symbolBodyBBox(s, libById.get(s.libId)), accuracy / 2);
    if (contains(box, p)) return { kind: 'symbol', id: refId('symbol', s.uuid, i) };
  }

  return null;
}

/** Stable id for a symbol, matching `refId` usage in hitTest. */
export function symbolId(s: SchSymbol, index: number): string {
  return refId('symbol', s.uuid, index);
}
