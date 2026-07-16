/**
 * "Color Code" memo panel — resistor band encoder + reference chart.
 * Counterpart: KiCad `calculator_panels/panel_color_code.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  DIGIT_COLORS,
  MULTIPLIER_COLORS,
  TEMPCO_COLORS,
  TOLERANCE_COLORS,
  colorCode,
} from '@ziroeda/pcb_calculator';
import { Field, Group, fmt, parseNum } from '../fields.js';

export function PanelColorCode(): JSX.Element {
  const [value, setValue] = useState('4700');
  const [tolerance, setTolerance] = useState(5);
  const [bands, setBands] = useState<4 | 5 | 6>(4);
  const [tempco, setTempco] = useState(100);

  const r = useMemo(
    () => colorCode(parseNum(value), tolerance, bands, tempco),
    [value, tolerance, bands, tempco],
  );

  const allBands = r.error
    ? []
    : [
        ...r.digits,
        r.multiplier,
        ...(r.tolerance ? [r.tolerance] : []),
        ...(r.tempco ? [r.tempco] : []),
      ];

  return (
    <div>
      <h3>Resistor Color Code</h3>
      <Group title="Resistor">
        <Field label="Resistance:" value={value} onChange={setValue} unit="Ω" />
        <div className="calc-field">
          <span className="calc-field-label">Tolerance:</span>
          <select
            className="calc-select"
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value))}
          >
            {TOLERANCE_COLORS.map((t) => (
              <option key={t.pct} value={t.pct}>
                ±{t.pct} % ({t.name})
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field">
          <span className="calc-field-label">Bands:</span>
          <label className="calc-radio">
            <input
              type="radio"
              name="cc-bands"
              checked={bands === 4}
              onChange={() => setBands(4)}
            />
            4 band (2 digits)
          </label>
          <label className="calc-radio">
            <input
              type="radio"
              name="cc-bands"
              checked={bands === 5}
              onChange={() => setBands(5)}
            />
            5 band (3 digits)
          </label>
          <label className="calc-radio">
            <input
              type="radio"
              name="cc-bands"
              checked={bands === 6}
              onChange={() => setBands(6)}
            />
            6 band (+ tempco)
          </label>
        </div>
        {bands === 6 && (
          <div className="calc-field">
            <span className="calc-field-label">Temp. coefficient:</span>
            <select
              className="calc-select"
              value={tempco}
              onChange={(e) => setTempco(Number(e.target.value))}
            >
              {TEMPCO_COLORS.map((t) => (
                <option key={t.ppm} value={t.ppm}>
                  {t.ppm} ppm/K ({t.name})
                </option>
              ))}
            </select>
          </div>
        )}
      </Group>

      {r.error ? (
        <div className="calc-error">{r.error}</div>
      ) : (
        <>
          <div className="cc-resistor" data-testid="cc-bands">
            {allBands.map((b, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={i} className="cc-band" style={{ background: b.css }} title={b.name} />
            ))}
          </div>
          <div className="calc-note">
            {allBands.map((b) => b.name).join(' – ')} → encodes {fmt(r.encodedOhms, 6)} Ω ±
            {tolerance} %
          </div>
        </>
      )}

      <Group title="Chart">
        <table className="calc-table">
          <thead>
            <tr>
              <th>Color</th>
              <th>Digit</th>
              <th>Multiplier</th>
              <th>Tolerance</th>
            </tr>
          </thead>
          <tbody>
            {MULTIPLIER_COLORS.map((m) => {
              const digit = DIGIT_COLORS.findIndex((d) => d.name === m.name);
              const tol = TOLERANCE_COLORS.find((t) => t.name === m.name);
              return (
                <tr key={m.name}>
                  <td className="rowhead">
                    <span
                      style={{
                        display: 'inline-block',
                        width: 12,
                        height: 12,
                        background: m.css,
                        border: '1px solid #333',
                        marginRight: 6,
                        verticalAlign: 'middle',
                      }}
                    />
                    {m.name}
                  </td>
                  <td>{digit >= 0 ? digit : ''}</td>
                  <td>×10{m.exp === 0 ? '⁰' : sup(m.exp)}</td>
                  <td>{tol ? `±${tol.pct} %` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Group>
    </div>
  );
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(n: number): string {
  const neg = n < 0 ? '⁻' : '';
  return (
    neg +
    String(Math.abs(n))
      .split('')
      .map((c) => SUP[Number(c)])
      .join('')
  );
}
