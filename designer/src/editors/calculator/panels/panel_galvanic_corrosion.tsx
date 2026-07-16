/**
 * "Galvanic Corrosion" memo panel — anodic-index difference matrix.
 * Counterpart: KiCad `calculator_panels/panel_galvanic_corrosion.cpp`.
 */

import { useState, type JSX } from 'react';
import { CORROSION_METALS, corrosionDeltaV } from '@ziroeda/pcb_calculator';
import { Field, fmt, parseNum } from '../fields.js';

export function PanelGalvanicCorrosion(): JSX.Element {
  const [threshold, setThreshold] = useState('0.3');
  const t = parseNum(threshold);

  return (
    <div>
      <h3>Galvanic Corrosion</h3>
      <div className="calc-note">
        Potential difference (V) between metal pairs, from their anodic index. Pairs above the
        threshold (highlighted) risk corroding the more anodic metal. 0.3 V suits controlled
        environments; use 0.15 V for harsh/marine ones.
      </div>
      <Field
        label="Corrosion threshold:"
        value={threshold}
        onChange={setThreshold}
        unit="V"
        width={70}
      />
      <div style={{ overflowX: 'auto' }}>
        <table className="calc-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th className="rowhead">Metal (potential, V)</th>
              {CORROSION_METALS.map((m) => (
                <th
                  key={m.name}
                  title={`${m.name} (${m.symbol})`}
                  style={{ maxWidth: 60, overflow: 'hidden' }}
                >
                  {m.symbol.slice(0, 8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORROSION_METALS.map((row, i) => (
              <tr key={row.name}>
                <td className="rowhead">
                  {row.name} ({fmt(row.potentialV, 3)} V)
                </td>
                {CORROSION_METALS.map((col, j) => {
                  const dv = corrosionDeltaV(i, j);
                  return (
                    <td key={col.name} className={Number.isFinite(t) && dv > t ? 'bad' : ''}>
                      {dv.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
