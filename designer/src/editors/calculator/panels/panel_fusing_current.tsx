/**
 * "Fusing Current" panel — Preece / Onderdonk melting-current estimates.
 * Counterpart: KiCad `calculator_panels/panel_fusing_current.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import { fusingCurrent } from '@ziroeda/pcb_calculator';
import { Field, Group, LEN_UNITS, NumField, TIME_UNITS, fmt } from '../fields.js';

export function PanelFusingCurrent(): JSX.Element {
  const [ambientC, setAmbientC] = useState(25);
  const [meltingC, setMeltingC] = useState(1084);
  const [widthM, setWidthM] = useState(0.5e-3);
  const [thicknessM, setThicknessM] = useState(35e-6);
  const [timeS, setTimeS] = useState(1);
  const [round, setRound] = useState(false);

  const r = useMemo(() => {
    const p = {
      ambientC,
      meltingC,
      widthM,
      thicknessM: round ? 0 : thicknessM,
      timeS,
    };
    if (!(p.widthM > 0) || !(p.timeS > 0) || !(p.meltingC > p.ambientC)) return null;
    if (!round && !(p.thicknessM > 0)) return null;
    return fusingCurrent(p);
  }, [ambientC, meltingC, widthM, thicknessM, timeS, round]);

  return (
    <div>
      <h3>Fusing Current</h3>
      <div className="calc-note">
        Estimates the current that melts a copper conductor — Preece for steady state, Onderdonk for
        a short event. These are estimates; treat them with a healthy safety margin.
      </div>
      <Group title="Parameters">
        <Field
          label="Ambient temperature:"
          value={fmt(ambientC)}
          onChange={(v) => setAmbientC(Number(v) || 0)}
          unit="°C"
        />
        <Field
          label="Melting point:"
          value={fmt(meltingC)}
          onChange={(v) => setMeltingC(Number(v) || 0)}
          unit="°C"
        />
        <div className="calc-field">
          <span className="calc-field-label">Conductor shape:</span>
          <label className="calc-radio">
            <input
              type="radio"
              name="fuse-shape"
              checked={!round}
              onChange={() => setRound(false)}
            />
            Rectangular (track)
          </label>
          <label className="calc-radio">
            <input type="radio" name="fuse-shape" checked={round} onChange={() => setRound(true)} />
            Round wire
          </label>
        </div>
        <NumField
          label={round ? 'Diameter:' : 'Width:'}
          units={LEN_UNITS}
          defaultUnit="mm"
          base={widthM}
          onBase={setWidthM}
        />
        {!round && (
          <NumField
            label="Thickness:"
            units={LEN_UNITS}
            defaultUnit="µm"
            base={thicknessM}
            onBase={setThicknessM}
          />
        )}
        <NumField label="Duration (Onderdonk):" units={TIME_UNITS} base={timeS} onBase={setTimeS} />
      </Group>
      <Group title="Results">
        <Field
          label="Cross-section area:"
          value={r ? fmt(r.areaM2 * 1e6) : '--'}
          readOnly
          unit="mm²"
        />
        <NumField
          label="Equivalent wire diameter:"
          units={LEN_UNITS}
          defaultUnit="mm"
          base={r ? r.equivDiaM : NaN}
          readOnly
        />
        <Field label="Preece fusing current:" value={r ? fmt(r.preeceA) : '--'} readOnly unit="A" />
        <Field
          label="Onderdonk fusing current:"
          value={r ? fmt(r.onderdonkA) : '--'}
          readOnly
          unit="A"
        />
        {r && !r.onderdonkValid && (
          <div className="calc-error">
            Onderdonk is only valid for events of about 10 s or less.
          </div>
        )}
      </Group>
      {!r && (
        <div className="calc-error">Check the inputs (positive sizes, melting above ambient).</div>
      )}
    </div>
  );
}
