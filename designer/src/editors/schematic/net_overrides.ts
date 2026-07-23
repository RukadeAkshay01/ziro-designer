/**
 * Per-item netclass render overrides. Counterparts: `SCH_LINE::GetLineColor` /
 * `GetPenWidth` / `GetEffectiveLineStyle` (an item without its own stroke
 * falls back to its net's effective netclass) and
 * `SCH_JUNCTION::getEffectiveShape` (the settings dot size is clamped to
 * ≥170% of the connected wire width).
 *
 * The maps are keyed by the renderer's refIds; the renderer applies them only
 * where the item itself doesn't override (explicit stroke wins, per upstream).
 */

import {
  computeNetlist,
  refId,
  type LibSymbol,
  type Netlist,
  type Schematic,
} from '@ziroeda/eeschema';
import {
  IU_PER_MILS,
  LINE_STYLES,
  junctionDotDiameterIU,
  resolveEffectiveNetClass,
  type SchematicSetup,
} from './schematic_settings.js';

export interface NetClassOverrides {
  /** Line refId -> stroke fallback (wires get wire width, buses bus width). */
  lines: ReadonlyMap<string, { color?: string; widthIU?: number; dash?: string }>;
  /** Junction refId -> effective dot diameter (settings size clamped to
   *  ≥ 1.7 × the net's wire width). */
  junctions: ReadonlyMap<string, number>;
}

/** LINE_STYLES name -> the renderer's stroke-type token (solid = undefined). */
const DASH_TOKENS: Record<string, string | undefined> = {
  Solid: undefined,
  Dashed: 'dash',
  Dotted: 'dot',
  'Dash-Dot': 'dash_dot',
  'Dash-Dot-Dot': 'dash_dot_dot',
};

/** True when no class carries a visual parameter — the whole pass can skip. */
function nothingToApply(s: SchematicSetup): boolean {
  return s.netClasses.classes.every(
    (c) =>
      !c.color &&
      c.wireThickness.trim() === '' &&
      c.busThickness.trim() === '' &&
      (c.lineStyle === 'Solid' || LINE_STYLES.indexOf(c.lineStyle) <= 0),
  );
}

/**
 * Resolve every net's effective netclass and emit the per-item overrides.
 * Pass a precomputed netlist when one is at hand (the editor's memo); plot
 * paths let it compute one per document.
 */
export function computeNetClassOverrides(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  setup: SchematicSetup,
  netlist?: Netlist | null,
): NetClassOverrides | undefined {
  if (nothingToApply(setup)) return undefined;
  const nl = netlist ?? computeNetlist(sch, libById);

  // refId -> line kind, for wire-vs-bus width selection.
  const lineKind = new Map<string, 'wire' | 'bus'>();
  sch.lines.forEach((l, i) => {
    if (l.kind === 'wire' || l.kind === 'bus') lineKind.set(refId('line', l.uuid, i), l.kind);
  });
  const junctionIds = new Set<string>();
  sch.junctions.forEach((j, i) => junctionIds.add(refId('junction', j.uuid, i)));

  const baseDot = junctionDotDiameterIU(setup);
  const lines = new Map<string, { color?: string; widthIU?: number; dash?: string }>();
  const junctions = new Map<string, number>();

  for (const net of nl.nets) {
    const eff = resolveEffectiveNetClass(net.name, setup.netClasses);
    const dash = DASH_TOKENS[eff.lineStyle];
    const wireIU = eff.wireWidthMils !== undefined ? eff.wireWidthMils * IU_PER_MILS : undefined;
    const busIU = eff.busWidthMils !== undefined ? eff.busWidthMils * IU_PER_MILS : undefined;
    const hasLineOverride =
      eff.color !== undefined || wireIU !== undefined || busIU !== undefined || dash !== undefined;
    for (const id of net.items) {
      const kind = lineKind.get(id);
      if (kind && hasLineOverride) {
        const widthIU = kind === 'bus' ? busIU : wireIU;
        lines.set(id, {
          ...(eff.color !== undefined ? { color: eff.color } : {}),
          ...(widthIU !== undefined ? { widthIU } : {}),
          ...(dash !== undefined ? { dash } : {}),
        });
      } else if (junctionIds.has(id) && wireIU !== undefined && baseDot > 1) {
        // sch_junction.cpp: diameter 1 ("None") skips the wire-width clamp.
        junctions.set(id, Math.max(baseDot, Math.round(wireIU * 1.7)));
      }
    }
  }
  if (lines.size === 0 && junctions.size === 0) return undefined;
  return { lines, junctions };
}
