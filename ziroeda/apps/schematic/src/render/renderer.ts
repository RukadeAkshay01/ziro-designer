/**
 * Canvas2D renderer for a ZiroEDA schematic model.
 *
 * Framework-agnostic: it takes a 2D context, the typed Schematic, a viewport, and
 * a theme, and draws in world (internal-unit) space via a single canvas transform.
 * Grounded in KiCad's geometry: symbol graphics and pins are mapped through the
 * placement transform (rotation + mirror) exactly as KiCad does, and pin body ends
 * follow KiCad's per-orientation direction.
 */

import {
  symbolTransform,
  localToWorld,
  iuToMM,
  refId,
  symbolBodyBBox,
  type BBox,
  type Transform,
  type Schematic,
  type SchLabel,
  type LibSymbol,
  type LibSymbolUnit,
  type Vec2,
} from '@ziroeda/core';
import type { Theme } from '../theme.js';

const SELECT_COLOR = '#1d7fdd';

/** World(IU) -> screen(px): screenX = worldX * scale + offsetX. */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MM = 10000; // IU per mm
const DEFAULT_LINE_WIDTH = 0.1524 * MM; // ~6 mil, KiCad default
const GRID = 1.27 * MM; // 50 mil

function libUnitMatches(u: LibSymbolUnit, unit: number, bodyStyle: number): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/** Local body-end of a pin given its connection point, orientation and length (KiCad mapping). */
function pinBodyEnd(at: Vec2, angle: number, length: number): Vec2 {
  switch (((angle % 360) + 360) % 360) {
    case 0: return { x: at.x + length, y: at.y };
    case 90: return { x: at.x, y: at.y - length };
    case 180: return { x: at.x - length, y: at.y };
    case 270: return { x: at.x, y: at.y + length };
    default: return at;
  }
}

export function renderSchematic(
  ctx: CanvasRenderingContext2D,
  sch: Schematic,
  viewport: Viewport,
  theme: Theme,
  canvasWidth: number,
  canvasHeight: number,
  selection?: ReadonlySet<string>,
): void {
  const libById = new Map<string, LibSymbol>();
  for (const lib of sch.libSymbols) libById.set(lib.libId, lib);

  // Background.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // World transform.
  const { scale, offsetX, offsetY } = viewport;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawGrid(ctx, viewport, theme, canvasWidth, canvasHeight);

  // Wires and buses.
  for (const line of sch.lines) {
    ctx.strokeStyle = line.kind === 'bus' ? theme.bus : line.kind === 'wire' ? theme.wire : theme.symbolOutline;
    ctx.lineWidth = line.stroke && line.stroke.width > 0 ? line.stroke.width : DEFAULT_LINE_WIDTH;
    strokeLine(ctx, line.start, line.end);
  }

  // Junctions.
  ctx.fillStyle = theme.junction;
  for (const j of sch.junctions) {
    const d = j.diameter > 0 ? j.diameter : 0.9 * MM;
    ctx.beginPath();
    ctx.arc(j.at.x, j.at.y, d / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Placed symbols.
  for (const sym of sch.symbols) {
    const lib = libById.get(sym.libId);
    if (lib) {
      const t = symbolTransform(sym.angle, sym.mirror);
      const pins = { numbersHidden: lib.pinNumbersHidden, namesHidden: lib.pinNamesHidden, nameOffset: lib.pinNameOffset };
      for (const unit of lib.units) {
        if (libUnitMatches(unit, sym.unit, sym.bodyStyle)) drawLibUnit(ctx, unit, sym.at, t, theme, pins);
      }
    }
    // Instance fields are stored in absolute schematic coordinates.
    for (const f of sym.fields) {
      if (!f.at || f.effects?.hidden || f.value === '') continue;
      const color = f.key === 'Reference' ? theme.reference : f.key === 'Value' ? theme.value : theme.label;
      drawText(ctx, f.value, f.at, f.effects?.fontSize?.[0] ?? 1.27 * MM, color, f.effects?.justify);
    }
  }

  // Labels and free text.
  for (const l of sch.labels) {
    if (l.effects?.hidden) continue;
    drawLabel(ctx, l, theme);
  }

  if (selection && selection.size > 0) drawSelection(ctx, sch, libById, viewport, selection);
}

// ----- labels (SCH_LABEL / GLOBALLABEL / HIERLABEL / TEXT) -------------------

// SPIN_STYLE: LEFT=0, UP=1, RIGHT=2, BOTTOM=3 (KiCad spin_style.h).
const SPIN = { LEFT: 0, UP: 1, RIGHT: 2, BOTTOM: 3 } as const;

/** KiCad SCH_LABEL_BASE::GetSpinStyle(): from text angle + horizontal justify. */
function labelSpin(angle: number, justify?: readonly string[]): number {
  const vertical = (((angle % 360) + 360) % 360) % 180 === 90;
  const right = justify?.includes('right') ?? false;
  if (vertical) return right ? SPIN.BOTTOM : SPIN.UP;
  return right ? SPIN.LEFT : SPIN.RIGHT;
}

// Hierarchical-label flag polygons, transcribed from KiCad's TemplateShape table.
// Indexed [shape][spin]; each entry is (x,y) multipliers of halfSize (textHeight/2).
// Shapes: 0 input, 1 output, 2 bidirectional, 3 tri_state, 4 passive(unspecified).
// Spins:  0 LEFT(HN), 1 UP, 2 RIGHT(HI), 3 BOTTOM.
const HIER_TEMPLATES: number[][][] = [
  [ // input
    [0, 0, -1, -1, -2, -1, -2, 1, -1, 1, 0, 0],
    [0, 0, 1, -1, 1, -2, -1, -2, -1, -1, 0, 0],
    [0, 0, 1, 1, 2, 1, 2, -1, 1, -1, 0, 0],
    [0, 0, 1, 1, 1, 2, -1, 2, -1, 1, 0, 0],
  ],
  [ // output
    [-2, 0, -1, 1, 0, 1, 0, -1, -1, -1, -2, 0],
    [0, -2, 1, -1, 1, 0, -1, 0, -1, -1, 0, -2],
    [2, 0, 1, -1, 0, -1, 0, 1, 1, 1, 2, 0],
    [0, 2, 1, 1, 1, 0, -1, 0, -1, 1, 0, 2],
  ],
  [ // bidirectional
    [0, 0, -1, -1, -2, 0, -1, 1, 0, 0],
    [0, 0, -1, -1, 0, -2, 1, -1, 0, 0],
    [0, 0, 1, -1, 2, 0, 1, 1, 0, 0],
    [0, 0, -1, 1, 0, 2, 1, 1, 0, 0],
  ],
  [ // tri_state (same outline as bidirectional)
    [0, 0, -1, -1, -2, 0, -1, 1, 0, 0],
    [0, 0, -1, -1, 0, -2, 1, -1, 0, 0],
    [0, 0, 1, -1, 2, 0, 1, 1, 0, 0],
    [0, 0, -1, 1, 0, 2, 1, 1, 0, 0],
  ],
  [ // passive / unspecified
    [0, -1, -2, -1, -2, 1, 0, 1, 0, -1],
    [1, 0, 1, -2, -1, -2, -1, 0, 1, 0],
    [0, -1, 2, -1, 2, 1, 0, 1, 0, -1],
    [1, 0, 1, 2, -1, 2, -1, 0, 1, 0],
  ],
];

const SHAPE_INDEX: Record<string, number> = { input: 0, output: 1, bidirectional: 2, tri_state: 3, passive: 4 };
const LABEL_RATIO = 0.375; // KiCad DEFAULT_LABEL_SIZE_RATIO (box expansion)

/** Rotate a point by the spin style, as KiCad's global-label CreateGraphicShape does. */
function spinRotate(p: Vec2, spin: number): Vec2 {
  switch (spin) {
    case SPIN.UP: return { x: p.y, y: -p.x }; // -90°
    case SPIN.RIGHT: return { x: -p.x, y: -p.y }; // 180°
    case SPIN.BOTTOM: return { x: -p.y, y: p.x }; // +90°
    default: return p; // LEFT
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, l: SchLabel, theme: Theme): void {
  const h = l.effects?.fontSize?.[0] ?? 1.27 * MM;
  const spin = labelSpin(l.angle, l.effects?.justify);
  const color = l.kind === 'global_label' ? theme.globalLabel : l.kind === 'hierarchical_label' ? theme.hierLabel : theme.label;
  const dist = h * 0.26; // ~ text offset + pen, to lift text off the wire
  // Reading direction unit vector for the spin style (where the text flows).
  const flow = spin === SPIN.LEFT ? { x: -1, y: 0 } : spin === SPIN.RIGHT ? { x: 1, y: 0 }
    : spin === SPIN.UP ? { x: 0, y: -1 } : { x: 0, y: 1 };

  ctx.lineWidth = DEFAULT_LINE_WIDTH;
  ctx.strokeStyle = color;

  if (l.kind === 'hierarchical_label' || l.kind === 'global_label') {
    const halfSize = h / 2;
    if (l.kind === 'hierarchical_label') {
      const tpl = HIER_TEMPLATES[SHAPE_INDEX[l.shape ?? 'input'] ?? 0]![spin]!;
      const pts: Vec2[] = [];
      for (let i = 0; i < tpl.length; i += 2) pts.push({ x: l.at.x + halfSize * tpl[i]!, y: l.at.y + halfSize * tpl[i + 1]! });
      polygon(ctx, pts, false, true);
      // Text sits just beyond the flag (which spans ~2*halfSize from the anchor).
      const off = 2 * halfSize + dist;
      drawText(ctx, l.text, { x: l.at.x + flow.x * off, y: l.at.y + flow.y * off }, h, color, justifyFor(spin));
    } else {
      // Global label: 6-point box (margined) with a notch/point per shape, then spin-rotated.
      const margin = LABEL_RATIO * h;
      const hs = halfSize + margin;
      const symbLen = Math.max(1, l.text.length) * h * 0.62 + 2 * margin;
      const x = symbLen + 3, y = hs + 3;
      const box: { x: number; y: number }[] = [{ x: 0, y: 0 }, { x: 0, y: -y }, { x: -x, y: -y }, { x: -x, y: 0 }, { x: -x, y }, { x: 0, y }];
      let xoff = 0;
      const s = l.shape ?? 'bidirectional';
      if (s === 'input') { xoff = -hs; box[0]!.x += hs; }
      else if (s === 'output') { box[3]!.x -= hs; }
      else if (s === 'bidirectional' || s === 'tri_state') { xoff = -hs; box[0]!.x += hs; box[3]!.x -= hs; }
      const pts = box.map((p) => { const r = spinRotate({ x: p.x + xoff, y: p.y }, spin); return { x: l.at.x + r.x, y: l.at.y + r.y }; });
      polygon(ctx, pts, false, true);
      // Centre the text in the box (box centre is at -symbLen/2 along the reading axis).
      const c = spinRotate({ x: -x / 2 + xoff, y: 0 }, spin);
      drawText(ctx, l.text, { x: l.at.x + c.x, y: l.at.y + c.y }, h, color);
    }
    return;
  }

  // Local label / free text: text lifted off the wire, flowing in the reading direction.
  const perp = spin === SPIN.UP || spin === SPIN.BOTTOM ? { x: -dist, y: 0 } : { x: 0, y: -dist };
  drawText(ctx, l.text, { x: l.at.x + perp.x, y: l.at.y + perp.y }, h, color, justifyFor(spin));
}

/** Text justification for a spin style: anchored at the connection point, reading outward. */
function justifyFor(spin: number): string[] {
  switch (spin) {
    case SPIN.LEFT: return ['right'];
    case SPIN.UP: return ['left'];
    case SPIN.BOTTOM: return ['right'];
    default: return ['left']; // RIGHT
  }
}

/** Draw a highlight box around each selected item. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  viewport: Viewport,
  selection: ReadonlySet<string>,
): void {
  const pad = 0.6 * MM;
  const boxes: BBox[] = [];
  sch.symbols.forEach((s, i) => {
    if (selection.has(refId('symbol', s.uuid, i))) boxes.push(symbolBodyBBox(s, libById.get(s.libId)));
  });
  sch.lines.forEach((l, i) => {
    if (selection.has(refId('line', l.uuid, i)))
      boxes.push({ minX: Math.min(l.start.x, l.end.x), minY: Math.min(l.start.y, l.end.y), maxX: Math.max(l.start.x, l.end.x), maxY: Math.max(l.start.y, l.end.y) });
  });
  sch.junctions.forEach((j, i) => {
    if (selection.has(refId('junction', j.uuid, i))) {
      const r = (j.diameter > 0 ? j.diameter : 0.9 * MM) / 2;
      boxes.push({ minX: j.at.x - r, minY: j.at.y - r, maxX: j.at.x + r, maxY: j.at.y + r });
    }
  });
  sch.labels.forEach((l, i) => {
    if (selection.has(refId('label', l.uuid, i))) {
      const h = l.effects?.fontSize?.[0] ?? 1.27 * MM;
      const w = Math.max(1, l.text.length) * h * 0.7;
      boxes.push({ minX: l.at.x - h, minY: l.at.y - h, maxX: l.at.x + w, maxY: l.at.y + h });
    }
  });

  ctx.strokeStyle = SELECT_COLOR;
  ctx.fillStyle = 'rgba(29,127,221,0.10)';
  ctx.lineWidth = 1 / viewport.scale; // ~1px regardless of zoom
  for (const b of boxes) {
    const x = b.minX - pad, y = b.minY - pad, w = b.maxX - b.minX + 2 * pad, h = b.maxY - b.minY + 2 * pad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
}

interface PinDisplay {
  numbersHidden: boolean;
  namesHidden: boolean;
  nameOffset: number;
}

/** Local-space unit vector pointing from a pin's connection point toward the body. */
function pinDir(angle: number): Vec2 {
  switch (((angle % 360) + 360) % 360) {
    case 0: return { x: 1, y: 0 };
    case 90: return { x: 0, y: -1 };
    case 180: return { x: -1, y: 0 };
    default: return { x: 0, y: 1 };
  }
}

function drawLibUnit(
  ctx: CanvasRenderingContext2D,
  unit: LibSymbolUnit,
  origin: Vec2,
  t: Transform,
  theme: Theme,
  pins: PinDisplay,
): void {
  for (const g of unit.graphics) {
    const lw = g.kind !== 'text' && g.stroke && g.stroke.width > 0 ? g.stroke.width : DEFAULT_LINE_WIDTH;
    const filled = g.kind !== 'text' && g.fill && g.fill.type !== 'none';
    ctx.lineWidth = lw;
    ctx.strokeStyle = theme.symbolOutline;
    ctx.fillStyle = g.kind !== 'text' && g.fill?.type === 'background' ? theme.symbolFill : theme.symbolOutline;

    switch (g.kind) {
      case 'rectangle': {
        const corners = [
          { x: g.start.x, y: g.start.y },
          { x: g.end.x, y: g.start.y },
          { x: g.end.x, y: g.end.y },
          { x: g.start.x, y: g.end.y },
        ].map((c) => localToWorld(origin, t, c));
        polygon(ctx, corners, !!filled, true);
        break;
      }
      case 'polyline': {
        const pts = g.points.map((p) => localToWorld(origin, t, p));
        polygon(ctx, pts, !!filled, false);
        break;
      }
      case 'circle': {
        const c = localToWorld(origin, t, g.center);
        ctx.beginPath();
        ctx.arc(c.x, c.y, g.radius, 0, Math.PI * 2);
        if (filled) ctx.fill();
        ctx.stroke();
        break;
      }
      case 'arc': {
        drawArc(ctx, localToWorld(origin, t, g.start), localToWorld(origin, t, g.mid), localToWorld(origin, t, g.end), !!filled);
        break;
      }
      case 'text': {
        const p = localToWorld(origin, t, g.at);
        drawText(ctx, g.text, p, g.effects?.fontSize?.[0] ?? 1.27 * MM, theme.symbolOutline, g.effects?.justify);
        break;
      }
    }
  }

  // Pins.
  const NUM = 1.27 * MM, NAME = 1.27 * MM, MARGIN = 0.25 * MM;
  // External pin decoration radius = number text size / 2 (KiCad externalPinDecoSize).
  const DECO_R = NUM / 2;
  for (const pin of unit.pins) {
    if (pin.hidden) continue;
    const endLocal = pinBodyEnd(pin.at, pin.angle, pin.length);
    const a = localToWorld(origin, t, pin.at); // connection point (tip)
    const b = localToWorld(origin, t, endLocal); // body end (root)
    ctx.strokeStyle = theme.pin;
    ctx.lineWidth = DEFAULT_LINE_WIDTH;

    // Inverted pins draw a negation bubble at the body end (KiCad GRAPHIC_PINSHAPE).
    const inverted = pin.shape === 'inverted' || pin.shape === 'inverted_clock';
    if (inverted && pin.length > 0) {
      // Unit vector pointing from the body end outward to the tip.
      const ox = (a.x - b.x) / pin.length, oy = (a.y - b.y) / pin.length;
      ctx.beginPath();
      ctx.arc(b.x + ox * DECO_R, b.y + oy * DECO_R, DECO_R, 0, Math.PI * 2);
      ctx.stroke();
      strokeLine(ctx, { x: b.x + ox * DECO_R * 2, y: b.y + oy * DECO_R * 2 }, a);
    } else {
      strokeLine(ctx, a, b);
    }

    const dir = pinDir(pin.angle);
    const horiz = dir.y === 0;

    // Pin number: centred over the pin line, offset to one side.
    if (!pins.numbersHidden && pin.number && pin.number !== '~') {
      const mid = { x: (pin.at.x + endLocal.x) / 2, y: (pin.at.y + endLocal.y) / 2 };
      const off = NUM / 2 + MARGIN;
      const anchor = localToWorld(origin, t, horiz ? { x: mid.x, y: mid.y - off } : { x: mid.x - off, y: mid.y });
      drawText(ctx, pin.number, anchor, NUM, theme.pinNumber);
    }

    // Pin name: inside the body at the inner end (offset > 0), else just outside.
    if (!pins.namesHidden && pin.name && pin.name !== '~') {
      if (pins.nameOffset > 0) {
        const anchor = localToWorld(origin, t, { x: endLocal.x + dir.x * pins.nameOffset, y: endLocal.y + dir.y * pins.nameOffset });
        const justify = horiz ? [dir.x > 0 ? 'left' : 'right'] : ['left'];
        drawText(ctx, pin.name, anchor, NAME, theme.pinName, justify);
      } else {
        const anchor = localToWorld(origin, t, horiz ? { x: endLocal.x - dir.x * MARGIN, y: endLocal.y - NAME / 2 } : { x: endLocal.x, y: endLocal.y });
        drawText(ctx, pin.name, anchor, NAME, theme.pinName, horiz ? [dir.x > 0 ? 'right' : 'left'] : undefined);
      }
    }
  }
}

// ----- primitives -----------------------------------------------------------

function strokeLine(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function polygon(ctx: CanvasRenderingContext2D, pts: Vec2[], fill: boolean, close: boolean): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  if (close) ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

/**
 * Draw a circular arc through three points (KiCad stores arcs as start/mid/end).
 * When `fill` is set, the arc's circular segment is filled (the path is implicitly
 * closed by the chord for filling but only the arc itself is stroked) — matching
 * KiCad, where a filled arc combines with its sibling polyline to form e.g. a gate
 * body, and the shared chord edge is never stroked.
 */
function drawArc(ctx: CanvasRenderingContext2D, start: Vec2, mid: Vec2, end: Vec2, fill = false): void {
  const ax = start.x, ay = start.y, bx = mid.x, by = mid.y, cx = end.x, cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) {
    strokeLine(ctx, start, end); // collinear: degenerate to a segment
    return;
  }
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux);
  const a1 = Math.atan2(cy - uy, cx - ux);
  const aMid = Math.atan2(by - uy, bx - ux);
  // Choose sweep direction so the arc passes through the mid point.
  const ccw = !isBetween(a0, aMid, a1);
  ctx.beginPath();
  ctx.arc(ux, uy, r, a0, a1, ccw);
  if (fill) ctx.fill(); // fills the segment (arc + chord); does not affect the stroked path
  ctx.stroke();
}

function isBetween(a0: number, aMid: number, a1: number): boolean {
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const s = norm(a1 - a0);
  const m = norm(aMid - a0);
  return m <= s;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Vec2,
  heightIU: number,
  color: string,
  justify?: readonly string[],
): void {
  if (text === '' || text === '~') return;
  ctx.fillStyle = color;
  // NOTE: KiCad renders schematic text with the Newstroke stroke font. Using a
  // system font here is intentional first-pass debt; Newstroke is a tracked
  // follow-up for exact visual parity.
  ctx.font = `${heightIU}px sans-serif`;
  ctx.textAlign = justify?.includes('right') ? 'right' : justify?.includes('left') ? 'left' : 'center';
  ctx.textBaseline = justify?.includes('top') ? 'top' : justify?.includes('bottom') ? 'bottom' : 'middle';
  ctx.fillText(text, at.x, at.y);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  theme: Theme,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Visible world bounds (inverse of the viewport transform).
  const left = (-viewport.offsetX) / viewport.scale;
  const top = (-viewport.offsetY) / viewport.scale;
  const right = (canvasWidth - viewport.offsetX) / viewport.scale;
  const bottom = (canvasHeight - viewport.offsetY) / viewport.scale;

  // Skip when the grid would be denser than ~6px to avoid a wall of dots.
  if (GRID * viewport.scale < 6) return;

  const dot = Math.max(0.15 * MM, 0.5 / viewport.scale);
  ctx.fillStyle = theme.grid;
  const x0 = Math.ceil(left / GRID) * GRID;
  const y0 = Math.ceil(top / GRID) * GRID;
  for (let x = x0; x <= right; x += GRID) {
    for (let y = y0; y <= bottom; y += GRID) {
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
  }
}

/** Render a single library symbol centred and scaled into a preview canvas. */
export function renderSymbolPreview(
  ctx: CanvasRenderingContext2D,
  lib: LibSymbol,
  width: number,
  height: number,
  theme: Theme,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const units = lib.units.filter((u) => libUnitMatches(u, 1, 1));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const inc = (p: Vec2) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  for (const u of units) {
    for (const g of u.graphics) {
      if (g.kind === 'rectangle') { inc(g.start); inc(g.end); }
      else if (g.kind === 'polyline') g.points.forEach(inc);
      else if (g.kind === 'circle') { inc({ x: g.center.x - g.radius, y: g.center.y - g.radius }); inc({ x: g.center.x + g.radius, y: g.center.y + g.radius }); }
      else if (g.kind === 'arc') { inc(g.start); inc(g.mid); inc(g.end); }
      else inc(g.at);
    }
    // Hidden pins (e.g. power) sit far from the body; excluding them keeps the
    // visible symbol from being shrunk to a dot, matching KiCad's preview fit.
    for (const pin of u.pins) {
      if (pin.hidden) continue;
      inc(pin.at);
      inc(pinBodyEnd(pin.at, pin.angle, pin.length));
    }
  }
  if (!Number.isFinite(minX)) {
    ctx.fillStyle = '#888';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No preview', width / 2, height / 2);
    return;
  }

  const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
  const scale = Math.min(width / (bw * 1.35), height / (bh * 1.35));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  ctx.setTransform(scale, 0, 0, scale, width / 2 - cx * scale, height / 2 - cy * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pins = { numbersHidden: lib.pinNumbersHidden, namesHidden: lib.pinNamesHidden, nameOffset: lib.pinNameOffset };
  for (const u of units) drawLibUnit(ctx, u, { x: 0, y: 0 }, symbolTransform(0), theme, pins);
}

/** Compute a viewport that fits the schematic content into the given canvas size. */
export function fitToContent(sch: Schematic, canvasWidth: number, canvasHeight: number): Viewport {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (p: Vec2) => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  };
  for (const l of sch.lines) { include(l.start); include(l.end); }
  for (const j of sch.junctions) include(j.at);
  for (const s of sch.symbols) { include(s.at); for (const f of s.fields) if (f.at) include(f.at); }
  for (const l of sch.labels) include(l.at);

  if (!Number.isFinite(minX)) return { scale: 0.02, offsetX: canvasWidth / 2, offsetY: canvasHeight / 2 };

  const pad = 8 * MM;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const scale = Math.min(canvasWidth / w, canvasHeight / h);
  const offsetX = canvasWidth / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = canvasHeight / 2 - ((minY + maxY) / 2) * scale;
  return { scale, offsetX, offsetY };
}

export { iuToMM };
