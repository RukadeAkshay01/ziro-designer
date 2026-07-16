/**
 * "Wavelength" panel — frequency/period/wavelength conversions in a medium.
 * Counterpart: KiCad `calculator_panels/panel_wavelength.cpp`.
 */

import { useState, type JSX } from 'react';
import {
  fromFrequency,
  fromPeriod,
  fromWavelengthMedium,
  fromWavelengthVacuum,
  type WavelengthState,
} from '@ziroeda/pcb_calculator';
import { Field, Group, fmt, parseNum } from '../fields.js';

export function PanelWavelength(): JSX.Element {
  const [er, setEr] = useState('4.5');
  const [mur, setMur] = useState('1');
  // The last-edited field drives the others.
  const [state, setState] = useState<WavelengthState>(() => fromFrequency(1e9, 4.5, 1));
  const [text, setText] = useState({
    frequency: '1',
    period: fmt(1e-9 * 1e9),
    vacuum: fmt(fromFrequency(1e9, 4.5, 1).wavelengthVacuumM * 1000),
    medium: fmt(fromFrequency(1e9, 4.5, 1).wavelengthMediumM * 1000),
  });

  const medium = (): { er: number; mur: number } => ({
    er: parseNum(er) > 0 ? parseNum(er) : 1,
    mur: parseNum(mur) > 0 ? parseNum(mur) : 1,
  });

  const apply = (s: WavelengthState, edited: keyof typeof text, editedText: string): void => {
    setState(s);
    setText({
      frequency: edited === 'frequency' ? editedText : fmt(s.frequencyHz / 1e9, 6),
      period: edited === 'period' ? editedText : fmt(s.periodS * 1e9, 6),
      vacuum: edited === 'vacuum' ? editedText : fmt(s.wavelengthVacuumM * 1000, 6),
      medium: edited === 'medium' ? editedText : fmt(s.wavelengthMediumM * 1000, 6),
    });
  };

  const onFrequency = (v: string): void => {
    const f = parseNum(v) * 1e9;
    if (f > 0) apply(fromFrequency(f, medium().er, medium().mur), 'frequency', v);
    else setText((t) => ({ ...t, frequency: v }));
  };
  const onPeriod = (v: string): void => {
    const p = parseNum(v) * 1e-9;
    if (p > 0) apply(fromPeriod(p, medium().er, medium().mur), 'period', v);
    else setText((t) => ({ ...t, period: v }));
  };
  const onVacuum = (v: string): void => {
    const l = parseNum(v) * 1e-3;
    if (l > 0) apply(fromWavelengthVacuum(l, medium().er, medium().mur), 'vacuum', v);
    else setText((t) => ({ ...t, vacuum: v }));
  };
  const onMedium = (v: string): void => {
    const l = parseNum(v) * 1e-3;
    if (l > 0) apply(fromWavelengthMedium(l, medium().er, medium().mur), 'medium', v);
    else setText((t) => ({ ...t, medium: v }));
  };
  const onMediumProps = (nextEr: string, nextMur: string): void => {
    setEr(nextEr);
    setMur(nextMur);
    const e = parseNum(nextEr);
    const m = parseNum(nextMur);
    if (e > 0 && m > 0) {
      const s = fromFrequency(state.frequencyHz, e, m);
      setState(s);
      setText((t) => ({ ...t, medium: fmt(s.wavelengthMediumM * 1000, 6) }));
    }
  };

  return (
    <div>
      <h3>Wavelength</h3>
      <div className="calc-note">Edit any value — the others follow.</div>
      <Group title="Values">
        <Field label="Frequency:" value={text.frequency} onChange={onFrequency} unit="GHz" />
        <Field label="Period:" value={text.period} onChange={onPeriod} unit="ns" />
        <Field label="Wavelength in vacuum:" value={text.vacuum} onChange={onVacuum} unit="mm" />
        <Field label="Wavelength in medium:" value={text.medium} onChange={onMedium} unit="mm" />
        <Field
          label="Speed in medium:"
          value={fmt(state.speedM / 1e6, 6)}
          readOnly
          unit="× 10⁶ m/s"
        />
      </Group>
      <Group title="Medium">
        <Field
          label="Relative permittivity (εr):"
          value={er}
          onChange={(v) => onMediumProps(v, mur)}
          unit=""
        />
        <Field
          label="Relative permeability (µr):"
          value={mur}
          onChange={(v) => onMediumProps(er, v)}
          unit=""
        />
      </Group>
    </div>
  );
}
