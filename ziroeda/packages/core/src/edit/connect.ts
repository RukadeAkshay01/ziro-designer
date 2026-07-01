/**
 * Connection-aware move planning ("rubber-banding").
 *
 * Grounded in KiCad's `SCH_MOVE_TOOL::getConnectedDragItems`: when an item moves,
 * any wire whose endpoint coincides exactly with one of the moved item's
 * connection points has *that endpoint* dragged along, so the wire stretches and
 * the connection stays intact. Coincidence is exact integer-IU equality, as in
 * KiCad (pins and wire ends land on the grid).
 *
 * `getConnectedDragItems` also handles the case where the *fixed* item at a moved
 * connection point is a symbol pin or a junction rather than another wire: since
 * those can't stretch, it inserts a brand-new zero-length wire there (`makeNewWire`,
 * flagged `SELECTED_BY_DRAG | STARTPOINT`) with one end anchored at the fixed pin
 * and the other end following the drag — the rubber-band stub that keeps a moved
 * wire (or symbol) attached to a fixed pin instead of pulling free of it.
 */

import { symbolTransform, localToWorld } from '../geom/transform.js';
import type { LibSymbol, SchSymbol, Schematic, Vec2 } from '../model/types.js';
import { refId } from './hittest.js';
import { newUuid } from './build.js';

function unitMatches(unit: number, bodyStyle: number, u: { unit: number; bodyStyle: number }): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/** World positions of a placed symbol's pins (its electrical connection points). */
export function symbolPinPositions(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if (!unitMatches(sym.unit, sym.bodyStyle, u)) continue;
    for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
  }
  return out;
}

/** A new rubber-band stub wire anchored at a fixed pin/junction, tracking the drag. */
export interface StubWire {
  uuid: string;
  fixed: Vec2;
}

/** A plan for a connection-aware move: which items move whole, which wire ends drag. */
export interface MoveSpec {
  /** Items (any kind) that move in their entirety. */
  fullIds: ReadonlySet<string>;
  /** Wire ids whose start point should be dragged. */
  wireStart: ReadonlySet<string>;
  /** Wire ids whose end point should be dragged. */
  wireEnd: ReadonlySet<string>;
  /** New stub wires to insert, anchored at a fixed pin/junction not being moved. */
  newWires: readonly StubWire[];
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * Build a move plan for a selection: collect the connection points of the
 * selected items, then attach the coincident endpoints of any *unselected* wire,
 * and plan a rubber-band stub for any moved point that lands on a fixed
 * (unselected) symbol pin or junction, so that connection isn't pulled apart.
 */
export function planMove(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ids: ReadonlySet<string>,
): MoveSpec {
  const points = new Set<string>();
  sch.symbols.forEach((s, i) => {
    if (ids.has(refId('symbol', s.uuid, i)))
      for (const p of symbolPinPositions(s, libById.get(s.libId))) points.add(key(p));
  });
  sch.lines.forEach((l, i) => {
    if (ids.has(refId('line', l.uuid, i))) { points.add(key(l.start)); points.add(key(l.end)); }
  });
  sch.junctions.forEach((j, i) => { if (ids.has(refId('junction', j.uuid, i))) points.add(key(j.at)); });
  sch.labels.forEach((l, i) => { if (ids.has(refId('label', l.uuid, i))) points.add(key(l.at)); });

  const wireStart = new Set<string>();
  const wireEnd = new Set<string>();
  sch.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    if (ids.has(id)) return; // already moving in full
    if (points.has(key(l.start))) wireStart.add(id);
    if (points.has(key(l.end))) wireEnd.add(id);
  });

  // Fixed (unselected) symbol pins and junctions at a moved point each get one
  // rubber-band stub (KiCad: `if (test->IsConnected(aPoint) && !newWire)` — a
  // single new wire per point, regardless of how many fixed items touch it there).
  const fixedPoints = new Set<string>();
  sch.symbols.forEach((s, i) => {
    if (ids.has(refId('symbol', s.uuid, i))) return;
    for (const p of symbolPinPositions(s, libById.get(s.libId))) {
      const k = key(p);
      if (points.has(k)) fixedPoints.add(k);
    }
  });
  sch.junctions.forEach((j, i) => {
    if (ids.has(refId('junction', j.uuid, i))) return;
    const k = key(j.at);
    if (points.has(k)) fixedPoints.add(k);
  });

  const newWires: StubWire[] = [...fixedPoints].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { uuid: newUuid(), fixed: { x: x!, y: y! } };
  });

  return { fullIds: ids, wireStart, wireEnd, newWires };
}
