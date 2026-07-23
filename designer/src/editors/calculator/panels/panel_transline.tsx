/**
 * "Transmission Lines" panel — analysis/synthesis for the nine line types.
 * Counterpart: KiCad `calculator_panels/panel_transline.cpp`.
 *
 * Every physical dimension has a per-field unit selector (mm/mil/inch/µm…) and
 * the frequency has its own Hz…GHz selector, matching KiCad's UNIT_SELECTOR
 * fields; internally all lengths are held in metres.
 */

import { useState, type JSX } from 'react';
import {
  CONDUCTOR_RESISTIVITIES,
  LOSS_TANGENTS,
  type MaterialPreset,
  RELATIVE_DIELECTRIC_CONSTANTS,
  coaxAnalyze,
  coaxSynthesize,
  coupledStriplineAnalyze,
  coupledStriplineSynthesize,
  dispersedSubstrate,
  coplanarAnalyze,
  coplanarSynthesize,
  coupledMicrostripAnalyze,
  coupledMicrostripSynthesize,
  microstripAnalyze,
  microstripSynthesize,
  rectWaveguideAnalyze,
  striplineAnalyze,
  striplineSynthesize,
  twistedPairAnalyze,
  twistedPairSynthesize,
  type TranslineAnalysis,
} from '@ziroeda/pcb_calculator';
import { Field, FREQ_UNITS, Group, LEN_UNITS, NumField, fmt, parseNum } from '../fields.js';

type LineType =
  | 'microstrip'
  | 'c_microstrip'
  | 'stripline'
  | 'c_stripline'
  | 'cpw'
  | 'gcpw'
  | 'rectwaveguide'
  | 'coax'
  | 'twistedpair';

const LINE_TYPES: { id: LineType; name: string }[] = [
  // KiCad master's order (panel_transline.cpp tltype_list).
  { id: 'microstrip', name: 'Microstrip Line' },
  { id: 'c_microstrip', name: 'Coupled Microstrip Lines' },
  { id: 'stripline', name: 'Stripline' },
  { id: 'c_stripline', name: 'Coupled Stripline' },
  { id: 'cpw', name: 'Coplanar Waveguide' },
  { id: 'gcpw', name: 'Coplanar Waveguide with Ground Plane' },
  { id: 'rectwaveguide', name: 'Rectangular Waveguide' },
  { id: 'coax', name: 'Coaxial Line' },
  { id: 'twistedpair', name: 'Twisted Pair' },
];

interface PhysField {
  key: string;
  label: string;
  /** 'len' → held in metres with a length unit selector; 'raw' → plain number. */
  kind: 'len' | 'raw';
  /** Default value in base units (metres for 'len'). */
  def: number;
  /** Starting unit for a length field. */
  unit?: string;
}

const L = (key: string, label: string, defMm: number, unit = 'mm'): PhysField => ({
  key,
  label,
  kind: 'len',
  def: defMm * 1e-3,
  unit,
});

const PHYS_FIELDS: Record<LineType, PhysField[]> = {
  microstrip: [
    L('w', 'Trace width (W):', 3),
    L('h', 'Substrate height (H):', 1.6),
    L('t', 'Trace thickness (T):', 0.035, 'µm'),
    L('l', 'Line length (L):', 50),
  ],
  cpw: [
    L('w', 'Trace width (W):', 0.5),
    L('s', 'Gap width (S):', 0.3),
    L('h', 'Substrate height (H):', 1.6),
    L('t', 'Trace thickness (T):', 0.035, 'µm'),
    L('l', 'Line length (L):', 50),
  ],
  gcpw: [
    L('w', 'Trace width (W):', 0.5),
    L('s', 'Gap width (S):', 0.3),
    L('h', 'Substrate height (H):', 1.6),
    L('t', 'Trace thickness (T):', 0.035, 'µm'),
    L('l', 'Line length (L):', 50),
  ],
  rectwaveguide: [
    L('a', 'Broad wall width (a):', 22.86),
    L('b', 'Narrow wall height (b):', 10.16),
    L('l', 'Guide length (L):', 100),
  ],
  coax: [
    L('din', 'Inner conductor diameter (d):', 0.9),
    L('dout', 'Shield diameter (D):', 2.95),
    L('l', 'Line length (L):', 1000),
  ],
  c_microstrip: [
    L('w', 'Trace width (W):', 0.3),
    L('s', 'Gap width (S):', 0.2),
    L('h', 'Substrate height (H):', 0.2),
    L('t', 'Trace thickness (T):', 0.035, 'µm'),
    L('l', 'Line length (L):', 50),
  ],
  stripline: [
    L('w', 'Strip width (W):', 0.7),
    L('h', 'Ground spacing (B):', 1.6),
    L('t', 'Strip thickness (T):', 0.035, 'µm'),
    L('l', 'Line length (L):', 50),
  ],
  c_stripline: [
    L('w', 'Line width (W):', 0.2),
    L('s', 'Gap width (S):', 0.2),
    L('h', 'Height of substrate (H):', 0.2),
    L('a', 'Offset to nearest ground (a, 0 = centered):', 0),
    L('t', 'Strip thickness (T):', 0.035, 'µm'),
    L('l', 'Line length (L):', 50),
  ],
  twistedpair: [
    L('din', 'Conductor diameter (d):', 0.511),
    L('dout', 'Insulation diameter (D):', 0.93),
    { key: 'twists', label: 'Twists per meter:', kind: 'raw', def: 100 },
    L('l', 'Cable length (L):', 1000),
  ],
};

const SUBSTRATE_DEFAULTS = {
  er: '4.5',
  tand: '0.02',
  // KiCad's panel takes the conductor's specific resistance ρ in Ω·m.
  rho: '1.72e-8',
  mur: '1',
  erEnv: '1',
};

/** Text field with a KiCad-style "…" preset picker that fills the value. */
function PresetField({
  label,
  value,
  onChange,
  unit,
  presets,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  presets: readonly MaterialPreset[];
}): JSX.Element {
  return (
    <div className="calc-field">
      <span className="calc-field-label">{label}</span>
      <input
        className="calc-input"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <select
        className="calc-select calc-unit-select"
        value=""
        title="Standard materials"
        onChange={(e) => {
          if (e.target.value !== '') onChange(e.target.value);
        }}
      >
        <option value="">…</option>
        {presets.map((p) => (
          <option key={`${p.name}`} value={String(p.value)}>
            {p.value} — {p.name}
          </option>
        ))}
      </select>
      <span className="calc-unit">{unit}</span>
    </div>
  );
}

export function PanelTransline(): JSX.Element {
  const [type, setType] = useState<LineType>('microstrip');
  const [freqHz, setFreqHz] = useState(1e9);
  const [sub, setSub] = useState({ ...SUBSTRATE_DEFAULTS });
  const [phys, setPhys] = useState<Record<string, number>>(() => defaults('microstrip'));
  const [z0, setZ0] = useState('50');
  // Odd-mode impedance target — used by the coupled stripline (KiCad Zodd).
  const [zOdd, setZOdd] = useState('50');
  // Dielectric dispersion model (KiCad m_dielectricModelChoice + spec frequency).
  const [dielModel, setDielModel] = useState<'constant' | 'djordjevic_sarkar'>('constant');
  const [specFreqHz, setSpecFreqHz] = useState(1e9);
  // Solder mask overlay (KiCad m_soldermask* controls; defaults from TRANSLINE::Init).
  const [smPresent, setSmPresent] = useState(false);
  const [smThickM, setSmThickM] = useState(20e-6);
  const [smEr, setSmEr] = useState('3.5');
  const [smTand, setSmTand] = useState('0.025');
  const [smFills, setSmFills] = useState(true);
  const [angle, setAngle] = useState('90');
  const [result, setResult] = useState<TranslineAnalysis | null>(null);
  const [error, setError] = useState('');

  function defaults(t: LineType): Record<string, number> {
    return Object.fromEntries(PHYS_FIELDS[t].map((f) => [f.key, f.def]));
  }

  const pick = (t: LineType): void => {
    setType(t);
    setPhys(defaults(t));
    setResult(null);
    setError('');
    setZ0(t === 'c_microstrip' ? '100' : t === 'twistedpair' ? '120' : '50');
    setZOdd('50');
  };

  const el = () => {
    const base = {
      frequencyHz: freqHz,
      epsilonR: parseNum(sub.er),
      tanD: parseNum(sub.tand),
      sigma: 1 / parseNum(sub.rho),
      mur: 1, // dielectric relative permeability (non-magnetic substrate)
      murC: parseNum(sub.mur),
    };
    // Djordjevic–Sarkar overlays the dispersed εr / tan δ at the operating
    // frequency, exactly as KiCad's UpdateDielectricModel does per analysis.
    const d = dispersedSubstrate(base, { model: dielModel, specFreqHz });
    return { ...base, epsilonR: d.epsilonR, tanD: d.tanD };
  };
  const v = (key: string): number => phys[key] ?? 0;

  // Mask correction applies to microstrip, coupled microstrip, CPW and CBCPW.
  const maskApplies = ['microstrip', 'c_microstrip', 'cpw', 'gcpw'].includes(type);
  const soldermask = () => ({
    present: smPresent,
    thicknessM: smThickM,
    epsilonR: parseNum(smEr),
    tanD: parseNum(smTand),
    fillsGaps: smFills,
  });

  const analyze = (): void => {
    setError('');
    try {
      const e = el();
      let r: TranslineAnalysis;
      switch (type) {
        case 'microstrip':
          r = microstripAnalyze(
            { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
            e,
            soldermask(),
          );
          break;
        case 'cpw':
        case 'gcpw':
          r = coplanarAnalyze(
            { widthM: v('w'), gapM: v('s'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
            e,
            type === 'gcpw',
            soldermask(),
          );
          break;
        case 'rectwaveguide':
          r = rectWaveguideAnalyze({ aM: v('a'), bM: v('b'), lengthM: v('l') }, e);
          break;
        case 'coax':
          r = coaxAnalyze({ innerDiaM: v('din'), outerDiaM: v('dout'), lengthM: v('l') }, e);
          break;
        case 'c_microstrip':
          r = coupledMicrostripAnalyze(
            {
              widthM: v('w'),
              gapM: v('s'),
              heightM: v('h'),
              thicknessM: v('t'),
              lengthM: v('l'),
            },
            e,
            soldermask(),
          );
          break;
        case 'stripline':
          r = striplineAnalyze(
            { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
            e,
          );
          break;
        case 'c_stripline': {
          const cr = coupledStriplineAnalyze(
            {
              widthM: v('w'),
              gapM: v('s'),
              heightM: v('h'),
              offsetAM: v('a'),
              thicknessM: v('t'),
              lengthM: v('l'),
            },
            e,
          );
          r = {
            z0: Math.sqrt(cr.z0Even * cr.z0Odd),
            epsEff: cr.epsEffEven,
            angleDeg: cr.angleDeg,
            conductorLossDb: 0.5 * (cr.attenCondEvenDb + cr.attenCondOddDb),
            dielectricLossDb: 0.5 * (cr.attenDielEvenDb + cr.attenDielOddDb),
            skinDepthM: cr.skinDepthM,
            extra: {
              z0Even: cr.z0Even,
              z0Odd: cr.z0Odd,
              zDiff: cr.zDiff,
              zComm: cr.zComm,
              coupling: cr.couplingK,
            },
          };
          setZOdd(fmt(cr.z0Odd, 5));
          break;
        }
        case 'twistedpair':
          r = twistedPairAnalyze(
            { dinM: v('din'), doutM: v('dout'), twistsPerM: v('twists'), lengthM: v('l') },
            { ...e, epsilonRenv: parseNum(sub.erEnv) },
          );
          break;
      }
      setResult(r);
      if (type === 'c_stripline') setZ0(fmt(r.extra?.z0Even ?? r.z0, 5));
      else setZ0(fmt(type === 'c_microstrip' ? (r.extra?.zDiff ?? r.z0) : r.z0, 5));
      setAngle(fmt(r.angleDeg, 5));
    } catch {
      setError('Analysis failed — check the input values.');
    }
  };

  const synthesize = (): void => {
    setError('');
    const e = el();
    const zTarget = parseNum(z0);
    const angTarget = parseNum(angle);
    if (!(zTarget > 0) || !(angTarget > 0)) {
      setError('Enter a positive Z0 and electrical length.');
      return;
    }
    let next: Record<string, number> | null = null;
    switch (type) {
      case 'microstrip': {
        const s = microstripSynthesize(
          { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, w: s.widthM, l: s.lengthM };
        break;
      }
      case 'cpw':
      case 'gcpw': {
        const s = coplanarSynthesize(
          { widthM: v('w'), gapM: v('s'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
          e,
          type === 'gcpw',
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, s: s.gapM, l: s.lengthM };
        break;
      }
      case 'rectwaveguide':
        setError('Synthesis is not available for rectangular waveguides.');
        return;
      case 'coax': {
        const s = coaxSynthesize(
          { innerDiaM: v('din'), outerDiaM: v('dout'), lengthM: v('l') },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, din: s.innerDiaM, l: s.lengthM };
        break;
      }
      case 'c_microstrip': {
        const s = coupledMicrostripSynthesize(
          {
            widthM: v('w'),
            gapM: v('s'),
            heightM: v('h'),
            thicknessM: v('t'),
            lengthM: v('l'),
          },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, s: s.gapM, l: s.lengthM };
        break;
      }
      case 'stripline': {
        const s = striplineSynthesize(
          { widthM: v('w'), heightM: v('h'), thicknessM: v('t'), lengthM: v('l') },
          e,
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, w: s.widthM, l: s.lengthM };
        break;
      }
      case 'c_stripline': {
        // Joint (W, S) Newton solve for the Zeven/Zodd targets (KiCad default path).
        const zOddTarget = parseNum(zOdd);
        if (!(zOddTarget > 0)) {
          setError('Enter a positive odd-mode impedance.');
          return;
        }
        const s = coupledStriplineSynthesize(
          {
            widthM: v('w'),
            gapM: v('s'),
            heightM: v('h'),
            offsetAM: v('a'),
            thicknessM: v('t'),
            lengthM: v('l'),
          },
          e,
          zTarget,
          zOddTarget,
        );
        if (s) next = { ...phys, w: s.widthM, s: s.gapM };
        break;
      }
      case 'twistedpair': {
        const s = twistedPairSynthesize(
          { dinM: v('din'), doutM: v('dout'), twistsPerM: v('twists'), lengthM: v('l') },
          { ...e, epsilonRenv: parseNum(sub.erEnv) },
          zTarget,
          angTarget,
        );
        if (s) next = { ...phys, din: s.dinM, l: s.lengthM };
        break;
      }
    }
    if (!next) {
      setError('No physical solution found for this target impedance.');
      return;
    }
    setPhys(next);
    setResult(null);
  };

  const isDiff = type === 'c_microstrip';
  const extraRows: [string, string][] = [];
  if (result?.extra) {
    const x = result.extra;
    if (x.z0Even != null) extraRows.push(['Even-mode impedance (Ze)', `${fmt(x.z0Even, 5)} Ω`]);
    if (x.z0Odd != null) extraRows.push(['Odd-mode impedance (Zo)', `${fmt(x.z0Odd, 5)} Ω`]);
    if (x.zDiff != null) extraRows.push(['Differential impedance (Zd)', `${fmt(x.zDiff, 5)} Ω`]);
    if (x.zComm != null) extraRows.push(['Common-mode impedance (Zc)', `${fmt(x.zComm, 5)} Ω`]);
    if (x.coupling != null) extraRows.push(['Coupling factor', fmt(x.coupling, 4)]);
    if (x.te11CutoffHz != null)
      extraRows.push(['TE11 cutoff', `${fmt(x.te11CutoffHz / 1e9, 4)} GHz`]);
    if (x.fcTE10Hz != null) extraRows.push(['TE10 cutoff', `${fmt(x.fcTE10Hz / 1e9, 4)} GHz`]);
    if (x.fcTE20Hz != null) extraRows.push(['TE20 cutoff', `${fmt(x.fcTE20Hz / 1e9, 4)} GHz`]);
    if (x.fcTE01Hz != null) extraRows.push(['TE01 cutoff', `${fmt(x.fcTE01Hz / 1e9, 4)} GHz`]);
    if (x.guideWavelengthM != null)
      extraRows.push(['Guide wavelength', `${fmt(x.guideWavelengthM * 1000, 5)} mm`]);
  }

  return (
    <div>
      <h3>Transmission Lines</h3>
      <div className="calc-field">
        <span className="calc-field-label">Line type:</span>
        <select
          className="calc-select"
          value={type}
          onChange={(e) => pick(e.target.value as LineType)}
        >
          {LINE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="calc-row">
        <Group title="Substrate parameters">
          <PresetField
            label="Relative permittivity (εr):"
            value={sub.er}
            onChange={(val) => setSub({ ...sub, er: val })}
            unit=""
            presets={RELATIVE_DIELECTRIC_CONSTANTS}
          />
          <PresetField
            label="Loss tangent (tanδ):"
            value={sub.tand}
            onChange={(val) => setSub({ ...sub, tand: val })}
            unit=""
            presets={LOSS_TANGENTS}
          />
          <PresetField
            label="Specific resistance (ρ):"
            value={sub.rho}
            onChange={(val) => setSub({ ...sub, rho: val })}
            unit="Ω·m"
            presets={CONDUCTOR_RESISTIVITIES}
          />
          <div
            className="calc-field"
            title={
              "'Constant': εr and tan δ applied at all frequencies.\n" +
              "'Djordjevic-Sarkar': causal wideband Debye anchored at the spec frequency."
            }
          >
            <span className="calc-field-label">Dielectric model:</span>
            <select
              className="calc-select"
              value={dielModel}
              onChange={(e) => setDielModel(e.target.value as 'constant' | 'djordjevic_sarkar')}
            >
              <option value="constant">Constant</option>
              <option value="djordjevic_sarkar">Djordjevic-Sarkar</option>
            </select>
          </div>
          {dielModel === 'djordjevic_sarkar' && (
            <NumField
              label="εr, tanδ spec frequency:"
              units={FREQ_UNITS}
              base={specFreqHz}
              onBase={setSpecFreqHz}
            />
          )}
          {maskApplies && (
            <>
              <label
                className="calc-field"
                title={
                  'Enable solder resist / LPI overlay correction.  Affects εeff, Z0, and ' +
                  'dielectric loss for microstrip, coupled microstrip, CPW, and CBCPW.'
                }
              >
                <input
                  type="checkbox"
                  checked={smPresent}
                  onChange={(e) => setSmPresent(e.target.checked)}
                />
                <span className="calc-field-label">Solder mask present</span>
              </label>
              {smPresent && (
                <>
                  <NumField
                    label="Mask thickness:"
                    units={LEN_UNITS}
                    defaultUnit="µm"
                    base={smThickM}
                    onBase={setSmThickM}
                  />
                  <Field
                    label="Mask εr:"
                    value={smEr}
                    onChange={setSmEr}
                    unit=""
                    title="Mask relative permittivity. Default 3.5 for standard green LPI. Range 3.3-3.8 for typical resins."
                  />
                  <Field
                    label="Mask tanδ:"
                    value={smTand}
                    onChange={setSmTand}
                    unit=""
                    title="Mask loss tangent. Default 0.025 for LPI."
                  />
                  {(type === 'cpw' || type === 'gcpw') && (
                    <label
                      className="calc-field"
                      title={
                        'Enable when the mask fills the CPW slots (standard LPI process).\n' +
                        'Disable for selective mask that covers only the traces.'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={smFills}
                        onChange={(e) => setSmFills(e.target.checked)}
                      />
                      <span className="calc-field-label">Mask fills gaps</span>
                    </label>
                  )}
                </>
              )}
            </>
          )}
          <Field
            label="Conductor permeability (µ):"
            value={sub.mur}
            onChange={(val) => setSub({ ...sub, mur: val })}
            unit=""
          />
          {type === 'twistedpair' && (
            <Field
              label="Environment εr:"
              value={sub.erEnv}
              onChange={(val) => setSub({ ...sub, erEnv: val })}
              unit=""
            />
          )}
          <NumField label="Frequency:" units={FREQ_UNITS} base={freqHz} onBase={setFreqHz} />
        </Group>

        <Group title="Physical parameters">
          {PHYS_FIELDS[type].map((f) =>
            f.kind === 'len' ? (
              <NumField
                key={f.key}
                label={f.label}
                units={LEN_UNITS}
                defaultUnit={f.unit ?? 'mm'}
                base={v(f.key)}
                onBase={(val) => setPhys((p) => ({ ...p, [f.key]: val }))}
              />
            ) : (
              <Field
                key={f.key}
                label={f.label}
                value={fmt(v(f.key))}
                onChange={(val) => setPhys((p) => ({ ...p, [f.key]: Number(val) || 0 }))}
                unit="1/m"
              />
            ),
          )}
        </Group>

        <Group title="Electrical parameters">
          <Field
            label={
              type === 'c_stripline'
                ? 'Even-mode impedance (Zeven):'
                : isDiff
                  ? 'Differential impedance (Zd):'
                  : 'Characteristic impedance (Z0):'
            }
            value={z0}
            onChange={setZ0}
            unit="Ω"
          />
          {type === 'c_stripline' && (
            <Field label="Odd-mode impedance (Zodd):" value={zOdd} onChange={setZOdd} unit="Ω" />
          )}
          <Field label="Electrical length:" value={angle} onChange={setAngle} unit="°" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="calc-btn primary" onClick={analyze}>
              Analyze ▶
            </button>
            <button type="button" className="calc-btn primary" onClick={synthesize}>
              ◀ Synthesize
            </button>
          </div>
        </Group>
      </div>

      {error && <div className="calc-error">{error}</div>}

      <Group title="Results">
        <table className="calc-table">
          <tbody>
            <tr>
              <td className="rowhead">Characteristic impedance (Z0)</td>
              <td>{result ? `${fmt(result.z0, 5)} Ω` : '--'}</td>
            </tr>
            <tr>
              <td className="rowhead">Effective permittivity (εeff)</td>
              <td>{result ? fmt(result.epsEff, 5) : '--'}</td>
            </tr>
            <tr>
              <td className="rowhead">Electrical length</td>
              <td>{result ? `${fmt(result.angleDeg, 5)} °` : '--'}</td>
            </tr>
            <tr>
              <td className="rowhead">Conductor losses</td>
              <td>
                {result && Number.isFinite(result.conductorLossDb)
                  ? `${fmt(result.conductorLossDb, 4)} dB`
                  : '--'}
              </td>
            </tr>
            <tr>
              <td className="rowhead">Dielectric losses</td>
              <td>
                {result && Number.isFinite(result.dielectricLossDb)
                  ? `${fmt(result.dielectricLossDb, 4)} dB`
                  : '--'}
              </td>
            </tr>
            <tr>
              <td className="rowhead">Skin depth</td>
              <td>{result ? `${fmt(result.skinDepthM * 1e6, 4)} µm` : '--'}</td>
            </tr>
            {extraRows.map(([k, val]) => (
              <tr key={k}>
                <td className="rowhead">{k}</td>
                <td>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
    </div>
  );
}
