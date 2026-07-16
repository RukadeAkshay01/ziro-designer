/**
 * "Electrical Spacing" panel — two calculators like KiCad: the IPC-2221
 * minimum-clearance table and the IEC 60664-1 insulation coordination
 * (clearance / creepage / groove width).
 * Counterparts: KiCad `calculator_panels/panel_electrical_spacing_ipc2221.cpp`
 * and `panel_electrical_spacing_iec60664.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  IPC2221_CASES,
  IPC2221_SPACING_MM,
  IPC2221_VOLTAGE_RANGES,
  type Iec60664Params,
  type InsulationType,
  type MaterialGroup,
  type OvervoltageCategory,
  type PollutionDegree,
  iec60664,
  ipc2221RowForVoltage,
  ipc2221Spacing,
  ratedImpulseWithstandVoltageV,
} from '@ziroeda/pcb_calculator';
import { Field, Group, fmt, parseNum } from '../fields.js';

function PanelIpc2221(): JSX.Element {
  const [voltage, setVoltage] = useState('250');
  const v = parseNum(voltage);
  const activeRow = Number.isFinite(v) && v >= 0 ? ipc2221RowForVoltage(v) : -2;

  return (
    <div>
      <Group title="Voltage">
        <Field
          label="Voltage > 500 V extrapolates:"
          value={voltage}
          onChange={setVoltage}
          unit="V (DC or AC peak)"
        />
        {Number.isFinite(v) && v >= 0 && activeRow === -1 && (
          <div className="calc-note">
            Above 500 V the spacing grows linearly; the computed values are shown in the last row.
          </div>
        )}
      </Group>

      <table className="calc-table">
        <thead>
          <tr>
            <th className="rowhead">Voltage range</th>
            {IPC2221_CASES.map((c) => (
              <th key={c.id} title={c.description}>
                {c.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {IPC2221_VOLTAGE_RANGES.map((label, row) => (
            <tr key={label}>
              <td className="rowhead">{label}</td>
              {(IPC2221_SPACING_MM[row] ?? []).map((mm, col) => (
                <td key={IPC2221_CASES[col]?.id ?? col} className={row === activeRow ? 'hl' : ''}>
                  {mm}
                </td>
              ))}
            </tr>
          ))}
          {activeRow === -1 && (
            <tr>
              <td className="rowhead">{fmt(v)} V (computed)</td>
              {IPC2221_CASES.map((c, col) => (
                <td key={c.id} className="hl">
                  {fmt(ipc2221Spacing(v, col), 4)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      <div className="calc-note">All values in millimetres.</div>

      <Group title="Cases">
        <table className="calc-table">
          <tbody>
            {IPC2221_CASES.map((c) => (
              <tr key={c.id}>
                <td className="rowhead">{c.id}</td>
                <td className="rowhead">{c.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
    </div>
  );
}

const OVC: { label: string; v: OvervoltageCategory }[] = [
  { label: 'OVC I', v: 1 },
  { label: 'OVC II', v: 2 },
  { label: 'OVC III', v: 3 },
  { label: 'OVC IV', v: 4 },
];
const PD: { label: string; v: PollutionDegree }[] = [
  { label: 'PD1', v: 1 },
  { label: 'PD2', v: 2 },
  { label: 'PD3', v: 3 },
  { label: 'PD4', v: 4 },
];
const MG: { label: string; v: MaterialGroup }[] = [
  { label: 'I', v: 'I' },
  { label: 'II', v: 'II' },
  { label: 'IIIa', v: 'IIIa' },
  { label: 'IIIb', v: 'IIIb' },
];
const INSUL: { label: string; v: InsulationType }[] = [
  { label: 'Functional', v: 'functional' },
  { label: 'Basic', v: 'basic' },
  { label: 'Reinforced', v: 'reinforced' },
];

function Select<T>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; v: T }[];
  value: T;
  onChange: (v: T) => void;
}): JSX.Element {
  const idx = options.findIndex((o) => o.v === value);
  return (
    <label className="calc-field">
      <span className="calc-field-label">{label}</span>
      <select
        className="calc-select"
        value={idx}
        onChange={(e) => onChange(options[Number(e.target.value)]!.v)}
      >
        {options.map((o, i) => (
          <option key={o.label} value={i}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PanelIec60664(): JSX.Element {
  const [ratedVoltage, setRatedVoltage] = useState('300');
  const [ovc, setOvc] = useState<OvervoltageCategory>(3);
  const [rms, setRms] = useState('250');
  const [transient, setTransient] = useState('4');
  const [peak, setPeak] = useState('2.5');
  const [insul, setInsul] = useState<InsulationType>('basic');
  const [pd, setPd] = useState<PollutionDegree>(2);
  const [mg, setMg] = useState<MaterialGroup>('I');
  const [pcb, setPcb] = useState(false);
  const [altitude, setAltitude] = useState('2000');

  const impulseKv = useMemo(() => {
    const r = ratedImpulseWithstandVoltageV(parseNum(ratedVoltage), ovc);
    return r < 0 ? -1 : r / 1000;
  }, [ratedVoltage, ovc]);

  const result = useMemo(() => {
    const p: Iec60664Params = {
      ratedVoltageV: parseNum(ratedVoltage),
      overvoltageCategory: ovc,
      pollutionDegree: pd,
      materialGroup: mg,
      insulationType: insul,
      field: 'inhomogeneous',
      pcbMaterial: pcb,
      altitudeM: parseNum(altitude),
      rmsVoltageV: parseNum(rms),
      peakVoltageKv: parseNum(peak),
      transientVoltageKv: parseNum(transient),
    };
    return iec60664(p);
  }, [ratedVoltage, ovc, pd, mg, insul, pcb, altitude, rms, peak, transient]);

  const dist = (mm: number): string => {
    if (pd === 4) return 'N/A';
    return mm >= 0 ? fmt(mm, 5) : 'Out of range';
  };

  return (
    <div className="calc-row">
      <div className="calc-col">
        <Group title="Insulation for equipment within low-voltage supply systems">
          <Field
            label="Rated Voltage (RMS or DC):"
            value={ratedVoltage}
            onChange={setRatedVoltage}
            unit="V"
          />
          <Select label="Overvoltage category:" options={OVC} value={ovc} onChange={setOvc} />
          <Field
            label="Impulse voltage:"
            value={impulseKv < 0 ? 'Out of range' : fmt(impulseKv, 4)}
            readOnly
            unit="kV"
          />
          <div style={{ margin: '2px 0 6px 178px' }}>
            <button
              type="button"
              className="calc-btn"
              disabled={impulseKv < 0}
              onClick={() => setTransient(fmt(impulseKv, 4))}
            >
              Use as transient overvoltage ↓
            </button>
          </div>
          <Field label="RMS Voltage:" value={rms} onChange={setRms} unit="V" />
          <Field
            label="Transient overvoltage:"
            value={transient}
            onChange={setTransient}
            unit="kV"
          />
          <Field label="Recurring peak voltage:" value={peak} onChange={setPeak} unit="kV" />
          <Select label="Type of insulation:" options={INSUL} value={insul} onChange={setInsul} />
          <Select label="Pollution Degree:" options={PD} value={pd} onChange={setPd} />
          <Select label="Material group:" options={MG} value={mg} onChange={setMg} />
          <label className="calc-field">
            <span className="calc-field-label">PCB material:</span>
            <input type="checkbox" checked={pcb} onChange={(e) => setPcb(e.target.checked)} />
          </label>
          <Field label="Max altitude:" value={altitude} onChange={setAltitude} unit="m" />
        </Group>
      </div>
      <div className="calc-col">
        <Group title="Results">
          <Field label="Clearance:" value={dist(result.clearanceMm)} readOnly unit="mm" />
          <Field label="Creepage:" value={dist(result.creepageMm)} readOnly unit="mm" />
          <Field label="Min groove width:" value={dist(result.grooveWidthMm)} readOnly unit="mm" />
          {pd === 4 && (
            <div className="calc-note">
              For PD4 the surface may carry permanent conductive pollution, so creepage and groove
              width are not defined (IEC 60664-1 §4.6.3).
            </div>
          )}
        </Group>
        <div className="calc-note" style={{ maxWidth: 340 }}>
          IEC 60664-1:2020 insulation coordination for equipment in low-voltage supply systems.
          Transient and peak voltages are in kV; RMS in V.
        </div>
      </div>
    </div>
  );
}

export function PanelElectricalSpacing(): JSX.Element {
  const [tab, setTab] = useState<'ipc' | 'iec'>('ipc');
  return (
    <div>
      <h3>Electrical Spacing</h3>
      <div className="calc-tabs">
        <div className={`calc-tab${tab === 'ipc' ? ' active' : ''}`} onClick={() => setTab('ipc')}>
          IPC-2221
        </div>
        <div className={`calc-tab${tab === 'iec' ? ' active' : ''}`} onClick={() => setTab('iec')}>
          IEC 60664-1
        </div>
      </div>
      {tab === 'ipc' ? <PanelIpc2221 /> : <PanelIec60664 />}
    </div>
  );
}
