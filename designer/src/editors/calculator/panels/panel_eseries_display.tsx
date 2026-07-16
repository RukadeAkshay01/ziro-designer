/**
 * "E-Series" memo panel — the IEC 60063 preferred-value tables, shown as two
 * colour-coded grids (E1/E3/E6/E12 and E24/E48/E96) like KiCad.
 * Counterpart: KiCad `calculator_panels/panel_eseries_display.cpp`.
 */

import type { JSX } from 'react';
import {
  E1_VALUES,
  E3_VALUES,
  E6_VALUES,
  E12_VALUES,
  E24_VALUES,
  E48_VALUES,
  E96_VALUES,
} from '@ziroeda/pcb_calculator';

/** Per-series background colours, matching KiCad's palette (BGR → RGB). */
interface SeriesCol {
  name: string;
  values: readonly number[];
  colour: string;
  decimals: number;
}

const GRID_112: SeriesCol[] = [
  { name: 'E1', values: E1_VALUES, colour: '#f0fff0', decimals: 1 },
  { name: 'E3', values: E3_VALUES, colour: '#98fb98', decimals: 1 },
  { name: 'E6', values: E6_VALUES, colour: '#6495ed', decimals: 1 },
  { name: 'E12', values: E12_VALUES, colour: '#dda0dd', decimals: 1 },
];

const GRID_2496: SeriesCol[] = [
  { name: 'E24', values: E24_VALUES, colour: '#87ceeb', decimals: 1 },
  { name: 'E48', values: E48_VALUES, colour: '#6be823', decimals: 2 },
  { name: 'E96', values: E96_VALUES, colour: '#ffa07a', decimals: 2 },
];

function SeriesGrid({ title, cols }: { title: string; cols: SeriesCol[] }): JSX.Element {
  const rows = Math.max(...cols.map((c) => c.values.length));
  return (
    <fieldset className="calc-group">
      <legend>{title}</legend>
      <div className="es-scroll">
        <table className="es-grid">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.name} style={{ background: c.colour }}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={r}>
                {cols.map((c) => {
                  const v = c.values[r];
                  return (
                    <td key={c.name} style={{ background: c.colour }}>
                      {v != null ? v.toFixed(c.decimals) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

export function PanelEseriesDisplay(): JSX.Element {
  return (
    <div>
      <h3>E-Series (IEC 60063 preferred values)</h3>
      <div className="calc-note">
        First-decade base values (1 … 10). Series/tolerance pairing: E6 ±20 %, E12 ±10 %, E24 ±5 %,
        E48 ±2 %, E96 ±1 %.
      </div>
      <div className="calc-row">
        <SeriesGrid title="E1, E3, E6, E12" cols={GRID_112} />
        <SeriesGrid title="E24, E48, E96" cols={GRID_2496} />
      </div>
    </div>
  );
}
