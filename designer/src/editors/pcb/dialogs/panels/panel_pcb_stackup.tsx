/**
 * Board Setup > Board Stackup > Physical Stackup. Counterpart:
 * `pcbnew/board_stackup_manager/panel_board_stackup.cpp`
 * (PANEL_SETUP_BOARD_STACKUP) — the physical layer stack: a copper-layer
 * count + impedance-controlled option, a borderless 12-column grid (Layer /
 * Id / Type / Material+browse / Thickness+lock / Color / Epsilon R / Loss Tan
 * / Spec Freq / Dielectric Model) and the board thickness. All four actions
 * are KiCad's:
 *
 *  - Add Dielectric Layer… (onAddDielectricLayer): an EDA_LIST_DIALOG of the
 *    dielectric sublayers in stackup order ("Layer 'Dielectric N'
 *    (sublayer i/n)"), inserting a fresh DIELECTRIC_PRMS — thickness 0,
 *    epsilon 1, loss 0 — after the chosen one.
 *  - Remove Dielectric Layer… (onRemoveDielectricLayer): lists only the
 *    sublayers of dielectrics that have two or more; the button enables only
 *    when such a dielectric exists (onRemoveDielUI).
 *  - Adjust Dielectric Thickness (onAdjustDielectricThickness +
 *    setDefaultLayerWidths): asks for the target board thickness (min = the
 *    sum of the non-adjustable layers), then distributes — prepregs at a
 *    fixed 0.1 mm, cores splitting the remainder, alternating types
 *    (prepreg-outside except on a two-layer board), both shrinking equally
 *    when 0.1 mm cores would not fit; locked layers keep their value.
 *  - Export to Clipboard (onExportToClipboard / BuildStackupReport): the
 *    ASCII stackup report, one line per enabled layer plus the finish line.
 *
 * The material "…" buttons open DIALOG_DIELECTRIC_MATERIAL: editable
 * Material / Epsilon R / Loss Tan fields over the predefined substrate table
 * for the row's type (dielectric_material.cpp substrateMaterial /
 * solderMaskMaterial / silkscreenMaterial).
 */

import { useState, type JSX } from 'react';
import {
  buildStackup,
  type DielectricSublayer,
  type PhysicalStackup,
  type StackupLayer,
} from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  buildStackup,
  defaultPhysicalStackup,
  type DielectricSublayer,
  type PhysicalStackup,
  type StackupLayer,
} from '../../board_settings.js';

const COPPER_COUNTS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

// Which editable fields a row's type carries (Solder Paste rows carry none).
const hasField = (type: string, f: 'mat' | 'thick' | 'color' | 'eps' | 'diel'): boolean => {
  if (type.includes('Solder Paste')) return false;
  if (type === 'Copper') return f === 'mat' || f === 'thick';
  if (type.includes('Silk Screen')) return f === 'mat' || f === 'thick' || f === 'color';
  if (type.includes('Solder Mask'))
    return f === 'mat' || f === 'thick' || f === 'color' || f === 'eps';
  // Dielectric (Core / Prepreg)
  return true;
};
const isDielectric = (l: StackupLayer): boolean => l.type === 'Core' || l.type === 'Prepreg';

const SWATCH: Record<string, string> = {
  'Silk Screen': '#e0e0e0',
  'Solder Paste': '#9a9a9a',
  'Solder Mask': '#2e8b57',
  Copper: '#c08a3e',
  Core: '#6b5b45',
  Prepreg: '#6b5b45',
};
const swatchColor = (type: string): string => {
  for (const k of Object.keys(SWATCH)) if (type.includes(k)) return SWATCH[k]!;
  return 'transparent';
};

// Predefined substrates (dielectric_material.cpp — names are used in .gbrjob
// files, so they are proper nouns and not translated).
type Substrate = { name: string; epsilonR: number; lossTan: number };
const SUBSTRATE_MATERIALS: Substrate[] = [
  { name: 'Not specified', epsilonR: 0.0, lossTan: 0.0 },
  { name: 'FR4', epsilonR: 4.5, lossTan: 0.02 },
  { name: 'FR408-HR', epsilonR: 3.69, lossTan: 0.0091 },
  { name: 'Polyimide', epsilonR: 3.2, lossTan: 0.004 },
  { name: 'Kapton', epsilonR: 3.2, lossTan: 0.004 },
  { name: 'Polyolefin', epsilonR: 1.0, lossTan: 0.0 },
  { name: 'Al', epsilonR: 8.7, lossTan: 0.001 },
  { name: 'PTFE', epsilonR: 2.1, lossTan: 0.0002 },
  { name: 'Teflon', epsilonR: 2.1, lossTan: 0.0002 },
  { name: 'Ceramic', epsilonR: 1.0, lossTan: 0.0 },
];
const SOLDERMASK_MATERIALS: Substrate[] = [
  { name: 'Not specified', epsilonR: 3.3, lossTan: 0.0 },
  { name: 'Epoxy', epsilonR: 3.3, lossTan: 0.0 },
  { name: 'Liquid Ink', epsilonR: 3.3, lossTan: 0.0 },
  { name: 'Dry Film', epsilonR: 3.3, lossTan: 0.0 },
];
const SILKSCREEN_MATERIALS: Substrate[] = [
  { name: 'Not specified', epsilonR: 1.0, lossTan: 0.0 },
  { name: 'Liquid Photo', epsilonR: 1.0, lossTan: 0.0 },
  { name: 'Direct Printing', epsilonR: 1.0, lossTan: 0.0 },
];
const materialsFor = (type: string): Substrate[] => {
  if (type.includes('Solder Mask')) return SOLDERMASK_MATERIALS;
  if (type.includes('Silk Screen')) return SILKSCREEN_MATERIALS;
  return SUBSTRATE_MATERIALS;
};

/** Display stackup name -> canonical board layer name (report/file). */
const CANONICAL: Record<string, string> = {
  'F.Silkscreen': 'F.SilkS',
  'B.Silkscreen': 'B.SilkS',
};
/** Display type -> the file/report type string (GetTypeName). */
const TYPE_NAME: Record<string, string> = { Copper: 'copper', Core: 'core', Prepreg: 'prepreg' };

const trimNum = (v: number): string => {
  let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
};

/** BuildStackupReport (board_stackup_reporter.cpp): the clipboard text. */
export function buildStackupReport(
  stackup: PhysicalStackup,
  finish: { copperFinish: string; platedBoardEdge: boolean; edgeCardConnectors: string },
): string {
  let report = '';
  stackup.layers.forEach((l, i) => {
    const typeName = TYPE_NAME[l.type] ?? l.type;
    const subCount = 1 + (l.sublayers?.length ?? 0);
    if (isDielectric(l)) {
      // Dielectric ids restart at 1 in stackup order.
      const dielId = stackup.layers.slice(0, i + 1).filter((x) => isDielectric(x)).length;
      report += `layer "Dielectric ${dielId}" type "${typeName}"\n  sublayer "1/${subCount}"`;
    } else {
      report += `layer "${CANONICAL[l.name] ?? l.name}" type "${typeName}"`;
    }
    if (hasField(l.type, 'color')) report += ` Color "${l.color || 'Not specified'}"`;
    const subs: {
      thicknessMM: number;
      locked?: boolean;
      material: string;
      epsilonR?: number;
      lossTan?: number;
    }[] = [l, ...(l.sublayers ?? [])];
    subs.forEach((p, idx) => {
      if (idx) report += `\n  sublayer "${idx + 1}/${subCount}"`;
      if (hasField(l.type, 'thick')) {
        report += ` Thickness ${trimNum(p.thicknessMM)} mm`;
        if (isDielectric(l) && p.locked) report += ' Locked';
      }
      if (hasField(l.type, 'mat')) report += ` Material "${p.material}"`;
      if (p.epsilonR !== undefined) report += ` EpsilonR ${trimNum(p.epsilonR)}`;
      if (p.lossTan !== undefined) report += ` LossTg ${trimNum(p.lossTan)}`;
    });
    report += '\n';
  });
  report += `Finish "${finish.copperFinish}"`;
  if (stackup.impedanceControlled) report += ' Option "Impedance Controlled"';
  if (finish.platedBoardEdge) report += ' Option "Plated edges"';
  if (finish.edgeCardConnectors !== 'None') {
    report += ` EdgeConnector "${finish.edgeCardConnectors === 'Yes, bevelled' ? 'yes,bevelled' : 'yes'}"`;
  }
  report += '\n';
  return report;
}

interface Props {
  value: PhysicalStackup;
  onChange: (next: PhysicalStackup) => void;
  /** Board finish values for the clipboard report (the sibling page's data). */
  finish?: { copperFinish: string; platedBoardEdge: boolean; edgeCardConnectors: string };
}

// KiCad's 12-column wxFlexGridSizer (borderless form; Material has a browse
// button in its own column). Content-sized columns, no cell borders/gridlines.
const HEADERS = [
  'Layer',
  'Id',
  'Type',
  'Material',
  '',
  'Thickness',
  '',
  'Color',
  'Epsilon R',
  'Loss Tan',
  'Spec Freq',
  'Dielectric Model',
];
const GRID_COLS = '40px 96px 138px 118px 26px 84px 26px 150px 64px 64px 80px 120px';
const COLORS = ['Not specified', 'White', 'Black', 'Green', 'Red', 'Blue', 'Yellow'];

/** A picked material-browse / add / remove target. */
type MaterialTarget = { layer: number; sub: number }; // sub 0 = main
type ListPick = { title: string; label: string; items: string[]; onPick: (index: number) => void };

export function PanelPcbStackup({ value, onChange, finish }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const setLayer = (i: number, patch: Partial<StackupLayer>): void =>
    onChange({ ...value, layers: value.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setSub = (i: number, si: number, patch: Partial<DielectricSublayer>): void => {
    const l = value.layers[i]!;
    const sublayers = (l.sublayers ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s));
    setLayer(i, { sublayers });
  };
  const setCount = (copperCount: number): void =>
    onChange({ ...value, copperCount, layers: buildStackup(copperCount) });

  const subCountOf = (l: StackupLayer): number => 1 + (l.sublayers?.length ?? 0);
  const boardThickness = value.layers.reduce(
    (s, l) =>
      s + (l.thicknessMM || 0) + (l.sublayers ?? []).reduce((a, p) => a + (p.thicknessMM || 0), 0),
    0,
  );

  // Dielectric numbering in stackup order (FormatDielectricLayerName).
  const dielIdOf = (i: number): number =>
    value.layers.slice(0, i + 1).filter((l) => isDielectric(l)).length;

  // ----- list-picker + material dialogs ------------------------------------
  const [listPick, setListPick] = useState<ListPick | null>(null);
  const [listSel, setListSel] = useState(0);
  const [matTarget, setMatTarget] = useState<MaterialTarget | null>(null);
  const [matDraft, setMatDraft] = useState<Substrate>({ name: '', epsilonR: 0, lossTan: 0 });

  // onAddDielectricLayer: every dielectric sublayer is an insert position.
  const onAddDielectric = (): void => {
    const items: string[] = [];
    const targets: MaterialTarget[] = [];
    value.layers.forEach((l, i) => {
      if (!isDielectric(l)) return;
      const n = subCountOf(l);
      for (let si = 0; si < n; si++) {
        items.push(
          n > 1
            ? `Layer 'Dielectric ${dielIdOf(i)}' (sublayer ${si + 1}/${n})`
            : `Dielectric ${dielIdOf(i)}`,
        );
        targets.push({ layer: i, sub: si });
      }
    });
    setListSel(0);
    setListPick({
      title: 'Add Dielectric Layer',
      label: 'Select layer to add:',
      items,
      onPick: (index) => {
        const t = targets[index]!;
        const l = value.layers[t.layer]!;
        // Insert a fresh DIELECTRIC_PRMS after the selected sublayer
        // (thickness 0, epsilon 1, loss 0 — the C++ default constructor).
        const fresh: DielectricSublayer = { material: '', thicknessMM: 0, epsilonR: 1, lossTan: 0 };
        const subs = [...(l.sublayers ?? [])];
        subs.splice(t.sub, 0, fresh); // after main (sub 0) = subs[0]; after sub k = subs[k]
        setLayer(t.layer, { sublayers: subs });
      },
    });
  };

  // onRemoveDielectricLayer: only sublayers of dielectrics with >= 2 listed.
  const removableExists = value.layers.some((l) => isDielectric(l) && subCountOf(l) > 1);
  const onRemoveDielectric = (): void => {
    const items: string[] = [];
    const targets: MaterialTarget[] = [];
    value.layers.forEach((l, i) => {
      if (!isDielectric(l) || subCountOf(l) <= 1) return;
      const n = subCountOf(l);
      for (let si = 0; si < n; si++) {
        items.push(`Layer 'Dielectric ${dielIdOf(i)}' sublayer ${si + 1}/${n}`);
        targets.push({ layer: i, sub: si });
      }
    });
    setListSel(0);
    setListPick({
      title: 'Remove Dielectric Layer',
      label: 'Select layer to remove:',
      items,
      onPick: (index) => {
        const t = targets[index]!;
        const l = value.layers[t.layer]!;
        // RemoveDielectricPrms: drop the prms entry; prms[0] is the main
        // layer, so removing it promotes the first sublayer.
        const prms: DielectricSublayer[] = [
          {
            material: l.material,
            thicknessMM: l.thicknessMM,
            epsilonR: l.epsilonR,
            lossTan: l.lossTan,
            locked: l.locked,
          },
          ...(l.sublayers ?? []),
        ];
        prms.splice(t.sub, 1);
        const [main, ...rest] = prms;
        setLayer(t.layer, {
          material: main!.material,
          thicknessMM: main!.thicknessMM,
          epsilonR: main!.epsilonR,
          lossTan: main!.lossTan,
          locked: main!.locked,
          sublayers: rest.length ? rest : undefined,
        });
      },
    });
  };

  // onAdjustDielectricThickness + setDefaultLayerWidths.
  const onAdjustThickness = (): void => {
    // Min thickness = every thickness the algorithm may not change: layers
    // without a lock control (copper/mask/silk) and locked dielectrics.
    let minThickness = 0;
    let candidates = 0;
    const eachThickness = (
      l: StackupLayer,
      p: { thicknessMM: number; locked?: boolean },
      lockable: boolean,
    ): void => {
      if (!hasField(l.type, 'thick')) return;
      if (lockable && !p.locked) candidates++;
      else minThickness += p.thicknessMM || 0;
    };
    for (const l of value.layers) {
      eachThickness(l, l, isDielectric(l));
      for (const sub of l.sublayers ?? []) eachThickness(l, sub, true);
    }
    const title =
      minThickness === 0
        ? 'Enter board thickness in mm:'
        : `Enter expected board thickness (min value ${trimNum(minThickness)} mm):`;
    const answer = window.prompt(`Adjust Unlocked Dielectric Layers\n\n${title}`);
    if (answer === null) return;
    const target = Number(answer);
    if (!Number.isFinite(target)) return;
    if (target < minThickness) {
      window.alert(`Value too small (min value ${trimNum(minThickness)} mm).`);
      return;
    }
    if (candidates === 0) {
      window.alert('All dielectric  thickness layers are locked');
      return;
    }

    // setDefaultLayerWidths: fixed 0.1 mm prepregs, cores share the rest,
    // alternating prepreg/core from the outside in (a two-layer board is a
    // single core); both shrink equally when 0.1 mm cores would not fit.
    const prePregDefault = 0.1;
    const copperCount = value.copperCount;
    const dielectricCount = copperCount - 1;
    let coreCount = copperCount / 2 - 1;
    let currentIsCore = false;
    if (copperCount === 2) {
      coreCount = 1;
      currentIsCore = true;
    }
    const prePregCount = dielectricCount - coreCount;

    // Fixed widths: masks/silks/coppers, locked dielectric mains, and every
    // secondary sublayer (they are never auto-resized).
    let fixed = 0;
    for (const l of value.layers) {
      if (hasField(l.type, 'thick') && (!isDielectric(l) || l.locked)) fixed += l.thicknessMM || 0;
      for (const sub of l.sublayers ?? []) fixed += sub.thicknessMM || 0;
    }
    let prePreg = prePregDefault;
    let core = (target - fixed - prePregDefault * prePregCount) / coreCount;
    if (core < prePreg) {
      const remaining = target - fixed;
      prePreg = core = Math.max(0, remaining / dielectricCount);
    }
    const round = (v: number): number => Math.round(v * 1e6) / 1e6;
    const layers = value.layers.map((l) => {
      if (!isDielectric(l)) return l;
      if (l.locked) {
        currentIsCore = !currentIsCore;
        return l;
      }
      const next: StackupLayer = {
        ...l,
        type: currentIsCore ? 'Core' : 'Prepreg',
        thicknessMM: round(currentIsCore ? core : prePreg),
      };
      currentIsCore = !currentIsCore;
      return next;
    });
    onChange({ ...value, layers });
  };

  // onExportToClipboard: the ASCII stackup report.
  const onExport = (): void => {
    const report = buildStackupReport(
      value,
      finish ?? { copperFinish: 'None', platedBoardEdge: false, edgeCardConnectors: 'None' },
    );
    void navigator.clipboard?.writeText(report);
  };

  // Material browse (DIALOG_DIELECTRIC_MATERIAL).
  const openMaterial = (layer: number, sub: number): void => {
    const l = value.layers[layer]!;
    const p = sub === 0 ? l : l.sublayers![sub - 1]!;
    setMatDraft({
      name: p.material || 'Not specified',
      epsilonR: p.epsilonR ?? 0,
      lossTan: p.lossTan ?? 0,
    });
    setMatTarget({ layer, sub });
  };
  const commitMaterial = (): void => {
    if (!matTarget) return;
    const l = value.layers[matTarget.layer]!;
    const patch = {
      material: matDraft.name,
      // Silk rows carry no epsilon field in the grid, but the value still
      // rides along in the model, like the C++ item.
      epsilonR: matDraft.epsilonR,
      lossTan: matDraft.lossTan,
    };
    if (matTarget.sub === 0) setLayer(matTarget.layer, patch);
    else setSub(matTarget.layer, matTarget.sub - 1, patch);
    setMatTarget(null);
  };
  const matType = matTarget ? value.layers[matTarget.layer]!.type : '';

  const txt = (
    v: string | number | undefined,
    onText: (s: string) => void,
    numeric: boolean,
  ): JSX.Element => (
    <input
      className="ze-search"
      type="text"
      style={{ width: '100%', boxSizing: 'border-box' }}
      value={v ?? ''}
      onChange={(e) => onText(e.target.value)}
      data-numeric={numeric || undefined}
    />
  );
  const blank = <span />;

  // One grid row (12 cells) for a main layer or a dielectric sublayer.
  const renderRow = (l: StackupLayer, i: number, sub: number): JSX.Element[] => {
    const diel = isDielectric(l);
    const p = sub === 0 ? l : l.sublayers![sub - 1]!;
    const key = `${i}.${sub}`;
    const setP = (patch: Record<string, unknown>): void => {
      if (sub === 0) setLayer(i, patch as Partial<StackupLayer>);
      else setSub(i, sub - 1, patch as Partial<DielectricSublayer>);
    };
    return [
      // Layer: colour swatch (main rows only)
      <div key={`${key}-sw`} style={{ display: 'flex', justifyContent: 'center' }}>
        {sub === 0 ? (
          <span
            style={{
              display: 'inline-block',
              width: 24,
              height: 8,
              borderRadius: 2,
              background: swatchColor(l.type),
              border: '1px solid var(--chrome-border)',
            }}
          />
        ) : (
          blank
        )}
      </div>,
      // Id: name; sublayers show their "i/n" ordinal, like the C++ rows.
      <div key={`${key}-id`} style={sub ? { paddingLeft: 12 } : undefined}>
        {sub === 0 ? l.name : `sublayer ${sub + 1}/${subCountOf(l)}`}
      </div>,
      // Type
      <div key={`${key}-ty`}>{sub === 0 ? l.type : blank}</div>,
      // Material
      <div key={`${key}-mat`}>
        {hasField(l.type, 'mat') ? txt(p.material, (s) => setP({ material: s }), false) : blank}
      </div>,
      // Material browse button
      <div key={`${key}-matb`}>
        {hasField(l.type, 'mat') ? (
          <button
            className="ze-gridbtn"
            style={{ width: 24, height: 24 }}
            title="Select material"
            onClick={() => openMaterial(i, sub)}
          >
            …
          </button>
        ) : (
          blank
        )}
      </div>,
      // Thickness
      <div key={`${key}-th`}>
        {hasField(l.type, 'thick')
          ? txt(p.thicknessMM, (s) => setP({ thicknessMM: num(s) }), true)
          : blank}
      </div>,
      // Lock (dielectric main + sublayers)
      <div key={`${key}-lk`} style={{ textAlign: 'center' }}>
        {diel ? (
          <input
            type="checkbox"
            title="Locked thickness"
            checked={!!p.locked}
            onChange={(e) => setP({ locked: e.target.checked })}
          />
        ) : (
          blank
        )}
      </div>,
      // Color (main rows only)
      <div key={`${key}-cl`}>
        {sub === 0 && hasField(l.type, 'color') ? (
          <select
            className="ze-select"
            style={{ width: '100%' }}
            value={l.color || 'Not specified'}
            onChange={(e) => setLayer(i, { color: e.target.value })}
          >
            {COLORS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : (
          blank
        )}
      </div>,
      // Epsilon R
      <div key={`${key}-ep`}>
        {hasField(l.type, 'eps') ? txt(p.epsilonR, (s) => setP({ epsilonR: num(s) }), true) : blank}
      </div>,
      // Loss Tan
      <div key={`${key}-lt`}>
        {hasField(l.type, 'eps') ? txt(p.lossTan, (s) => setP({ lossTan: num(s) }), true) : blank}
      </div>,
      // Spec Freq (main dielectric rows only)
      <div key={`${key}-sf`}>
        {diel && sub === 0 ? txt(l.specFreq, (s) => setLayer(i, { specFreq: s }), false) : blank}
      </div>,
      // Dielectric Model (main dielectric rows only)
      <div key={`${key}-dm`}>{diel && sub === 0 ? l.dielectricModel : blank}</div>,
    ];
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      {/* Top options */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 8,
          fontSize: 12.5,
          flexWrap: 'wrap',
        }}
      >
        <span>Copper layers:</span>
        <select
          className="ze-select"
          value={value.copperCount}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          {COPPER_COUNTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input
            type="checkbox"
            checked={value.impedanceControlled}
            onChange={(e) => onChange({ ...value, impedanceControlled: e.target.checked })}
          />
          Impedance controlled
        </label>
        <span style={{ flex: 1 }} />
        <button className="ze-btn sm" onClick={onAddDielectric}>
          Add Dielectric Layer...
        </button>
        <button className="ze-btn sm" disabled={!removableExists} onClick={onRemoveDielectric}>
          Remove Dielectric Layer...
        </button>
      </div>

      {/* Stackup grid: borderless flexgrid (no table/cell borders), like KiCad. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_COLS,
            alignItems: 'center',
            columnGap: 4,
            rowGap: 6,
            fontSize: 12,
            width: 'max-content',
          }}
        >
          {/* Header row */}
          {HEADERS.map((h, i) => (
            <div
              key={`h${i}`}
              style={{ fontWeight: 600, padding: '2px 2px 6px', textAlign: 'center' }}
            >
              {h}
            </div>
          ))}

          {/* Layer rows + dielectric sublayer rows */}
          {value.layers.flatMap((l, i) => [
            ...renderRow(l, i, 0),
            ...(l.sublayers ?? []).flatMap((_, si) => renderRow(l, i, si + 1)),
          ])}
        </div>
      </div>

      {/* Bottom: board thickness + actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 8,
          fontSize: 12.5,
          flexWrap: 'wrap',
        }}
      >
        <span>Board thickness from stackup:</span>
        <input
          className="ze-search"
          style={{ width: 90 }}
          value={boardThickness.toFixed(3)}
          readOnly
        />
        <span className="ze-muted" style={{ fontSize: 11 }}>
          mm
        </span>
        <span style={{ flex: 1 }} />
        <button className="ze-btn sm" onClick={onAdjustThickness}>
          Adjust Dielectric Thickness
        </button>
        <button className="ze-btn sm" onClick={onExport}>
          Export to Clipboard
        </button>
      </div>

      {/* EDA_LIST_DIALOG for add/remove dielectric */}
      {listPick && (
        <div
          className="ze-modal-backdrop"
          onMouseDown={() => setListPick(null)}
          style={{ zIndex: 60 }}
        >
          <div
            className="ze-modal"
            style={{ width: 340, height: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ze-modal-header">
              {listPick.title}
              <span className="x" title="Close" onClick={() => setListPick(null)}>
                ✕
              </span>
            </div>
            <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
              <div style={{ fontSize: 12.5, marginBottom: 6 }}>{listPick.label}</div>
              <select
                className="ze-select"
                size={Math.min(10, Math.max(4, listPick.items.length))}
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={listSel}
                onChange={(e) => setListSel(Number(e.target.value))}
                onDoubleClick={() => {
                  listPick.onPick(listSel);
                  setListPick(null);
                }}
              >
                {listPick.items.map((label, idx) => (
                  <option key={idx} value={idx}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setListPick(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={listPick.items.length === 0}
                onClick={() => {
                  listPick.onPick(listSel);
                  setListPick(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG_DIELECTRIC_MATERIAL */}
      {matTarget && (
        <div
          className="ze-modal-backdrop"
          onMouseDown={() => setMatTarget(null)}
          style={{ zIndex: 60 }}
        >
          <div
            className="ze-modal"
            style={{ width: 380, height: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ze-modal-header">
              Dielectric Material Characteristics
              <span className="x" title="Close" onClick={() => setMatTarget(null)}>
                ✕
              </span>
            </div>
            <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  gap: '6px 8px',
                  alignItems: 'center',
                  fontSize: 12.5,
                  marginBottom: 8,
                }}
              >
                <span>Material:</span>
                <input
                  className="ze-search"
                  value={matDraft.name}
                  onChange={(e) => setMatDraft({ ...matDraft, name: e.target.value })}
                />
                <span>Epsilon R:</span>
                <input
                  className="ze-search"
                  value={matDraft.epsilonR}
                  onChange={(e) => setMatDraft({ ...matDraft, epsilonR: num(e.target.value) })}
                />
                <span>Loss Tan:</span>
                <input
                  className="ze-search"
                  value={matDraft.lossTan}
                  onChange={(e) => setMatDraft({ ...matDraft, lossTan: num(e.target.value) })}
                />
              </div>
              <div className="ze-grid-pane" style={{ maxHeight: 220 }}>
                <table className="ze-grid" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Epsilon R</th>
                      <th>Loss Tan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialsFor(matType).map((m) => (
                      <tr
                        key={m.name}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setMatDraft({ ...m })}
                        onDoubleClick={() => {
                          setMatDraft({ ...m });
                          commitMaterial();
                        }}
                      >
                        <td style={{ padding: '2px 8px' }}>{m.name}</td>
                        <td style={{ padding: '2px 8px' }}>{trimNum(m.epsilonR)}</td>
                        <td style={{ padding: '2px 8px' }}>{trimNum(m.lossTan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setMatTarget(null)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitMaterial}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
