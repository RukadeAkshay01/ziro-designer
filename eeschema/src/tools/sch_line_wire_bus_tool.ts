/**
 * Interactive wire/bus drawing logic. Mirrors kicad/eeschema/tools/
 * sch_line_wire_bus_tool.cpp (SCH_LINE_WIRE_BUS_TOOL): the two-segment
 * break-point coercion for the 90°/45° line modes, posture switching, the
 * backtrack simplification pass, terminal-point detection (a click on a pin,
 * junction, label or wire ends the run) and the finishing commit with
 * automatic junctions.
 *
 * The UI event loop lives in the canvas; everything here is the pure model
 * side so it can be unit-tested.
 */
import type { LibSymbol, Schematic, SchLine, Vec2 } from '../types.js';
import { symbolTransform, localToWorld } from '@ziroeda/common/src/transform.js';
import { addItems } from './mutate.js';
import { needsJunction } from './mutate.js';
import { makeWire, makeBus, makeJunction } from './build.js';
import type { EditCommand } from './command.js';

/** EESCHEMA_SETTINGS m_Drawing.line_mode (sch_line.h LINE_MODE). */
export type WireLineMode = 'free' | '90' | '45';

/** One segment of the chain being drawn (upstream m_wires entries). */
export interface WireSeg {
  a: Vec2;
  b: Vec2;
}

const eq = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

export const segIsNull = (s: WireSeg): boolean => eq(s.a, s.b);

/**
 * SCH_LINE_WIRE_BUS_TOOL::startSegments — the first click creates one
 * segment; in the 90°/45° modes a second chained segment is created at once
 * so the pair can bend orthogonally toward the cursor.
 */
export function startSegments(pos: Vec2, mode: WireLineMode): WireSeg[] {
  const wires: WireSeg[] = [{ a: { ...pos }, b: { ...pos } }];
  if (mode !== 'free') wires.push({ a: { ...pos }, b: { ...pos } });
  return wires;
}

/**
 * SCH_LINE_WIRE_BUS_TOOL::computeBreakPoint — coerce the live segment pair so
 * both reach `pos` while staying orthogonal (90) or orthogonal+diagonal (45).
 * The existing shape is maintained where possible: a first segment that was
 * vertical stays vertical. Wires starting on a left/right sheet pin are
 * forced horizontal, pushed one grid outside the sheet boundary.
 * Returns the (possibly adjusted) position.
 */
export function computeBreakPoint(
  segment: WireSeg,
  nextSegment: WireSeg,
  aPosition: Vec2,
  mode: WireLineMode,
  posture: boolean,
  sheetPinSide?: 'left' | 'right',
  gridSize = 1270000 / 100, // 50 mil in IU when the caller doesn't say
): Vec2 {
  const pos: { x: number; y: number } = { ...aPosition };
  const delta = { x: pos.x - segment.a.x, y: pos.y - segment.a.y };
  const xDir = delta.x > 0 ? 1 : -1;
  const yDir = delta.y > 0 ? 1 : -1;

  let preferHorizontal: boolean;
  let preferVertical: boolean;

  if (mode === '45' && posture) {
    preferHorizontal = nextSegment.b.x - nextSegment.a.x !== 0;
    preferVertical = nextSegment.b.y - nextSegment.a.y !== 0;
  } else {
    preferHorizontal = segment.b.x - segment.a.x !== 0;
    preferVertical = segment.b.y - segment.a.y !== 0;
  }

  // Times we need to force horizontal sheet pin connections.
  if (sheetPinSide) {
    if (pos.x === segment.a.x) {
      // push outside sheet boundary
      pos.x += gridSize * (sheetPinSide === 'left' ? -1 : 1);
      delta.x = pos.x - segment.a.x;
    }
    preferHorizontal = true;
    preferVertical = false;
  }

  const midPoint: { x: number; y: number } = { x: 0, y: 0 };

  const breakVertical = () => {
    if (mode === '45') {
      if (!posture) {
        midPoint.x = segment.a.x;
        midPoint.y = pos.y - yDir * Math.abs(delta.x);
      } else {
        midPoint.x = pos.x;
        midPoint.y = segment.a.y + yDir * Math.abs(delta.x);
      }
    } else {
      midPoint.x = segment.a.x;
      midPoint.y = pos.y;
    }
  };

  const breakHorizontal = () => {
    if (mode === '45') {
      if (!posture) {
        midPoint.x = pos.x - xDir * Math.abs(delta.y);
        midPoint.y = segment.a.y;
      } else {
        midPoint.x = segment.a.x + xDir * Math.abs(delta.y);
        midPoint.y = pos.y;
      }
    } else {
      midPoint.x = pos.x;
      midPoint.y = segment.a.y;
    }
  };

  // Maintain the current line shape if we can, e.g. if we were originally
  // moving vertically keep the first segment vertical.
  if (preferVertical) breakVertical();
  else if (preferHorizontal) breakHorizontal();

  // Reject 45° breaks that overshoot or reverse against the cursor delta.
  const deltaMidpoint = { x: midPoint.x - segment.a.x, y: midPoint.y - segment.a.y };
  const signbit = (v: number) => v < 0 || Object.is(v, -0);

  if (
    mode === '45' &&
    !posture &&
    (signbit(deltaMidpoint.x) !== signbit(delta.x) || signbit(deltaMidpoint.y) !== signbit(delta.y))
  ) {
    preferVertical = false;
    preferHorizontal = false;
  } else if (
    mode === '45' &&
    posture &&
    (Math.abs(deltaMidpoint.x) > Math.abs(delta.x) || Math.abs(deltaMidpoint.y) > Math.abs(delta.y))
  ) {
    preferVertical = false;
    preferHorizontal = false;
  }

  if (!preferHorizontal && !preferVertical) {
    if (Math.abs(delta.x) < Math.abs(delta.y)) breakVertical();
    else breakHorizontal();
  }

  segment.b = { ...midPoint };
  nextSegment.a = { ...midPoint };
  nextSegment.b = { ...pos };
  return pos;
}

/**
 * The posture-switch action (SCH_ACTIONS::switchSegmentPosture, '/'):
 * in 90° mode swap the two live segments' directions in place; in 45° mode
 * the caller flips the posture flag and recomputes the break point.
 */
export function switchPosture90(segment: WireSeg, nextSegment: WireSeg): void {
  const delta1 = { x: segment.b.x - segment.a.x, y: segment.b.y - segment.a.y };
  const delta2 = { x: nextSegment.b.x - nextSegment.a.x, y: nextSegment.b.y - nextSegment.a.y };
  nextSegment.a = { x: nextSegment.b.x - delta1.x, y: nextSegment.b.y - delta1.y };
  segment.b = { x: segment.a.x + delta2.x, y: segment.a.y + delta2.y };
}

/** Is `p` on segment a–b (endpoints included)? */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot >= 0 && dot <= len2;
}

/** All pin positions of every placed symbol. */
function allPinPositions(sch: Schematic, libById: Map<string, LibSymbol>): Vec2[] {
  const out: Vec2[] = [];
  for (const sym of sch.symbols) {
    const lib = libById.get(sym.libId);
    if (!lib) continue;
    const t = symbolTransform(sym.angle, sym.mirror);
    for (const u of lib.units) {
      if (
        (u.unit !== 0 && u.unit !== sym.unit) ||
        (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
      )
        continue;
      for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
    }
  }
  return out;
}

/**
 * SCH_SCREEN::IsTerminalPoint — should a click here end the wire run?
 * For wires: a bus entry end, junction, symbol pin, another wire (anywhere
 * along it), a connected label, or a sheet pin. For buses: another bus,
 * a sheet pin, or a connected label.
 */
export function isTerminalPoint(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  pos: Vec2,
  kind: 'wire' | 'bus',
): boolean {
  const lineAt = (k: SchLine['kind']) =>
    sch.lines.some((l) => l.kind === k && onSegment(pos, l.start, l.end));

  if (kind === 'bus') {
    if (lineAt('bus')) return true;
  } else {
    if (
      sch.busEntries.some(
        (e) => eq(pos, e.at) || eq(pos, { x: e.at.x + e.size.x, y: e.at.y + e.size.y }),
      )
    )
      return true;
    if (sch.junctions.some((j) => eq(j.at, pos))) return true;
    if (allPinPositions(sch, libById).some((p) => eq(p, pos))) return true;
    if (lineAt('wire')) return true;
  }

  if (sch.labels.some((l) => eq(l.at, pos))) return true;

  for (const sheet of sch.sheets) {
    if (sheet.pins.some((p) => eq(p.at, pos))) return true;
  }

  return false;
}

/** The left/right sheet pin at `pos`, if any (forces horizontal wire starts). */
export function sheetPinSideAt(sch: Schematic, pos: Vec2): 'left' | 'right' | undefined {
  for (const sheet of sch.sheets) {
    for (const pin of sheet.pins) {
      if (!eq(pin.at, pos)) continue;
      // Side encoding: 0 = right, 90 = top, 180 = left, 270 = bottom.
      if (pin.angle === 180) return 'left';
      if (pin.angle === 0) return 'right';
    }
  }
  return undefined;
}

/**
 * SCH_LINE_WIRE_BUS_TOOL::simplifyWireList — drop zero-length segments and
 * merge consecutive collinear segments, which also removes backtracks
 * (a segment drawn back over the previous one).
 */
export function simplifyWireList(wires: readonly WireSeg[]): WireSeg[] {
  const out: WireSeg[] = [];
  for (const seg of wires) {
    if (segIsNull(seg)) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const d1 = { x: prev.b.x - prev.a.x, y: prev.b.y - prev.a.y };
      const d2 = { x: seg.b.x - seg.a.x, y: seg.b.y - seg.a.y };
      if (d1.x * d2.y - d1.y * d2.x === 0 && eq(prev.b, seg.a)) {
        // Collinear continuation or backtrack: merge into one segment.
        prev.b = { ...seg.b };
        if (segIsNull(prev)) out.pop();
        continue;
      }
    }
    out.push({ a: { ...seg.a }, b: { ...seg.b } });
  }
  return out;
}

/**
 * SCH_LINE_WIRE_BUS_TOOL::finishSegments — commit the simplified chain as
 * wire/bus lines plus the junctions the new connections call for: at each
 * new wire end, and at existing connection points the new wires pass over.
 */
export function finishWires(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  wires: readonly WireSeg[],
  kind: 'wire' | 'bus',
): EditCommand | null {
  const simplified = simplifyWireList(wires);
  if (simplified.length === 0) return null;

  const lines = simplified.map((s) => (kind === 'bus' ? makeBus(s.a, s.b) : makeWire(s.a, s.b)));

  const withLines = addItems({ lines }).apply(sch);

  // Candidate junction spots: the new segments' own ends, plus any existing
  // connection point (pin/wire end/junction/label) that lies on a new segment.
  const candidates: Vec2[] = [];
  for (const s of simplified) {
    candidates.push(s.a, s.b);
  }

  const connections: Vec2[] = [
    ...allPinPositions(sch, libById),
    ...sch.lines.flatMap((l) => [l.start, l.end]),
    ...sch.labels.map((l) => l.at),
  ];

  for (const s of simplified) {
    for (const pt of connections) {
      if (onSegment(pt, s.a, s.b)) candidates.push(pt);
    }
  }

  const junctions: Vec2[] = [];
  for (const p of candidates) {
    if (junctions.some((q) => eq(p, q))) continue;
    if (needsJunction(withLines, p, libById)) junctions.push(p);
  }

  return addItems({ lines, junctions: junctions.map((p) => makeJunction(p)) });
}
