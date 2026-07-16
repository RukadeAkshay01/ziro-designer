/**
 * "Board Classes" memo panel — typical fabrication limits per class.
 * Counterpart: KiCad `calculator_panels/panel_board_class.cpp`.
 */

import { useState, type JSX } from 'react';
import { BOARD_CLASS_COUNT, BOARD_CLASS_ROWS } from '@ziroeda/pcb_calculator';
import { fmt } from '../fields.js';

export function PanelBoardClass(): JSX.Element {
  const [inches, setInches] = useState(false);
  const conv = (mm: number): string =>
    Number.isNaN(mm) ? '-' : inches ? fmt(mm / 25.4, 4) : fmt(mm, 4);

  return (
    <div>
      <h3>Board Classes</h3>
      <div className="calc-note">
        Indicative geometry limits per manufacturing class — a finer class means tighter features
        and a more expensive board. Always confirm against your fab's capabilities.
      </div>
      <div className="calc-field">
        <span className="calc-field-label">Units:</span>
        <label className="calc-radio">
          <input type="radio" name="bc-units" checked={!inches} onChange={() => setInches(false)} />
          mm
        </label>
        <label className="calc-radio">
          <input type="radio" name="bc-units" checked={inches} onChange={() => setInches(true)} />
          inch
        </label>
      </div>
      <table className="calc-table">
        <thead>
          <tr>
            <th className="rowhead">Parameter</th>
            {Array.from({ length: BOARD_CLASS_COUNT }, (_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <th key={i}>Class {i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_CLASS_ROWS.map((row) => (
            <tr key={row.label}>
              <td className="rowhead">{row.label}</td>
              {row.mm.map((v, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={i}>{conv(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
