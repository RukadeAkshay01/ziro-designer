/**
 * "Track Width" panel — IPC-2221 current capacity for external and internal
 * layers. Counterpart: KiCad `calculator_panels/panel_track_width.cpp`.
 */

import { useState, type JSX } from 'react';
import { COPPER_RESISTIVITY_OHM_M, trackWidth } from '@ziroeda/pcb_calculator';
import { Field, Group, LEN_UNITS, NumField, fmt } from '../fields.js';

export function PanelTrackWidth(): JSX.Element {
  // Controlling value: the applied current (shown in bold, like KiCad).
  const [currentA, setCurrentA] = useState(1);
  const [deltaTC, setDeltaTC] = useState(10);
  const [lengthM, setLengthM] = useState(0.2);
  const [extThicknessM, setExtThicknessM] = useState(35e-6);
  const [intThicknessM, setIntThicknessM] = useState(35e-6);

  const valid = currentA > 0 && deltaTC > 0 && lengthM >= 0;
  const ext =
    valid && extThicknessM > 0
      ? trackWidth({ currentA, deltaTC, lengthM, thicknessM: extThicknessM }, true)
      : null;
  const int_ =
    valid && intThicknessM > 0
      ? trackWidth({ currentA, deltaTC, lengthM, thicknessM: intThicknessM }, false)
      : null;

  const layerBox = (
    title: string,
    r: ReturnType<typeof trackWidth> | null,
    thicknessM: number,
    setThicknessM: (v: number) => void,
  ): JSX.Element => (
    <Group title={title}>
      <NumField
        label="Track width (W):"
        units={LEN_UNITS}
        defaultUnit="mm"
        base={r ? r.widthM : NaN}
        readOnly
      />
      <NumField
        label="Track thickness (H):"
        units={LEN_UNITS}
        defaultUnit="µm"
        base={thicknessM}
        onBase={setThicknessM}
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
    </Group>
  );

  return (
    <div>
      <h3>Track Width</h3>
      <div className="calc-row">
        <Group title="Parameters">
          <label className="calc-field">
            <span className="calc-field-label" style={{ fontWeight: 700 }}>
              Current (I):
            </span>
            <input
              className="calc-input"
              style={{ fontWeight: 700 }}
              value={fmt(currentA)}
              spellCheck={false}
              onChange={(e) => setCurrentA(Number(e.target.value) || 0)}
            />
            <span className="calc-unit">A</span>
          </label>
          <Field
            label="Temperature rise (ΔT):"
            value={fmt(deltaTC)}
            onChange={(v) => setDeltaTC(Number(v) || 0)}
            unit="°C"
          />
          <NumField
            label="Conductor length:"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={lengthM}
            onBase={setLengthM}
          />
          <Field
            label="Copper resistivity:"
            value={String(COPPER_RESISTIVITY_OHM_M)}
            readOnly
            unit="Ω·m"
          />
        </Group>
        {layerBox('External Layer Tracks', ext, extThicknessM, setExtThicknessM)}
        {layerBox('Internal Layer Tracks', int_, intThicknessM, setIntThicknessM)}
      </div>
      {!valid && <div className="calc-error">Enter positive current, ΔT and length.</div>}

      <fieldset className="calc-group">
        <legend>Help</legend>
        <div className="calc-note" style={{ lineHeight: 1.6 }}>
          Enter the required current and the track widths are sized to carry it. The controlling
          value (current) is shown in bold. Valid for currents up to ~35 A external / 17.5 A
          internal, temperature rise up to 100 °C and widths up to 400 mils (10 mm).
        </div>
        <div className="calc-formula" style={{ marginTop: 8 }}>
          I = K · ΔT^0.44 · (W·H)^0.725 — IPC-2221, K = 0.048 external / 0.024 internal (W, H in
          mils)
        </div>
      </fieldset>
    </div>
  );
}
