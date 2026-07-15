/**
 * "Track Width" panel — IPC-2221 current capacity for external and internal
 * layers. Counterpart: KiCad `calculator_panels/panel_track_width.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import { trackWidth } from '@ziroeda/pcb_calculator';
import { Field, Group, LEN_UNITS, NumField, type UnitOpt, fmt } from '../fields.js';

// Copper thickness selector: weight (oz/ft²) or an absolute thickness.
const COPPER_UNITS: UnitOpt[] = [
  { label: 'oz/ft²', mult: 35e-6 },
  { label: 'µm', mult: 1e-6 },
  { label: 'mm', mult: 1e-3 },
];

export function PanelTrackWidth(): JSX.Element {
  // State in base SI units; the widgets convert to/from the chosen unit.
  const [currentA, setCurrentA] = useState(1);
  const [deltaTC, setDeltaTC] = useState(10);
  const [lengthM, setLengthM] = useState(0.2);
  const [thicknessM, setThicknessM] = useState(35e-6);

  const valid = currentA > 0 && deltaTC > 0 && lengthM >= 0 && thicknessM > 0;
  const params = useMemo(
    () => ({ currentA, deltaTC, lengthM, thicknessM }),
    [currentA, deltaTC, lengthM, thicknessM],
  );
  const ext = valid ? trackWidth(params, true) : null;
  const int_ = valid ? trackWidth(params, false) : null;

  const results = (r: ReturnType<typeof trackWidth> | null): JSX.Element => (
    <>
      <NumField
        label="Required track width:"
        units={LEN_UNITS}
        defaultUnit="mm"
        base={r ? r.widthM : NaN}
        readOnly
      />
      <Field
        label="Cross-section area:"
        value={r ? fmt(r.areaM2 * 1e6) : '--'}
        readOnly
        unit="mm²"
      />
      <Field label="Resistance:" value={r ? fmt(r.resistanceOhm) : '--'} readOnly unit="Ω" />
      <Field label="Voltage drop:" value={r ? fmt(r.voltageDrop) : '--'} readOnly unit="V" />
      <Field label="Power loss:" value={r ? fmt(r.powerLossW) : '--'} readOnly unit="W" />
    </>
  );

  return (
    <div>
      <h3>Track Width (IPC-2221)</h3>
      <div className="calc-formula">
        I = K · ΔT^0.44 · (W·H)^0.725 — K = 0.048 external, 0.024 internal
      </div>
      <div className="calc-note">
        The IPC-2221 nomograph-based estimate; valid for currents up to ~35 A, temperature rise up
        to 100 °C and copper up to 3 oz/ft².
      </div>
      <Group title="Parameters">
        <NumField
          label="Current:"
          units={[{ label: 'A', mult: 1 }]}
          base={currentA}
          onBase={setCurrentA}
        />
        <Field
          label="Temperature rise:"
          value={fmt(deltaTC)}
          onChange={(v) => setDeltaTC(Number(v) || 0)}
          unit="°C"
        />
        <NumField
          label="Conductor length:"
          units={LEN_UNITS}
          defaultUnit="cm"
          base={lengthM}
          onBase={setLengthM}
        />
        <NumField
          label="Copper thickness:"
          units={COPPER_UNITS}
          base={thicknessM}
          onBase={setThicknessM}
        />
      </Group>
      {!valid && <div className="calc-error">Enter positive values.</div>}
      <div className="calc-row">
        <Group title="External layer traces">{results(ext)}</Group>
        <Group title="Internal layer traces">{results(int_)}</Group>
      </div>
    </div>
  );
}
