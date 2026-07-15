/**
 * "Cable Size" panel — AWG/diameter linked fields, ampacity by current
 * density and application results. Counterpart: KiCad `calculator_panels/panel_cable_size.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  AWG_NAMES,
  awgDiameterM,
  awgIndexToGauge,
  cableSize,
  nearestAwgIndex,
} from '@ziroeda/pcb_calculator';
import { Field, Group, LEN_UNITS, NumField, fmt } from '../fields.js';

export function PanelCableSize(): JSX.Element {
  const [awgIdx, setAwgIdx] = useState(27); // AWG 24
  const [diameterM, setDiameterM] = useState(() => awgDiameterM(24));
  const [temp, setTemp] = useState('20');
  const [density, setDensity] = useState('3');
  const [current, setCurrent] = useState('1');
  const [lengthM, setLengthM] = useState(1);

  const pickAwg = (idx: number): void => {
    setAwgIdx(idx);
    setDiameterM(awgDiameterM(awgIndexToGauge(idx)));
  };
  const typeDiameter = (d: number): void => {
    setDiameterM(d);
    if (d > 0) setAwgIdx(nearestAwgIndex(d));
  };

  const r = useMemo(() => {
    const p = {
      diameterM,
      conductorTempC: Number(temp) || 0,
      currentDensity: Number(density) || 0,
      currentA: Number(current) || 0,
      lengthM,
    };
    if (!(p.diameterM > 0) || !(p.currentDensity > 0)) return null;
    return cableSize(p);
  }, [diameterM, temp, density, current, lengthM]);

  return (
    <div>
      <h3>Cable Size</h3>
      <div className="calc-row">
        <Group title="Wire properties">
          <div className="calc-field">
            <span className="calc-field-label">Standard size:</span>
            <select
              className="calc-select"
              value={awgIdx}
              onChange={(e) => pickAwg(Number(e.target.value))}
            >
              {AWG_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <NumField
            label="Diameter:"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={diameterM}
            onBase={typeDiameter}
          />
          <Field
            label="Cross-section area:"
            value={r ? fmt(r.areaMm2) : '--'}
            readOnly
            unit="mm²"
          />
          <Field
            label="Resistance per meter (20 °C):"
            value={r ? fmt(r.resPerMeter20 * 1000) : '--'}
            readOnly
            unit="mΩ/m"
          />
          <Field label="Conductor temperature:" value={temp} onChange={setTemp} unit="°C" />
          <Field
            label="Resistance per meter (hot):"
            value={r ? fmt(r.resPerMeter * 1000) : '--'}
            readOnly
            unit="mΩ/m"
          />
          <Field label="Max current density:" value={density} onChange={setDensity} unit="A/mm²" />
          <Field
            label="Ampacity (by density):"
            value={r ? fmt(r.ampacityA) : '--'}
            readOnly
            unit="A"
          />
        </Group>
        <Group title="Application">
          <Field label="Current:" value={current} onChange={setCurrent} unit="A" />
          <NumField
            label="Length:"
            units={LEN_UNITS}
            defaultUnit="m"
            base={lengthM}
            onBase={setLengthM}
          />
          <Field label="Resistance:" value={r ? fmt(r.resistanceOhm) : '--'} readOnly unit="Ω" />
          <Field label="Voltage drop:" value={r ? fmt(r.voltageDrop) : '--'} readOnly unit="V" />
          <Field label="Dissipated power:" value={r ? fmt(r.powerLossW) : '--'} readOnly unit="W" />
          {r && (Number(current) || 0) > r.ampacityA && (
            <div className="calc-error">Current exceeds the ampacity for this density.</div>
          )}
        </Group>
      </div>
      {!r && <div className="calc-error">Enter a positive diameter and current density.</div>}
    </div>
  );
}
