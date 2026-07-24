/**
 * Board Setup > Text & Graphics > Defaults. Counterparts:
 * `pcbnew/dialogs/panel_setup_text_and_graphics_base.cpp` (the layer-class grid,
 * "Default Properties for New Graphics and Text") and
 * `pcbnew/dialogs/panel_setup_dimensions_base.cpp` ("Default Properties for New
 * Dimension Objects"), which KiCad stacks on the same Defaults page.
 *
 * The grid rows are layer classes (Silk / Copper / Edge Cuts / Courtyards / Fab /
 * Other). Edge Cuts and Courtyards are graphics-only, so their Text Width/Height/
 * Thickness/Italic/Keep-Upright cells are blank and disabled, as upstream.
 */

import type { JSX } from 'react';
import type { DimensionDefaults, TextGfxDefaults, TextGfxRow } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTextGraphics,
  type DimensionDefaults,
  type TextGfxDefaults,
  type TextGfxRow,
} from '../../board_settings.js';

// Row labels + whether the row carries text (Edge Cuts / Courtyards do not).
const ROWS: { label: string; text: boolean }[] = [
  { label: 'Silk Layers', text: true },
  { label: 'Copper Layers', text: true },
  { label: 'Edge Cuts', text: false },
  { label: 'Courtyards', text: false },
  { label: 'Fab Layers', text: true },
  { label: 'Other Layers', text: true },
];

// Dimension choice lists (panel_setup_dimensions_base.cpp).
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'];
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'];
const DIM_PRECISION = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'];
const DIM_POSITION = ['Outside', 'Inline'];

interface Props {
  value: TextGfxDefaults;
  onChange: (next: TextGfxDefaults) => void;
}

// Text columns (blank for graphics-only rows); Line Thickness is always shown.
const TEXT_COLS: { label: string; key: 'textWidth' | 'textHeight' | 'textThickness' }[] = [
  { label: 'Text Width', key: 'textWidth' },
  { label: 'Text Height', key: 'textHeight' },
  { label: 'Text Thickness', key: 'textThickness' },
];

export function PanelPcbTextGraphics({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const setCell = (i: number, patch: Partial<TextGfxRow>): void =>
    onChange({ ...value, rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setDim = <K extends keyof DimensionDefaults>(k: K, val: DimensionDefaults[K]): void =>
    onChange({ ...value, dimensions: { ...value.dimensions, [k]: val } });
  const d = value.dimensions;

  const dimGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'max-content 130px max-content',
    alignItems: 'center',
    gap: '8px 8px',
    fontSize: 12.5,
  };
  // Graphics-only cells: no gridlines + the outside-table grey, so Edge Cuts /
  // Courtyards read as one blank block like KiCad (not empty bordered cells).
  const blankCell: React.CSSProperties = { border: 'none', background: 'var(--chrome-bg)' };

  return (
    <div style={{ padding: '2px 2px' }}>
      {/* Layer-class grid */}
      <div style={{ fontSize: 12.5, marginBottom: 6 }}>
        Default Properties for New Graphics and Text
      </div>
      <div className="ze-grid-pane" style={{ maxHeight: '48vh' }}>
        <table className="ze-grid" style={{ width: '100%', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0 }} />
              <th>Line Thickness (mm)</th>
              {TEXT_COLS.map((c) => (
                <th key={c.key}>{c.label} (mm)</th>
              ))}
              <th>Italic</th>
              <th>Keep Upright</th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((r, i) => {
              const hasText = ROWS[i]!.text;
              return (
                <tr key={i}>
                  <th
                    style={{ textAlign: 'left', padding: '0 8px', background: 'var(--chrome-bg2)' }}
                  >
                    {ROWS[i]!.label}
                  </th>
                  <td>
                    <input
                      type="text"
                      value={r.lineThickness}
                      onChange={(e) => setCell(i, { lineThickness: num(e.target.value) })}
                    />
                  </td>
                  {TEXT_COLS.map((c) => (
                    <td key={c.key} style={hasText ? undefined : blankCell}>
                      {hasText ? (
                        <input
                          type="text"
                          value={r[c.key]}
                          onChange={(e) => setCell(i, { [c.key]: num(e.target.value) })}
                        />
                      ) : null}
                    </td>
                  ))}
                  <td
                    style={
                      hasText ? { textAlign: 'center' } : { ...blankCell, textAlign: 'center' }
                    }
                  >
                    {hasText && (
                      <input
                        type="checkbox"
                        checked={r.italic}
                        onChange={(e) => setCell(i, { italic: e.target.checked })}
                      />
                    )}
                  </td>
                  <td
                    style={
                      hasText ? { textAlign: 'center' } : { ...blankCell, textAlign: 'center' }
                    }
                  >
                    {hasText && (
                      <input
                        type="checkbox"
                        checked={r.keepUpright}
                        onChange={(e) => setCell(i, { keepUpright: e.target.checked })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dimension defaults (panel_setup_dimensions) */}
      <div style={{ fontSize: 12.5, margin: '14px 0 8px' }}>
        Default Properties for New Dimension Objects
      </div>
      <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
        <div style={dimGrid}>
          <span>Units:</span>
          <select
            className="ze-select"
            style={{ width: '100%' }}
            value={d.units}
            onChange={(e) => setDim('units', e.target.value)}
          >
            {DIM_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <span />
          <span>Units format:</span>
          <select
            className="ze-select"
            style={{ width: '100%' }}
            value={d.format}
            onChange={(e) => setDim('format', e.target.value)}
          >
            {DIM_FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <span />
          <span>Precision:</span>
          <select
            className="ze-select"
            style={{ width: '100%' }}
            value={d.precision}
            onChange={(e) => setDim('precision', e.target.value)}
          >
            {DIM_PRECISION.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <span />
          <label style={{ gridColumn: '1 / 4', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={d.suppressTrailingZeroes}
              onChange={(e) => setDim('suppressTrailingZeroes', e.target.checked)}
            />
            Suppress trailing zeroes
          </label>
        </div>

        <div style={dimGrid}>
          <span>Text position:</span>
          <select
            className="ze-select"
            style={{ width: '100%' }}
            value={d.textPosition}
            onChange={(e) => setDim('textPosition', e.target.value)}
          >
            {DIM_POSITION.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <span />
          <label style={{ gridColumn: '1 / 4', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={d.keepTextAligned}
              onChange={(e) => setDim('keepTextAligned', e.target.checked)}
            />
            Keep text aligned
          </label>
          <span>Arrow length:</span>
          <input
            className="ze-search"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={d.arrowLengthMM}
            onChange={(e) => setDim('arrowLengthMM', num(e.target.value))}
          />
          <span className="ze-muted" style={{ fontSize: 11 }}>
            mm
          </span>
          <span>Extension line offset:</span>
          <input
            className="ze-search"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={d.extLineOffsetMM}
            onChange={(e) => setDim('extLineOffsetMM', num(e.target.value))}
          />
          <span className="ze-muted" style={{ fontSize: 11 }}>
            mm
          </span>
        </div>
      </div>
    </div>
  );
}
