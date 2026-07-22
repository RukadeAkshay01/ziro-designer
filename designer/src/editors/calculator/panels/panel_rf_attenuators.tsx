/**
 * "RF Attenuators" panel — PI, Tee, bridged Tee and resistive splitter.
 * Counterpart: KiCad `calculator_panels/panel_rf_attenuators.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import { ATTENUATORS, AttenuatorType, calculateAttenuator } from '@ziroeda/pcb_calculator';
import { Field, Group, fmt, parseNum } from '../fields.js';

/** Simple schematic sketch per topology. */
function AttenuatorDrawing({ type }: { type: AttenuatorType }): JSX.Element {
  const res = (x: number, y: number, vertical: boolean, label: string): JSX.Element => (
    <g key={label}>
      {vertical ? (
        <path
          d={`M${x} ${y} l5 4 l-10 7 l10 7 l-10 7 l10 7 l-5 4`}
          stroke="#4a86c5"
          fill="none"
          strokeWidth="1.5"
        />
      ) : (
        <path
          d={`M${x} ${y} l4 -5 l7 10 l7 -10 l7 10 l7 -10 l4 5`}
          stroke="#4a86c5"
          fill="none"
          strokeWidth="1.5"
        />
      )}
      <text
        x={vertical ? x + 10 : x + 12}
        y={vertical ? y + 22 : y - 10}
        fill="#e6e6e6"
        fontSize="12"
      >
        {label}
      </text>
    </g>
  );
  const wire = (x1: number, y1: number, x2: number, y2: number, i: number): JSX.Element => (
    <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4a86c5" strokeWidth="1.5" />
  );
  const gnd = (x: number, y: number, i: number): JSX.Element => (
    <g key={`g${i}`} stroke="#4a86c5" strokeWidth="1.5">
      <line x1={x - 10} y1={y} x2={x + 10} y2={y} />
      <line x1={x - 6} y1={y + 4} x2={x + 6} y2={y + 4} />
      <line x1={x - 2} y1={y + 8} x2={x + 2} y2={y + 8} />
    </g>
  );

  switch (type) {
    case AttenuatorType.PI:
      return (
        <svg width="320" height="150" className="calc-svg">
          {wire(10, 40, 90, 40, 0)}
          {res(90, 35, false, 'R2')}
          {wire(126, 40, 310, 40, 1)}
          {wire(60, 40, 60, 60, 2)}
          {res(55, 60, true, 'R1')}
          {wire(60, 96, 60, 115, 3)}
          {gnd(60, 115, 0)}
          {wire(250, 40, 250, 60, 4)}
          {res(245, 60, true, 'R3')}
          {wire(250, 96, 250, 115, 5)}
          {gnd(250, 115, 1)}
        </svg>
      );
    case AttenuatorType.TEE:
      return (
        <svg width="320" height="150" className="calc-svg">
          {wire(10, 40, 60, 40, 0)}
          {res(60, 35, false, 'R1')}
          {wire(96, 40, 170, 40, 1)}
          {res(170, 35, false, 'R3')}
          {wire(206, 40, 310, 40, 2)}
          {wire(150, 40, 150, 60, 3)}
          {res(145, 60, true, 'R2')}
          {wire(150, 96, 150, 115, 4)}
          {gnd(150, 115, 0)}
        </svg>
      );
    case AttenuatorType.BRIDGED_TEE:
      return (
        <svg width="320" height="190" className="calc-svg">
          {wire(10, 70, 70, 70, 0)}
          {wire(70, 70, 70, 30, 1)}
          {wire(70, 30, 120, 30, 2)}
          {res(120, 25, false, 'R1')}
          {wire(156, 30, 210, 30, 3)}
          {wire(210, 30, 210, 70, 4)}
          {wire(70, 70, 100, 70, 5)}
          {res(100, 65, false, 'Z0')}
          {wire(136, 70, 150, 70, 6)}
          {res(150, 65, false, 'Z0')}
          {wire(186, 70, 210, 70, 7)}
          {wire(210, 70, 310, 70, 8)}
          {wire(143, 70, 143, 95, 9)}
          {res(138, 95, true, 'R2')}
          {wire(143, 131, 143, 150, 10)}
          {gnd(143, 150, 0)}
        </svg>
      );
    case AttenuatorType.SPLITTER:
      return (
        <svg width="320" height="150" className="calc-svg">
          {wire(10, 70, 60, 70, 0)}
          {res(60, 65, false, 'R1')}
          {wire(96, 70, 130, 70, 1)}
          {wire(130, 70, 130, 30, 2)}
          {wire(130, 70, 130, 110, 3)}
          {wire(130, 30, 160, 30, 4)}
          {res(160, 25, false, 'R2')}
          {wire(196, 30, 310, 30, 5)}
          {wire(130, 110, 160, 110, 6)}
          {res(160, 105, false, 'R3')}
          {wire(196, 110, 310, 110, 7)}
        </svg>
      );
  }
}

export function PanelRfAttenuators(): JSX.Element {
  const [type, setType] = useState<AttenuatorType>(AttenuatorType.PI);
  const [atten, setAtten] = useState('6');
  const [zin, setZin] = useState('50');
  const [zout, setZout] = useState('50');

  const info = ATTENUATORS[type] ?? ATTENUATORS[0]!;
  const r = useMemo(
    () =>
      calculateAttenuator(
        type,
        parseNum(atten),
        parseNum(zin),
        info.hasZout ? parseNum(zout) : parseNum(zin),
      ),
    [type, atten, zin, zout, info.hasZout],
  );

  return (
    <div>
      <h3>RF Attenuators</h3>
      <div className="calc-row">
        <div className="calc-col" style={{ maxWidth: 260 }}>
          <Group title="Attenuator type">
            {ATTENUATORS.map((a) => (
              <label key={a.type} className="calc-radio">
                <input
                  type="radio"
                  name="att-type"
                  checked={type === a.type}
                  onChange={() => setType(a.type)}
                />
                {a.name}
              </label>
            ))}
          </Group>
          <AttenuatorDrawing type={type} />
        </div>
        <div className="calc-col">
          <Group title="Parameters">
            {info.hasAttenuation ? (
              <Field label="Attenuation:" value={atten} onChange={setAtten} unit="dB" />
            ) : (
              <Field label="Attenuation (fixed):" value="6.02" readOnly unit="dB" />
            )}
            <Field label="Zin:" value={zin} onChange={setZin} unit="Ω" />
            {info.hasZout && <Field label="Zout:" value={zout} onChange={setZout} unit="Ω" />}
            {info.hasAttenuation && (
              <Field
                label="Minimum attenuation:"
                value={fmt(r.minAttenuationDb, 4)}
                readOnly
                unit="dB"
              />
            )}
          </Group>
          <Group title="Resistor values">
            {r.error ? (
              <div className="calc-error">{r.error}</div>
            ) : (
              info.resistorLabels.map((label, i) => (
                <Field
                  key={label}
                  label={`${label}:`}
                  value={fmt(r.resistors[i] ?? NaN, 5)}
                  readOnly
                  unit="Ω"
                />
              ))
            )}
          </Group>
        </div>
      </div>
    </div>
  );
}
