/**
 * Dangling-pin detection, the model side of KiCad's dangling-state pass
 * (SCH_PIN / SCH_ITEM::UpdateDanglingState). A pin is "dangling" when nothing
 * connects at its connection point: no wire touches it (at an end or by passing
 * through), no junction sits on it, no label anchors there, and no other pin
 * stacks on it. KiCad draws an open circle on such pins (drawPinDanglingIndicator)
 * and treats them as the clickable anchors that auto-start a wire
 * (SCH_PIN::IsPointClickableAnchor = m_isDangling && position).
 */

import type { Schematic, LibSymbol, SchSymbol, Vec2 } from '../model/types.js';
import { symbolTransform, localToWorld } from '../geom/transform.js';

const key = (p: Vec2): string => `${p.x},${p.y}`;

/** True if point p lies on the segment a-b (exact integer-IU geometry, as KiCad). */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
      && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

/** World connection points of a placed symbol's pins (pin tips through the transform). */
function symbolPinWorld(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if ((u.unit !== 0 && u.unit !== sym.unit) || (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)) continue;
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

  const wires = sch.lines.filter((l) => l.kind === 'wire' || l.kind === 'bus');
  for (const w of wires) { nodePoints.add(key(w.start)); nodePoints.add(key(w.end)); }

  const connected = (p: Vec2): boolean => {
    if ((pinCount.get(key(p)) ?? 0) > 1) return true;      // stacked on another pin
    if (nodePoints.has(key(p))) return true;               // junction, label, or wire end here
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
