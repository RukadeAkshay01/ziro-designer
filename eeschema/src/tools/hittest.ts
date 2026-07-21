/**
 * Hit-testing for selection, grounded in KiCad's `HitTest(point, accuracy)`:
 * lines test segment proximity within a tolerance, junctions/labels/symbols test
 * against their shape/bounding box. `accuracy` is a world-space tolerance the
 * caller derives from a pixel radius (so selection feels the same at any zoom).
 */

import type { Schematic, SchSymbol, LibGraphic, LibSymbol, Vec2 } from '../types.js';
import { contains, inflate, labelBox, symbolBodyBBox } from './bbox.js';

/** A reference to a top-level, selectable schematic item. */
export interface ItemRef {
  kind:
    | 'symbol'
    | 'line'
    | 'junction'
    | 'noconnect'
    | 'label'
    | 'sheet'
    | 'busentry'
    | 'image'
    | 'graphic'
    | 'textbox'
    | 'table';
  /** Stable identity: the item's uuid, or `idx:<n>` when one is absent. */
  id: string;
}

// BITMAP_BASE: m_pixelSizeIu = 254000 / ppi with the default 300 ppi.
const IU_PER_PIXEL = 254000 / 300;

/** Whether world point p hits the stroke (or filled interior) of a graphic shape. */
function hitGraphic(g: LibGraphic, p: Vec2, tol: number): boolean {
  switch (g.kind) {
    case 'rectangle': {
      const x0 = Math.min(g.start.x, g.end.x),
        x1 = Math.max(g.start.x, g.end.x);
      const y0 = Math.min(g.start.y, g.end.y),
        y1 = Math.max(g.start.y, g.end.y);
      if (g.fill && g.fill.type !== 'none' && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
        return true;
      return (
        Math.min(
          distToSegment(p, { x: x0, y: y0 }, { x: x1, y: y0 }),
          distToSegment(p, { x: x0, y: y1 }, { x: x1, y: y1 }),
          distToSegment(p, { x: x0, y: y0 }, { x: x0, y: y1 }),
          distToSegment(p, { x: x1, y: y0 }, { x: x1, y: y1 }),
        ) <= tol
      );
    }
    case 'circle': {
      const d = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      if (g.fill && g.fill.type !== 'none' && d <= g.radius) return true;
      return Math.abs(d - g.radius) <= tol;
    }
    case 'arc':
      // Approximate the arc by its start–mid–end chords (fine within tolerance).
      return distToSegment(p, g.start, g.mid) <= tol || distToSegment(p, g.mid, g.end) <= tol;
    case 'polyline':
    case 'bezier': {
      // Béziers hit-test against their control polygon (fine within tolerance).
      for (let i = 1; i < g.points.length; i++)
        if (distToSegment(p, g.points[i - 1]!, g.points[i]!) <= tol) return true;
      return false;
    }
    case 'text': {
      const h = g.effects?.fontSize?.[0] ?? 12700;
      return (
        Math.abs(p.x - g.at.x) <= h * Math.max(2, g.text.length) && Math.abs(p.y - g.at.y) <= h
      );
    }
  }
}

export function refId(kind: ItemRef['kind'], uuid: string | undefined, index: number): string {
  return uuid ?? `${kind}:idx:${index}`;
}

/** Distance from point p to segment ab. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Find the top-most selectable item at a world point, within `accuracy` (world
 * units). Priority roughly follows KiCad: small/precise items (junctions, labels,
 * wires) win over the larger symbol body they may overlap.
 */
export function hitTest(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  p: Vec2,
  accuracy: number,
): ItemRef | null {
  for (let i = 0; i < sch.junctions.length; i++) {
    const j = sch.junctions[i]!;
    const r = (j.diameter > 0 ? j.diameter : 9000) / 2 + accuracy;
    if (Math.hypot(p.x - j.at.x, p.y - j.at.y) <= r)
      return { kind: 'junction', id: refId('junction', j.uuid, i) };
  }

  // No-connect flags: KiCad's X spans DEFAULT_NOCONNECT_SIZE (48 mil) about the point.
  for (let i = 0; i < sch.noConnects.length; i++) {
    const nc = sch.noConnects[i]!;
    const half = 6096 + accuracy; // 24 mil in IU
    if (Math.abs(p.x - nc.at.x) <= half && Math.abs(p.y - nc.at.y) <= half)
      return { kind: 'noconnect', id: refId('noconnect', nc.uuid, i) };
  }

  for (let i = 0; i < sch.labels.length; i++) {
    const l = sch.labels[i]!;
    if (contains(inflate(labelBox(l), accuracy), p))
      return { kind: 'label', id: refId('label', l.uuid, i) };
  }

  for (let i = 0; i < sch.lines.length; i++) {
    const ln = sch.lines[i]!;
    const tol = accuracy + (ln.stroke && ln.stroke.width > 0 ? ln.stroke.width / 2 : 0);
    if (distToSegment(p, ln.start, ln.end) <= tol)
      return { kind: 'line', id: refId('line', ln.uuid, i) };
  }

  // Wire-to-bus entries: the 45° stub from `at` to `at + size`.
  for (let i = 0; i < sch.busEntries.length; i++) {
    const be = sch.busEntries[i]!;
    const end = { x: be.at.x + be.size.x, y: be.at.y + be.size.y };
    if (distToSegment(p, be.at, end) <= accuracy)
      return { kind: 'busentry', id: refId('busentry', be.uuid, i) };
  }

  // Sheet-level graphic shapes (rectangles/circles/arcs/polylines).
  for (let i = 0; i < sch.graphics.length; i++) {
    const g = sch.graphics[i]!;
    const tol =
      accuracy + (g.kind !== 'text' && g.stroke && g.stroke.width > 0 ? g.stroke.width / 2 : 0);
    if (hitGraphic(g, p, tol)) return { kind: 'graphic', id: refId('graphic', undefined, i) };
  }

  for (let i = 0; i < sch.symbols.length; i++) {
    const s = sch.symbols[i]!;
    const box = inflate(symbolBodyBBox(s, libById.get(s.libId)), accuracy / 2);
    if (contains(box, p)) return { kind: 'symbol', id: refId('symbol', s.uuid, i) };
  }

  // Embedded images: bounding box centred at `at` (pixels x IU_PER_PIXEL x scale).
  for (let i = 0; i < sch.images.length; i++) {
    const im = sch.images[i]!;
    // Without a decoded natural size, assume a modest default extent so the
    // image is still clickable; the renderer uses the true size once decoded.
    const halfW = 20 * IU_PER_PIXEL * im.scale;
    const halfH = 20 * IU_PER_PIXEL * im.scale;
    if (Math.abs(p.x - im.at.x) <= halfW + accuracy && Math.abs(p.y - im.at.y) <= halfH + accuracy)
      return { kind: 'image', id: refId('image', im.uuid, i) };
  }

  // Text boxes: KiCad's SCH_TEXTBOX::HitTest matches any point in the bounding
  // box (rect.Contains), so the whole box selects. Tested late (like sheets) so
  // smaller items drawn over it win first.
  for (let i = 0; i < sch.textBoxes.length; i++) {
    const tb = sch.textBoxes[i]!;
    const x0 = Math.min(tb.start.x, tb.end.x),
      x1 = Math.max(tb.start.x, tb.end.x);
    const y0 = Math.min(tb.start.y, tb.end.y),
      y1 = Math.max(tb.start.y, tb.end.y);
    if (
      p.x >= x0 - accuracy &&
      p.x <= x1 + accuracy &&
      p.y >= y0 - accuracy &&
      p.y <= y1 + accuracy
    )
      return { kind: 'textbox', id: refId('textbox', tb.uuid, i) };
  }

  // Tables: the union of every cell's bounding box (SCH_TABLE::HitTest).
  for (let i = 0; i < sch.tables.length; i++) {
    const t = sch.tables[i]!;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of t.cells) {
      minX = Math.min(minX, c.start.x, c.end.x);
      minY = Math.min(minY, c.start.y, c.end.y);
      maxX = Math.max(maxX, c.start.x, c.end.x);
      maxY = Math.max(maxY, c.start.y, c.end.y);
    }
    if (
      t.cells.length &&
      p.x >= minX - accuracy &&
      p.x <= maxX + accuracy &&
      p.y >= minY - accuracy &&
      p.y <= maxY + accuracy
    )
      return { kind: 'table', id: refId('table', t.uuid, i) };
  }

  // Sheets last: their rectangle is large, so smaller items inside win first
  // (KiCad's SCH_SHEET::HitTest accepts any point in the body box).
  for (let i = 0; i < sch.sheets.length; i++) {
    const sh = sch.sheets[i]!;
    const box = inflate(
      { minX: sh.at.x, minY: sh.at.y, maxX: sh.at.x + sh.size.w, maxY: sh.at.y + sh.size.h },
      accuracy,
    );
    if (contains(box, p)) return { kind: 'sheet', id: refId('sheet', sh.uuid, i) };
  }

  return null;
}

/** Stable id for a symbol, matching `refId` usage in hitTest. */
export function symbolId(s: SchSymbol, index: number): string {
  return refId('symbol', s.uuid, index);
}
