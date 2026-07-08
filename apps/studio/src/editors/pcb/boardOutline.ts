/**
 * Board outline geometry for the 3D viewer: chain the Edge.Cuts graphics into
 * closed loops (KiCad's BOARD::GetBoardPolygonOutlines), tessellate arcs/circles,
 * and triangulate the resulting polygon-with-holes so the 3D board is the real
 * board shape (with cutouts) instead of a bounding rectangle.
 *
 * Output is in millimetres, already in the viewer's centred 3D frame: X centred
 * on the board, Y flipped (KiCad Y is down, GL Y is up).
 */
import earcut from 'earcut';
import { tessellateArc, type Board, type Vec2 } from '@ziroeda/core';

const MM = 10000; // internal units per millimetre

export interface Pt { x: number; y: number }

export interface BoardOutline {
  /** Closed loops (mm, centred 3D frame). loops[0] = outer, the rest are holes. */
  loops: Pt[][];
  /** Triangulated top-face vertices (mm, centred 3D frame). */
  verts: Pt[];
  /** Triangle indices into `verts`. */
  tris: number[];
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// Sample a full circle (board outline or circular cutout) into a polygon.
function circleLoop(center: Vec2, radius: number): Vec2[] {
  const n = Math.max(24, Math.min(160, Math.round((radius / MM) * 12)));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

// Rect (two opposite corners) -> 4-corner loop.
function rectLoop(a: Vec2, b: Vec2): Vec2[] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

// Signed area (shoelace) — sign gives winding, magnitude ranks outer vs holes.
function signedArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Chain open polylines (line/arc segments) into closed loops by matching
 * endpoints within `tol` (KiCad's ConnectBoardShapes / close-enough join).
 */
function chainLoops(polys: Vec2[][], tol: number): Vec2[][] {
  const near = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  const remaining = polys.filter((p) => p.length >= 2).map((p) => p.slice());
  const loops: Vec2[][] = [];

  while (remaining.length) {
    let cur = remaining.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      const head = cur[0]!;
      const tail = cur[cur.length - 1]!;
      if (cur.length >= 3 && near(head, tail)) break; // already closed
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i]!;
        const s = seg[0]!;
        const e = seg[seg.length - 1]!;
        if (near(tail, s)) cur = cur.concat(seg.slice(1));
        else if (near(tail, e)) cur = cur.concat(seg.slice(0, -1).reverse());
        else if (near(head, e)) cur = seg.slice(0, -1).concat(cur);
        else if (near(head, s)) cur = seg.slice(1).reverse().concat(cur);
        else continue;
        remaining.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 3) {
      if (near(cur[0]!, cur[cur.length - 1]!)) cur = cur.slice(0, -1); // drop duplicate close point
      loops.push(cur);
    }
  }
  return loops;
}

/** Build the triangulated board outline (mm, centred 3D frame). */
export function buildBoardOutline(board: Board, box: Box): BoardOutline {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const to3d = (p: Vec2): Pt => ({ x: (p.x - cx) / MM, y: -(p.y - cy) / MM });

  const shapes = [...board.shapes, ...board.footprints.flatMap((f) => f.shapes)].filter(
    (s) => s.layer === 'Edge.Cuts',
  );

  const closed: Vec2[][] = []; // circle/rect/poly are loops already
  const open: Vec2[][] = [];   // line/arc/curve are polylines to chain
  for (const s of shapes) {
    switch (s.kind) {
      case 'line': if (s.start && s.end) open.push([s.start, s.end]); break;
      case 'arc': if (s.start && s.mid && s.end) open.push(tessellateArc(s.start, s.mid, s.end)); break;
      case 'curve': if (s.start && s.end) open.push([s.start, ...(s.pts ?? []), s.end]); break;
      case 'circle': if (s.center && s.end) closed.push(circleLoop(s.center, dist(s.center, s.end))); break;
      case 'rect': if (s.start && s.end) closed.push(rectLoop(s.start, s.end)); break;
      case 'poly': if (s.pts && s.pts.length >= 3) closed.push(s.pts); break;
    }
  }

  const loopsIU = [...closed, ...chainLoops(open, MM * 0.02)].filter((l) => l.length >= 3);
  // No usable Edge.Cuts (or it failed to close): fall back to the bounding rect.
  if (loopsIU.length === 0) {
    loopsIU.push(rectLoop({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }));
  }

  // Largest-area loop is the outer boundary; the rest are cutouts.
  const loops = loopsIU.map((l) => l.map(to3d)).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const outer = loops[0]!;
  const holes = loops.slice(1);

  // Triangulate outer + holes (earcut's flat coords + hole start indices).
  const flat: number[] = [];
  const holeIdx: number[] = [];
  for (const p of outer) flat.push(p.x, p.y);
  for (const h of holes) {
    holeIdx.push(flat.length / 2);
    for (const p of h) flat.push(p.x, p.y);
  }
  const tris = earcut(flat, holeIdx.length ? holeIdx : undefined);
  const verts: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) verts.push({ x: flat[i]!, y: flat[i + 1]! });

  return { loops, verts, tris };
}
