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
      for (const unit of lib.units) {
        if (libUnitMatches(unit, sym.unit, sym.bodyStyle)) drawLibUnit(ctx, unit, sym.at, t, theme);
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
    drawText(ctx, l.text, l.at, l.effects?.fontSize?.[0] ?? 1.27 * MM, theme.label, l.effects?.justify);
  }

  if (selection && selection.size > 0) drawSelection(ctx, sch, libById, viewport, selection);
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

function drawLibUnit(
  ctx: CanvasRenderingContext2D,
  unit: LibSymbolUnit,
  origin: Vec2,
  t: Transform,
  theme: Theme,
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
        drawArc(ctx, localToWorld(origin, t, g.start), localToWorld(origin, t, g.mid), localToWorld(origin, t, g.end));
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
  for (const pin of unit.pins) {
    if (pin.hidden) continue;
    const a = localToWorld(origin, t, pin.at);
    const b = localToWorld(origin, t, pinBodyEnd(pin.at, pin.angle, pin.length));
    ctx.strokeStyle = theme.pin;
    ctx.lineWidth = DEFAULT_LINE_WIDTH;
    strokeLine(ctx, a, b);
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

/** Draw a circular arc through three points (KiCad stores arcs as start/mid/end). */
function drawArc(ctx: CanvasRenderingContext2D, start: Vec2, mid: Vec2, end: Vec2): void {
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
