/**
 * Per-layer board GEOMETRY for the 3D viewer — the KiCad approach
 * (create_scene.cpp): every copper/silk/pad shape becomes real triangles, so
 * the board stays razor-sharp at any zoom or angle (unlike a baked texture).
 *
 * Each primitive is turned into a filled polygon (tracks/silk lines → stadiums,
 * pads → their shape, vias → discs, zones → their fill polygons), triangulated
 * with earcut, and returned in the viewer's centred 3D frame (mm; X centred, Y
 * flipped) so pcb3d.ts can extrude/stack it. Text is handled separately.
 */
import earcut from 'earcut';
import { tessellateArc, type Board } from '@ziroeda/core';
import { layoutText } from '../../common/strokeFont.js';

const MM = 10000;
const ITALIC_TILT = 1 / 8;
type Pt = { x: number; y: number };
type Vec2 = { x: number; y: number };
type Pad = Board['footprints'][number]['pads'][number];
type Text = Board['texts'][number];

export interface Mesh { verts: Pt[]; tris: number[] }
export interface SideGeom { copper: Mesh; pads: Mesh; silk: Mesh }
export interface BoardGeom { front: SideGeom; back: SideGeom }

interface Box { minX: number; minY: number; maxX: number; maxY: number }

const newMesh = (): Mesh => ({ verts: [], tris: [] });

// Triangulate one simple polygon loop and append it to a mesh.
function addPoly(mesh: Mesh, loop: Pt[]): void {
  if (loop.length < 3) return;
  const flat: number[] = [];
  for (const p of loop) flat.push(p.x, p.y);
  const t = earcut(flat);
  const base = mesh.verts.length;
  for (const p of loop) mesh.verts.push(p);
  for (const i of t) mesh.tris.push(base + i);
}

// Circle / disc outline.
function disc(cx: number, cy: number, r: number): Pt[] {
  const n = Math.max(10, Math.min(64, Math.round((r / MM) * 24)));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return pts;
}

// Thick segment with round caps (a track / silk line / oval pad).
function stadium(a: Vec2, b: Vec2, width: number): Pt[] {
  const r = width / 2;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const seg = Math.max(4, Math.min(24, Math.round((r / MM) * 16)));
  const pts: Pt[] = [];
  const arc = (cx: number, cy: number, from: number, to: number): void => {
    for (let i = 0; i <= seg; i++) { const t = from + (to - from) * (i / seg); pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }); }
  };
  arc(b.x, b.y, ang - Math.PI / 2, ang + Math.PI / 2);
  arc(a.x, a.y, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
  return pts;
}

/** Pad outline (board-absolute IU), by shape. */
function padPoly(pad: Pad): Pt[] {
  const w = pad.size.x, h = pad.size.y;
  const a = (pad.angle * Math.PI) / 180;
  const cx = pad.at.x, cy = pad.at.y;
  const rot = (lx: number, ly: number): Pt => ({ x: cx + lx * Math.cos(a) - ly * Math.sin(a), y: cy + lx * Math.sin(a) + ly * Math.cos(a) });
  const rect = (): Pt[] => [rot(-w / 2, -h / 2), rot(w / 2, -h / 2), rot(w / 2, h / 2), rot(-w / 2, h / 2)];
  switch (pad.shape) {
    case 'circle': return disc(cx, cy, w / 2);
    case 'rect': return rect();
    case 'oval': {
      if (w >= h) { const d = (w - h) / 2; return stadium(rot(-d, 0), rot(d, 0), h); }
      const d = (h - w) / 2; return stadium(rot(0, -d), rot(0, d), w);
    }
    case 'roundrect': {
      const r = Math.min((pad.roundrectRatio ?? 0.25) * Math.min(w, h), Math.min(w, h) / 2);
      const hw = w / 2 - r, hh = h / 2 - r, seg = 5;
      const pts: Pt[] = [];
      const corner = (ox: number, oy: number, from: number): void => {
        for (let i = 0; i <= seg; i++) { const t = from + (Math.PI / 2) * (i / seg); pts.push(rot(ox + r * Math.cos(t), oy + r * Math.sin(t))); }
      };
      corner(hw, hh, 0); corner(-hw, hh, Math.PI / 2); corner(-hw, -hh, Math.PI); corner(hw, -hh, (3 * Math.PI) / 2);
      return pts;
    }
    default: return rect(); // trapezoid / custom → bounding rect (good enough here)
  }
}

export interface Hole { x: number; y: number; r: number }

/** Drilled holes (vias + through-hole pads) as centre+radius, centred 3D frame. */
export function boardHoles(board: Board, box: Box): Hole[] {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const out: Hole[] = [];
  for (const v of board.vias) out.push({ x: (v.at.x - cx) / MM, y: -(v.at.y - cy) / MM, r: v.drill / 2 / MM });
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!pad.drill) continue;
      const r = Math.min(pad.drill.w, pad.drill.h) / 2 / MM; // oblong → its narrow radius
      out.push({ x: (pad.at.x - cx) / MM, y: -(pad.at.y - cy) / MM, r });
    }
  }
  return out;
}

/** Build triangulated per-layer meshes (centred 3D frame, mm). */
export function buildBoardGeom(board: Board, box: Box): BoardGeom {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const to3d = (p: Vec2): Pt => ({ x: (p.x - cx) / MM, y: -(p.y - cy) / MM });
  const poly3d = (mesh: Mesh, loopIU: Pt[]): void => addPoly(mesh, loopIU.map(to3d));
  // Same, but with a hole (drill) cut out of the polygon (earcut with a ring).
  const poly3dHole = (mesh: Mesh, outerIU: Pt[], holeIU: Pt[]): void => {
    const outer = outerIU.map(to3d), hole = holeIU.map(to3d);
    if (outer.length < 3 || hole.length < 3) { addPoly(mesh, outer); return; }
    const flat: number[] = [];
    for (const p of outer) flat.push(p.x, p.y);
    const holeStart = outer.length;
    for (const p of hole) flat.push(p.x, p.y);
    const t = earcut(flat, [holeStart]);
    const base = mesh.verts.length;
    for (const p of outer) mesh.verts.push(p);
    for (const p of hole) mesh.verts.push(p);
    for (const i of t) mesh.tris.push(base + i);
  };

  const front: SideGeom = { copper: newMesh(), pads: newMesh(), silk: newMesh() };
  const back: SideGeom = { copper: newMesh(), pads: newMesh(), silk: newMesh() };
  const side = (layer: string): SideGeom | null => (layer === 'F.Cu' ? front : layer === 'B.Cu' ? back : null);
  const silkSide = (layer: string): SideGeom | null => (layer === 'F.SilkS' ? front : layer === 'B.SilkS' ? back : null);

  // Tracks (segments) and arc tracks → copper stadiums.
  for (const t of board.tracks) { const s = side(t.layer); if (s) poly3d(s.copper, stadium(t.start, t.end, t.width)); }
  for (const a of board.arcs) {
    const s = side(a.layer); if (!s) continue;
    const pline = tessellateArc(a.start, a.mid, a.end);
    for (let i = 0; i + 1 < pline.length; i++) poly3d(s.copper, stadium(pline[i]!, pline[i + 1]!, a.width));
  }
  // Zone fills → copper polygons.
  for (const z of board.zones) for (const f of z.fills) { const s = side(f.layer); if (s) for (const poly of f.polys) poly3d(s.copper, poly); }
  // Vias → copper annulus (drill cut out) on both sides.
  for (const v of board.vias) {
    const ring = disc(v.at.x, v.at.y, v.size / 2), hole = disc(v.at.x, v.at.y, v.drill / 2);
    poly3dHole(front.copper, ring, hole);
    poly3dHole(back.copper, ring, hole);
  }

  // Pads → exposed copper (gold at mask openings), on whichever copper side(s).
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const loop = padPoly(pad);
      // Through-hole pads: cut the drill so the pad ring is see-through.
      const drill = pad.drill ? disc(pad.at.x, pad.at.y, Math.min(pad.drill.w, pad.drill.h) / 2) : null;
      const add = (mesh: Mesh): void => (drill ? poly3dHole(mesh, loop, drill) : poly3d(mesh, loop));
      if (pad.layers.some((l) => l === 'F.Cu' || l === '*.Cu' || l === 'F&B.Cu')) add(front.pads);
      if (pad.layers.some((l) => l === 'B.Cu' || l === '*.Cu' || l === 'F&B.Cu')) add(back.pads);
    }
    // Silk graphics (lines/arcs/rects) on the footprint.
    for (const sh of fp.shapes) addSilk(sh, silkSide(sh.layer), poly3d);
  }
  for (const sh of board.shapes) addSilk(sh, silkSide(sh.layer), poly3d);

  // Text as stroke geometry — reference designators/values on silk, plus text
  // on copper (e.g. a board name on F.Cu/B.Cu) into the copper mesh so it reads
  // like KiCad. Mirrors renderBoard.addText's placement transform.
  const textMesh = (layer: string): Mesh | null =>
    layer === 'F.SilkS' ? front.silk
    : layer === 'B.SilkS' ? back.silk
    : layer === 'F.Cu' ? front.copper
    : layer === 'B.Cu' ? back.copper
    : null;
  for (const t of board.texts) addText(t, textMesh(t.layer), poly3d);
  for (const fp of board.footprints) for (const t of fp.texts) addText(t, textMesh(t.layer), poly3d);

  return { front, back };
}

// One text item → stroke-font geometry (thin filled strokes) into `mesh`.
function addText(t: Text, mesh: Mesh | null, poly3d: (mesh: Mesh, loop: Pt[]) => void): void {
  if (!mesh || t.hide || !t.text || t.size.y <= 0) return;
  const size = t.size.y;
  const { strokes, width } = layoutText(t.text, size);
  const raw = t.thickness && t.thickness > 1 ? t.thickness : (t.bold ? size / 5 : size / 8);
  const pen = Math.max(Math.min(raw, size * 0.2), size * 0.08); // visible stroke
  const j = t.justify ?? [];
  const offX = j.includes('left') ? 0 : j.includes('right') ? -width : -width / 2;
  const offY = j.includes('top') ? size : j.includes('bottom') ? 0 : size / 2;
  // Keep footprint reference/value text upright, never upside down — KiCad's
  // PCB_TEXT::GetDrawRotation (keep angle in ]-90..90]).
  let ang = t.angle;
  if (t.kind === 'reference' || t.kind === 'value') {
    while (ang > 90) ang -= 180;
    while (ang <= -90) ang += 180;
  }
  const rad = (-ang * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const mir = t.mirror ? -1 : 1, tilt = t.italic ? ITALIC_TILT : 0;
  // KiCad scales glyphs by (width, height) separately (eda_text.cpp writes
  // "(size height width)"); layoutText used height for both, so condense x by
  // width/height — otherwise non-square text (a condensed board name) is too
  // wide and runs off the board.
  const sx = size > 0 ? t.size.x / size : 1;
  const world = (p: Vec2): Pt => {
    const gx = ((p.x + offX) * sx - p.y * tilt) * mir, gy = p.y + offY;
    return { x: t.at.x + gx * cos - gy * sin, y: t.at.y + gx * sin + gy * cos };
  };
  for (const stroke of strokes) {
    for (let i = 0; i + 1 < stroke.length; i++) poly3d(mesh, stadium(world(stroke[i]!), world(stroke[i + 1]!), pen));
    if (stroke.length === 1) { const w = world(stroke[0]!); poly3d(mesh, stadium(w, { x: w.x + 1, y: w.y }, pen)); }
  }
}

// One silkscreen graphic → thin filled geometry.
function addSilk(
  sh: Board['shapes'][number],
  s: SideGeom | null,
  poly3d: (mesh: Mesh, loop: Pt[]) => void,
): void {
  if (!s) return;
  const w = sh.width || 1500; // default ~0.15 mm
  if (sh.kind === 'line' && sh.start && sh.end) poly3d(s.silk, stadium(sh.start, sh.end, w));
  else if (sh.kind === 'arc' && sh.start && sh.mid && sh.end) {
    const p = tessellateArc(sh.start, sh.mid, sh.end);
    for (let i = 0; i + 1 < p.length; i++) poly3d(s.silk, stadium(p[i]!, p[i + 1]!, w));
  } else if (sh.kind === 'rect' && sh.start && sh.end) {
    const a = sh.start, b = sh.end;
    const c = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    for (let i = 0; i < 4; i++) poly3d(s.silk, stadium(c[i]!, c[(i + 1) % 4]!, w));
  } else if (sh.kind === 'circle' && sh.center && sh.end) {
    const r = Math.hypot(sh.end.x - sh.center.x, sh.end.y - sh.center.y);
    const n = 48, pts: Pt[] = [];
    for (let i = 0; i < n; i++) { const ang = (2 * Math.PI * i) / n; pts.push({ x: sh.center.x + r * Math.cos(ang), y: sh.center.y + r * Math.sin(ang) }); }
    for (let i = 0; i < n; i++) poly3d(s.silk, stadium(pts[i]!, pts[(i + 1) % n]!, w));
  }
}
