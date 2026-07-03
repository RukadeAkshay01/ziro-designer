/**
 * Board renderer: PCB_PAINTER (pcbnew/pcb_painter.cpp) ported to Canvas 2D.
 *
 * Strategy: the whole board is compiled once into retained per-layer Path2D
 * buckets in internal units (zone fills, track strokes grouped by width, pad
 * and via flashes, graphic strokes/fills), then every frame just sets the view
 * transform and replays the buckets in GAL_LAYER_ORDER. This is what makes a
 * 20k-track board pan smoothly: the per-frame cost is a few hundred canvas
 * calls, not hundreds of thousands.
 *
 * Faithfulness notes (all from pcb_painter.cpp / pad.cpp):
 *  - vias and through-pads flash on every copper layer they span, in that
 *    layer's color (v9 padstack rendering; VIA_COPPER_LAYER_FOR/PAD_COPPER_…);
 *  - holes are drawn above all copper: hole walls in rgb(236,236,236), via
 *    holes in rgb(227,183,46), plated pad holes rgb(194,194,0), NPTH
 *    rgb(26,196,210) (s_defaultTheme);
 *  - roundrect corner radius = ratio · min(w,h) clamped to half
 *    (GetRoundRectCornerRadius), trapezoid corners per pad.cpp
 *    TransformShapeToPolygon, oval pads are stadium shapes;
 *  - zone fills sit directly under their layer's tracks (ZONE_LAYER_FOR).
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
import { layoutText, measureText } from '../render/strokeFont.js';

const MM = 10000; // IU per mm, matches core units

// KiCad object-opacity defaults (project_local_settings.cpp): tracks/vias/
// pads 1.0, zones 0.6 — the translucent planes are a big part of the pcbnew look.
const ZONE_OPACITY = 0.6;

interface LayerBuckets {
  zones: Path2D;
  hasZones: boolean;
  flash: Path2D; // filled copper: pads + via annuli + filled graphics
  hasFlash: boolean;
  strokes: Map<number, Path2D>; // width -> tracks/open graphics
}

export interface BoardScene {
  layers: Map<string, LayerBuckets>;
  viaHoles: Path2D;
  viaHoleWalls: Path2D;
  padHolesPlated: Path2D;
  padHoleWalls: Path2D;
  padHolesNP: Path2D;
  texts: PcbTextItem[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const buckets = (scene: BoardScene, layer: string): LayerBuckets => {
  let b = scene.layers.get(layer);
  if (!b) {
    b = { zones: new Path2D(), hasZones: false, flash: new Path2D(), hasFlash: false, strokes: new Map() };
    scene.layers.set(layer, b);
  }
  return b;
};

const strokePath = (b: LayerBuckets, width: number): Path2D => {
  let p = b.strokes.get(width);
  if (!p) {
    p = new Path2D();
    b.strokes.set(width, p);
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
function viaSpan(board: Board, from: string, to: string, copperNames: string[]): string[] {
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
  // Walk clockwise from top-left in y-down coords.
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
    const p = strokePath(b, width);
    p.moveTo(s.start.x, s.start.y);
    p.lineTo(s.end.x, s.end.y);
  } else if (s.kind === 'rect' && s.start && s.end) {
    const x = Math.min(s.start.x, s.end.x);
    const y = Math.min(s.start.y, s.end.y);
    const rw = Math.abs(s.end.x - s.start.x);
    const rh = Math.abs(s.end.y - s.start.y);
    if (s.fill) {
      b.flash.rect(x, y, rw, rh);
      b.hasFlash = true;
    }
    strokePath(b, width).rect(x, y, rw, rh);
  } else if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    if (r <= 0) return;
    if (s.fill) {
      b.flash.moveTo(s.center.x + r, s.center.y);
      b.flash.arc(s.center.x, s.center.y, r, 0, Math.PI * 2);
      b.hasFlash = true;
    }
    const p = strokePath(b, width);
    p.moveTo(s.center.x + r, s.center.y);
    p.arc(s.center.x, s.center.y, r, 0, Math.PI * 2);
  } else if (s.kind === 'arc' && s.start && s.mid && s.end) {
    const pts = tessellateArc(s.start, s.mid, s.end);
    const p = strokePath(b, width);
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
  } else if ((s.kind === 'poly' || s.kind === 'curve') && s.pts && s.pts.length >= 2) {
    if (s.fill && s.pts.length >= 3) {
      b.flash.moveTo(s.pts[0]!.x, s.pts[0]!.y);
      for (let i = 1; i < s.pts.length; i++) b.flash.lineTo(s.pts[i]!.x, s.pts[i]!.y);
      b.flash.closePath();
      b.hasFlash = true;
    }
    const p = strokePath(b, width);
    p.moveTo(s.pts[0]!.x, s.pts[0]!.y);
    for (let i = 1; i < s.pts.length; i++) p.lineTo(s.pts[i]!.x, s.pts[i]!.y);
    if (s.fill) p.closePath();
  }
}

/** Compile the board into retained per-layer paths. */
export function buildScene(board: Board): BoardScene {
  const scene: BoardScene = {
    layers: new Map(),
    viaHoles: new Path2D(),
    viaHoleWalls: new Path2D(),
    padHolesPlated: new Path2D(),
    padHoleWalls: new Path2D(),
    padHolesNP: new Path2D(),
    texts: [],
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
    const p = strokePath(buckets(scene, t.layer), Math.max(t.width, 1));
    p.moveTo(t.start.x, t.start.y);
    p.lineTo(t.end.x, t.end.y);
    grow(t.start.x, t.start.y, t.width);
    grow(t.end.x, t.end.y, t.width);
  }
  for (const a of board.arcs) {
    const pts = tessellateArc(a.start, a.mid, a.end);
    const p = strokePath(buckets(scene, a.layer), Math.max(a.width, 1));
    p.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]!.x, pts[i]!.y);
    grow(a.start.x, a.start.y, a.width);
    grow(a.end.x, a.end.y, a.width);
  }
  for (const v of board.vias) {
    const r = v.size / 2;
    for (const layer of viaSpan(board, v.layers[0], v.layers[1], copperNames)) {
      const b = buckets(scene, layer);
      b.flash.moveTo(v.at.x + r, v.at.y);
      b.flash.arc(v.at.x, v.at.y, r, 0, Math.PI * 2);
      b.hasFlash = true;
    }
    const hr = v.drill / 2;
    // Hole wall ring ≈ hole + plating (visual match for pcb_painter's wall pass).
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
    for (const s of fp.shapes) addShape(scene, s);
    for (const t of fp.texts) if (!t.hide) addText(scene, t);
    for (const pad of fp.pads) {
      if (pad.type === 'np_thru_hole') {
        // Painter draws NPTH as its hole in LAYER_NON_PLATEDHOLES.
        if (pad.drill) addHole(scene.padHolesNP, pad, pad.drill);
        continue;
      }
      const flashLayers = expandLayers(pad.layers, copperNames);
      for (const layer of flashLayers) {
        const b = scene.layers.get(layer) ?? buckets(scene, layer);
        addPadShape(b.flash, pad);
        b.hasFlash = true;
      }
      if (pad.drill && pad.type === 'thru_hole') {
        addHole(scene.padHoleWalls, pad, { ...pad.drill, w: pad.drill.w + 0.1 * MM, h: pad.drill.h + 0.1 * MM });
        addHole(scene.padHolesPlated, pad, pad.drill);
      }
      grow(pad.at.x, pad.at.y, Math.max(pad.size.x, pad.size.y) / 2);
    }
    grow(fp.at.x, fp.at.y);
  }
  for (const t of board.texts) if (!t.hide) addText(scene, t);

  scene.bbox = minX < maxX ? { minX, minY, maxX, maxY } : null;
  return scene;
}

function addText(scene: BoardScene, t: PcbTextItem): void {
  const size = t.size.y;
  if (size <= 0 || t.text === '') return;
  const { strokes, width } = layoutText(t.text, size);
  const thickness = Math.max(t.thickness ?? Math.round(size * 0.15), 1);
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
  const path = strokePath(buckets(scene, t.layer), thickness);
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const gx = (stroke[i]!.x + offX) * mir;
      const gy = stroke[i]!.y + offY;
      const x = t.at.x + gx * cos - gy * sin;
      const y = t.at.y + gx * sin + gy * cos;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      if (stroke.length === 1) path.lineTo(x + 1, y);
    }
  }
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
  showHoles = true,
): (() => void)[] {
  const steps: (() => void)[] = [];
  steps.push(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PCB_BACKGROUND;
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  });

  const paintZones = (layer: string) => (): void => {
    const b = scene.layers.get(layer);
    if (!b?.hasZones) return;
    ctx.fillStyle = layerColor(layer);
    ctx.globalAlpha = ZONE_OPACITY;
    ctx.fill(b.zones, 'nonzero');
    ctx.globalAlpha = 1;
  };
  const paintCopper = (layer: string) => (): void => {
    const b = scene.layers.get(layer);
    if (!b) return;
    const color = layerColor(layer);
    if (b.hasFlash) {
      ctx.fillStyle = color;
      ctx.fill(b.flash, 'nonzero');
    }
    ctx.strokeStyle = color;
    for (const [width, path] of b.strokes) {
      ctx.lineWidth = width;
      ctx.stroke(path);
    }
  };
  const pushLayer = (layer: string): void => {
    if (!visible.has(layer) || !scene.layers.has(layer)) return;
    steps.push(paintZones(layer), paintCopper(layer));
  };

  const fCuIndex = PCB_PAINT_ORDER.indexOf('F.Cu');
  for (let i = 0; i <= fCuIndex; i++) pushLayer(PCB_PAINT_ORDER[i]!);

  if (showHoles) {
    steps.push(() => {
      ctx.fillStyle = PCB_SPECIAL.padHoleWall;
      ctx.fill(scene.padHoleWalls);
      ctx.fillStyle = PCB_SPECIAL.padPlatedHole;
      ctx.fill(scene.padHolesPlated);
      ctx.fillStyle = PCB_SPECIAL.viaHoleWall;
      ctx.fill(scene.viaHoleWalls);
      ctx.fillStyle = PCB_SPECIAL.viaHole;
      ctx.fill(scene.viaHoles);
      ctx.fillStyle = PCB_SPECIAL.nonPlatedHole;
      ctx.fill(scene.padHolesNP);
    });
  }

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
  showHoles = true,
): void {
  for (const step of buildDrawSteps(ctx, scene, view, visible, widthPx, heightPx, showHoles)) step();
}

export { measureText };
