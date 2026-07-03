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
  danglingPinPositions,
  fieldShownText,
  fieldBoundingBox,
  fieldDrawRotation,
  ITALIC_TILT,
  type BBox,
  type Transform,
  type Schematic,
  type SchLabel,
  type LibSymbol,
  type LibSymbolUnit,
  type Vec2,
} from '@ziroeda/core';
import type { Theme } from '../theme.js';
import { layoutText, measureText } from './strokeFont.js';

// Per-render state (single-threaded): the visible world rect for culling and the
// current zoom, so text below a few screen pixels is drawn cheaply.
let g_scale = 1;
let g_minX = -Infinity, g_minY = -Infinity, g_maxX = Infinity, g_maxY = Infinity;
function inView(minX: number, minY: number, maxX: number, maxY: number): boolean {
  return maxX >= g_minX && minX <= g_maxX && maxY >= g_minY && minY <= g_maxY;
}

// Cache the dangling-pin set by document identity so it isn't recomputed on every
// pan/zoom (the schematic object is stable between edits).
let g_dangleSch: Schematic | null = null;
let g_dangle: readonly Vec2[] = [];
function danglingFor(sch: Schematic, libById: Map<string, LibSymbol>): readonly Vec2[] {
  if (sch !== g_dangleSch) { g_dangleSch = sch; g_dangle = danglingPinPositions(sch, libById); }
  return g_dangle;
}

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

/** KiCad `(color r g b a)` (rgb 0-255, a 0-1) -> a CSS colour. */
function cssColor(c: readonly [number, number, number, number]): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
}

/**
 * Apply a KiCad line style to the context (STROKE_PARAMS::Stroke): dash = 12×width,
 * gap = 3×width, dot ≈ 1×width (ISO 128-2 ratios). Resets to solid otherwise.
 */
function setDash(ctx: CanvasRenderingContext2D, type: string | undefined, width: number): void {
  const w = width > 0 ? width : DEFAULT_LINE_WIDTH;
  switch (type) {
    case 'dash': ctx.setLineDash([12 * w, 3 * w]); break;
    case 'dot': ctx.setLineDash([w, 3 * w]); break;
    case 'dash_dot': ctx.setLineDash([12 * w, 3 * w, w, 3 * w]); break;
    case 'dash_dot_dot': ctx.setLineDash([12 * w, 3 * w, w, 3 * w, w, 3 * w]); break;
    default: ctx.setLineDash([]); break;
  }
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
  highlight?: ReadonlySet<string>,
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

  // Visible world rect (+ margin) and zoom, for culling and small-text handling.
  g_scale = scale;
  const cullMargin = 4 * MM;
  g_minX = -offsetX / scale - cullMargin;
  g_minY = -offsetY / scale - cullMargin;
  g_maxX = (canvasWidth - offsetX) / scale + cullMargin;
  g_maxY = (canvasHeight - offsetY) / scale + cullMargin;

  drawGrid(ctx, viewport, theme, canvasWidth, canvasHeight);

  const hl = (id: string): boolean => highlight !== undefined && highlight.has(id);

  // KiCad draws selection as a blue LAYER_SELECTION_SHADOWS glow *under* the item,
  // never a bounding box: a wider stroke of the item's own geometry in the shadow
  // colour, drawn before the normal render so it reads as an underglow. Width is
  // getShadowWidth(false) = selection_thickness (3 mils) as a zoom-scaled screen
  // term plus a fixed world minimum. Net highlight (magenta) is a *separate* thing.
  const SELECTION_THICKNESS_MILS = 3;
  const selShadowWidth = Math.abs(SELECTION_THICKNESS_MILS / scale) + SELECTION_THICKNESS_MILS * (0.0254 * MM);
  if (selection && selection.size > 0)
    drawSelectionShadows(ctx, sch, libById, selection, theme, theme.selectionShadow, selShadowWidth);

  // Net highlighting, ported from SCH_PAINTER: brightened items are drawn twice —
  // once on LAYER_SELECTION_SHADOWS (a wider stroke of the brightened colour at 15%
  // alpha, i.e. getRenderColor()'s `color.WithAlpha(0.15)` branch for IsBrightened()
  // with aDrawingShadows), then again on their normal layer at full-opacity
  // LAYER_BRIGHTENED with their ordinary pen width (getRenderColor/getLineWidth with
  // aDrawingShadows == false). getShadowWidth() adds highlight_thickness (2 mils,
  // eeschema_settings.cpp) both as a screen-space term (scaled by current zoom) and as
  // a fixed minimum in world units, so the halo doesn't vanish when zoomed out.
  const HIGHLIGHT_THICKNESS_MILS = 2;
  const MIL = 0.0254 * MM; // 1 mil in IU
  const shadowWidth = Math.abs(HIGHLIGHT_THICKNESS_MILS / scale) + HIGHLIGHT_THICKNESS_MILS * MIL;
  const HALO_COLOR = 'rgba(255, 0, 255, 0.15)'; // LAYER_BRIGHTENED at 15% alpha

  if (highlight && highlight.size > 0) {
    ctx.strokeStyle = HALO_COLOR;
    sch.lines.forEach((line, i) => {
      if (!hl(refId('line', line.uuid, i))) return;
      const base = line.stroke && line.stroke.width > 0 ? line.stroke.width : DEFAULT_LINE_WIDTH;
      ctx.lineWidth = base + shadowWidth;
      strokeLine(ctx, line.start, line.end);
    });
    // Junction shadows are drawn as a stroked ring at the junction's own radius
    // (SCH_PAINTER::draw(SCH_JUNCTION*): SetIsStroke(drawingShadows), unchanged
    // circle radius), not a bigger filled disc.
    ctx.strokeStyle = HALO_COLOR;
    sch.junctions.forEach((j, i) => {
      if (!hl(refId('junction', j.uuid, i))) return;
      const d = j.diameter > 0 ? j.diameter : 0.9 * MM;
      ctx.lineWidth = shadowWidth;
      ctx.beginPath();
      ctx.arc(j.at.x, j.at.y, d / 2, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  // Wires, buses and graphic polylines. Wires/buses use the theme net colours; a
  // graphic polyline uses its own stroke colour (KiCad graphics carry their colour)
  // and dash style, and draws all of its vertices — not just the first segment.
  sch.lines.forEach((line, i) => {
    const pts = line.points ?? [line.start, line.end];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (!inView(minX, minY, maxX, maxY)) return;

    const on = hl(refId('line', line.uuid, i));
    const width = line.stroke && line.stroke.width > 0 ? line.stroke.width : DEFAULT_LINE_WIDTH;
    ctx.strokeStyle = on ? theme.netHighlight
      : line.kind === 'bus' ? theme.bus
      : line.kind === 'wire' ? theme.wire
      : line.stroke?.color ? cssColor(line.stroke.color) // graphic polyline: its own colour
      : theme.noteLine;
    ctx.lineWidth = width;
    setDash(ctx, line.stroke?.type, width);
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]!.x, pts[k]!.y);
    ctx.stroke();
    if (line.stroke?.type && line.stroke.type !== 'default' && line.stroke.type !== 'solid') ctx.setLineDash([]);
  });

  // Junctions (recoloured when on the highlighted net).
  sch.junctions.forEach((j, i) => {
    if (!inView(j.at.x, j.at.y, j.at.x, j.at.y)) return;
    ctx.fillStyle = hl(refId('junction', j.uuid, i)) ? theme.netHighlight : theme.junction;
    const d = j.diameter > 0 ? j.diameter : 0.9 * MM;
    ctx.beginPath();
    ctx.arc(j.at.x, j.at.y, d / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // No-connect flags: KiCad's X, spanning DEFAULT_NOCONNECT_SIZE (48 mil) about
  // the point, in the LAYER_NOCONNECT colour (SCH_PAINTER::draw(SCH_NO_CONNECT)).
  if (sch.noConnects.length > 0) {
    ctx.strokeStyle = theme.noConnect;
    ctx.lineWidth = DEFAULT_LINE_WIDTH;
    const delta = Math.max(NOCONNECT_SIZE, DEFAULT_LINE_WIDTH * 3) / 2;
    for (const nc of sch.noConnects) {
      if (!inView(nc.at.x - delta, nc.at.y - delta, nc.at.x + delta, nc.at.y + delta)) continue;
      ctx.beginPath();
      ctx.moveTo(nc.at.x - delta, nc.at.y - delta);
      ctx.lineTo(nc.at.x + delta, nc.at.y + delta);
      ctx.moveTo(nc.at.x - delta, nc.at.y + delta);
      ctx.lineTo(nc.at.x + delta, nc.at.y - delta);
      ctx.stroke();
    }
  }

  // Placed symbols (culled to the visible rect, including their fields).
  sch.symbols.forEach((sym, si) => {
    const lib = libById.get(sym.libId);
    const bb: BBox = symbolBodyBBox(sym, lib);
    const bodyVisible = inView(bb.minX, bb.minY, bb.maxX, bb.maxY);
    if (lib && bodyVisible) {
      const t = symbolTransform(sym.angle, sym.mirror);
      const pins = { numbersHidden: lib.pinNumbersHidden, namesHidden: lib.pinNamesHidden, nameOffset: lib.pinNameOffset };
      const symId = refId('symbol', sym.uuid, si);
      let pinIndex = 0;
      for (const unit of lib.units) {
        if (libUnitMatches(unit, sym.unit, sym.bodyStyle))
          pinIndex = drawLibUnit(ctx, unit, sym.at, t, theme, pins, symId, pinIndex, highlight, shadowWidth);
      }
    }
    // Fields are painted exactly as KiCad's SCH_PAINTER::draw(SCH_FIELD): compute
    // the field's bounding box (text box rotated by the field angle, mapped through
    // the symbol transform — SCH_FIELD::GetBoundingBox), then stroke the text
    // CENTER/CENTER at the box centre with the draw rotation (GetDrawRotation).
    // A multi-unit Reference gains its unit letter (GetRef(..., true)).
    const unitCount = lib ? lib.units.reduce((m, u) => Math.max(m, u.unit), 0) : 1;
    for (const f of sym.fields) {
      if (!f.at || f.effects?.hidden) continue;
      const shown = fieldShownText(f, sym, unitCount);
      if (shown === '') continue;
      const box = fieldBoundingBox(f, sym, shown, measureText);
      if (!inView(box.x, box.y, box.x + box.w, box.y + box.h)) continue;
      const h = f.effects?.fontSize?.[0] ?? 1.27 * MM;
      const color = f.effects?.color ? cssColor(f.effects.color)
        : f.key === 'Reference' ? theme.reference : f.key === 'Value' ? theme.value : theme.label;
      const centre = { x: box.x + Math.trunc(box.w / 2), y: box.y + Math.trunc(box.h / 2) };
      drawText(ctx, shown, centre, h, color, undefined, fieldDrawRotation(f, sym), f.effects?.bold, f.effects?.italic);
    }
  });

  // Labels and free text (culled).
  for (const l of sch.labels) {
    if (l.effects?.hidden) continue;
    const h = l.effects?.fontSize?.[0] ?? 1.27 * MM;
    const span = h * (Math.max(1, l.text.length) + 4);
    if (!inView(l.at.x - span, l.at.y - span, l.at.x + span, l.at.y + span)) continue;
    drawLabel(ctx, l, theme);
  }

  // Dangling-pin targets: KiCad draws an open circle (TARGET_PIN_RADIUS = 15 mil,
  // thickness = penWidth/3, in the pin colour Brightened(0.3)) on every pin with no
  // connection (drawPinDanglingIndicator). Cached by document identity so it isn't
  // recomputed on every pan/zoom, and culled to the visible rect.
  const dangling = danglingFor(sch, libById);
  if (dangling.length > 0) {
    ctx.strokeStyle = brighten(theme.pin, 0.3);
    ctx.lineWidth = DEFAULT_LINE_WIDTH / 3;
    for (const p of dangling) {
      if (!inView(p.x, p.y, p.x, p.y)) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, TARGET_PIN_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// KiCad's TARGET_PIN_RADIUS is 15 mil, but that reads visually large here; use a
// smaller target that matches the desktop app's on-screen appearance.
const TARGET_PIN_RADIUS = 0.3 * MM; // ~11.8 mil radius

// KiCad DEFAULT_NOCONNECT_SIZE: 48 mil.
const NOCONNECT_SIZE = 1.2192 * MM;

// KiCad's ERC marker: MarkerShapeCorners (marker_base.cpp) scaled by 0.15 mm
// (sch_marker.cpp SCALING_FACTOR) — the little bent arrow anchored at the fault.
const MARKER_SHAPE: readonly (readonly [number, number])[] = [
  [0, 0], [8, 1], [4, 3], [13, 8], [9, 9], [8, 13], [3, 4], [1, 8], [0, 0],
];
const MARKER_SCALE = 0.15 * MM;

/** An ERC marker to draw: position + severity (colour). */
export interface MarkerDraw {
  at: Vec2;
  severity: 'error' | 'warning';
}

/** Draw ERC markers over the schematic (sets its own canvas transform). */
export function drawErcMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly MarkerDraw[],
  viewport: Viewport,
  theme: Theme,
): void {
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY);
  for (const m of markers) {
    ctx.fillStyle = m.severity === 'error' ? theme.ercError : theme.ercWarning;
    ctx.beginPath();
    MARKER_SHAPE.forEach(([x, y], i) => {
      const px = m.at.x + x * MARKER_SCALE;
      const py = m.at.y + y * MARKER_SCALE;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
}

/** KiCad COLOR4D::Brightened(f): move the colour a fraction f toward white. */
function brighten(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  const r = mix(parseInt(m[1]!, 16)), g = mix(parseInt(m[2]!, 16)), b = mix(parseInt(m[3]!, 16));
  return `rgb(${r}, ${g}, ${b})`;
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

/** When `shadow` is set, draw only the blue selection underglow (wider strokes, no text). */
function drawLabel(ctx: CanvasRenderingContext2D, l: SchLabel, theme: Theme, shadow?: { color: string; width: number }): void {
  const h = l.effects?.fontSize?.[0] ?? 1.27 * MM;
  const spin = labelSpin(l.angle, l.effects?.justify);
  // Free text uses its own font colour when set, else the notes-layer blue
  // (LAYER_NOTES, rgb(0,0,194) in KiCad's default theme) — not the label black.
  const color = shadow ? shadow.color
    : l.kind === 'global_label' ? theme.globalLabel
    : l.kind === 'hierarchical_label' ? theme.hierLabel
    : l.kind === 'text' ? (l.effects?.color ? cssColor(l.effects.color) : theme.noText)
    : theme.label;
  const dist = h * 0.26; // ~ text offset + pen, to lift text off the wire
  // Reading direction unit vector for the spin style (where the text flows).
  const flow = spin === SPIN.LEFT ? { x: -1, y: 0 } : spin === SPIN.RIGHT ? { x: 1, y: 0 }
    : spin === SPIN.UP ? { x: 0, y: -1 } : { x: 0, y: 1 };

  ctx.lineWidth = shadow ? DEFAULT_LINE_WIDTH + shadow.width : DEFAULT_LINE_WIDTH;
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
      if (!shadow) drawText(ctx, l.text, { x: l.at.x + flow.x * off, y: l.at.y + flow.y * off }, h, color, justifyFor(spin));
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
      if (!shadow) drawText(ctx, l.text, { x: l.at.x + c.x, y: l.at.y + c.y }, h, color);
    }
    return;
  }

  // Local label / free text: text lifted off the wire, flowing in the reading direction.
  const perp = spin === SPIN.UP || spin === SPIN.BOTTOM ? { x: -dist, y: 0 } : { x: 0, y: -dist };
  const anchor = { x: l.at.x + perp.x, y: l.at.y + perp.y };
  if (shadow) {
    // No flag to glow: underline the text run in the reading direction as the cue.
    const len = Math.max(1, l.text.length) * h * 0.6;
    const from = spin === SPIN.LEFT || spin === SPIN.BOTTOM ? { x: anchor.x - flow.x * len, y: anchor.y - flow.y * len } : anchor;
    const to = { x: from.x + flow.x * len, y: from.y + flow.y * len };
    strokeLine(ctx, from, to);
    return;
  }
  drawText(ctx, l.text, anchor, h, color, justifyFor(spin), 0, l.effects?.bold ?? false);
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

/**
 * KiCad-style selection: a blue LAYER_SELECTION_SHADOWS glow drawn *under* each
 * selected item by re-stroking the item's own geometry wider in the shadow colour
 * (SCH_PAINTER draws selected items on the shadow layer at getShadowWidth() extra
 * width). Wires, junctions, symbol bodies + pins, and label flags/anchors each get
 * the halo; there is no bounding box, matching the desktop app.
 */
function drawSelectionShadows(
  ctx: CanvasRenderingContext2D,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  selection: ReadonlySet<string>,
  theme: Theme,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  // Wires / buses: wider stroke of the segment.
  sch.lines.forEach((l, i) => {
    if (!selection.has(refId('line', l.uuid, i))) return;
    const base = l.stroke && l.stroke.width > 0 ? l.stroke.width : DEFAULT_LINE_WIDTH;
    ctx.lineWidth = base + width;
    strokeLine(ctx, l.start, l.end);
  });

  // Junctions: a slightly larger filled disc under the dot.
  sch.junctions.forEach((j, i) => {
    if (!selection.has(refId('junction', j.uuid, i))) return;
    const r = (j.diameter > 0 ? j.diameter : 0.9 * MM) / 2 + width / 2;
    ctx.beginPath();
    ctx.arc(j.at.x, j.at.y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  // No-connect flags: a wider X under the mark.
  sch.noConnects.forEach((nc, i) => {
    if (!selection.has(refId('noconnect', nc.uuid, i))) return;
    ctx.lineWidth = DEFAULT_LINE_WIDTH + width;
    const delta = Math.max(NOCONNECT_SIZE, DEFAULT_LINE_WIDTH * 3) / 2;
    ctx.beginPath();
    ctx.moveTo(nc.at.x - delta, nc.at.y - delta);
    ctx.lineTo(nc.at.x + delta, nc.at.y + delta);
    ctx.moveTo(nc.at.x - delta, nc.at.y + delta);
    ctx.lineTo(nc.at.x + delta, nc.at.y - delta);
    ctx.stroke();
  });

  // Symbols: re-stroke the body graphics and pins in the shadow colour.
  sch.symbols.forEach((sym, i) => {
    if (!selection.has(refId('symbol', sym.uuid, i))) return;
    const lib = libById.get(sym.libId);
    if (!lib) return;
    const t = symbolTransform(sym.angle, sym.mirror);
    for (const unit of lib.units)
      if (libUnitMatches(unit, sym.unit, sym.bodyStyle)) drawLibUnitShadow(ctx, unit, sym.at, t, color, width);
  });

  // Labels: re-stroke the flag/box geometry wider in the shadow colour.
  sch.labels.forEach((l, i) => {
    if (l.effects?.hidden || !selection.has(refId('label', l.uuid, i))) return;
    drawLabel(ctx, l, theme, { color, width });
  });
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

/** Underglow for a selected symbol: re-stroke its body graphics and pins wider in `color`. */
function drawLibUnitShadow(
  ctx: CanvasRenderingContext2D, unit: LibSymbolUnit, origin: Vec2, t: Transform, color: string, width: number,
): void {
  ctx.strokeStyle = color;
  for (const g of unit.graphics) {
    const base = g.kind !== 'text' && g.stroke && g.stroke.width > 0 ? g.stroke.width : DEFAULT_LINE_WIDTH;
    ctx.lineWidth = base + width;
    switch (g.kind) {
      case 'rectangle': {
        const corners = [
          { x: g.start.x, y: g.start.y }, { x: g.end.x, y: g.start.y },
          { x: g.end.x, y: g.end.y }, { x: g.start.x, y: g.end.y },
        ].map((c) => localToWorld(origin, t, c));
        polygon(ctx, corners, false, true);
        break;
      }
      case 'polyline':
        polygon(ctx, g.points.map((p) => localToWorld(origin, t, p)), false, false);
        break;
      case 'circle': {
        const c = localToWorld(origin, t, g.center);
        ctx.beginPath();
        ctx.arc(c.x, c.y, g.radius, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arc':
        drawArc(ctx, localToWorld(origin, t, g.start), localToWorld(origin, t, g.mid), localToWorld(origin, t, g.end), false);
        break;
      case 'text': break; // text has no stroke halo
    }
  }
  ctx.lineWidth = DEFAULT_LINE_WIDTH + width;
  for (const pin of unit.pins) {
    if (pin.hidden) continue;
    const a = localToWorld(origin, t, pin.at);
    const b = localToWorld(origin, t, pinBodyEnd(pin.at, pin.angle, pin.length));
    strokeLine(ctx, a, b);
  }
}

function drawLibUnit(
  ctx: CanvasRenderingContext2D,
  unit: LibSymbolUnit,
  origin: Vec2,
  t: Transform,
  theme: Theme,
  pins: PinDisplay,
  symId?: string,
  pinIndexStart = 0,
  highlight?: ReadonlySet<string>,
  shadowWidth = 0,
): number {
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
  const DEFAULT_TEXT = 1.27 * MM, MARGIN = 0.25 * MM;
  let pinIndex = pinIndexStart;
  for (const pin of unit.pins) {
    const idx = pinIndex++;
    if (pin.hidden) continue;
    // Per-pin text sizes; a stored size of 0 means "not drawn" (KiCad lays the text
    // out at zero height — Altium imports hide pin names this way and put graphic
    // text in the body instead).
    const NUM = pin.numberSize ?? DEFAULT_TEXT;
    const NAME = pin.nameSize ?? DEFAULT_TEXT;
    // External pin decoration radius = number text size / 2 (KiCad externalPinDecoSize).
    const DECO_R = (NUM > 0 ? NUM : DEFAULT_TEXT) / 2;
    const endLocal = pinBodyEnd(pin.at, pin.angle, pin.length);
    const a = localToWorld(origin, t, pin.at); // connection point (tip)
    const b = localToWorld(origin, t, endLocal); // body end (root)

    // Inverted pins draw a negation bubble at the body end (KiCad GRAPHIC_PINSHAPE).
    const inverted = pin.shape === 'inverted' || pin.shape === 'inverted_clock';
    const strokePinBody = (): void => {
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
    };

    // Brightened pin (on the highlighted net): shadow-pass halo behind, then the
    // pin redrawn in the brightened colour, exactly like the wire/junction pass.
    const brightened = symId !== undefined && (highlight?.has(`${symId}:pin${idx}`) ?? false);
    if (brightened) {
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.15)';
      ctx.lineWidth = DEFAULT_LINE_WIDTH + shadowWidth;
      strokePinBody();
    }
    ctx.strokeStyle = brightened ? '#ff00ff' : theme.pin;
    ctx.lineWidth = DEFAULT_LINE_WIDTH;
    strokePinBody();

    const dir = pinDir(pin.angle);
    const horiz = dir.y === 0;

    // Pin number: centred over the pin line, offset to one side.
    if (!pins.numbersHidden && NUM > 0 && pin.number && pin.number !== '~') {
      const mid = { x: (pin.at.x + endLocal.x) / 2, y: (pin.at.y + endLocal.y) / 2 };
      const off = NUM / 2 + MARGIN;
      const anchor = localToWorld(origin, t, horiz ? { x: mid.x, y: mid.y - off } : { x: mid.x - off, y: mid.y });
      drawText(ctx, pin.number, anchor, NUM, theme.pinNumber);
    }

    // Pin name: inside the body at the inner end (offset > 0), else just outside.
    if (!pins.namesHidden && NAME > 0 && pin.name && pin.name !== '~') {
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
  return pinIndex;
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
  angleDeg = 0,
  bold = false,
  italic = false,
): void {
  if (text === '' || text === '~') return;

  const cap = heightIU;
  const right = justify?.includes('right'), left = justify?.includes('left');
  const top = justify?.includes('top'), bottom = justify?.includes('bottom');

  // KiCad reads 90°/rotated text turned counter-clockwise (screen y is down).
  const a = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.cos(-a), sin = Math.sin(-a);
  const placeAt = (x: number, y: number): Vec2 => ({ x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos });

  // Below a few screen pixels, stroke glyphs blur into an unreadable blob (and are
  // slow); KiCad switches to a bitmap/outline. We draw a light bar of the text's
  // footprint instead — cheap, declutters the overview. Real glyphs above threshold.
  if (heightIU * g_scale < 6) {
    const w = measureText(text, heightIU);
    const offX = right ? -w : left ? 0 : -w / 2;
    const offY = top ? cap : bottom ? 0 : cap / 2;
    const barTop = offY - cap * 0.72, barH = cap * 0.62; // roughly the x-to-cap band
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    const c0 = placeAt(offX, barTop), c1 = placeAt(offX + w, barTop), c2 = placeAt(offX + w, barTop + barH), c3 = placeAt(offX, barTop + barH);
    ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // KiCad strokes schematic text with the Newstroke font. Lay the run out with a
  // baseline-left origin, then place it per the justify flags: cap-height ~= the
  // text size, letters extend up from the baseline (negative local y).
  const { strokes, width } = layoutText(text, heightIU);
  const offX = right ? -width : left ? 0 : -width / 2; // default: centre
  const offY = top ? cap : bottom ? 0 : cap / 2;       // baseline placement; default: middle
  // Italic: STROKE_GLYPH::Transform shears each point right by y·ITALIC_TILT
  // (y is negative above the baseline, so tops lean right) — glyph.cpp.
  const tilt = italic ? ITALIC_TILT : 0;
  const place = (p: Vec2): Vec2 => placeAt(p.x - p.y * tilt + offX, p.y + offY);

  ctx.strokeStyle = color;
  // KiCad text pen: default ~size/8 clamped; bold = size/5 (GetPenSizeForBold).
  ctx.lineWidth = bold ? heightIU / 5 : Math.max(heightIU * 0.11, DEFAULT_LINE_WIDTH * 0.6);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    const p0 = place(stroke[0]!);
    ctx.moveTo(p0.x, p0.y);
    if (stroke.length === 1) ctx.lineTo(p0.x + 0.01, p0.y); // lone point -> tiny dot
    else for (let i = 1; i < stroke.length; i++) { const p = place(stroke[i]!); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }
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
