/**
 * Drag-box (marquee) selection, ported from KiCad's
 * SCH_SELECTION_TOOL::selectMultiple / SelectMultiple (sch_selection_tool.cpp):
 *
 *  - dragging left-to-right selects items *fully enclosed* by the rectangle
 *    (SELECTION_MODE::INSIDE_RECTANGLE — the "window" select),
 *  - dragging right-to-left is greedy and selects everything the rectangle
 *    *touches* (SELECTION_MODE::TOUCHING_RECTANGLE).
 *
 * Per-item hit rules are the item's HitTest(BOX2I, aContained) overloads:
 *  - SCH_SYMBOL: the body bounding box (fields excluded) — contained needs the
 *    whole body inside, touching needs an intersect (sch_symbol.cpp).
 *  - SCH_LINE: contained needs *both endpoints* inside; touching needs the
 *    rectangle to intersect the segment (sch_line.cpp). KiCad can additionally
 *    grab a single dangling endpoint for a partial drag; ZiroEDA moves whole
 *    lines (rubber-banding handles the connections), so that partial case
 *    selects the whole line here.
 *  - SCH_JUNCTION: contained needs the dot's box inside; touching collides the
 *    dot circle with the rectangle (sch_junction.cpp).
 *  - labels/text: their text bounding box.
 */

import type { Schematic, LibSymbol, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { symbolBodyBBox, labelBox, type BBox } from './bbox.js';

const boxContains = (r: BBox, b: BBox): boolean =>
  b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY;

const boxIntersects = (r: BBox, b: BBox): boolean =>
  b.maxX >= r.minX && b.minX <= r.maxX && b.maxY >= r.minY && b.minY <= r.maxY;

const containsPt = (r: BBox, p: Vec2): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** BOX2::Intersects(seg): does the rectangle touch segment a-b anywhere? */
function segmentIntersectsBox(r: BBox, a: Vec2, b: Vec2): boolean {
  if (containsPt(r, a) || containsPt(r, b)) return true;
  // Test the segment against each rectangle edge.
  const edges: [Vec2, Vec2][] = [
    [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
    ],
    [
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
    ],
    [
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ],
    [
      { x: r.minX, y: r.maxY },
      { x: r.minX, y: r.minY },
    ],
  ];
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const segsIntersect = (p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean => {
    const d1 = cross(p3, p4, p1),
      d2 = cross(p3, p4, p2),
      d3 = cross(p1, p2, p3),
      d4 = cross(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
      return true;
    const onSeg = (o: Vec2, p: Vec2, q: Vec2): boolean =>
      cross(o, p, q) === 0 &&
      Math.min(o.x, p.x) <= q.x &&
      q.x <= Math.max(o.x, p.x) &&
      Math.min(o.y, p.y) <= q.y &&
      q.y <= Math.max(o.y, p.y);
    return onSeg(p3, p4, p1) || onSeg(p3, p4, p2) || onSeg(p1, p2, p3) || onSeg(p1, p2, p4);
  };
  return edges.some(([e1, e2]) => segsIntersect(a, b, e1, e2));
}

/** SHAPE_RECT vs SHAPE_CIRCLE collide (junction dot in touching mode). */
function circleIntersectsBox(r: BBox, c: Vec2, radius: number): boolean {
  const nx = Math.max(r.minX, Math.min(c.x, r.maxX));
  const ny = Math.max(r.minY, Math.min(c.y, r.maxY));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 <= radius * radius;
}

/**
 * Items selected by a drag from `origin` to `end` in world coordinates.
 * Contained ("window") mode is chosen exactly as KiCad does: the drag ran
 * left-to-right (`end.x >= origin.x`); right-to-left drags are greedy/touching.
 */
export function boxSelect(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  origin: Vec2,
  end: Vec2,
): Set<string> {
  const contained = end.x >= origin.x;
  const rect: BBox = {
    minX: Math.min(origin.x, end.x),
    minY: Math.min(origin.y, end.y),
    maxX: Math.max(origin.x, end.x),
    maxY: Math.max(origin.y, end.y),
  };
  const ids = new Set<string>();

  sch.symbols.forEach((s, i) => {
    const body = symbolBodyBBox(s, libById.get(s.libId));
    if (contained ? boxContains(rect, body) : boxIntersects(rect, body))
      ids.add(refId('symbol', s.uuid, i));
  });

  sch.lines.forEach((l, i) => {
    const hit = contained
      ? containsPt(rect, l.start) && containsPt(rect, l.end)
      : segmentIntersectsBox(rect, l.start, l.end);
    if (hit) ids.add(refId('line', l.uuid, i));
  });

  sch.junctions.forEach((j, i) => {
    const r = (j.diameter > 0 ? j.diameter : 9000) / 2;
    const dot: BBox = { minX: j.at.x - r, minY: j.at.y - r, maxX: j.at.x + r, maxY: j.at.y + r };
    if (contained ? boxContains(rect, dot) : circleIntersectsBox(rect, j.at, r))
      ids.add(refId('junction', j.uuid, i));
  });

  sch.noConnects.forEach((nc, i) => {
    const half = 6096; // DEFAULT_NOCONNECT_SIZE/2 (24 mil)
    const box: BBox = {
      minX: nc.at.x - half,
      minY: nc.at.y - half,
      maxX: nc.at.x + half,
      maxY: nc.at.y + half,
    };
    if (contained ? boxContains(rect, box) : boxIntersects(rect, box))
      ids.add(refId('noconnect', nc.uuid, i));
  });

  sch.labels.forEach((l, i) => {
    const box = labelBox(l);
    if (contained ? boxContains(rect, box) : boxIntersects(rect, box))
      ids.add(refId('label', l.uuid, i));
  });

  sch.sheets.forEach((s, i) => {
    const box: BBox = {
      minX: s.at.x,
      minY: s.at.y,
      maxX: s.at.x + s.size.w,
      maxY: s.at.y + s.size.h,
    };
    if (contained ? boxContains(rect, box) : boxIntersects(rect, box))
      ids.add(refId('sheet', s.uuid, i));
  });

  sch.textBoxes.forEach((tb, i) => {
    const box: BBox = {
      minX: Math.min(tb.start.x, tb.end.x),
      minY: Math.min(tb.start.y, tb.end.y),
      maxX: Math.max(tb.start.x, tb.end.x),
      maxY: Math.max(tb.start.y, tb.end.y),
    };
    if (contained ? boxContains(rect, box) : boxIntersects(rect, box))
      ids.add(refId('textbox', tb.uuid, i));
  });

  return ids;
}

// ----- lasso (freehand polygon) selection -----------------------------------
//
// KiCad's SCH_SELECTION_TOOL::selectLasso: a closed polygon traced by the
// pointer. The default mode is TOUCHING_LASSO — an item is selected if the
// polygon contains it or its outline crosses it. (KiCad additionally flips to
// INSIDE_LASSO when the trace winds clockwise; ZiroEDA uses touching, the more
// forgiving and common behaviour.)

/** Ray-cast point-in-polygon test (even-odd rule). */
function pointInPoly(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Do segments p1-p2 and p3-p4 intersect (including collinear overlap)? */
function segsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(p3, p4, p1),
    d2 = cross(p3, p4, p2),
    d3 = cross(p1, p2, p3),
    d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const onSeg = (o: Vec2, p: Vec2, q: Vec2): boolean =>
    cross(o, p, q) === 0 &&
    Math.min(o.x, p.x) <= q.x &&
    q.x <= Math.max(o.x, p.x) &&
    Math.min(o.y, p.y) <= q.y &&
    q.y <= Math.max(o.y, p.y);
  return onSeg(p3, p4, p1) || onSeg(p3, p4, p2) || onSeg(p1, p2, p3) || onSeg(p1, p2, p4);
}

/** Does the polygon touch (contain or cross) segment a-b? */
function polyTouchesSeg(poly: readonly Vec2[], a: Vec2, b: Vec2): boolean {
  if (pointInPoly(poly, a) || pointInPoly(poly, b)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segsIntersect(a, b, poly[j]!, poly[i]!)) return true;
  }
  return false;
}

/** Does the polygon touch (contain or cross) axis-aligned box `box`? */
function polyTouchesBox(poly: readonly Vec2[], box: BBox): boolean {
  const corners: Vec2[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  if (corners.some((c) => pointInPoly(poly, c))) return true;
  if (poly.some((v) => containsPt(box, v))) return true;
  for (let e = 0; e < 4; e++) {
    const a = corners[e]!,
      b = corners[(e + 1) % 4]!;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segsIntersect(a, b, poly[j]!, poly[i]!)) return true;
    }
  }
  return false;
}

/**
 * Items the lasso `polygon` (world coordinates, auto-closed) selects, using
 * KiCad's touching semantics: the polygon contains the item or crosses it.
 */
export function lassoSelect(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  polygon: readonly Vec2[],
): Set<string> {
  const ids = new Set<string>();
  if (polygon.length < 3) return ids;

  sch.symbols.forEach((s, i) => {
    if (polyTouchesBox(polygon, symbolBodyBBox(s, libById.get(s.libId))))
      ids.add(refId('symbol', s.uuid, i));
  });
  sch.lines.forEach((l, i) => {
    if (polyTouchesSeg(polygon, l.start, l.end)) ids.add(refId('line', l.uuid, i));
  });
  sch.junctions.forEach((j, i) => {
    if (pointInPoly(polygon, j.at)) ids.add(refId('junction', j.uuid, i));
  });
  sch.noConnects.forEach((nc, i) => {
    if (pointInPoly(polygon, nc.at)) ids.add(refId('noconnect', nc.uuid, i));
  });
  sch.labels.forEach((l, i) => {
    if (polyTouchesBox(polygon, labelBox(l))) ids.add(refId('label', l.uuid, i));
  });
  sch.busEntries.forEach((be, i) => {
    if (polyTouchesSeg(polygon, be.at, { x: be.at.x + be.size.x, y: be.at.y + be.size.y }))
      ids.add(refId('busentry', be.uuid, i));
  });
  sch.sheets.forEach((s, i) => {
    const box: BBox = {
      minX: s.at.x,
      minY: s.at.y,
      maxX: s.at.x + s.size.w,
      maxY: s.at.y + s.size.h,
    };
    if (polyTouchesBox(polygon, box)) ids.add(refId('sheet', s.uuid, i));
  });
  sch.textBoxes.forEach((tb, i) => {
    const box: BBox = {
      minX: Math.min(tb.start.x, tb.end.x),
      minY: Math.min(tb.start.y, tb.end.y),
      maxX: Math.max(tb.start.x, tb.end.x),
      maxY: Math.max(tb.start.y, tb.end.y),
    };
    if (polyTouchesBox(polygon, box)) ids.add(refId('textbox', tb.uuid, i));
  });

  return ids;
}
