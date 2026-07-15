/**
 * "Via Size" panel — electrical, thermal and parasitic characteristics of a
 * plated through-hole via. Counterpart: KiCad `calculator_panels/panel_via_size.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import { viaSize } from '@ziroeda/pcb_calculator';
import { Field, Group, LEN_UNITS, NumField, fmt } from '../fields.js';

export function PanelViaSize(): JSX.Element {
  const [holeDiaM, setHoleDiaM] = useState(0.4e-3);
  const [platingM, setPlatingM] = useState(0.035e-3);
  const [lengthM, setLengthM] = useState(1.6e-3);
  const [padDiaM, setPadDiaM] = useState(0.6e-3);
  const [clearanceDiaM, setClearanceDiaM] = useState(1.0e-3);
  const [er, setEr] = useState('4.5');
  const [current, setCurrent] = useState('1');
  const [deltaT, setDeltaT] = useState('10');

  const r = useMemo(() => {
    const p = {
      holeDiaM,
      platingM,
      lengthM,
      padDiaM,
      clearanceDiaM,
      epsilonR: Number(er) || 0,
      currentA: Number(current) || 0,
      deltaTC: Number(deltaT) || 0,
    };
    if (!(p.holeDiaM > 0) || !(p.platingM > 0) || !(p.lengthM > 0) || !(p.deltaTC > 0)) return null;
    return viaSize(p);
  }, [holeDiaM, platingM, lengthM, padDiaM, clearanceDiaM, er, current, deltaT]);

  return (
    <div>
      <h3>Via Size</h3>
      <div className="calc-row">
        <Group title="Parameters">
          <NumField
            label="Finished hole diameter:"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={holeDiaM}
            onBase={setHoleDiaM}
          />
          <NumField
            label="Plating thickness:"
            units={LEN_UNITS}
            defaultUnit="µm"
            base={platingM}
            onBase={setPlatingM}
          />
          <NumField
            label="Via length (board thickness):"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={lengthM}
            onBase={setLengthM}
          />
          <NumField
            label="Via pad diameter:"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={padDiaM}
            onBase={setPadDiaM}
          />
          <NumField
            label="Clearance hole diameter:"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={clearanceDiaM}
            onBase={setClearanceDiaM}
          />
          <Field label="Board permittivity (εr):" value={er} onChange={setEr} unit="" />
          <Field label="Applied current:" value={current} onChange={setCurrent} unit="A" />
          <Field label="Temperature rise:" value={deltaT} onChange={setDeltaT} unit="°C" />
        </Group>
        <Group title="Results">
          <Field
            label="Resistance:"
            value={r ? fmt(r.resistanceOhm * 1000) : '--'}
            readOnly
            unit="mΩ"
          />
          <Field
            label="Voltage drop:"
            value={r ? fmt(r.voltageDrop * 1000) : '--'}
            readOnly
            unit="mV"
          />
          <Field
            label="Power loss:"
            value={r ? fmt(r.powerLossW * 1000) : '--'}
            readOnly
            unit="mW"
          />
          <Field
            label="Estimated ampacity (IPC-2221):"
            value={r ? fmt(r.ampacityA) : '--'}
            readOnly
            unit="A"
          />
          <Field
            label="Thermal resistance:"
            value={r ? fmt(r.thermalResistance) : '--'}
            readOnly
            unit="K/W"
          />
          <Field
            label="Capacitance:"
            value={r ? fmt(r.capacitanceF * 1e12) : '--'}
            readOnly
            unit="pF"
          />
          <Field
            label="Inductance:"
            value={r ? fmt(r.inductanceH * 1e9) : '--'}
            readOnly
            unit="nH"
          />
          <Field
            label="Reactance @ 1 GHz:"
            value={r ? fmt(r.reactanceOhm) : '--'}
            readOnly
            unit="Ω"
          />
          <Field
            label="Aspect ratio:"
            value={r ? fmt(r.aspectRatio, 3) : '--'}
            readOnly
            unit=":1"
          />
          {r && r.aspectRatio > 8 && (
            <div className="calc-error">
              Aspect ratio over 8:1 — many fabs cannot plate this via.
            </div>
          )}
        </Group>
      </div>
      {!r && <div className="calc-error">Enter positive hole, plating, length and ΔT values.</div>}
    </div>
  );
}
