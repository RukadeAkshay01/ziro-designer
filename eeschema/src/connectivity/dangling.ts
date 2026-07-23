/**
 * Dangling-pin detection, the model side of KiCad's dangling-state pass
 * (SCH_PIN / SCH_ITEM::UpdateDanglingState). A pin is "dangling" when nothing
 * connects at its connection point: no wire touches it (at an end or by passing
 * through), no junction sits on it, no label anchors there, and no other pin
 * stacks on it. KiCad draws an open circle on such pins (drawPinDanglingIndicator)
 * and treats them as the clickable anchors that auto-start a wire
 * (SCH_PIN::IsPointClickableAnchor = m_isDangling && position).
 */

import type { Schematic, LibSymbol, SchSymbol, Vec2 } from '../types.js';
import { symbolTransform, localToWorld } from '@ziroeda/common/src/transform.js';

const key = (p: Vec2): string => `${p.x},${p.y}`;

/** True if point p lies on the segment a-b (exact integer-IU geometry, as KiCad). */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** World connection points of a placed symbol's pins (pin tips through the transform). */
function symbolPinWorld(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) {
      if (pin.hidden) continue; // hidden pins aren't drawn or auto-started (unless "show hidden")
      out.push(localToWorld(sym.at, t, pin.at));
    }
  }
  return out;
}

/** All (visible) pin connection points on the sheet, in world coordinates. */
export function allPinPositions(sch: Schematic, libById: Map<string, LibSymbol>): Vec2[] {
  const pts: Vec2[] = [];
  for (const sym of sch.symbols) pts.push(...symbolPinWorld(sym, libById.get(sym.libId)));
  return pts;
}

/**
 * Positions of every dangling pin (KiCad's open-circle targets). A pin is dangling
 * unless a wire touches its point (end or pass-through), a junction/label is on it,
 * or another pin stacks on it.
 */
export function danglingPinPositions(sch: Schematic, libById: Map<string, LibSymbol>): Vec2[] {
  const pins = allPinPositions(sch, libById);

  // Count how many pins occupy each point, so a stacked pin (>1) is "connected".
  const pinCount = new Map<string, number>();
  for (const p of pins) pinCount.set(key(p), (pinCount.get(key(p)) ?? 0) + 1);

  // Points occupied by a junction, label anchor, or a wire endpoint (O(1) lookup for
  // the common case — a pin connects at a wire end far more often than mid-span).
  const nodePoints = new Set<string>();
  for (const j of sch.junctions) nodePoints.add(key(j.at));
  for (const nc of sch.noConnects) nodePoints.add(key(nc.at)); // an NC flag "connects" the pin
  for (const l of sch.labels) if (l.kind !== 'text') nodePoints.add(key(l.at));
  for (const sh of sch.sheets) for (const p of sh.pins) nodePoints.add(key(p.at));

  const wires = sch.lines.filter((l) => l.kind === 'wire' || l.kind === 'bus');
  for (const w of wires) {
    nodePoints.add(key(w.start));
    nodePoints.add(key(w.end));
  }

  const connected = (p: Vec2): boolean => {
    if ((pinCount.get(key(p)) ?? 0) > 1) return true; // stacked on another pin
    if (nodePoints.has(key(p))) return true; // junction, label, or wire end here
    // Only the rare pin that is on no endpoint needs the mid-span (pass-through) scan.
    for (const w of wires) if (onSegment(p, w.start, w.end)) return true;
    return false;
  };

  // De-duplicate coincident dangling pins so we draw one target per point.
  const seen = new Set<string>();
  const out: Vec2[] = [];
  for (const p of pins) {
    if (connected(p)) continue;
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ----- wire-end / label dangling (SCH_LINE / SCH_LABEL_BASE UpdateDanglingState) --

/** DANGLING_END_T, the connectable end-point types KiCad indexes by position. */
type EndType =
  | 'wire'
  | 'bus'
  | 'junction'
  | 'pin'
  | 'label'
  | 'wire_entry'
  | 'sheet_label'
  | 'no_connect';

interface EndEntry {
  type: EndType;
  /** Object identity of the owning item, for the `item.GetItem() == this` skip. */
  owner: unknown;
}

/** All pin points including hidden ones — invisible power pins still connect
 *  (SCH_SYMBOL::GetEndPoints adds every pin). */
function allPinsWorld(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
  }
  return out;
}

/** The DANGLING_END_ITEM list, grouped by position (aItemListByPos). */
function endEntriesByPos(sch: Schematic, libById: Map<string, LibSymbol>): Map<string, EndEntry[]> {
  const map = new Map<string, EndEntry[]>();
  const add = (p: Vec2, type: EndType, owner: unknown): void => {
    const k = key(p);
    const arr = map.get(k);
    if (arr) arr.push({ type, owner });
    else map.set(k, [{ type, owner }]);
  };
  for (const l of sch.lines) {
    if (l.kind !== 'wire' && l.kind !== 'bus') continue;
    add(l.start, l.kind, l);
    add(l.end, l.kind, l);
  }
  for (const j of sch.junctions) add(j.at, 'junction', j);
  for (const s of sch.symbols)
    for (const p of allPinsWorld(s, libById.get(s.libId))) add(p, 'pin', s);
  for (const l of sch.labels) if (l.kind !== 'text') add(l.at, 'label', l);
  for (const sh of sch.sheets) for (const p of sh.pins) add(p.at, 'sheet_label', sh);
  for (const nc of sch.noConnects) add(nc.at, 'no_connect', nc);
  for (const be of sch.busEntries) {
    // Our entries are SCH_BUS_WIRE_ENTRY (WIRE_ENTRY_END at both ends).
    add(be.at, 'wire_entry', be);
    add({ x: be.at.x + be.size.x, y: be.at.y + be.size.y }, 'wire_entry', be);
  }
  return map;
}

export interface DanglingWireEnd {
  pos: Vec2;
  /** The wire's explicit stroke width in IU, 0 = layer default. */
  strokeWidth: number;
}

/**
 * Dangling wire endpoints — where KiCad draws the small square
 * (drawDanglingIndicator). Per SCH_LINE::UpdateDanglingState, a wire end is
 * connected by any co-located end item except a bus end (or bus-bus entry
 * end); only wires are reported since KiCad never draws bus squares.
 */
export function danglingWireEnds(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
): DanglingWireEnd[] {
  const byPos = endEntriesByPos(sch, libById);
  const out: DanglingWireEnd[] = [];
  for (const l of sch.lines) {
    if (l.kind !== 'wire') continue;
    for (const p of [l.start, l.end]) {
      const entries = byPos.get(key(p)) ?? [];
      const connected = entries.some((e) => e.owner !== l && e.type !== 'bus');
      if (!connected) out.push({ pos: p, strokeWidth: l.stroke?.width ?? 0 });
    }
  }
  return out;
}

/**
 * Dangling label anchors (SCH_LABEL_BASE::UpdateDanglingState): connected by
 * an exact-position pin / label / sheet pin / no-connect, or by lying anywhere
 * on a wire or bus segment. Plain graphic text is not connectable.
 */
export function danglingLabelAnchors(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
): { pos: Vec2; kind: string }[] {
  const byPos = endEntriesByPos(sch, libById);
  const segs = sch.lines.filter((l) => l.kind === 'wire' || l.kind === 'bus');
  const out: { pos: Vec2; kind: string }[] = [];
  for (const l of sch.labels) {
    if (l.kind === 'text') continue;
    const entries = byPos.get(key(l.at)) ?? [];
    let connected = entries.some(
      (e) =>
        e.owner !== l &&
        (e.type === 'pin' ||
          e.type === 'label' ||
          e.type === 'sheet_label' ||
          e.type === 'no_connect'),
    );
    if (!connected) {
      for (const w of segs) {
        if (onSegment(l.at, w.start, w.end)) {
          connected = true;
          break;
        }
      }
    }
    if (!connected) out.push({ pos: l.at, kind: l.kind });
  }
  return out;
}
