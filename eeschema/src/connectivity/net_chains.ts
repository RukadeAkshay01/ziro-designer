/**
 * Net-chain detection. Counterpart: `CONNECTION_GRAPH::buildBridgeAdjacency` +
 * `RebuildNetChains` (eeschema/connection_graph.cpp) and SCH_NETCHAIN
 * (eeschema/sch_netchain.h) — chains of nets bridged by 2-pin passthrough
 * symbols (series resistors, filters, …) so DRC rules can target them via
 * `inNetChainClass('name')`.
 *
 * The exact pipeline, single-sheet:
 *  1. bridge edges: every 2-pin symbol whose pins each land on a wire, with
 *     the default-mode gate (no power pins; both wires collinear — vertical
 *     on one X or horizontal on one Y) links its two distinct nets;
 *  2. edges touching a power subgraph (a power-class pin or power symbol)
 *     drop, their non-power endpoints marked power-adjacent;
 *  3. power-adjacent degree-≤1 leaves prune iteratively (skipped entirely
 *     for graphs of ≤2 nets or ≤2 power-adjacent nets);
 *  4. components larger than 4 nets shed degree-1 stubs whose neighbour has
 *     degree >2 (case-insensitive-sorted, only as many as needed);
 *  5. remaining components of ≥2 nets become chains;
 *  6. a local label on a member net names its chain (leading '/' stripped,
 *     512-char cap); unnamed chains fall back to `NetChain<n>`.
 *
 * Deviations, documented: no PASSTHROUGH_MODE symbol attribute in our model
 * (upstream's BLOCK/FORCE overrides), and only "potential" chains — the
 * committed-chain store (`.kicad_sch` `signal` nodes) is not implemented.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { refId } from '../tools/hittest.js';
import { enumeratePins, type Netlist, type PinNode } from './nets.js';

export interface DetectedNetChain {
  name: string;
  /** Member net names, sorted. */
  nets: string[];
  /** RefIds of the bridging 2-pin symbols. */
  symbols: string[];
}

interface BridgeEdge {
  a: string;
  b: string;
  symId: string;
}

export function detectNetChains(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  netlist: Netlist,
): DetectedNetChain[] {
  const wires = sch.lines.filter((l) => l.kind === 'wire');

  // findWireOnScreen: the pin position within an H or V wire's span.
  const findWire = (p: Vec2): { a: Vec2; b: Vec2 } | null => {
    for (const w of wires) {
      const s = w.start;
      const e = w.end;
      if (s.y === e.y && p.y === s.y) {
        if (p.x >= Math.min(s.x, e.x) && p.x <= Math.max(s.x, e.x)) return { a: s, b: e };
      } else if (s.x === e.x && p.x === s.x) {
        if (p.y >= Math.min(s.y, e.y) && p.y <= Math.max(s.y, e.y)) return { a: s, b: e };
      }
    }
    return null;
  };

  const pins = enumeratePins(sch, libById);
  const bySym = new Map<string, PinNode[]>();
  for (const p of pins) {
    const arr = bySym.get(p.symId) ?? [];
    arr.push(p);
    bySym.set(p.symId, arr);
  }
  const netName = (code: number | undefined): string =>
    code !== undefined ? (netlist.nets.find((n) => n.code === code)?.name ?? '') : '';
  const isPowerPin = (p: PinNode): boolean =>
    p.electricalType === 'power_in' || p.electricalType === 'power_out';

  // ----- 1. bridge edges over 2-pin symbols --------------------------------
  const edges: BridgeEdge[] = [];
  for (const [symId, symPins] of bySym) {
    if (symPins.length !== 2) continue;
    const [p0, p1] = symPins as [PinNode, PinNode];
    const wireA = findWire(p0.at);
    const wireB = findWire(p1.at);
    if (!wireA || !wireB) continue;

    // Default passthrough mode: no power pins, and both wires collinear.
    if (isPowerPin(p0) || isPowerPin(p1)) continue;
    let allow = false;
    if (wireA.a.x === wireA.b.x && wireB.a.x === wireB.b.x && wireA.a.x === wireB.a.x) allow = true;
    else if (wireA.a.y === wireA.b.y && wireB.a.y === wireB.b.y && wireA.a.y === wireB.a.y)
      allow = true;
    if (!allow) continue;

    const netA = netName(netlist.netByItem.get(p0.id));
    const netB = netName(netlist.netByItem.get(p1.id));
    if (netA === '' || netB === '' || netA === netB) continue;
    edges.push({ a: netA, b: netB, symId });
  }

  // ----- 2. power subgraphs drop their edges -------------------------------
  const powerNets = new Set<string>();
  for (const p of pins) {
    if (isPowerPin(p) || p.isPowerSymbol) {
      const name = netName(netlist.netByItem.get(p.id));
      if (name !== '') powerNets.add(name);
    }
  }
  const powerAdjacent = new Set<string>();
  let adjacency = new Map<string, { other: string; symId: string }[]>();
  const addAdj = (from: string, other: string, symId: string): void => {
    const arr = adjacency.get(from) ?? [];
    arr.push({ other, symId });
    adjacency.set(from, arr);
  };
  for (const be of edges) {
    if (powerNets.has(be.a) || powerNets.has(be.b)) {
      if (!powerNets.has(be.a)) powerAdjacent.add(be.a);
      if (!powerNets.has(be.b)) powerAdjacent.add(be.b);
      continue;
    }
    addAdj(be.a, be.b, be.symId);
    addAdj(be.b, be.a, be.symId);
  }

  // ----- 3. iterative power-adjacent leaf pruning --------------------------
  const degree = new Map<string, number>();
  for (const [k, v] of adjacency) degree.set(k, v.length);
  if (adjacency.size <= 2) powerAdjacent.clear();
  if (powerAdjacent.size <= 2) powerAdjacent.clear();
  const queue: string[] = [];
  for (const [k, d] of degree) if (d <= 1 && powerAdjacent.has(k)) queue.push(k);
  const removed = new Set<string>();
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (removed.has(n)) continue;
    removed.add(n);
    for (const e of adjacency.get(n) ?? []) {
      if (removed.has(e.other)) continue;
      const d = degree.get(e.other);
      if (d !== undefined) {
        degree.set(e.other, d - 1);
        if (d - 1 <= 1 && powerAdjacent.has(e.other)) queue.push(e.other);
      }
    }
  }
  if (removed.size > 0) {
    const newAdj = new Map<string, { other: string; symId: string }[]>();
    for (const [k, v] of adjacency) {
      if (removed.has(k)) continue;
      newAdj.set(
        k,
        v.filter((e) => !removed.has(e.other)),
      );
    }
    adjacency = newAdj;
  }

  // ----- 4. targeted stub pruning for components > 4 nets ------------------
  {
    const snapshot = adjacency;
    const seen = new Set<string>();
    const globalPrune = new Set<string>();
    for (const start of snapshot.keys()) {
      if (seen.has(start)) continue;
      const comp: string[] = [];
      const q = [start];
      seen.add(start);
      while (q.length > 0) {
        const cur = q.shift()!;
        comp.push(cur);
        for (const e of snapshot.get(cur) ?? []) {
          if (!seen.has(e.other)) {
            seen.add(e.other);
            q.push(e.other);
          }
        }
      }
      if (comp.length <= 4) continue;
      const deg = new Map<string, number>();
      for (const n of comp) deg.set(n, (snapshot.get(n) ?? []).length);
      const candidates: string[] = [];
      for (const n of comp) {
        const nbrs = snapshot.get(n) ?? [];
        if (nbrs.length === 1) {
          const neigh = nbrs[0]!.other;
          if ((deg.get(neigh) ?? 0) > 2) candidates.push(n);
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      let needPrune = comp.length - 4;
      if (needPrune > candidates.length) needPrune = candidates.length;
      for (let i = 0; i < needPrune; i++) globalPrune.add(candidates[i]!);
    }
    if (globalPrune.size > 0) {
      const newAdj = new Map<string, { other: string; symId: string }[]>();
      for (const [k, v] of adjacency) {
        if (globalPrune.has(k)) continue;
        newAdj.set(
          k,
          v.filter((e) => !globalPrune.has(e.other)),
        );
      }
      adjacency = newAdj;
    }
  }

  // ----- 5. connected components of ≥2 nets become chains ------------------
  const chains: { nets: Set<string>; symbols: Set<string>; name: string }[] = [];
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const comp = new Set<string>([start]);
    const q = [start];
    visited.add(start);
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const e of adjacency.get(cur) ?? []) {
        if (visited.has(e.other)) continue;
        visited.add(e.other);
        comp.add(e.other);
        q.push(e.other);
      }
    }
    if (comp.size >= 2) {
      const symbols = new Set<string>();
      for (const be of edges) if (comp.has(be.a) && comp.has(be.b)) symbols.add(be.symId);
      chains.push({ nets: comp, symbols, name: '' });
    }
  }

  // ----- 6. naming: local labels first, then NetChain<n> -------------------
  const netToChain = new Map<string, (typeof chains)[number]>();
  for (const c of chains) for (const n of c.nets) netToChain.set(n, c);
  sch.labels.forEach((l, i) => {
    if (l.kind !== 'label') return; // SCH_LABEL_T only, like upstream's pass
    const code = netlist.netByItem.get(refId('label', l.uuid, i));
    const net = netName(code);
    if (net === '' || net.length >= 2048) return;
    const chain = netToChain.get(net);
    if (!chain) return;
    let name = l.text;
    if (name.length > 512) name = name.slice(0, 512);
    if (name.startsWith('/')) name = name.slice(1);
    chain.name = name;
  });
  let idx = 1;
  for (const c of chains) {
    if (c.name === '') {
      c.name = `NetChain${idx}`;
      idx++;
    }
  }

  return chains.map((c) => ({
    name: c.name,
    nets: [...c.nets].sort(),
    symbols: [...c.symbols].sort(),
  }));
}
