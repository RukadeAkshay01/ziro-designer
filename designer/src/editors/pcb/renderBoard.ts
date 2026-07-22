/**
 * Board renderer: PCB_PAINTER (pcbnew/pcb_painter.cpp) ported to Canvas 2D.
 *
 * The whole board is compiled once into retained per-layer Path2D buckets,
 * split by object class exactly like pcbnew's Appearance>Objects rows
 * (appearance_controls.cpp s_objectSettings): tracks, vias, pads, zones,
 * graphics and the three footprint-text classes. Every frame just sets the
 * view transform and replays the buckets in GAL_LAYER_ORDER
 * (pcb_draw_panel_gal.cpp), honoring per-object visibility and opacity
 * (project_local_settings.cpp defaults: zones 0.6, images 0.6, rest 1.0).
 *
 * Faithfulness notes (pcb_painter.cpp / pad.cpp):
 *  - vias and through-pads flash on every copper layer they span, in that
 *    layer's color (v9 padstack rendering);
 *  - holes draw above all copper: walls rgb(236,236,236), via holes
 *    rgb(227,183,46), plated pad holes rgb(194,194,0), NPTH rgb(26,196,210);
 *  - text renders on its own board layer (LAYER_FP_TEXT is only a visibility
 *    switch); roundrect radius = ratio·min(w,h); trapezoid corners per
 *    pad.cpp; zone fills sit directly under their layer's tracks.
 */

import type { Vec2 } from '@ziroeda/kimath';
import {
  tessellateArc,
  type Board,
  type PcbPad,
  type PcbShape,
  type PcbTextItem,
} from '@ziroeda/pcbnew';
import { PCB_PAINT_ORDER, PCB_SPECIAL, layerColor, PCB_GRID } from './pcbTheme.js';
import { layoutText, measureText } from '@ziroeda/common/src/font/stroke_font.js';

const MM = 10000; // IU per mm, matches core units

// Default net-class clearance (netclass.cpp DEFAULT_CLEARANCE = 0.2 mm). This
// board carries no explicit net class (those live in the .kicad_pro), so KiCad
// falls back to it for the pad-clearance outlines shown by default.
const DEFAULT_PAD_CLEARANCE = 0.2 * MM;

/**
 * COLOR4D::Brightened(f): push each channel toward white by factor f
 * (c·(1−f)+f). KiCad brightens selected items by 0.8 (pcb_painter.cpp getColor).
 * Parses the `rgb()/rgba()` strings the theme emits and re-emits the same form.
 */
export function brightenColor(color: string, f: number): string {
  if (f <= 0) return color;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return color;
  const parts = m[1]!.split(',').map((s) => s.trim());
  const r = Math.round(Number(parts[0]) * (1 - f) + 255 * f);
  const g = Math.round(Number(parts[1]) * (1 - f) + 255 * f);
  const b = Math.round(Number(parts[2]) * (1 - f) + 255 * f);
  return parts.length > 3 ? `rgba(${r},${g},${b},${parts[3]})` : `rgb(${r},${g},${b})`;
}

/** Object visibility + opacity, mirroring pcbnew's Appearance>Objects tab. */
export interface PcbDrawOptions {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  zones: boolean;
  fpValues: boolean;
  fpReferences: boolean;
  fpText: boolean;
  drawingSheet: boolean;
  trackOpacity: number;
  viaOpacity: number;
  padOpacity: number;
  zoneOpacity: number;
  /** Zone display mode: false = filled (default), true = outline sketch. */
  zoneOutline: boolean;
  /** Show pad clearance outlines (m_Display.m_PadClearance, default on). */
  padClearance: boolean;
  /** Fill vs sketch (outline) for tracks / vias / pads (m_Display*Fill; default
   *  filled). Sketch strokes each item's outline at min-pen, like pcb_painter. */
  trackFill: boolean;
  viaFill: boolean;
  padFill: boolean;
  /** Opacity of filled graphic shapes (s_objectSettings "Filled Shapes"). */
  filledShapeOpacity: number;
  /** High-contrast mode for inactive layers (HIGH_CONTRAST_MODE): 'dim' fades
   *  them by m_hiContrastFactor (0.2), 'hide' drops them entirely; Edge.Cuts is
   *  clamped at 0.3 and stays visible even in hide mode (pcb_painter.cpp). */
  contrastMode: 'normal' | 'dim' | 'hide';
  /** The active layer, exempt from contrast dimming. */
  activeLayer?: string;
  /** Paint every layer in this color — the net-color overlay pass
   *  (net colors mode "All": copper items tinted with their net's color). */
  colorOverride?: string;
}

/** KiCad defaults (project_local_settings.cpp + s_objectSettings). */
export const DEFAULT_DRAW_OPTIONS: PcbDrawOptions = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
  fpValues: true,
  fpReferences: true,
  fpText: true,
  drawingSheet: true,
  trackOpacity: 1.0,
  viaOpacity: 1.0,
  padOpacity: 1.0,
  zoneOpacity: 0.6,
  zoneOutline: false,
  padClearance: true,
  trackFill: true,
  viaFill: true,
  padFill: true,
  filledShapeOpacity: 1.0,
  contrastMode: 'normal',
};

interface LayerBuckets {
  zones: Path2D;
  hasZones: boolean;
  zoneOutlines: Path2D; // zone boundary borders (drawn full-opacity over the fill)
  hasZoneOutlines: boolean;
  clearance: Path2D; // pad clearance outlines (stroked in the copper color)
  hasClearance: boolean;
  trackOutlines: Path2D; // track/arc stadium outlines for sketch (unfilled) mode
  hasTrackOutlines: boolean;
  tracks: Map<number, Path2D>; // width -> segments/arcs (object: Tracks)
  pads: Path2D; // pad flashes (object: Pads)
  hasPads: boolean;
  vias: Path2D; // via annuli (object: Vias)
  hasVias: boolean;
  gfxFill: Path2D;
  hasGfxFill: boolean;
  gfxStrokes: Map<number, Path2D>;
  textRef: Map<number, Path2D>; // thickness -> glyph strokes
  textVal: Map<number, Path2D>;
  textFp: Map<number, Path2D>;
  textBoard: Map<number, Path2D>;
}

export interface BoardScene {
  layers: Map<string, LayerBuckets>;
  viaHoles: Path2D;
  viaHoleWalls: Path2D;
  padHolesPlated: Path2D;
  padHoleWalls: Path2D;
  padHolesNP: Path2D;
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const newBuckets = (): LayerBuckets => ({
  zones: new Path2D(),
  hasZones: false,
  zoneOutlines: new Path2D(),
  hasZoneOutlines: false,
  clearance: new Path2D(),
  hasClearance: false,
  trackOutlines: new Path2D(),
  hasTrackOutlines: false,
  tracks: new Map(),
  pads: new Path2D(),
  hasPads: false,
  vias: new Path2D(),
  hasVias: false,
  gfxFill: new Path2D(),
  hasGfxFill: false,
  gfxStrokes: new Map(),
  textRef: new Map(),
  textVal: new Map(),
  textFp: new Map(),
  textBoard: new Map(),
});

const buckets = (scene: BoardScene, layer: string): LayerBuckets => {
  let b = scene.layers.get(layer);
  if (!b) {
    b = newBuckets();
    scene.layers.set(layer, b);
  }
  return b;
};

const pathIn = (map: Map<number, Path2D>, width: number): Path2D => {
  let p = map.get(width);
  if (!p) {
    p = new Path2D();
    map.set(width, p);
  }
  return p;
};

/** Expand a pad/via layer list ('*.Cu' wildcards) to real board layer names. */
function expandLayers(list: string[], copperNames: string[]): string[] {
  const out: string[] = [];
  for (const l of list) {
    if (l === '*.Cu') out.push(...copperNames);
    else if (l === 'F&B.Cu') out.push('F.Cu', 'B.Cu');
    else if (l.startsWith('*.')) out.push(`F${l.slice(1)}`, `B${l.slice(1)}`);
    else out.push(l);
  }
  return out;
}

/** Copper layers spanned by a via, in board stackup order. */
function viaSpan(from: string, to: string, copperNames: string[]): string[] {
  const i0 = copperNames.indexOf(from);
  const i1 = copperNames.indexOf(to);
  if (i0 < 0 || i1 < 0) return copperNames;
  const [a, b] = i0 <= i1 ? [i0, i1] : [i1, i0];
  return copperNames.slice(a, b + 1);
}

/**
 * Stadium outline of a track centreline A→B of width `w` (radius r = w/2): the
 * two parallel edges plus the semicircular end caps, as a closed subpath. This
 * is what a track drawn in sketch mode outlines (pcb_painter.cpp DrawSegment in
 * stroke mode). Caps are sampled to stay independent of arc-direction quirks.
 */
function addStadiumOutline(path: Path2D, a: Vec2, b: Vec2, r: number): void {
  if (r <= 0) return;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const N = 8;
  const pt: [number, number][] = [];
  // Forward cap around B: from B-perp through B+dir to B+perp.
  for (let i = 0; i <= N; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / N;
    pt.push([b.x + r * Math.cos(t), b.y + r * Math.sin(t)]);
  }
  // Backward cap around A: from A+perp through A-dir to A-perp.
  for (let i = 0; i <= N; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / N;
    pt.push([a.x + r * Math.cos(t), a.y + r * Math.sin(t)]);
  }
  path.moveTo(pt[0]![0], pt[0]![1]);
  for (let i = 1; i < pt.length; i++) path.lineTo(pt[i]![0], pt[i]![1]);
  path.closePath();
}

/** Outline of a poly-line track (tessellated arc) of width `w`: offset each side. */
function addPolylineOutline(path: Path2D, pts: Vec2[], r: number): void {
  if (r <= 0 || pts.length < 2) return;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const px = -Math.sin(ang) * r;
    const py = Math.cos(ang) * r;
    left.push([p.x + px, p.y + py]);
    right.push([p.x - px, p.y - py]);
  }
  path.moveTo(left[0]![0], left[0]![1]);
  for (let i = 1; i < left.length; i++) path.lineTo(left[i]![0], left[i]![1]);
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i]![0], right[i]![1]);
  path.closePath();
}

/** Pad outline as a Path2D subpath in board coordinates. */
function addPadShape(path: Path2D, pad: PcbPad): void {
  const m = new DOMMatrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const w = pad.size.x;
  const h = pad.size.y;
  const sub = new Path2D();
  switch (pad.shape) {
    case 'circle':
      sub.arc(0, 0, w / 2, 0, Math.PI * 2);
      break;
    case 'oval': {
      const r = Math.min(w, h) / 2;
      sub.roundRect(-w / 2, -h / 2, w, h, r);
      break;
    }
    case 'rect':
      sub.rect(-w / 2, -h / 2, w, h);
      break;
    case 'roundrect': {
      // GetRoundRectCornerRadius: ratio · min(w, h), ratio ≤ 0.5.
      const r = Math.min(0.5, pad.roundrectRatio ?? 0.25) * Math.min(w, h);
      if (pad.chamferRatio && pad.chamfer && pad.chamfer.length > 0) {
        addChamferedRect(sub, w, h, r, pad.chamferRatio, pad.chamfer);
      } else {
        sub.roundRect(-w / 2, -h / 2, w, h, r);
      }
      break;
    }
    case 'trapezoid': {
      // pad.cpp TransformShapeToPolygon corner order.
      const hx = w / 2;
      const hy = h / 2;
      const dx = (pad.delta?.x ?? 0) / 2;
      const dy = (pad.delta?.y ?? 0) / 2;
      sub.moveTo(-hx - dy, hy + dx);
      sub.lineTo(hx + dy, hy - dx);
      sub.lineTo(hx - dy, -hy + dx);
      sub.lineTo(-hx + dy, -hy - dx);
      sub.closePath();
      break;
    }
    case 'custom': {
      // Anchor shape first (circle or rect of `size`), then primitives.
      if (w > 0) sub.arc(0, 0, w / 2, 0, Math.PI * 2);
      for (const prim of pad.primitives ?? []) {
        if (prim.kind === 'gr_poly' && prim.pts && prim.pts.length >= 3) {
          sub.moveTo(prim.pts[0]!.x, prim.pts[0]!.y);
          for (let i = 1; i < prim.pts.length; i++) sub.lineTo(prim.pts[i]!.x, prim.pts[i]!.y);
          sub.closePath();
        } else if (prim.kind === 'gr_circle' && prim.center) {
          const r = prim.end
            ? Math.hypot(prim.end.x - prim.center.x, prim.end.y - prim.center.y)
            : 0;
          if (r > 0) {
            sub.moveTo(prim.center.x + r, prim.center.y);
            sub.arc(prim.center.x, prim.center.y, r, 0, Math.PI * 2);
          }
        } else if (prim.kind === 'gr_rect' && prim.start && prim.end) {
          sub.rect(
            Math.min(prim.start.x, prim.end.x),
            Math.min(prim.start.y, prim.end.y),
            Math.abs(prim.end.x - prim.start.x),
            Math.abs(prim.end.y - prim.start.y),
          );
        }
      }
      break;
    }
  }
  path.addPath(sub, m);
}

/**
 * The pad outline inflated by `clr` — the pad-clearance outline KiCad strokes
 * in the copper color (pcb_painter.cpp draw(PAD) clearance layer): a circle of
 * radius+clr for round pads, otherwise the shape offset outward by clr (which
 * rounds the corners with radius clr).
 */
function addPadClearanceShape(path: Path2D, pad: PcbPad, clr: number): void {
  const m = new DOMMatrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const w = pad.size.x;
  const h = pad.size.y;
  const sub = new Path2D();
  const x = -w / 2 - clr;
  const y = -h / 2 - clr;
  const rw = w + 2 * clr;
  const rh = h + 2 * clr;
  switch (pad.shape) {
    case 'circle':
      sub.arc(0, 0, w / 2 + clr, 0, Math.PI * 2);
      break;
    case 'oval':
      sub.roundRect(x, y, rw, rh, Math.min(w, h) / 2 + clr);
      break;
    case 'roundrect': {
      const r = Math.min(0.5, pad.roundrectRatio ?? 0.25) * Math.min(w, h);
      sub.roundRect(x, y, rw, rh, r + clr);
      break;
    }
    default:
      // rect / trapezoid / custom: offset outward with clr-radius corners.
      sub.roundRect(x, y, rw, rh, clr);
      break;
  }
  path.addPath(sub, m);
}

/** Chamfered roundrect: straight cuts on `corners`, radius `r` elsewhere. */
function addChamferedRect(
  sub: Path2D,
  w: number,
  h: number,
  r: number,
  chamferRatio: number,
  corners: string[],
): void {
  const cut = chamferRatio * Math.min(w, h);
  const hx = w / 2;
  const hy = h / 2;
  const has = (c: string): boolean => corners.includes(c);
  const tl = has('top_left');
  const tr = has('top_right');
  const br = has('bottom_right');
  const bl = has('bottom_left');
  sub.moveTo(-hx + (tl ? cut : r), -hy);
  if (tr) {
    sub.lineTo(hx - cut, -hy);
    sub.lineTo(hx, -hy + cut);
  } else {
    sub.lineTo(hx - r, -hy);
    sub.arcTo(hx, -hy, hx, -hy + r, r);
  }
  if (br) {
    sub.lineTo(hx, hy - cut);
    sub.lineTo(hx - cut, hy);
  } else {
    sub.lineTo(hx, hy - r);
    sub.arcTo(hx, hy, hx - r, hy, r);
  }
  if (bl) {
    sub.lineTo(-hx + cut, hy);
    sub.lineTo(-hx, hy - cut);
  } else {
    sub.lineTo(-hx + r, hy);
    sub.arcTo(-hx, hy, -hx, hy - r, r);
  }
  if (tl) {
    sub.lineTo(-hx, -hy + cut);
    sub.lineTo(-hx + cut, -hy);
  } else {
    sub.lineTo(-hx, -hy + r);
    sub.arcTo(-hx, -hy, -hx + r, -hy, r);
  }
  sub.closePath();
}

function addShape(scene: BoardScene, s: PcbShape): void {
  const b = buckets(scene, s.layer);
  const width = Math.max(s.width, 1);
  if (s.kind === 'line' && s.start && s.end) {
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(s.start.x, s.start.y);
    p.lineTo(s.end.x, s.end.y);
  } else if (s.kind === 'rect' && s.start && s.end) {
    const x = Math.min(s.start.x, s.end.x);
    const y = Math.min(s.start.y, s.end.y);
    const rw = Math.abs(s.end.x - s.start.x);
    const rh = Math.abs(s.end.y - s.start.y);
    if (s.fill) {
      b.gfxFill.rect(x, y, rw, rh);
      b.hasGfxFill = true;
    }
    pathIn(b.gfxStrokes, width).rect(x, y, rw, rh);
  } else if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    if (r <= 0) return;
    if (s.fill) {
      b.gfxFill.moveTo(s.center.x + r, s.center.y);
      b.gfxFill.arc(s.center.x, s.center.y, r, 0, Math.PI * 2);
      b.hasGfxFill = true;
    }
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(s.center.x + r, s.center.y);
    p.arc(s.center.x, s.center.y, r, 0, Math.PI * 2);
  } else if (s.kind === 'arc' && s.start && s.mid && s.end) {
    const pts = tessellateArc(s.start, s.mid, s.end);
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
  } else if ((s.kind === 'poly' || s.kind === 'curve') && s.pts && s.pts.length >= 2) {
    if (s.fill && s.pts.length >= 3) {
      b.gfxFill.moveTo(s.pts[0]!.x, s.pts[0]!.y);
      for (let i = 1; i < s.pts.length; i++) b.gfxFill.lineTo(s.pts[i]!.x, s.pts[i]!.y);
      b.gfxFill.closePath();
      b.hasGfxFill = true;
    }
    const p = pathIn(b.gfxStrokes, width);
    p.moveTo(s.pts[0]!.x, s.pts[0]!.y);
    for (let i = 1; i < s.pts.length; i++) p.lineTo(s.pts[i]!.x, s.pts[i]!.y);
    if (s.fill) p.closePath();
  }
}

/** Bake a text item's glyph strokes into the given thickness->path map. */
function addText(map: Map<number, Path2D>, t: PcbTextItem): void {
  const size = t.size.y;
  if (size <= 0 || t.text === '') return;
  const { strokes, width } = layoutText(t.text, size);
  // EDA_TEXT::GetEffectiveTextPenWidth (eda_text.cpp): file thickness, else
  // bold→size/5 / normal→size/8, then clamped to ≤ size·0.25. A too-thin pen
  // is exactly what made board text read like a plain font instead of the
  // stroke font, so this clamp restores the proper Newstroke weight.
  const raw = t.thickness && t.thickness > 1 ? t.thickness : penForText(size, !!t.bold);
  const thickness = Math.max(Math.min(raw, size * 0.25), 1);
  // PCB text anchors CENTER/CENTER by default (EDA_TEXT on boards).
  const justify = t.justify ?? [];
  const hAlign = justify.includes('left') ? 'left' : justify.includes('right') ? 'right' : 'center';
  const vAlign = justify.includes('top') ? 'top' : justify.includes('bottom') ? 'bottom' : 'center';
  const offX = hAlign === 'left' ? 0 : hAlign === 'right' ? -width : -width / 2;
  const offY = vAlign === 'top' ? size : vAlign === 'bottom' ? 0 : size / 2;
  // PCB_TEXT::GetDrawRotation: footprint text keeps its angle in ]-90°, 90°] so
  // it stays readable — e.g. a 270° "POWER" field draws at 90°, not upside-down.
  let drawAngle = t.angle;
  if (t.keepUpright) {
    while (drawAngle > 90) drawAngle -= 180;
    while (drawAngle <= -90) drawAngle += 180;
  }
  const rad = (-drawAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mir = t.mirror ? -1 : 1;
  const tilt = t.italic ? ITALIC_TILT : 0;
  // KiCad scales glyphs by width and height separately (eda_text.cpp writes
  // "(size height width)"); layoutText uses height for both, so condense x by
  // width/height for non-square text (e.g. a condensed board name).
  const sx = size > 0 ? t.size.x / size : 1;
  const path = pathIn(map, thickness);
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const gx = ((stroke[i]!.x + offX) * sx - stroke[i]!.y * tilt) * mir;
      const gy = stroke[i]!.y + offY;
      const x = t.at.x + gx * cos - gy * sin;
      const y = t.at.y + gx * sin + gy * cos;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      if (stroke.length === 1) path.lineTo(x + 1, y);
    }
  }
}

export interface SceneFilter {
  /** Appearance>Objects "Footprints Front/Back": hide whole footprints per side. */
  hideFrontFootprints?: boolean;
  hideBackFootprints?: boolean;
}

/** Even-odd ray cast: is point `p` inside the closed polygon `poly`? */
function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * Zone border hatch ticks (SHAPE_POLY_SET::GenerateHatchLines / ZONE::HatchBorder):
 * a family of parallel lines y = slope·x + a spaced by `spacing` is intersected
 * with the outline; each in-polygon crossing yields a tick of length `lineLen`
 * running inward from the border (`lineLen = -1` keeps the full crossing, for the
 * DIAGONAL_FULL style). Copper zones use slope −1 (all copper layer ids are even).
 */
function zoneHatchSegments(
  outline: Vec2[],
  slope: number,
  spacing: number,
  lineLen: number,
): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  if (outline.length < 3 || spacing <= 0) return out;
  let minX = outline[0]!.x;
  let maxX = minX;
  let minY = outline[0]!.y;
  let maxY = minY;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let maxA: number;
  let minA: number;
  if (slope > 0) {
    maxA = Math.round(maxY - slope * minX);
    minA = Math.round(minY - slope * maxX);
  } else {
    maxA = Math.round(maxY - slope * maxX);
    minA = Math.round(minY - slope * minX);
  }
  minA = Math.floor(minA / spacing) * spacing;
  const n = outline.length;
  for (let a = minA; a < maxA; a += spacing) {
    const pts: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const A = outline[i]!;
      const B = outline[(i + 1) % n]!;
      // Segment A→B ∩ line y = slope·x + a. f(t) = f0 + t·d, t ∈ [0,1).
      const f0 = A.y - slope * A.x - a;
      const d = B.y - A.y - slope * (B.x - A.x);
      if (d === 0) continue;
      const t = -f0 / d;
      if (t < 0 || t >= 1) continue;
      const x = A.x + t * (B.x - A.x);
      const y = A.y + t * (B.y - A.y);
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      pts.push({ x, y });
    }
    if (pts.length > 2) pts.sort((p, q) => q.x - p.x); // descending x
    for (let ip = 0; ip + 1 < pts.length; ip++) {
      const p1 = pts[ip]!;
      const p2 = pts[ip + 1]!;
      if (p1.x === p2.x && p1.y === p2.y) continue;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (!pointInPoly(mid, outline)) continue;
      const dx = p2.x - p1.x;
      if (lineLen === -1 || Math.abs(dx) < 2 * lineLen) {
        out.push([p1, p2]);
      } else {
        const s = (p2.y - p1.y) / dx;
        const ddx = dx > 0 ? lineLen : -lineLen;
        out.push([p1, { x: p1.x + ddx, y: p1.y + ddx * s }]);
        out.push([p2, { x: p2.x - ddx, y: p2.y - ddx * s }]);
      }
    }
  }
  return out;
}

/** Compile the board into retained per-layer, per-object paths. */
export function buildScene(board: Board, filter: SceneFilter = {}): BoardScene {
  const scene: BoardScene = {
    layers: new Map(),
    viaHoles: new Path2D(),
    viaHoleWalls: new Path2D(),
    padHolesPlated: new Path2D(),
    padHoleWalls: new Path2D(),
    padHolesNP: new Path2D(),
    bbox: null,
  };
  const copperNames = board.layers
    .filter((l) => /\.Cu$/.test(l.name))
    .sort((a, b) => cuOrder(a.name) - cuOrder(b.name))
    .map((l) => l.name);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (x: number, y: number, pad = 0): void => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const t of board.tracks) {
    const b = buckets(scene, t.layer);
    const p = pathIn(b.tracks, Math.max(t.width, 1));
    p.moveTo(t.start.x, t.start.y);
    p.lineTo(t.end.x, t.end.y);
    addStadiumOutline(b.trackOutlines, t.start, t.end, t.width / 2);
    b.hasTrackOutlines = true;
    grow(t.start.x, t.start.y, t.width);
    grow(t.end.x, t.end.y, t.width);
  }
  for (const a of board.arcs) {
    const pts = tessellateArc(a.start, a.mid, a.end);
    const b = buckets(scene, a.layer);
    const p = pathIn(b.tracks, Math.max(a.width, 1));
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
    addPolylineOutline(b.trackOutlines, pts, a.width / 2);
    b.hasTrackOutlines = true;
    grow(a.start.x, a.start.y, a.width);
    grow(a.end.x, a.end.y, a.width);
  }
  for (const v of board.vias) {
    const r = v.size / 2;
    for (const layer of viaSpan(v.layers[0], v.layers[1], copperNames)) {
      const b = buckets(scene, layer);
      b.vias.moveTo(v.at.x + r, v.at.y);
      b.vias.arc(v.at.x, v.at.y, r, 0, Math.PI * 2);
      b.hasVias = true;
    }
    const hr = v.drill / 2;
    scene.viaHoleWalls.moveTo(v.at.x + hr + 0.05 * MM, v.at.y);
    scene.viaHoleWalls.arc(v.at.x, v.at.y, hr + 0.05 * MM, 0, Math.PI * 2);
    scene.viaHoles.moveTo(v.at.x + hr, v.at.y);
    scene.viaHoles.arc(v.at.x, v.at.y, hr, 0, Math.PI * 2);
    grow(v.at.x, v.at.y, r);
  }
  for (const z of board.zones) {
    for (const fill of z.fills) {
      const b = buckets(scene, fill.layer);
      for (const poly of fill.polys) {
        b.zones.moveTo(poly[0]!.x, poly[0]!.y);
        for (let i = 1; i < poly.length; i++) b.zones.lineTo(poly[i]!.x, poly[i]!.y);
        b.zones.closePath();
        b.hasZones = true;
        for (const pt of poly) grow(pt.x, pt.y);
      }
    }
    // The zone boundary is drawn as a border on each of the zone's layers
    // (pcb_painter.cpp draw(ZONE): outline of GetBoardOutline in the layer color).
    if (z.outline && z.outline.length >= 3) {
      // DIAGONAL_EDGE = short ticks (length = pitch, spacing = pitch);
      // DIAGONAL_FULL = full diagonals (spacing = pitch·2). Copper slope = −1.
      const style = z.hatchStyle ?? 'edge';
      const pitch = z.hatchPitch ?? 0;
      const hatch =
        style !== 'none' && pitch > 0
          ? zoneHatchSegments(
              z.outline,
              -1,
              style === 'full' ? pitch * 2 : pitch,
              style === 'full' ? -1 : pitch,
            )
          : [];
      for (const layer of z.layers) {
        const b = buckets(scene, layer);
        b.zoneOutlines.moveTo(z.outline[0]!.x, z.outline[0]!.y);
        for (let i = 1; i < z.outline.length; i++)
          b.zoneOutlines.lineTo(z.outline[i]!.x, z.outline[i]!.y);
        b.zoneOutlines.closePath();
        for (const [p, q] of hatch) {
          b.zoneOutlines.moveTo(p.x, p.y);
          b.zoneOutlines.lineTo(q.x, q.y);
        }
        b.hasZoneOutlines = true;
      }
      for (const pt of z.outline) grow(pt.x, pt.y);
    }
  }
  for (const s of board.shapes) {
    addShape(scene, s);
    if (s.start) grow(s.start.x, s.start.y, s.width);
    if (s.end) grow(s.end.x, s.end.y, s.width);
    if (s.center) grow(s.center.x, s.center.y);
    for (const pt of s.pts ?? []) grow(pt.x, pt.y);
  }
  for (const fp of board.footprints) {
    if (filter.hideFrontFootprints && fp.layer === 'F.Cu') continue;
    if (filter.hideBackFootprints && fp.layer === 'B.Cu') continue;
    for (const s of fp.shapes) addShape(scene, s);
    for (const t of fp.texts) {
      if (t.hide) continue;
      const b = buckets(scene, t.layer);
      addText(t.kind === 'reference' ? b.textRef : t.kind === 'value' ? b.textVal : b.textFp, t);
    }
    for (const pad of fp.pads) {
      if (pad.type === 'np_thru_hole') {
        // Painter draws NPTH as its hole in LAYER_NON_PLATEDHOLES.
        if (pad.drill) addHole(scene.padHolesNP, pad, pad.drill);
        continue;
      }
      for (const layer of expandLayers(pad.layers, copperNames)) {
        const b = buckets(scene, layer);
        addPadShape(b.pads, pad);
        b.hasPads = true;
        // Pad clearance outline is drawn per copper layer the pad flashes on
        // (not the mask layers), in that layer's color.
        if (copperNames.includes(layer)) {
          addPadClearanceShape(b.clearance, pad, DEFAULT_PAD_CLEARANCE);
          b.hasClearance = true;
        }
      }
      if (pad.drill && pad.type === 'thru_hole') {
        addHole(scene.padHoleWalls, pad, {
          ...pad.drill,
          w: pad.drill.w + 0.1 * MM,
          h: pad.drill.h + 0.1 * MM,
        });
        addHole(scene.padHolesPlated, pad, pad.drill);
      }
      grow(pad.at.x, pad.at.y, Math.max(pad.size.x, pad.size.y) / 2);
    }
    grow(fp.at.x, fp.at.y);
  }
  for (const t of board.texts) {
    if (!t.hide) addText(buckets(scene, t.layer).textBoard, t);
  }

  scene.bbox = minX < maxX ? { minX, minY, maxX, maxY } : null;
  return scene;
}

const addHole = (
  path: Path2D,
  pad: PcbPad,
  drill: { oblong: boolean; w: number; h: number; offset?: Vec2 },
): void => {
  const m = new DOMMatrix().translate(pad.at.x, pad.at.y).rotate(-pad.angle);
  const sub = new Path2D();
  const ox = drill.offset?.x ?? 0;
  const oy = drill.offset?.y ?? 0;
  if (drill.oblong) {
    const r = Math.min(drill.w, drill.h) / 2;
    sub.roundRect(ox - drill.w / 2, oy - drill.h / 2, drill.w, drill.h, r);
  } else {
    sub.arc(ox, oy, drill.w / 2, 0, Math.PI * 2);
  }
  path.addPath(sub, m);
};

/** F.Cu first, inners in numeric order, B.Cu last (board stackup). */
const cuOrder = (name: string): number => {
  if (name === 'F.Cu') return 0;
  if (name === 'B.Cu') return 1000;
  const m = /^In(\d+)\.Cu$/.exec(name);
  return m ? Number(m[1]) : 500;
};

export interface PcbViewTransform {
  scale: number; // canvas px per IU
  tx: number;
  ty: number;
  /** Horizontal mirror of the view (APPEARANCE_CONTROLS "Flip board view",
   *  KIGFX::VIEW::SetMirror on X): screenX = worldX·(−scale) + tx. */
  flipX?: boolean;
}

// KiCad renders every stroke at a minimum on-screen width so thin tracks stay
// crisp and visible when zoomed out (GAL's minimum pen), instead of fading to a
// sub-pixel blur. `minPen` is 1 device pixel expressed in world (IU) units.
const strokeAll = (ctx: CanvasRenderingContext2D, map: Map<number, Path2D>, minPen = 0): void => {
  for (const [width, path] of map) {
    ctx.lineWidth = Math.max(width, minPen);
    ctx.stroke(path);
  }
};

// ----- drawing sheet (page frame + title block) ------------------------------
// KiCad's default worksheet (common/drawing_sheet/drawing_sheet_default_
// description.cpp): 10 mm margins, a double border 2 mm apart, a 50 mm
// coordinate band, and the 110×34 mm title block in the bottom-right corner.
// pcbnew draws it in LAYER_DRAWINGSHEET colour rgb(200,114,171)
// (builtin_color_themes.h). The board origin (0,0) is the page's top-left.

const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};

const paperSizeIU = (paper: string | undefined): { w: number; h: number } | null => {
  if (!paper) return null;
  const parts = paper.split(/\s+/);
  const dims = PAPER_MM[parts[0]!];
  if (!dims) return null;
  const [w, h] = parts.includes('portrait') ? [dims[1], dims[0]] : dims;
  return { w: w! * MM, h: h! * MM };
};

export interface SheetInfo {
  paper?: string;
  titleBlock?: { title?: string; date?: string; rev?: string; company?: string };
  fileName?: string;
}

// eda_text.cpp / gr_text.cpp EDA_TEXT pen: bold = size/5, normal = size/8,
// clamped to ≤ size·0.25 (ClampTextPenSize). glyph.cpp ITALIC_TILT = 1/8.
const penForText = (size: number, bold: boolean): number =>
  Math.min(bold ? size / 5 : size / 8, size * 0.25);
const ITALIC_TILT = 1 / 8;

/** Stroke a Newstroke string at (x, y) baseline, with optional bold/italic. */
function sheetText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  justify: 'left' | 'center' = 'left',
  bold = false,
  italic = false,
): void {
  if (!text) return;
  const { strokes, width } = layoutText(text, size);
  const offX = justify === 'center' ? -width / 2 : 0;
  ctx.lineWidth = penForText(size, bold);
  const tilt = italic ? ITALIC_TILT : 0;
  ctx.beginPath();
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      // Italic shear: y is negative above the baseline, so tops lean right.
      const px = x + stroke[i]!.x - stroke[i]!.y * tilt + offX;
      const py = y + stroke[i]!.y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      if (stroke.length === 1) ctx.lineTo(px + 1, py);
    }
  }
  ctx.stroke();
}

const DRAWINGSHEET_COLOR = 'rgb(200,114,171)';

export function drawDrawingSheet(ctx: CanvasRenderingContext2D, info: SheetInfo): void {
  const page = paperSizeIU(info.paper);
  if (!page) return;
  const M = 10 * MM;
  const L = M,
    T = M,
    R = page.w - M,
    B = page.h - M;
  const color = DRAWINGSHEET_COLOR;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.15 * MM;
  ctx.setLineDash([]);
  ctx.strokeRect(L, T, R - L, B - T);
  const i2 = 2 * MM;
  ctx.strokeRect(L + i2, T + i2, R - L - 2 * i2, B - T - 2 * i2);

  // Coordinate band (numbers across, letters down), 50 mm divisions.
  const refH = 1.3 * MM;
  const step = 50 * MM;
  ctx.beginPath();
  for (let x = L + step; x < R - i2; x += step) {
    ctx.moveTo(x, T);
    ctx.lineTo(x, T + i2);
    ctx.moveTo(x, B);
    ctx.lineTo(x, B - i2);
  }
  for (let y = T + step; y < B - i2; y += step) {
    ctx.moveTo(L, y);
    ctx.lineTo(L + i2, y);
    ctx.moveTo(R, y);
    ctx.lineTo(R - i2, y);
  }
  ctx.stroke();
  let n = 1;
  for (let x = L; x < R - i2; x += step, n++) {
    const cx = Math.min(x + step / 2, (x + R) / 2);
    sheetText(ctx, String(n), cx, T + i2 / 2 + refH / 2, refH, 'center');
    sheetText(ctx, String(n), cx, B - i2 / 2 + refH / 2, refH, 'center');
  }
  let li = 0;
  for (let y = T; y < B - i2; y += step, li++) {
    const cy = Math.min(y + step / 2, (y + B) / 2);
    const ch = String.fromCharCode(65 + (li % 26));
    sheetText(ctx, ch, L + i2 / 2, cy + refH / 2, refH, 'center');
    sheetText(ctx, ch, R - i2 / 2, cy + refH / 2, refH, 'center');
  }

  // Title block, default description (110×34 off the bottom-right corner).
  const rx = (d: number): number => R - d * MM;
  const ry = (d: number): number => B - d * MM;
  ctx.strokeRect(rx(110), ry(34), 108 * MM, 32 * MM);
  ctx.beginPath();
  for (const yy of [5.5, 8.5, 12.5, 18.5]) {
    ctx.moveTo(rx(110), ry(yy));
    ctx.lineTo(rx(2), ry(yy));
  }
  ctx.moveTo(rx(90), ry(8.5));
  ctx.lineTo(rx(90), ry(5.5));
  ctx.moveTo(rx(26), ry(8.5));
  ctx.lineTo(rx(26), ry(2));
  ctx.stroke();

  // Field layout + weights are the KiCad default worksheet
  // (drawing_sheet_default_description.cpp): Title is bold italic, Rev and
  // Company are bold, the rest normal.
  const tb = info.titleBlock;
  const t15 = 1.5 * MM;
  sheetText(ctx, `Date: ${tb?.date ?? ''}`, rx(87), ry(6.9), t15);
  sheetText(ctx, 'ZiroEDA', rx(109), ry(4.1), t15);
  sheetText(ctx, `Rev: ${tb?.rev ?? ''}`, rx(24), ry(6.9), t15, 'left', true);
  sheetText(ctx, `Size: ${info.paper ?? ''}`, rx(109), ry(6.9), t15);
  sheetText(ctx, 'Id: 1/1', rx(24), ry(4.1), t15);
  sheetText(ctx, `Title: ${tb?.title ?? ''}`, rx(109), ry(10.7), 2 * MM, 'left', true, true);
  sheetText(ctx, `File: ${info.fileName ?? ''}`, rx(109), ry(14.3), t15);
  sheetText(ctx, 'Sheet: /', rx(109), ry(17), t15);
  sheetText(ctx, tb?.company ?? '', rx(109), ry(20), t15, 'left', true);
}

// ----- grid (GAL DrawGrid) ---------------------------------------------------

/** Grid render options — the GAL DOTS grid with KiCad's pcbnew defaults. */
export interface PcbGridOptions {
  /** Grid spacing in IU (world units). pcbnew default grid = 0.5 mm. */
  size: number;
  /** Grid origin in IU (GAL m_gridOrigin; board grid origin). */
  origin: Vec2;
  /** Coarse-grid multiple: every `tick`th dot is doubled (SetCoarseGrid(10)). */
  tick: number;
  /** Minimum on-screen dot spacing in device px (m_gridMinSpacing = 10). */
  minSpacing: number;
  /** LAYER_GRID color. */
  color: string;
}

export const DEFAULT_GRID_OPTIONS: PcbGridOptions = {
  size: 0.5 * MM,
  origin: { x: 0, y: 0 },
  tick: 10,
  minSpacing: 10,
  color: PCB_GRID,
};

/**
 * Paint the dotted grid the way GAL does (CAIRO_GAL_BASE::DrawGrid, DOTS
 * branch): a dot at every grid node in device space, every `tick`th row/column
 * doubled in size, with the spacing scaled up by whole `tick`s until it clears
 * the minimum on-screen spacing so a zoomed-out board isn't a solid wall of
 * dots. Drawn on the live canvas (identity transform) so it stays crisp every
 * frame like GAL's NONCACHED grid target, behind the board raster. `dpr` is the
 * device-pixel ratio (GAL's scaleFactor).
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: PcbViewTransform,
  widthPx: number,
  heightPx: number,
  dpr: number,
  opts: PcbGridOptions = DEFAULT_GRID_OPTIONS,
): void {
  if (opts.size <= 0 || view.scale <= 0) return;
  const worldScale = view.scale; // device px per IU
  // Signed X scale so grid nodes line up with the (mirrored) board and crosshair.
  const sx = view.flipX ? -worldScale : worldScale;
  // GAL: m_gridLineWidth = scaleFactor * 0.5 + 0.25; a normal dot is this wide,
  // a coarse dot twice that, each clamped to a minimum of 1 device px.
  const lineW = dpr * 0.5 + 0.25;

  // Visible world rectangle (screen corners → world).
  const wsx = (0 - view.tx) / sx;
  const wsy = (0 - view.ty) / worldScale;
  const wex = (widthPx - view.tx) / sx;
  const wey = (heightPx - view.ty) / worldScale;

  // Scale spacing up by whole ticks until it clears the min screen spacing.
  const threshold = Math.round(opts.minSpacing / worldScale); // IU
  let step = opts.size;
  while (step <= threshold) step *= opts.tick;

  const ox = opts.origin.x;
  const oy = opts.origin.y;
  let startX = Math.round((wsx - ox) / step);
  let endX = Math.round((wex - ox) / step);
  let startY = Math.round((wsy - oy) / step);
  let endY = Math.round((wey - oy) / step);
  if (startX > endX) [startX, endX] = [endX, startX];
  if (startY > endY) [startY, endY] = [endY, startY];
  startX--;
  endX++;
  startY--;
  endY++;

  // Guard against pathological counts (e.g. a not-yet-sized view).
  if (endX - startX > 4000 || endY - startY > 4000) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = opts.color;
  // Group dots by device size so the whole grid paints in a few fills.
  const paths = new Map<string, Path2D>();
  const rectAt = (dx: number, dy: number, sw: number, sh: number): void => {
    // Pixel-align to whole device pixels so each dot is full-coverage (the OpenGL
    // GAL's dots are crisp); a sub-pixel rect anti-aliases to a dim grey smear.
    const w = Math.max(1, Math.round(sw));
    const h = Math.max(1, Math.round(sh));
    const key = `${w}:${h}`;
    let p = paths.get(key);
    if (!p) {
      p = new Path2D();
      paths.set(key, p);
    }
    p.rect(Math.round(dx) - (w >> 1), Math.round(dy) - (h >> 1), w, h);
  };
  for (let j = startY; j <= endY; j++) {
    const tickY = j % opts.tick === 0;
    const dy = (j * step + oy) * worldScale + view.ty;
    const sh = Math.max(1, tickY ? lineW * 2 : lineW);
    for (let i = startX; i <= endX; i++) {
      const tickX = i % opts.tick === 0;
      const dx = (i * step + ox) * sx + view.tx;
      const sw = Math.max(1, tickX ? lineW * 2 : lineW);
      rectAt(dx, dy, sw, sh);
    }
  }
  for (const p of paths.values()) ctx.fill(p);
}

/**
 * The paint sequence as resumable steps, one per stacking pass. The editor
 * runs these across animation frames with a time budget so a 20k-track board
 * never blocks the UI while the crisp raster streams in.
 */
export function buildDrawSteps(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  view: PcbViewTransform,
  visible: ReadonlySet<string>,
  widthPx: number,
  heightPx: number,
  opts: PcbDrawOptions = DEFAULT_DRAW_OPTIONS,
  sheet?: SheetInfo,
  // Overlay pass (live move preview): paint the items on top of an existing
  // frame, so skip the background clear and the drawing sheet.
  overlay = false,
  // Selection brightening (pcb_painter.cpp: selected items are Brightened(0.8)).
  // 0 = paint the layer colors as-is.
  brighten = 0,
): (() => void)[] {
  const steps: (() => void)[] = [];
  // Per-layer color, brightened toward white for a selection overlay.
  const col = (layer: string): string =>
    opts.colorOverride ?? brightenColor(layerColor(layer), brighten);
  const sp = (c: string): string => brightenColor(c, brighten);
  steps.push(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The raster is kept transparent so the grid (painted on the live canvas
    // behind the raster, like GAL's GRID_DEPTH) shows through the empty board
    // areas. The visible canvas fills PCB_BACKGROUND before blitting.
    // A flipped view negates the X scale (SetMirror on X).
    ctx.setTransform(view.flipX ? -view.scale : view.scale, 0, 0, view.scale, view.tx, view.ty);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Drawing sheet (page frame + title block) behind the board, like pcbnew.
    if (!overlay && sheet && opts.drawingSheet) drawDrawingSheet(ctx, sheet);
  });

  const minPen = view.scale > 0 ? 1 / view.scale : 0; // 1 device px in IU

  // High-contrast alpha for a whole layer (pcb_painter.cpp getColor): inactive
  // layers fade by m_hiContrastFactor (0.2) in dim mode and disappear in hide
  // mode; Edge.Cuts is clamped at 0.3 and survives even hide mode.
  const layerAlpha = (layer: string): number => {
    if (opts.contrastMode === 'normal' || layer === opts.activeLayer) return 1;
    if (layer === 'Edge.Cuts') return 0.3;
    return opts.contrastMode === 'dim' ? 0.2 : 0;
  };

  const paintZones = (layer: string, la: number) => (): void => {
    const b = scene.layers.get(layer);
    if (!b || !opts.zones || (!b.hasZones && !b.hasZoneOutlines)) return;
    const color = col(layer);
    if (b.hasZones) {
      ctx.globalAlpha = opts.zoneOpacity * la;
      if (opts.zoneOutline) {
        // PCB_ACTIONS::zoneDisplayOutline — sketch the fill outlines.
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.05 * MM;
        ctx.stroke(b.zones);
      } else {
        ctx.fillStyle = color;
        ctx.fill(b.zones, 'nonzero');
      }
    }
    // Zone boundary border: full opacity (color.WithAlpha(1.0)), min-pen width
    // (m_outlineWidth = 1 IU), drawn over the fill — the outline KiCad always
    // shows around a filled zone.
    if (b.hasZoneOutlines) {
      ctx.globalAlpha = la;
      ctx.strokeStyle = color;
      ctx.lineWidth = minPen;
      ctx.stroke(b.zoneOutlines);
    }
    ctx.globalAlpha = 1;
  };
  const paintCopper = (layer: string, la: number) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    const color = col(layer);
    if (b.hasGfxFill) {
      ctx.globalAlpha = opts.filledShapeOpacity * la;
      ctx.fillStyle = color;
      ctx.fill(b.gfxFill, 'nonzero');
    }
    ctx.globalAlpha = la;
    ctx.strokeStyle = color;
    strokeAll(ctx, b.gfxStrokes, minPen);
    if (opts.tracks && b.tracks.size > 0) {
      ctx.globalAlpha = opts.trackOpacity * la;
      if (opts.trackFill) {
        strokeAll(ctx, b.tracks, minPen);
      } else if (b.hasTrackOutlines) {
        // Sketch: outline each track at min-pen instead of filling it.
        ctx.lineWidth = minPen;
        ctx.stroke(b.trackOutlines);
      }
    }
    if (opts.pads && b.hasPads) {
      ctx.globalAlpha = opts.padOpacity * la;
      if (opts.padFill) {
        ctx.fillStyle = color;
        ctx.fill(b.pads, 'nonzero');
      } else {
        ctx.lineWidth = minPen;
        ctx.stroke(b.pads);
      }
    }
    if (opts.vias && b.hasVias) {
      ctx.globalAlpha = opts.viaOpacity * la;
      if (opts.viaFill) {
        ctx.fillStyle = color;
        ctx.fill(b.vias, 'nonzero');
      } else {
        ctx.lineWidth = minPen;
        ctx.stroke(b.vias);
      }
    }
    // Pad clearance outlines: thin (min-pen) stroke in the copper color, the
    // ring KiCad shows around every pad by default (m_Display.m_PadClearance).
    // Drawn translucent so it reads as the light "glass" ring GAL's anti-aliased
    // sub-pixel line gives, rather than a hard solid circle.
    if (opts.padClearance && b.hasClearance) {
      ctx.globalAlpha = 0.55 * la;
      ctx.strokeStyle = color;
      ctx.lineWidth = minPen;
      ctx.stroke(b.clearance);
    }
    ctx.globalAlpha = 1;
  };
  const paintText = (layer: string, la: number) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    ctx.globalAlpha = la;
    ctx.strokeStyle = col(layer);
    if (opts.fpReferences) strokeAll(ctx, b.textRef);
    if (opts.fpValues) strokeAll(ctx, b.textVal);
    if (opts.fpText) strokeAll(ctx, b.textFp);
    strokeAll(ctx, b.textBoard);
    ctx.globalAlpha = 1;
  };
  const pushLayer = (layer: string): void => {
    if (!visible.has(layer) || !scene.layers.has(layer)) return;
    const la = layerAlpha(layer);
    if (la <= 0) return;
    steps.push(paintZones(layer, la), paintCopper(layer, la), paintText(layer, la));
  };

  const fCuIndex = PCB_PAINT_ORDER.indexOf('F.Cu');
  for (let i = 0; i <= fCuIndex; i++) pushLayer(PCB_PAINT_ORDER[i]!);

  steps.push(() => {
    if (opts.pads) {
      ctx.fillStyle = sp(PCB_SPECIAL.padHoleWall);
      ctx.fill(scene.padHoleWalls);
      ctx.fillStyle = sp(PCB_SPECIAL.padPlatedHole);
      ctx.fill(scene.padHolesPlated);
    }
    if (opts.vias) {
      ctx.fillStyle = sp(PCB_SPECIAL.viaHoleWall);
      ctx.fill(scene.viaHoleWalls);
      ctx.fillStyle = sp(PCB_SPECIAL.viaHole);
      ctx.fill(scene.viaHoles);
    }
    if (opts.pads) {
      ctx.fillStyle = sp(PCB_SPECIAL.nonPlatedHole);
      ctx.fill(scene.padHolesNP);
    }
  });

  for (let i = fCuIndex + 1; i < PCB_PAINT_ORDER.length; i++) pushLayer(PCB_PAINT_ORDER[i]!);
  return steps;
}

/** Paint the compiled scene in one blocking pass (small boards / exports). */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  view: PcbViewTransform,
  visible: ReadonlySet<string>,
  widthPx: number,
  heightPx: number,
  opts: PcbDrawOptions = DEFAULT_DRAW_OPTIONS,
  sheet?: SheetInfo,
  overlay = false,
  brighten = 0,
): void {
  for (const step of buildDrawSteps(
    ctx,
    scene,
    view,
    visible,
    widthPx,
    heightPx,
    opts,
    sheet,
    overlay,
    brighten,
  ))
    step();
}

export { measureText };
