/**
 * Ratsnest computation — a compact port of pcbnew's RN_NET /
 * CONNECTIVITY_DATA pipeline (ratsnest/ratsnest_data.cpp): per net, cluster
 * the copper items that are already physically connected (pads, track/arc
 * segments, vias, filled zones), then emit the shortest edges that would join
 * the remaining clusters (kruskal on the closest cluster pairs), which are
 * the airwires the canvas draws and the "Unrouted" count.
 */

import type { Board, PcbPad } from './types.js';

/** Copper scope of a connection anchor: one layer, or through-hole (all). */
type AnchorLayer = string | 'through';

interface Anchor {
  x: number;
  y: number;
  layer: AnchorLayer;
  /** Union-find parent index. */
  parent: number;
}

/** One airwire between two unconnected clusters of a net. */
export interface RatsnestEdge {
  net: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  aLayer: AnchorLayer;
  bLayer: AnchorLayer;
}

const layersCompatible = (a: AnchorLayer, b: AnchorLayer): boolean =>
  a === 'through' || b === 'through' || a === b;

/** Copper scope of a pad: through-hole pads join every layer. */
function padLayer(pad: PcbPad): AnchorLayer {
  if (pad.type === 'thru_hole' || pad.type === 'np_thru_hole') return 'through';
  if (pad.layers.some((l) => l === '*.Cu')) return 'through';
  const cu = pad.layers.find((l) => /\.Cu$/.test(l));
  return cu ?? 'through';
}

/** Ray-cast point-in-polygon. */
function inPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Build the airwire list for every net on the board. */
export function buildRatsnest(board: Board): RatsnestEdge[] {
  const edges: RatsnestEdge[] = [];

  // Bucket the board's connected items per net code (net 0 = no net).
  interface NetItems {
    pads: PcbPad[];
    tracks: { sx: number; sy: number; ex: number; ey: number; layer: string }[];
    vias: { x: number; y: number; r: number }[];
    zones: { layer: string; polys: { x: number; y: number }[][] }[];
  }
  const nets = new Map<number, NetItems>();
  const forNet = (net: number): NetItems => {
    let n = nets.get(net);
    if (!n) {
      n = { pads: [], tracks: [], vias: [], zones: [] };
      nets.set(net, n);
    }
    return n;
  };

  for (const fp of board.footprints)
    for (const pad of fp.pads) if (pad.net && pad.net > 0) forNet(pad.net).pads.push(pad);
  board.tracks.forEach((t) => {
    if (t.net > 0)
      forNet(t.net).tracks.push({
        sx: t.start.x,
        sy: t.start.y,
        ex: t.end.x,
        ey: t.end.y,
        layer: t.layer,
      });
  });
  board.arcs.forEach((a) => {
    if (a.net > 0)
      forNet(a.net).tracks.push({
        sx: a.start.x,
        sy: a.start.y,
        ex: a.end.x,
        ey: a.end.y,
        layer: a.layer,
      });
  });
  board.vias.forEach((v) => {
    if (v.net > 0) forNet(v.net).vias.push({ x: v.at.x, y: v.at.y, r: v.size / 2 });
  });
  for (const z of board.zones) {
    if (z.net <= 0) continue;
    // A poured (filled) zone connects every same-net item within its boundary.
    // Use the zone outline for the containment test rather than the fill
    // polygons: a thermal-relieved pad sits in the fill's clearance hole, so
    // its centre is outside the fill even though a spoke connects it — the
    // outline captures that, matching what KiCad's connectivity reports.
    if (z.fills.length === 0) continue; // unfilled zone: no copper, no connection
    if (z.outline && z.outline.length >= 3) {
      for (const layer of z.layers) forNet(z.net).zones.push({ layer, polys: [z.outline] });
    } else {
      // No stored outline — fall back to the fill polygons.
      for (const f of z.fills) forNet(z.net).zones.push({ layer: f.layer, polys: f.polys });
    }
  }

  for (const [net, items] of nets) {
    const anchors: Anchor[] = [];
    const add = (x: number, y: number, layer: AnchorLayer): number => {
      anchors.push({ x, y, layer, parent: anchors.length });
      return anchors.length - 1;
    };
    const find = (i: number): number => {
      let r = i;
      while (anchors[r]!.parent !== r) r = anchors[r]!.parent;
      // Path compression.
      let c = i;
      while (anchors[c]!.parent !== c) {
        const next = anchors[c]!.parent;
        anchors[c]!.parent = r;
        c = next;
      }
      return r;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) anchors[rb]!.parent = ra;
    };

    // Pads and vias are round(ish) connection targets with a capture radius;
    // track ends connect where they land on them (connectivity_algo's shape
    // collisions, reduced to the anchor-distance case).
    const targets: { idx: number; r: number }[] = [];
    for (const pad of items.pads) {
      const idx = add(pad.at.x, pad.at.y, padLayer(pad));
      targets.push({ idx, r: Math.max(pad.size.x, pad.size.y) / 2 });
    }
    for (const via of items.vias) {
      const idx = add(via.x, via.y, 'through');
      targets.push({ idx, r: via.r });
    }
    const trackEnds: number[] = [];
    for (const t of items.tracks) {
      const s = add(t.sx, t.sy, t.layer);
      const e = add(t.ex, t.ey, t.layer);
      union(s, e); // the segment itself connects its two ends
      trackEnds.push(s, e);
    }

    // Track end ↔ pad/via capture, and coincident track ends.
    for (const ei of trackEnds) {
      const e = anchors[ei]!;
      for (const t of targets) {
        const a = anchors[t.idx]!;
        if (!layersCompatible(e.layer, a.layer)) continue;
        if (Math.hypot(e.x - a.x, e.y - a.y) <= t.r + 1) union(ei, t.idx);
      }
    }
    // Coincident endpoints (track-to-track joints share exact coordinates).
    const byPos = new Map<string, number[]>();
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const key = `${Math.round(a.x)},${Math.round(a.y)}`;
      const list = byPos.get(key);
      if (list) {
        for (const j of list) if (layersCompatible(a.layer, anchors[j]!.layer)) union(i, j);
        list.push(i);
      } else byPos.set(key, [i]);
    }
    // Pad-to-pad / pad-to-via overlap (stacked or touching anchors).
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = anchors[targets[i]!.idx]!;
        const b = anchors[targets[j]!.idx]!;
        if (!layersCompatible(a.layer, b.layer)) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) <= targets[i]!.r + targets[j]!.r) {
          union(targets[i]!.idx, targets[j]!.idx);
        }
      }
    }

    // Filled zones connect everything sitting inside their fill.
    for (const z of items.zones) {
      let first = -1;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i]!;
        if (!layersCompatible(a.layer, z.layer)) continue;
        if (z.polys.some((p) => inPoly(a.x, a.y, p))) {
          if (first < 0) first = i;
          else union(first, i);
        }
      }
    }

    // Cluster and join with the shortest airwires (greedy kruskal over the
    // closest anchor pair between clusters, like RN_NET::kruskalMST).
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < anchors.length; i++) {
      const r = find(i);
      const c = clusters.get(r);
      if (c) c.push(i);
      else clusters.set(r, [i]);
    }
    let groups = [...clusters.values()];
    while (groups.length > 1) {
      let best = { d: Infinity, gi: -1, gj: -1, a: -1, b: -1 };
      for (let gi = 0; gi < groups.length; gi++) {
        for (let gj = gi + 1; gj < groups.length; gj++) {
          for (const a of groups[gi]!) {
            for (const b of groups[gj]!) {
              const d = Math.hypot(anchors[a]!.x - anchors[b]!.x, anchors[a]!.y - anchors[b]!.y);
              if (d < best.d) best = { d, gi, gj, a, b };
            }
          }
        }
      }
      if (best.gi < 0) break;
      const a = anchors[best.a]!;
      const b = anchors[best.b]!;
      edges.push({
        net,
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        aLayer: a.layer,
        bLayer: b.layer,
      });
      const merged = [...groups[best.gi]!, ...groups[best.gj]!];
      groups = groups.filter((_, i) => i !== best.gi && i !== best.gj);
      groups.push(merged);
    }
  }

  return edges;
}
