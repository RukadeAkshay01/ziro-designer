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

import type { Schematic, LibSymbol, Vec2 } from '../types.js';
import { refId } from '../tools/hittest.js';
import { computeNetlist, enumeratePins, onSegment, type PinNode } from './nets.js';
import { expandBusLabel, isBusLabel } from './bus.js';
import {
  OK,
  WAR,
  ERR,
  typeIndex,
  TYPE_NAMES,
  defaultErcSettings,
  type PinError,
  type ErcCode,
  type ErcSeverity,
  type ErcSettings,
} from '../erc/erc_settings.js';

// Re-export the ERC settings surface so `@ziroeda/eeschema` consumers keep
// importing these names from the ERC module (the Schematic Setup panels do).
export {
  PIN_TYPES,
  TYPE_NAMES,
  TYPE_ABBREV,
  ERC_ITEMS,
  DEFAULT_PIN_MAP,
  DEFAULT_SEVERITIES,
  defaultErcSettings,
  type ErcCode,
  type ErcSeverity,
  type ErcSeverityLevel,
  type ErcSettings,
  type PinError,
} from '../erc/erc_settings.js';

// erc.cpp pin-type driver sets.
const DRIVING = new Set(['output', 'power_out', 'passive', 'tri_state', 'bidirectional']);
const DRIVING_POWER = new Set(['power_out']);
const DRIVEN = new Set(['input', 'power_in']);

export interface ErcViolation {
  code: ErcCode;
  severity: ErcSeverity;
  message: string;
  at: Vec2;
  /** Item ids involved (selectable refIds; pin ids resolve to their symbol). */
  items: string[];
}

/**
 * An exclusion signature for a violation (SCH_MARKER::SerializeToString): the
 * settings key, position, and the involved item ids — enough to recognise the
 * same marker on a later run so its exclusion persists across ERC runs.
 */
export function ercExclusionKey(v: Pick<ErcViolation, 'code' | 'at' | 'items'>): string {
  return `${v.code}|${v.at.x}|${v.at.y}|${v.items[0] ?? ''}|${v.items[1] ?? ''}`;
}

// The active ERC configuration for the current run (set at the top of runErc).
let g_settings: ErcSettings = defaultErcSettings();

const violation = (code: ErcCode, message: string, at: Vec2, items: string[]): ErcViolation => ({
  code,
  // 'ignore' rules are dropped after the run; the survivors are error/warning.
  severity: g_settings.severities[code] as ErcSeverity,
  message,
  at,
  items,
});

/** A pin id `<symId>:pin<k>` selects its parent symbol in the editor. */
const selectableId = (id: string): string => {
  const i = id.lastIndexOf(':pin');
  return i === -1 ? id : id.slice(0, i);
};

/** KiCad SCH_PIN::IsStacked (simplified): same symbol, same position. */
const stacked = (a: PinNode, b: PinNode): boolean =>
  a.symId === b.symId && a.at.x === b.at.x && a.at.y === b.at.y;

/** Run the electrical rules check on a single sheet. `connectionGridIU` is
 *  SCHEMATIC_SETTINGS::m_ConnectionGridSize for the off-grid endpoint test
 *  (0/absent disables it, as a degenerate grid would flag everything);
 *  `busAliases` feeds bus-label expansion in the netlist. */
export function runErc(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  settings: ErcSettings = defaultErcSettings(),
  opts: {
    connectionGridIU?: number;
    busAliases?: ReadonlyMap<string, readonly string[]>;
  } = {},
): ErcViolation[] {
  g_settings = settings;
  const out: ErcViolation[] = [];
  const netlist = computeNetlist(sch, libById, { busAliases: opts.busAliases });
  const pins = enumeratePins(sch, libById);
  const pinById = new Map(pins.map((p) => [p.id, p]));

  // Item-kind lookups by id, matching the node ids computeNetlist emits.
  const labelIds = new Map<string, { text: string; at: Vec2; kind: string }>();
  sch.labels.forEach((l, i) => {
    if (l.kind !== 'text')
      labelIds.set(refId('label', l.uuid, i), { text: l.text, at: l.at, kind: l.kind });
  });
  const noConnectIds = new Map<string, Vec2>();
  sch.noConnects.forEach((nc, i) => noConnectIds.set(refId('noconnect', nc.uuid, i), nc.at));
  const wireIds = new Set<string>();
  sch.lines.forEach((l, i) => {
    if (l.kind === 'wire') wireIds.add(refId('line', l.uuid, i));
  });
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
        out.push(
          violation(
            'no_connect_connected',
            'A pin with a "no connection" flag is connected',
            p.at,
            [selectableId(p.id), netNCs[0]!],
          ),
        );
      }
      if (netPins.length === 0 && netLabels.length === 0) {
        out.push(
          violation(
            'no_connect_dangling',
            'Unconnected "no connection" flag',
            noConnectIds.get(netNCs[0]!)!,
            [netNCs[0]!],
          ),
        );
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
        out.push(
          violation(
            'pin_not_connected',
            `Pin ${p.number} (${TYPE_NAMES[p.electricalType] ?? p.electricalType}) of ${p.ref} is not connected`,
            p.at,
            [selectableId(p.id)],
          ),
        );
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
    sch.lines.forEach((l) => {
      if (l.kind === 'wire') {
        bump(l.start);
        bump(l.end);
      }
    });
    sch.labels.forEach((l) => {
      if (l.kind !== 'text') bump(l.at);
    });
    sch.junctions.forEach((j) => bump(j.at));
    for (const { nc, others } of byPoint.values()) {
      if (others > 0) {
        const p = nc[0]!;
        out.push(
          violation(
            'no_connect_connected',
            `Pin with 'no connection' type is connected (pin ${p.number} of ${p.ref})`,
            p.at,
            [selectableId(p.id)],
          ),
        );
      }
    }
  }

  // ----- name-merged nets (KiCad m_nets: subgraphs grouped by net name) ---------
  interface NetGroup {
    pins: PinNode[];
    hasNC: boolean;
    labels: string[];
    hasSheetPin: boolean;
  }
  const groups = new Map<string, NetGroup>();
  for (const net of netlist.nets) {
    let g = groups.get(net.name);
    if (!g) {
      g = { pins: [], hasNC: false, labels: [], hasSheetPin: false };
      groups.set(net.name, g);
    }
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
        if (
          !needsDriver ||
          (needsDriver.hidden && !ref.hidden) ||
          (isPowerNet !== (needsDriver.electricalType === 'power_in') &&
            isPowerNet === (refType === 'power_in'))
        ) {
          needsDriver = ref;
        }
      }
      hasDriver ||= (isPowerNet ? DRIVING_POWER : DRIVING).has(refType);

      for (let j = i + 1; j < gpins.length; j++) {
        const test = gpins[j]!;
        if (stacked(ref, test)) continue; // stacked pins don't conflict
        const erc = g_settings.pinMap[typeIndex(refType)]![typeIndex(test.electricalType)]!;
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
        if (d < best) {
          best = d;
          nearest = other;
          nearestErc = erc;
        }
        return false;
      });
      if (nearest !== -1) {
        const other = gpins[nearest]!;
        const code: ErcCode = nearestErc === ERR ? 'pin_to_pin_error' : 'pin_to_pin_warning';
        out.push(
          violation(
            code,
            `Pins of type ${TYPE_NAMES[pin.electricalType]} and ${TYPE_NAMES[other.electricalType]} are connected`,
            pin.at,
            [selectableId(pin.id), selectableId(other.id)],
          ),
        );
      }
    }

    // Nets crossing the hierarchy through a sheet pin may be driven on the other
    // side; single-sheet ERC cannot see that, so the driver check stands down.
    if (needsDriver && !hasDriver && !group.hasNC && !group.hasSheetPin) {
      const code: ErcCode = isPowerNet ? 'power_pin_not_driven' : 'pin_not_driven';
      out.push(
        violation(
          code,
          isPowerNet
            ? 'Input Power pin not driven by any Output Power pins'
            : 'Input pin not driven by any Output pins',
          needsDriver.at,
          [selectableId(needsDriver.id)],
        ),
      );
    }

    // ercCheckLabels: labels need pins on their (name-merged) net. Locals and
    // hierarchical labels error with none and warn with exactly one; globals
    // keep KiCad's default of ignoring the single-instance check.
    if (group.labels.length > 0 && !group.hasNC && !group.hasSheetPin && gpins.length <= 1) {
      for (const lid of group.labels) {
        const l = labelIds.get(lid)!;
        if (l.kind === 'global_label' && gpins.length === 1) continue;
        if (gpins.length === 0) {
          out.push(
            violation('label_not_connected', `Label '${l.text}' not connected`, l.at, [lid]),
          );
        } else if (l.kind !== 'global_label') {
          out.push(
            violation('label_single_pin', `Label '${l.text}' connected to only one pin`, l.at, [
              lid,
            ]),
          );
        }
      }
    }
  }

  // ERC_TESTER::TestOffGridEndpoints: wire/bus endpoints, bus-entry connection
  // points and symbol pins must sit on the connection grid (Schematic Setup >
  // Formatting, SCHEMATIC_SETTINGS::m_ConnectionGridSize). One marker per
  // wire (start, else end) and per symbol (first off-grid pin), like upstream.
  const grid = Math.round(opts.connectionGridIU ?? 0);
  if (grid > 0) {
    const MSG = 'Symbol pin or wire end off connection grid';
    const off = (p: Vec2): boolean => Math.round(p.x) % grid !== 0 || Math.round(p.y) % grid !== 0;
    sch.lines.forEach((l, i) => {
      if (l.kind !== 'wire' && l.kind !== 'bus') return;
      const lid = refId('line', l.uuid, i);
      if (off(l.start)) out.push(violation('endpoint_off_grid', MSG, l.start, [lid]));
      else if (off(l.end)) out.push(violation('endpoint_off_grid', MSG, l.end, [lid]));
    });
    sch.busEntries.forEach((e, i) => {
      const eid = refId('busentry', e.uuid, i);
      for (const p of [e.at, { x: e.at.x + e.size.x, y: e.at.y + e.size.y }]) {
        if (off(p)) out.push(violation('endpoint_off_grid', MSG, p, [eid]));
      }
    });
    const flagged = new Set<string>();
    for (const p of pins) {
      // NC-type pins are exempt (upstream skips ELECTRICAL_PINTYPE::PT_NC).
      if (flagged.has(p.symId) || p.electricalType === 'no_connect') continue;
      if (off(p.at)) {
        out.push(violation('endpoint_off_grid', MSG, p.at, [p.id]));
        flagged.add(p.symId);
      }
    }
  }

  // ----- Bus rules (CONNECTION_GRAPH::ercCheckBus*) ------------------------
  const busLines = sch.lines
    .map((l, i) => ({ l, id: refId('line', l.uuid, i) }))
    .filter((x) => x.l.kind === 'bus');
  const netByCode = new Map(netlist.nets.map((n) => [n.code, n]));

  // bus_to_net_conflict (ERCE_BUS_TO_NET_CONFLICT): a wire endpoint sitting
  // directly on a bus (no entry), or a bus-syntax label driving a wire net.
  sch.lines.forEach((l, i) => {
    if (l.kind !== 'wire') return;
    const wid = refId('line', l.uuid, i);
    for (const p of [l.start, l.end]) {
      const bus = busLines.find((b) => onSegment(p, b.l.start, b.l.end));
      if (bus) {
        out.push(
          violation('bus_to_net_conflict', 'Invalid connection between bus and net items', p, [
            wid,
            bus.id,
          ]),
        );
        break; // one marker per wire, like the off-grid test
      }
    }
  });
  for (const [lid, l] of labelIds) {
    if (!isBusLabel(l.text)) continue;
    // Bus labels on a bus were routed to the bus graph; one still in the wire
    // netlist is a bus label attached to net items — but only when the net
    // has other items (upstream needs a net item AND a bus item; a floating
    // bus label is just unconnected).
    const code = netlist.netByItem.get(lid);
    const net = code !== undefined ? netByCode.get(code) : undefined;
    if (net && net.items.length > 1) {
      out.push(
        violation('bus_to_net_conflict', 'Invalid connection between bus and net items', l.at, [
          lid,
        ]),
      );
    }
  }

  // net_not_bus_member (ERCE_BUS_ENTRY_CONFLICT): a net attached to a bus via
  // an entry, whose resolved name is not one of the bus's members. Power-pin /
  // global-label driven nets are exempt, and unnamed (auto-named) nets are
  // left to the unconnected checks, like upstream.
  const globalLabelNets = new Set<number>();
  for (const [lid, l] of labelIds) {
    if (l.kind === 'global_label') {
      const code = netlist.netByItem.get(lid);
      if (code !== undefined) globalLabelNets.add(code);
    }
  }
  const powerNets = new Set<number>();
  for (const p of pins) {
    if (!p.isPowerSymbol) continue;
    const code = netlist.netByItem.get(p.id);
    if (code !== undefined) powerNets.add(code);
  }
  const entryById = new Map(
    sch.busEntries.map((e, i) => [refId('busentry', e.uuid, i), e] as const),
  );
  for (const bus of netlist.buses) {
    if (bus.members.length === 0) continue;
    const memberSet = new Set(bus.members);
    const busLineId = bus.items.find((id) => busLines.some((b) => b.id === id));
    for (const entryId of bus.entryIds) {
      const code = netlist.netByItem.get(entryId);
      if (code === undefined) continue;
      if (globalLabelNets.has(code) || powerNets.has(code)) continue;
      const net = netByCode.get(code);
      if (!net || net.name.startsWith('Net-')) continue; // undriven: incomplete
      if (memberSet.has(net.name)) continue;
      const entry = entryById.get(entryId);
      out.push(
        violation(
          'net_not_bus_member',
          `Net ${net.name} is graphically connected to bus ${bus.name} but is not a member of that bus`,
          entry?.at ?? { x: 0, y: 0 },
          busLineId ? [entryId, busLineId] : [entryId],
        ),
      );
    }
  }

  // bus_to_bus_conflict (ERCE_BUS_TO_BUS_CONFLICT): a bus label and a bus
  // port (hierarchical label) on the same bus that share no members.
  for (const bus of netlist.buses) {
    const label = bus.labels.find((l) => !l.port);
    const port = bus.labels.find((l) => l.port);
    if (!label || !port) continue;
    const a = new Set(expandBusLabel(label.text, opts.busAliases)?.members ?? []);
    const bMembers = expandBusLabel(port.text, opts.busAliases)?.members ?? [];
    if (!bMembers.some((m) => a.has(m))) {
      const l = labelIds.get(label.id);
      out.push(
        violation(
          'bus_to_bus_conflict',
          'Buses are graphically connected but share no bus members',
          l?.at ?? { x: 0, y: 0 },
          [label.id, port.id],
        ),
      );
    }
  }

  // Drop rules set to "ignore" in the Schematic Setup severities panel.
  const kept = out.filter((v) => g_settings.severities[v.code] !== 'ignore');

  // Stable order: errors first, then by position (KiCad sorts its report).
  kept.sort((a, b) =>
    a.severity === b.severity
      ? a.at.y - b.at.y || a.at.x - b.at.x
      : a.severity === 'error'
        ? -1
        : 1,
  );
  return kept;
}
