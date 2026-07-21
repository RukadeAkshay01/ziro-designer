/**
 * Plot dialog. Counterpart: `eeschema/dialogs/dialog_plot_schematic.cpp`
 * (DIALOG_PLOT_SCHEMATIC) — the Output Format radio box on the left with the
 * Options group (page size, drawing sheet, output mode, color theme,
 * background, minimum line width) beside it, per-format option groups below,
 * and the Plot Current Page / Plot All Pages buttons. Upstream formats we do
 * not generate in the browser (Postscript, DXF) are greyed in place; the
 * output directory is the browser's download folder, so the field is greyed.
 */

import { useState, type JSX } from 'react';
import { mmToIU } from '@ziroeda/common';
import type { PlotOpts } from '../render/plot.js';
import { BUILTIN_THEMES } from '../theme.js';

export type PlotFormat = 'svg' | 'pdf' | 'png';

interface Props {
  /** The editor's active theme id (the "Color theme:" default selection). */
  themeId?: string;
  onPlot: (format: PlotFormat, opts: PlotOpts, allPages: boolean, themeId: string) => void;
  onClose: () => void;
}

const FORMATS: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'ps', label: 'Postscript', disabled: true },
  { id: 'pdf', label: 'PDF' },
  { id: 'svg', label: 'SVG' },
  { id: 'dxf', label: 'DXF', disabled: true },
  { id: 'png', label: 'PNG' },
];

export function DialogPlot({ themeId, onPlot, onClose }: Props): JSX.Element {
  const [format, setFormat] = useState<PlotFormat>('pdf');
  const [color, setColor] = useState(true);
  const [drawingSheet, setDrawingSheet] = useState(true);
  const [background, setBackground] = useState(true);
  const [themeSel, setThemeSel] = useState(
    themeId && BUILTIN_THEMES[themeId] ? themeId : '_builtin_default',
  );
  const [dpi, setDpi] = useState(300);
  const [minWidthMm, setMinWidthMm] = useState('0.1524');

  const opts = (): PlotOpts => ({
    color,
    drawingSheet,
    background,
    dpi,
    defaultPenIU: mmToIU(Number(minWidthMm) || 0),
  });

  const group: React.CSSProperties = {
    border: '1px solid var(--chrome-border)',
    borderRadius: 4,
    padding: '6px 10px 8px',
    margin: '0 0 10px',
  };
  const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px' };
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '5px 0',
    fontSize: 12.5,
  };
  const lab: React.CSSProperties = { width: 118, flex: '0 0 auto', fontSize: 12 };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 560, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Plot Schematic Options
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'block', padding: '10px 14px', maxHeight: '72vh', overflow: 'auto' }}
        >
          <div style={row}>
            <span style={lab}>Output directory:</span>
            <input
              className="ze-search"
              style={{ flex: 1 }}
              disabled
              placeholder="Browser downloads folder"
              title="Plots download through the browser; the target folder is your download setting."
            />
          </div>
          {/* KiCad 10's design-variant selector; the web app has no variant
              support yet, so the base design is the only entry. */}
          <div style={row}>
            <span style={lab}>Design variant:</span>
            <select
              className="ze-select"
              style={{ flex: 1 }}
              disabled
              value="default"
              title="Design variants are not supported in the browser yet"
            >
              <option value="default">Default</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <fieldset style={{ ...group, flex: '0 0 150px' }}>
              <legend style={legend}>Output Format</legend>
              {FORMATS.map((f) => (
                <label
                  key={f.id}
                  style={{
                    display: 'block',
                    margin: '4px 0',
                    fontSize: 12.5,
                    opacity: f.disabled ? 0.45 : 1,
                  }}
                  title={f.disabled ? 'Not supported in the browser yet' : undefined}
                >
                  <input
                    type="radio"
                    name="pfmt"
                    checked={format === f.id}
                    disabled={f.disabled}
                    onChange={() => setFormat(f.id as PlotFormat)}
                  />{' '}
                  {f.label}
                </label>
              ))}
            </fieldset>

            <fieldset style={{ ...group, flex: 1 }}>
              <legend style={legend}>Options</legend>
              <div style={row}>
                <span style={lab}>Page size:</span>
                <select
                  className="ze-select"
                  style={{ flex: 1 }}
                  value="schematic"
                  onChange={() => {}}
                >
                  <option value="schematic">Schematic size</option>
                  <option value="a4" disabled title="Not supported in the browser yet">
                    A4
                  </option>
                  <option value="a" disabled title="Not supported in the browser yet">
                    A
                  </option>
                </select>
              </div>
              <label style={{ display: 'block', margin: '5px 0', fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={drawingSheet}
                  onChange={(e) => setDrawingSheet(e.target.checked)}
                />{' '}
                Plot drawing sheet
              </label>
              <div style={row}>
                <span style={lab}>Output mode:</span>
                <select
                  className="ze-select"
                  style={{ flex: 1 }}
                  value={color ? 'color' : 'bw'}
                  onChange={(e) => setColor(e.target.value === 'color')}
                >
                  <option value="color">Color</option>
                  <option value="bw">Black and White</option>
                </select>
              </div>
              <div style={row}>
                <span style={lab}>Color theme:</span>
                <select
                  className="ze-select"
                  style={{ flex: 1 }}
                  value={themeSel}
                  disabled={!color}
                  onChange={(e) => setThemeSel(e.target.value)}
                >
                  {Object.entries(BUILTIN_THEMES).map(([id, t]) => (
                    <option key={id} value={id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <label style={{ display: 'block', margin: '5px 0', fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={background}
                  disabled={!color}
                  onChange={(e) => setBackground(e.target.checked)}
                  title="Plot the background color if the output format supports it"
                />{' '}
                Plot background color
              </label>
              <div style={row}>
                <span style={lab}>Minimum line width:</span>
                <input
                  className="ze-search"
                  style={{ width: 70 }}
                  value={minWidthMm}
                  title="Selection of the default pen thickness used to draw items, when their thickness is set to 0."
                  onChange={(e) => setMinWidthMm(e.target.value)}
                />
                <span className="ze-muted" style={{ fontSize: 11 }}>
                  mm
                </span>
              </div>
            </fieldset>
          </div>

          {format === 'pdf' && (
            <fieldset style={group}>
              <legend style={legend}>PDF Options</legend>
              {[
                'Generate property popups',
                'Generate clickable links for hierarchical elements',
                'Generate metadata from AUTHOR & SUBJECT variables',
              ].map((l) => (
                <label
                  key={l}
                  style={{ display: 'block', margin: '4px 0', fontSize: 12.5, opacity: 0.45 }}
                  title="Not supported in the browser yet"
                >
                  <input type="checkbox" disabled /> {l}
                </label>
              ))}
            </fieldset>
          )}
          {format === 'png' && (
            <fieldset style={group}>
              <legend style={legend}>PNG Options</legend>
              <div style={row}>
                <span style={{ fontSize: 12 }}>DPI:</span>
                <input
                  className="ze-search"
                  type="number"
                  style={{ width: 80 }}
                  value={dpi}
                  min={50}
                  max={2400}
                  onChange={(e) =>
                    setDpi(Math.max(50, Math.min(2400, Number(e.target.value) || 300)))
                  }
                />
                <label style={{ fontSize: 12.5, opacity: 0.45 }} title="Always on in the browser">
                  <input type="checkbox" disabled checked readOnly /> Anti-alias
                </label>
              </div>
            </fieldset>
          )}

          <fieldset style={group}>
            <legend style={legend}>Other Options</legend>
            <label
              style={{ display: 'block', margin: '4px 0', fontSize: 12.5, opacity: 0.45 }}
              title="The browser handles downloaded files"
            >
              <input type="checkbox" disabled /> Open file after plot
            </label>
          </fieldset>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button className="ze-btn" onClick={() => onPlot(format, opts(), false, themeSel)}>
            Plot Current Page
          </button>
          <button className="ze-btn primary" onClick={() => onPlot(format, opts(), true, themeSel)}>
            Plot All Pages
          </button>
        </div>
      </div>
    </div>
  );
}
