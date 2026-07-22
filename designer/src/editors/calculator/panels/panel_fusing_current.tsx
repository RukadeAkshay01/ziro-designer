/**
 * "Fusing Current" panel — copper track fuse designer. Pick the unknown
 * (width, thickness, current or time to fuse) with the radio, fill the rest,
 * and Calculate. Counterpart: KiCad `calculator_panels/panel_fusing_current.cpp`.
 */

import { useState, type JSX } from 'react';
import { type FusingSolveFor, fusingCurrent } from '@ziroeda/pcb_calculator';
import { Field, LEN_UNITS, type UnitOpt, fmt, parseNum } from '../fields.js';

const LEN_SHORT: UnitOpt[] = LEN_UNITS.filter((u) => ['mm', 'µm', 'mil'].includes(u.label));

/** Radio + numeric input + length-unit dropdown (value held in metres). */
function LenRow({
  label,
  solveFor,
  active,
  onActive,
  baseM,
  onBaseM,
}: {
  label: string;
  solveFor: FusingSolveFor;
  active: FusingSolveFor;
  onActive: (s: FusingSolveFor) => void;
  baseM: number;
  onBaseM: (v: number) => void;
}): JSX.Element {
  const [unitIdx, setUnitIdx] = useState(0);
  const mult = LEN_SHORT[unitIdx]?.mult ?? 1e-3;
  const text = Number.isFinite(baseM) ? fmt(baseM / mult, 6) : '';
  return (
    <div className="calc-field">
      <input
        type="radio"
        name="fuse-solve"
        checked={active === solveFor}
        onChange={() => onActive(solveFor)}
      />
      <span className="calc-field-label" style={{ minWidth: 120 }}>
        {label}
      </span>
      <input
        className={`calc-input${active === solveFor ? ' ro' : ''}`}
        value={text}
        readOnly={active === solveFor}
        spellCheck={false}
        onChange={(e) => onBaseM(parseNum(e.target.value) * mult)}
      />
      <select
        className="calc-select calc-unit-select"
        value={unitIdx}
        onChange={(e) => setUnitIdx(Number(e.target.value))}
      >
        {LEN_SHORT.map((u, i) => (
          <option key={u.label} value={i}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Radio + numeric input + fixed unit text. */
function NumRow({
  label,
  solveFor,
  active,
  onActive,
  value,
  onValue,
  unit,
}: {
  label: string;
  solveFor: FusingSolveFor;
  active: FusingSolveFor;
  onActive: (s: FusingSolveFor) => void;
  value: string;
  onValue: (v: string) => void;
  unit: string;
}): JSX.Element {
  return (
    <div className="calc-field">
      <input
        type="radio"
        name="fuse-solve"
        checked={active === solveFor}
        onChange={() => onActive(solveFor)}
      />
      <span className="calc-field-label" style={{ minWidth: 120 }}>
        {label}
      </span>
      <input
        className={`calc-input${active === solveFor ? ' ro' : ''}`}
        value={value}
        readOnly={active === solveFor}
        spellCheck={false}
        onChange={(e) => onValue(e.target.value)}
      />
      <span className="calc-unit">{unit}</span>
    </div>
  );
}

export function PanelFusingCurrent(): JSX.Element {
  const [ambient, setAmbient] = useState('25');
  const [melting, setMelting] = useState('1084'); // copper
  const [widthM, setWidthM] = useState(0.1e-3);
  const [thicknessM, setThicknessM] = useState(0.035e-3);
  const [current, setCurrent] = useState('10');
  const [time, setTime] = useState('0.01');
  const [solveFor, setSolveFor] = useState<FusingSolveFor>('current');
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');

  const calculate = (): void => {
    setError('');
    setComment('');
    const r = fusingCurrent({
      ambientC: parseNum(ambient),
      meltingC: parseNum(melting),
      widthM,
      thicknessM,
      currentA: parseNum(current),
      timeS: parseNum(time),
      solveFor,
    });
    if (r.error) {
      setError(r.error);
      return;
    }
    setComment(r.comment ?? '');
    if (solveFor === 'width') setWidthM(r.widthM);
    else if (solveFor === 'thickness') setThicknessM(r.thicknessM);
    else if (solveFor === 'current') setCurrent(fmt(r.currentA, 6));
    else setTime(fmt(r.timeS, 6));
  };

  return (
    <div>
      <div style={{ maxWidth: 460 }}>
        <Field label="Ambient temperature:" value={ambient} onChange={setAmbient} unit="°C" />
        <Field label="Melting point:" value={melting} onChange={setMelting} unit="°C" title="Copper" />
        <LenRow
          label="Track width:"
          solveFor="width"
          active={solveFor}
          onActive={setSolveFor}
          baseM={widthM}
          onBaseM={setWidthM}
        />
        <LenRow
          label="Track thickness:"
          solveFor="thickness"
          active={solveFor}
          onActive={setSolveFor}
          baseM={thicknessM}
          onBaseM={setThicknessM}
        />
        <NumRow
          label="Current:"
          solveFor="current"
          active={solveFor}
          onActive={setSolveFor}
          value={current}
          onValue={setCurrent}
          unit="A"
        />
        <NumRow
          label="Time to fuse:"
          solveFor="time"
          active={solveFor}
          onActive={setSolveFor}
          value={time}
          onValue={setTime}
          unit="s"
        />
        <div style={{ marginTop: 8 }}>
          <button type="button" className="calc-btn primary" onClick={calculate}>
            Calculate
          </button>
        </div>
        {error && <div className="calc-error">{error}</div>}
        {comment && <div className="calc-note">{comment}</div>}
      </div>

      <fieldset className="calc-group" style={{ marginTop: 14 }}>
        <legend>Help</legend>
        <div className="calc-note" style={{ lineHeight: 1.6 }}>
          Checks whether a small track can carry a large current for a short time — a track-fuse
          design aid, to be used only as an estimate. The model compares the energy needed to heat
          the copper to its melting point (plus the latent heat of fusion) against the energy the
          track dissipates as I²R over the fuse time. Copper only.
        </div>
      </fieldset>
    </div>
  );
}
