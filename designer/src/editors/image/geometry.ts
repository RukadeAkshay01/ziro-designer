/**
 * Polygon helpers for the Image Converter: signed area, point-in-polygon, and
 * cutting holes into an outline by bridging.
 *
 * KiCad builds a `SHAPE_POLY_SET`, boolean-subtracts the hole paths, then
 * fractures the result so each outline is a single self-touching ring that a
 * solid `fp_poly` / outline-filled `polyline` can represent. We do the same with
 * a bridge merge adapted from the hole-elimination step of the `earcut`
 * triangulation library (ISC, © Mapbox) — only the linked-list bridging is
 * ported, not the triangulation.
 */

import { Pt } from './potrace.js';

/** Twice the signed area (positive when the ring winds counter-clockwise in +Y-up space). */
export function signedArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j]!.x - ring[i]!.x) * (ring[i]!.y + ring[j]!.y);
  }
  return sum / 2;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const yi = ring[i]!.y;
    const xj = ring[j]!.x;
    const yj = ring[j]!.y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ----- hole bridging (adapted from earcut) ------------------------------------

class Node {
  i: number;
  x: number;
  y: number;
  prev: Node = this;
  next: Node = this;
  steiner = false;
  constructor(i: number, x: number, y: number) {
    this.i = i;
    this.x = x;
    this.y = y;
  }
}

function insertNode(i: number, x: number, y: number, last: Node | null): Node {
  const p = new Node(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function removeNode(p: Node): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;
}

/** Build a circular doubly-linked list from a ring, normalised to the requested winding. */
function linkedList(ring: Pt[], base: number, clockwise: boolean): Node | null {
  let last: Node | null = null;
  const ccw = signedArea(ring) > 0;
  if (clockwise === ccw) {
    for (let i = 0; i < ring.length; i++) last = insertNode(base + i, ring[i]!.x, ring[i]!.y, last);
  } else {
    for (let i = ring.length - 1; i >= 0; i--)
      last = insertNode(base + i, ring[i]!.x, ring[i]!.y, last);
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

function equals(p1: Node, p2: Node): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

function area(p: Node, q: Node, r: Node): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function getLeftmost(start: Node): Node {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  return (
    (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0
  );
}

function locallyInside(a: Node, b: Node): boolean {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

/** Find a mutually-visible outer vertex to bridge a hole's leftmost vertex to. */
function findHoleBridge(hole: Node, outerNode: Node): Node | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: Node | null = null;

  // Cast a ray from the hole vertex to the left; find the closest outer edge.
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);

  if (!m) return null;

  // Look for a better bridge point among reflex vertices inside the candidate triangle.
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (
      hx >= p.x &&
      p.x >= mx &&
      hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (
        locallyInside(p, hole) &&
        (tan < tanMin ||
          (tan === tanMin && (p.x > m!.x || (p.x === m!.x && sectorContains(m!, p)))))
      ) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);

  return m;
}

function sectorContains(m: Node, p: Node): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

/** Split the ring by bridging a→b, returning b's copy (the two rings become one loop). */
function splitPolygon(a: Node, b: Node): Node {
  const a2 = new Node(a.i, a.x, a.y);
  const b2 = new Node(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;

  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

function eliminateHole(hole: Node, outerNode: Node): Node {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  // Bridging outer→hole stitches both rings into one loop; outerNode stays valid.
  splitPolygon(bridge, hole);
  return outerNode;
}

/**
 * Merge holes into an outline, returning one closed ring with zero-width bridges
 * at each hole — the fractured outline KiCad emits. With no holes the outline is
 * returned unchanged.
 */
export function fractureWithHoles(outer: Pt[], holes: Pt[][]): Pt[] {
  if (holes.length === 0) return outer;

  let outerNode = linkedList(outer, 0, true);
  if (!outerNode) return outer;

  let base = outer.length;
  const queue: Node[] = [];
  for (const h of holes) {
    const list = linkedList(h, base, false);
    base += h.length;
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x);

  for (const q of queue) {
    outerNode = eliminateHole(q, outerNode) ?? outerNode;
  }

  // Read the merged loop back out as a point ring.
  const out: Pt[] = [];
  let node = outerNode;
  do {
    out.push(new Pt(node.x, node.y));
    node = node.next;
  } while (node !== outerNode);
  return out;
}
