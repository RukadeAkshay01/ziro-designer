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

import {
  tessellateArc,
  type Board,
  type PcbPad,
  type PcbShape,
  type PcbTextItem,
  type Vec2,
} from '@ziroeda/core';
import { PCB_PAINT_ORDER, PCB_SPECIAL, layerColor, PCB_BACKGROUND } from './pcbTheme.js';
import { layoutText, measureText } from '../../common/strokeFont.js';

const MM = 10000; // IU per mm, matches core units

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
};

interface LayerBuckets {
  zones: Path2D;
  hasZones: boolean;
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
    else if (l.startsWith('*.')) out.push('F' + l.slice(1), 'B' + l.slice(1));
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
          const r = prim.end ? Math.hypot(prim.end.x - prim.center.x, prim.end.y - prim.center.y) : 0;
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
  const rad = (-t.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mir = t.mirror ? -1 : 1;
  const tilt = t.italic ? ITALIC_TILT : 0;
  const path = pathIn(map, thickness);
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const gx = (stroke[i]!.x - stroke[i]!.y * tilt + offX) * mir;
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

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number, pad = 0): void => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const t of board.tracks) {
    const p = pathIn(buckets(scene, t.layer).tracks, Math.max(t.width, 1));
    p.moveTo(t.start.x, t.start.y);
    p.lineTo(t.end.x, t.end.y);
    grow(t.start.x, t.start.y, t.width);
    grow(t.end.x, t.end.y, t.width);
  }
  for (const a of board.arcs) {
    const pts = tessellateArc(a.start, a.mid, a.end);
    const p = pathIn(buckets(scene, a.layer).tracks, Math.max(a.width, 1));
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
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
      }
      if (pad.drill && pad.type === 'thru_hole') {
        addHole(scene.padHoleWalls, pad, { ...pad.drill, w: pad.drill.w + 0.1 * MM, h: pad.drill.h + 0.1 * MM });
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

const addHole = (path: Path2D, pad: PcbPad, drill: { oblong: boolean; w: number; h: number; offset?: Vec2 }): void => {
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
  A5: [210, 148], A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
  A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
  USLetter: [279.4, 215.9], USLegal: [355.6, 215.9], USLedger: [431.8, 279.4],
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
  const L = M, T = M, R = page.w - M, B = page.h - M;
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
    ctx.moveTo(x, T); ctx.lineTo(x, T + i2);
    ctx.moveTo(x, B); ctx.lineTo(x, B - i2);
  }
  for (let y = T + step; y < B - i2; y += step) {
    ctx.moveTo(L, y); ctx.lineTo(L + i2, y);
    ctx.moveTo(R, y); ctx.lineTo(R - i2, y);
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
  for (const yy of [5.5, 8.5, 12.5, 18.5]) { ctx.moveTo(rx(110), ry(yy)); ctx.lineTo(rx(2), ry(yy)); }
  ctx.moveTo(rx(90), ry(8.5)); ctx.lineTo(rx(90), ry(5.5));
  ctx.moveTo(rx(26), ry(8.5)); ctx.lineTo(rx(26), ry(2));
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
): (() => void)[] {
  const steps: (() => void)[] = [];
  steps.push(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PCB_BACKGROUND;
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Drawing sheet (page frame + title block) behind the board, like pcbnew.
    if (sheet && opts.drawingSheet) drawDrawingSheet(ctx, sheet);
  });

  const minPen = view.scale > 0 ? 1 / view.scale : 0; // 1 device px in IU

  const paintZones = (layer: string) => (): void => {
    const b = scene.layers.get(layer);
    if (!b?.hasZones || !opts.zones) return;
    const color = layerColor(layer);
    ctx.globalAlpha = opts.zoneOpacity;
    if (opts.zoneOutline) {
      // PCB_ACTIONS::zoneDisplayOutline — sketch the fill outlines.
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.05 * MM;
      ctx.stroke(b.zones);
    } else {
      ctx.fillStyle = color;
      ctx.fill(b.zones, 'nonzero');
    }
    ctx.globalAlpha = 1;
  };
  const paintCopper = (layer: string) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    const color = layerColor(layer);
    if (b.hasGfxFill) {
      ctx.fillStyle = color;
      ctx.fill(b.gfxFill, 'nonzero');
    }
    ctx.strokeStyle = color;
    strokeAll(ctx, b.gfxStrokes, minPen);
    if (opts.tracks && b.tracks.size > 0) {
      ctx.globalAlpha = opts.trackOpacity;
      strokeAll(ctx, b.tracks, minPen);
      ctx.globalAlpha = 1;
    }
    if (opts.pads && b.hasPads) {
      ctx.globalAlpha = opts.padOpacity;
      ctx.fillStyle = color;
      ctx.fill(b.pads, 'nonzero');
      ctx.globalAlpha = 1;
    }
    if (opts.vias && b.hasVias) {
      ctx.globalAlpha = opts.viaOpacity;
      ctx.fillStyle = color;
      ctx.fill(b.vias, 'nonzero');
      ctx.globalAlpha = 1;
    }
  };
  const paintText = (layer: string) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    ctx.strokeStyle = layerColor(layer);
    if (opts.fpReferences) strokeAll(ctx, b.textRef);
    if (opts.fpValues) strokeAll(ctx, b.textVal);
    if (opts.fpText) strokeAll(ctx, b.textFp);
    strokeAll(ctx, b.textBoard);
  };
  const pushLayer = (layer: string): void => {
    if (!visible.has(layer) || !scene.layers.has(layer)) return;
    steps.push(paintZones(layer), paintCopper(layer), paintText(layer));
  };

  const fCuIndex = PCB_PAINT_ORDER.indexOf('F.Cu');
  for (let i = 0; i <= fCuIndex; i++) pushLayer(PCB_PAINT_ORDER[i]!);

  steps.push(() => {
    if (opts.pads) {
      ctx.fillStyle = PCB_SPECIAL.padHoleWall;
      ctx.fill(scene.padHoleWalls);
      ctx.fillStyle = PCB_SPECIAL.padPlatedHole;
      ctx.fill(scene.padHolesPlated);
    }
    if (opts.vias) {
      ctx.fillStyle = PCB_SPECIAL.viaHoleWall;
      ctx.fill(scene.viaHoleWalls);
      ctx.fillStyle = PCB_SPECIAL.viaHole;
      ctx.fill(scene.viaHoles);
    }
    if (opts.pads) {
      ctx.fillStyle = PCB_SPECIAL.nonPlatedHole;
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
): void {
  for (const step of buildDrawSteps(ctx, scene, view, visible, widthPx, heightPx, opts)) step();
}

export { measureText };
