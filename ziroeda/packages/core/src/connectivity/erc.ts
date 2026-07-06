/**
 * Electrical Rules Check, ported from KiCad:
 *
 *  - the pin-to-pin conflict matrix and driver pin-type sets are byte-for-byte
 *    copies of ERC_SETTINGS::m_defaultPinMap and the DrivingPinTypes /
 *    DrivingPowerPinTypes / DrivenPinTypes sets (eeschema/erc/erc_settings.cpp,
 *    erc.cpp);
 *  - TestPinToPin: for every net, each pin pair is looked up in the matrix
 *    (stacked pins of one symbol are exempt); mismatches are aggregated so the
 *    pin involved in the most conflicts is reported against its nearest
 *    conflicting pin, exactly KiCad's marker-dedup strategy. The same walk
 *    determines whether a net that *needs* a driver (input / power-input pins)
 *    actually has one — power nets accept only power-output drivers
 *    (ERCE_PIN_NOT_DRIVEN / ERCE_POWERPIN_NOT_DRIVEN); a net carrying a
 *    no-connect flag is exempt;
 *  - ercCheckNoConnects (connection_graph.cpp): a subgraph with a no-connect
 *    and more than one distinct (non-stacked) pin -> "connected NC" warning;
 *    a no-connect with no pins and no labels -> "dangling NC" warning; a pin
 *    alone on its subgraph without a no-connect -> ERCE_PIN_NOT_CONNECTED
 *    (free/NC-type pins exempt);
 *  - TestNoConnectPins (erc.cpp): an NC-*type* pin sharing its position with
 *    any other connectable item -> "Pin with 'no connection' type is connected";
 *  - ercCheckLabels: a label on a net with no pins -> label not connected
 *    (error); with exactly one pin -> "only one pin" warning. Global labels
 *    follow KiCad's default of ignoring the single-instance check.
 *
 * Default severities are ERC_SETTINGS' defaults: everything is an error except
 * pin-to-pin warnings, the no-connect checks, and the single-pin label check.
 */

import type { Schematic, LibSymbol, Vec2 } from '../model/types.js';
import { refId } from '../edit/hittest.js';
import { computeNetlist, enumeratePins, type PinNode } from './nets.js';

/** ELECTRICAL_PINTYPE order, matching the ERC matrix rows/columns. */
const PIN_TYPES = [
  'input', 'output', 'bidirectional', 'tri_state', 'passive', 'free',
  'unspecified', 'power_in', 'power_out', 'open_collector', 'open_emitter',
  'no_connect',
] as const;

type PinTypeIndex = number;

const typeIndex = (token: string): PinTypeIndex => {
  const i = PIN_TYPES.indexOf(token as (typeof PIN_TYPES)[number]);
  return i === -1 ? 6 : i; // unknown token -> unspecified, as KiCad's parser does
};

const OK = 0, WAR = 1, ERR = 2;
type PinError = typeof OK | typeof WAR | typeof ERR;

/** ERC_SETTINGS::m_defaultPinMap — the exact default conflict matrix. */
const PIN_MAP: PinError[][] = [
  /*         I,   O,    Bi,   3S,   Pas,  NIC,  UnS,  PwrI, PwrO, OC,   OE,   NC */
  /* I  */ [OK,  OK,   OK,   OK,   OK,   OK,   WAR,  OK,   OK,   OK,   OK,   ERR],
  /* O  */ [OK,  ERR,  OK,   WAR,  OK,   OK,   WAR,  OK,   ERR,  ERR,  ERR,  ERR],
  /* Bi */ [OK,  OK,   OK,   OK,   OK,   OK,   WAR,  OK,   WAR,  OK,   WAR,  ERR],
  /* 3S */ [OK,  WAR,  OK,   OK,   OK,   OK,   WAR,  WAR,  ERR,  WAR,  WAR,  ERR],
  /*Pas */ [OK,  OK,   OK,   OK,   OK,   OK,   WAR,  OK,   OK,   OK,   OK,   ERR],
  /*NIC */ [OK,  OK,   OK,   OK,   OK,   OK,   OK,   OK,   OK,   OK,   OK,   ERR],
  /*UnS */ [WAR, WAR,  WAR,  WAR,  WAR,  OK,   WAR,  WAR,  WAR,  WAR,  WAR,  ERR],
  /*PwrI*/ [OK,  OK,   OK,   WAR,  OK,   OK,   WAR,  OK,   OK,   OK,   OK,   ERR],
  /*PwrO*/ [OK,  ERR,  WAR,  ERR,  OK,   OK,   WAR,  OK,   ERR,  ERR,  ERR,  ERR],
  /* OC */ [OK,  ERR,  OK,   WAR,  OK,   OK,   WAR,  OK,   ERR,  OK,   OK,   ERR],
  /* OE */ [OK,  ERR,  WAR,  WAR,  OK,   OK,   WAR,  OK,   ERR,  OK,   OK,   ERR],
  /* NC */ [ERR, ERR,  ERR,  ERR,  ERR,  ERR,  ERR,  ERR,  ERR,  ERR,  ERR,  ERR],
];

// erc.cpp pin-type driver sets.
const DRIVING = new Set(['output', 'power_out', 'passive', 'tri_state', 'bidirectional']);
const DRIVING_POWER = new Set(['power_out']);
const DRIVEN = new Set(['input', 'power_in']);

/** Human names, as ElectricalPinTypeGetText produces them. */
const TYPE_NAMES: Record<string, string> = {
  input: 'Input', output: 'Output', bidirectional: 'Bidirectional', tri_state: 'Tri-state',
  passive: 'Passive', free: 'Free', unspecified: 'Unspecified', power_in: 'Power input',
  power_out: 'Power output', open_collector: 'Open collector', open_emitter: 'Open emitter',
  no_connect: 'Unconnected',
};

export type ErcCode =
  | 'pin_not_connected'
  | 'pin_not_driven'
  | 'power_pin_not_driven'
  | 'pin_to_pin_warning'
  | 'pin_to_pin_error'
  | 'no_connect_connected'
  | 'no_connect_dangling'
  | 'label_not_connected'
  | 'label_single_pin';

export type ErcSeverity = 'error' | 'warning';

export interface ErcViolation {
  code: ErcCode;
  severity: ErcSeverity;
  message: string;
  at: Vec2;
  /** Item ids involved (selectable refIds; pin ids resolve to their symbol). */
  items: string[];
}

// ERC_SETTINGS default severities: error unless listed otherwise.
const SEVERITY: Record<ErcCode, ErcSeverity> = {
  pin_not_connected: 'error',
  pin_not_driven: 'error',
  power_pin_not_driven: 'error',
  pin_to_pin_warning: 'warning',
  pin_to_pin_error: 'error',
  no_connect_connected: 'warning',
  no_connect_dangling: 'warning',
  label_not_connected: 'error',
  label_single_pin: 'warning',
};

const violation = (code: ErcCode, message: string, at: Vec2, items: string[]): ErcViolation =>
  ({ code, severity: SEVERITY[code], message, at, items });

/** A pin id `<symId>:pin<k>` selects its parent symbol in the editor. */
const selectableId = (id: string): string => {
  const i = id.lastIndexOf(':pin');
  return i === -1 ? id : id.slice(0, i);
};

/** KiCad SCH_PIN::IsStacked (simplified): same symbol, same position. */
const stacked = (a: PinNode, b: PinNode): boolean =>
  a.symId === b.symId && a.at.x === b.at.x && a.at.y === b.at.y;

/** Run the electrical rules check on a single sheet. */
export function runErc(sch: Schematic, libById: Map<string, LibSymbol>): ErcViolation[] {
  const out: ErcViolation[] = [];
  const netlist = computeNetlist(sch, libById);
  const pins = enumeratePins(sch, libById);
  const pinById = new Map(pins.map((p) => [p.id, p]));

  // Item-kind lookups by id, matching the node ids computeNetlist emits.
  const labelIds = new Map<string, { text: string; at: Vec2; kind: string }>();
  sch.labels.forEach((l, i) => {
    if (l.kind !== 'text') labelIds.set(refId('label', l.uuid, i), { text: l.text, at: l.at, kind: l.kind });
  });
  const noConnectIds = new Map<string, Vec2>();
  sch.noConnects.forEach((nc, i) => noConnectIds.set(refId('noconnect', nc.uuid, i), nc.at));
  const wireIds = new Set<string>();
  sch.lines.forEach((l, i) => { if (l.kind === 'wire') wireIds.add(refId('line', l.uuid, i)); });
  // Sheet-pin node ids (`<sheetId>:sheetpin<k>`): they count as connections; nets
  // crossing the hierarchy are exempt from single-sheet label/unconnected checks.
  const isSheetPin = (id: string): boolean => id.includes(':sheetpin');

  // ----- per-subgraph checks (each computeNetlist net = one graphical subgraph) ---
  for (const net of netlist.nets) {
    const netPins = net.items.filter((id) => pinById.has(id)).map((id) => pinById.get(id)!);
    const netNCs = net.items.filter((id) => noConnectIds.has(id));
    const netLabels = net.items.filter((id) => labelIds.has(id));

    // Distinct (non-stacked) pins, as ercCheckNoConnects counts them.
    const distinctPins: PinNode[] = [];
    for (const p of netPins) {
      if (!distinctPins.some((q) => stacked(p, q))) distinctPins.push(p);
    }

    if (netNCs.length > 0) {
      if (distinctPins.length > 1) {
        const p = netPins[0]!;
        out.push(violation('no_connect_connected',
          'A pin with a "no connection" flag is connected', p.at,
          [selectableId(p.id), netNCs[0]!]));
      }
      if (netPins.length === 0 && netLabels.length === 0) {
        out.push(violation('no_connect_dangling',
          'Unconnected "no connection" flag', noConnectIds.get(netNCs[0]!)!, [netNCs[0]!]));
      }
      continue; // a no-connect exempts the subgraph from the unconnected-pin check
    }

    // ERCE_PIN_NOT_CONNECTED: a pin with no other connections on its subgraph.
    // Labels and sheet pins count as connections (they join the net by name);
    // other non-stacked pins count; a bare stub wire does not (KiCad: wires have
    // driver priority NONE).
    if (net.items.some(isSheetPin)) continue;
    if (netPins.length > 0 && netLabels.length === 0 && distinctPins.length === 1) {
      const p = distinctPins[0]!;
      if (p.electricalType !== 'no_connect' && p.electricalType !== 'free' && !p.hidden) {
        out.push(violation('pin_not_connected',
          `Pin ${p.number} (${TYPE_NAMES[p.electricalType] ?? p.electricalType}) of ${p.ref} is not connected`,
          p.at, [selectableId(p.id)]));
      }
    }
  }

  // ----- NC-type pins connected to anything (TestNoConnectPins) -----------------
  {
    const byPoint = new Map<string, { nc: PinNode[]; others: number }>();
    const keyOf = (p: Vec2): string => `${p.x},${p.y}`;
    for (const p of pins) {
      if (p.electricalType !== 'no_connect') continue;
      const e = byPoint.get(keyOf(p.at)) ?? { nc: [], others: 0 };
      e.nc.push(p);
      byPoint.set(keyOf(p.at), e);
    }
    const bump = (pt: Vec2): void => {
      const e = byPoint.get(keyOf(pt));
      if (e) e.others++;
    };
    for (const p of pins) if (p.electricalType !== 'no_connect') bump(p.at);
    sch.lines.forEach((l) => { if (l.kind === 'wire') { bump(l.start); bump(l.end); } });
    sch.labels.forEach((l) => { if (l.kind !== 'text') bump(l.at); });
    sch.junctions.forEach((j) => bump(j.at));
    for (const { nc, others } of byPoint.values()) {
      if (others > 0) {
        const p = nc[0]!;
        out.push(violation('no_connect_connected',
          `Pin with 'no connection' type is connected (pin ${p.number} of ${p.ref})`,
          p.at, [selectableId(p.id)]));
      }
    }
  }

  // ----- name-merged nets (KiCad m_nets: subgraphs grouped by net name) ---------
  interface NetGroup { pins: PinNode[]; hasNC: boolean; labels: string[]; hasSheetPin: boolean }
  const groups = new Map<string, NetGroup>();
  for (const net of netlist.nets) {
    let g = groups.get(net.name);
    if (!g) { g = { pins: [], hasNC: false, labels: [], hasSheetPin: false }; groups.set(net.name, g); }
    for (const id of net.items) {
      const p = pinById.get(id);
      if (p) g.pins.push(p);
      if (noConnectIds.has(id)) g.hasNC = true;
      if (labelIds.has(id)) g.labels.push(id);
      if (isSheetPin(id)) g.hasSheetPin = true;
    }
  }

  for (const group of groups.values()) {
    const gpins = group.pins;

    // Power net: any power-input pin present (erc.cpp TestPinToPin).
    const isPowerNet = gpins.some((p) => p.electricalType === 'power_in');

    let needsDriver: PinNode | null = null;
    let hasDriver = false;
    const mismatches: [number, number, PinError][] = [];
    const mismatchCounts = new Map<number, number>();

    for (let i = 0; i < gpins.length; i++) {
      const ref = gpins[i]!;
      const refType = ref.electricalType;

      if (DRIVEN.has(refType)) {
        // Prefer a visible pin, and on a power net a power-in pin, for the report.
        if (!needsDriver
            || (needsDriver.hidden && !ref.hidden)
            || (isPowerNet !== (needsDriver.electricalType === 'power_in')
                && isPowerNet === (refType === 'power_in'))) {
          needsDriver = ref;
        }
      }
      hasDriver ||= (isPowerNet ? DRIVING_POWER : DRIVING).has(refType);

      for (let j = i + 1; j < gpins.length; j++) {
        const test = gpins[j]!;
        if (stacked(ref, test)) continue; // stacked pins don't conflict
        const erc = PIN_MAP[typeIndex(refType)]![typeIndex(test.electricalType)]!;
        if (erc !== OK) {
          mismatches.push([i, j, erc]);
          mismatchCounts.set(i, (mismatchCounts.get(i) ?? 0) + 1);
          mismatchCounts.set(j, (mismatchCounts.get(j) ?? 0) + 1);
        }
      }
    }

    // Report each offending pin once, against its nearest conflicting pin,
    // consuming its pairs — KiCad's aggregation in TestPinToPin.
    const order = [...mismatchCounts.entries()].sort((a, b) => b[1] - a[1]).map(([idx]) => idx);
    let remaining = mismatches;
    for (const idx of order) {
      if (remaining.length === 0) break;
      const pin = gpins[idx]!;
      let nearest = -1;
      let nearestErc = WAR as PinError;
      let best = Infinity;
      remaining = remaining.filter(([a, b, erc]) => {
        const other = a === idx ? b : b === idx ? a : -1;
        if (other === -1) return true;
        const q = gpins[other]!;
        const d = (q.at.x - pin.at.x) ** 2 + (q.at.y - pin.at.y) ** 2;
        if (d < best) { best = d; nearest = other; nearestErc = erc; }
        return false;
      });
      if (nearest !== -1) {
        const other = gpins[nearest]!;
        const code: ErcCode = nearestErc === ERR ? 'pin_to_pin_error' : 'pin_to_pin_warning';
        out.push(violation(code,
          `Pins of type ${TYPE_NAMES[pin.electricalType]} and ${TYPE_NAMES[other.electricalType]} are connected`,
          pin.at, [selectableId(pin.id), selectableId(other.id)]));
      }
    }

    // Nets crossing the hierarchy through a sheet pin may be driven on the other
    // side; single-sheet ERC cannot see that, so the driver check stands down.
    if (needsDriver && !hasDriver && !group.hasNC && !group.hasSheetPin) {
      const code: ErcCode = isPowerNet ? 'power_pin_not_driven' : 'pin_not_driven';
      out.push(violation(code,
        isPowerNet ? 'Input Power pin not driven by any Output Power pins'
                   : 'Input pin not driven by any Output pins',
        needsDriver.at, [selectableId(needsDriver.id)]));
    }

    // ercCheckLabels: labels need pins on their (name-merged) net. Locals and
    // hierarchical labels error with none and warn with exactly one; globals
    // keep KiCad's default of ignoring the single-instance check.
    if (group.labels.length > 0 && !group.hasNC && !group.hasSheetPin && gpins.length <= 1) {
      for (const lid of group.labels) {
        const l = labelIds.get(lid)!;
        if (l.kind === 'global_label' && gpins.length === 1) continue;
        if (gpins.length === 0) {
          out.push(violation('label_not_connected', `Label '${l.text}' not connected`, l.at, [lid]));
        } else if (l.kind !== 'global_label') {
          out.push(violation('label_single_pin', `Label '${l.text}' connected to only one pin`, l.at, [lid]));
        }
      }
    }
  }

  // Stable order: errors first, then by position (KiCad sorts its report).
  out.sort((a, b) => (a.severity === b.severity
    ? a.at.y - b.at.y || a.at.x - b.at.x
    : a.severity === 'error' ? -1 : 1));
  return out;
}
