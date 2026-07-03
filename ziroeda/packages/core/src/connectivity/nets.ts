/**
 * Schematic connectivity (netlist), a faithful-but-minimal port of KiCad's
 * CONNECTION_GRAPH (eeschema/connection_graph.cpp).
 *
 * The core of KiCad's algorithm, transcribed here:
 *
 *  - updateItemConnectivity(): build a map from each connection point to the items
 *    that touch it. An item's connection points are GetConnectionPoints():
 *      • SCH_LINE (wire) -> { start, end }   (one item spanning two points)
 *      • SCH_LABEL       -> { position }
 *      • SCH_JUNCTION    -> { position }
 *      • SCH_PIN         -> { tip position } (through the symbol transform)
 *    Items sharing a point are connected. A junction additionally ties every wire
 *    whose segment passes through it; a label ties >= 2 wires it overlaps.
 *
 *  - buildItemSubGraphs(): the connected items form subgraphs (nets). Because a wire
 *    is one item present at both of its endpoints, unioning the items at each point
 *    bridges the two endpoints through the wire — so a union-find over items yields
 *    the nets directly.
 *
 *  - GetDriverPriority()/driverName(): each net is named by its highest-priority
 *    driver (global label > power pin > local label > hier label > pin); an
 *    unnamed net gets an auto name Net-(REF-PIN), and a power pin's name is the
 *    power symbol's value (GND, +5V, …).
 *
 * Scope: single-sheet wire connectivity (no buses/hierarchy yet), enough to tell
 * what is electrically joined and to highlight a net.
 */

import type { Schematic, SchSymbol, LibSymbol, Vec2 } from '../model/types.js';
import { symbolTransform, localToWorld } from '../geom/transform.js';
import { refId } from '../edit/hittest.js';

/** KiCad CONNECTION_SUBGRAPH::PRIORITY (higher wins when naming a net). */
const enum Priority {
  None = 0,
  Pin = 1,
  SheetPin = 2,
  HierLabel = 3,
  LocalLabel = 4,
  LocalPowerPin = 5,
  GlobalPowerPin = 6,
  Global = 7,
}

interface Driver {
  priority: Priority;
  /** Resolved net name for this driver, or '' if it only contributes an auto name. */
  name: string;
}

/** A connectable item (node in the union-find): a wire, label, junction, or symbol pin. */
interface Node {
  id: string;
  points: Vec2[];
  driver: Driver | null;
  /** For auto-naming an unnamed net from a pin: "REF" and pin number. */
  autoName?: string;
}

export interface Net {
  /** 1-based net code, stable for a given schematic ordering. */
  code: number;
  name: string;
  /** Node ids on this net (wire/label/junction refIds and `<symbolRef>:pin<i>` ids). */
  items: string[];
}

export interface Netlist {
  nets: Net[];
  /** Node id -> net code. */
  netByItem: Map<string, number>;
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

/** A symbol pin instance in world coordinates, as enumerated for the netlist/ERC. */
export interface PinNode {
  /** Node id, `<symbolRefId>:pin<k>` — identical to the ids computeNetlist emits. */
  id: string;
  symId: string;
  ref: string;
  number: string;
  name: string;
  /** Electrical type token: input | output | ... (see ERC pin matrix). */
  electricalType: string;
  at: Vec2;
  /** True when the pin's parent lib symbol is a power symbol (GND, +5V, ...). */
  isPowerSymbol: boolean;
  hidden: boolean;
}

/**
 * Enumerate every placed symbol's pins in world coordinates. This is the single
 * source of pin identity shared by computeNetlist and the ERC checker, so the
 * `:pin<k>` ids always agree.
 */
export function enumeratePins(sch: Schematic, libById: Map<string, LibSymbol>): PinNode[] {
  const out: PinNode[] = [];
  sch.symbols.forEach((sym, si) => {
    const lib = libById.get(sym.libId);
    if (!lib) return;
    const symId = refId('symbol', sym.uuid, si);
    const t = symbolTransform(sym.angle, sym.mirror);
    const ref = fieldValue(sym, 'Reference') ?? '?';
    let k = 0;
    for (const u of lib.units) {
      if ((u.unit !== 0 && u.unit !== sym.unit) || (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)) continue;
      for (const pin of u.pins) {
        out.push({
          id: `${symId}:pin${k}`,
          symId,
          ref,
          number: pin.number,
          name: pin.name,
          electricalType: pin.electricalType,
          at: localToWorld(sym.at, t, pin.at),
          isPowerSymbol: lib.isPower,
          hidden: pin.hidden,
        });
        k++;
      }
    }
  });
  return out;
}

/** True if point p lies on the segment a-b (exact, integer IU coordinates). */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
      && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

function fieldValue(sym: SchSymbol, keyName: string): string | undefined {
  return sym.fields.find((f) => f.key === keyName)?.value;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = this.parent.get(x);
    if (root === undefined) { this.parent.set(x, x); return x; }
    while (root !== this.parent.get(root)) root = this.parent.get(root)!;
    // Path-compress.
    let cur = x;
    while (this.parent.get(cur) !== root) { const next = this.parent.get(cur)!; this.parent.set(cur, root); cur = next; }
    return root;
  }
  union(a: string, b: string): void { this.parent.set(this.find(a), this.find(b)); }
}

/** Compute the single-sheet netlist for a schematic. */
export function computeNetlist(sch: Schematic, libById: Map<string, LibSymbol>): Netlist {
  const nodes: Node[] = [];
  const wireNodes: { id: string; a: Vec2; b: Vec2 }[] = [];

  // Wires (only nets, not buses) contribute their two endpoints as one item.
  sch.lines.forEach((line, i) => {
    if (line.kind !== 'wire') return;
    const id = refId('line', line.uuid, i);
    nodes.push({ id, points: [line.start, line.end], driver: null });
    wireNodes.push({ id, a: line.start, b: line.end });
  });

  // Junctions.
  sch.junctions.forEach((j, i) => {
    nodes.push({ id: refId('junction', j.uuid, i), points: [j.at], driver: null });
  });

  // Labels: priority/name by kind.
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return; // free text is not a net driver
    const priority = l.kind === 'global_label' ? Priority.Global
      : l.kind === 'hierarchical_label' ? Priority.HierLabel : Priority.LocalLabel;
    nodes.push({ id: refId('label', l.uuid, i), points: [l.at], driver: { priority, name: l.text } });
  });

  // No-connect flags join the net at their point (KiCad: SCH_NO_CONNECT is a
  // connectable item; the subgraph carrying one is exempt from unconnected checks).
  sch.noConnects.forEach((nc, i) => {
    nodes.push({ id: refId('noconnect', nc.uuid, i), points: [nc.at], driver: null });
  });

  // Symbol pins (through the placement transform). Power symbols drive a power net
  // named by the symbol's Value; ordinary pins drive a Net-(REF-pin) auto name.
  const valueBySym = new Map(sch.symbols.map((s, i) => [refId('symbol', s.uuid, i), fieldValue(s, 'Value') ?? '']));
  for (const pin of enumeratePins(sch, libById)) {
    const node: Node = { id: pin.id, points: [pin.at], driver: null };
    if (pin.isPowerSymbol) {
      node.driver = { priority: Priority.GlobalPowerPin, name: valueBySym.get(pin.symId) ?? '' };
    } else {
      node.autoName = `Net-(${pin.ref}-Pad${pin.number || Number(pin.id.slice(pin.id.lastIndexOf(':pin') + 4)) + 1})`;
    }
    nodes.push(node);
  }

  // Build the point -> node-ids map (KiCad's connection_map).
  const pointMap = new Map<string, Set<string>>();
  const add = (p: Vec2, id: string): void => {
    const kk = key(p);
    let s = pointMap.get(kk);
    if (!s) { s = new Set(); pointMap.set(kk, s); }
    s.add(id);
  };
  for (const n of nodes) for (const p of n.points) add(p, n.id);

  // Junction rule: a junction ties every wire whose segment passes through it.
  sch.junctions.forEach((j, i) => {
    const jid = refId('junction', j.uuid, i);
    for (const w of wireNodes) {
      if (onSegment(j.at, w.a, w.b)) add(j.at, w.id);
    }
    void jid;
  });

  // Label-over-wires rule: a label overlapping >= 2 wires ties them (KiCad enforces
  // connectivity for all wires under a label even without an explicit junction).
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    const overlapping = wireNodes.filter((w) => onSegment(l.at, w.a, w.b));
    if (overlapping.length < 2) return;
    const lid = refId('label', l.uuid, i);
    for (const w of overlapping) { add(l.at, w.id); }
    void lid;
  });

  // Union items sharing a point; wires bridge their two endpoints automatically.
  const uf = new UnionFind();
  for (const n of nodes) uf.find(n.id); // ensure every node exists
  for (const ids of pointMap.values()) {
    const arr = [...ids];
    for (let i = 1; i < arr.length; i++) uf.union(arr[0]!, arr[i]!);
  }

  // Group nodes by net root.
  const byRoot = new Map<string, Node[]>();
  for (const n of nodes) {
    const r = uf.find(n.id);
    let g = byRoot.get(r);
    if (!g) { g = []; byRoot.set(r, g); }
    g.push(n);
  }

  // Name each net by its highest-priority driver; fall back to a pin auto name.
  const nets: Net[] = [];
  const netByItem = new Map<string, number>();
  let code = 1;
  for (const group of byRoot.values()) {
    let best: Driver | null = null;
    let auto: string | undefined;
    for (const n of group) {
      if (n.driver && n.driver.name && (!best || n.driver.priority > best.priority)) best = n.driver;
      if (!auto && n.autoName) auto = n.autoName;
    }
    const name = best?.name ?? auto ?? `Net-${code}`;
    const items = group.map((n) => n.id);
    nets.push({ code, name, items });
    for (const id of items) netByItem.set(id, code);
    code++;
  }

  return { nets, netByItem };
}
