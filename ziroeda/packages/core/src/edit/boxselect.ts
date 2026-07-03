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

import type { Schematic, LibSymbol, Vec2 } from '../model/types.js';
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
    [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }],
    [{ x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }],
    [{ x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }],
    [{ x: r.minX, y: r.maxY }, { x: r.minX, y: r.minY }],
  ];
  const cross = (o: Vec2, p: Vec2, q: Vec2): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const segsIntersect = (p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    const onSeg = (o: Vec2, p: Vec2, q: Vec2): boolean =>
      cross(o, p, q) === 0 && Math.min(o.x, p.x) <= q.x && q.x <= Math.max(o.x, p.x)
      && Math.min(o.y, p.y) <= q.y && q.y <= Math.max(o.y, p.y);
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
    const box: BBox = { minX: nc.at.x - half, minY: nc.at.y - half, maxX: nc.at.x + half, maxY: nc.at.y + half };
    if (contained ? boxContains(rect, box) : boxIntersects(rect, box))
      ids.add(refId('noconnect', nc.uuid, i));
  });

  sch.labels.forEach((l, i) => {
    const box = labelBox(l);
    if (contained ? boxContains(rect, box) : boxIntersects(rect, box))
      ids.add(refId('label', l.uuid, i));
  });

  return ids;
}
