/**
 * Plot dialog. Counterpart: `eeschema/dialogs/dialog_plot_schematic.cpp`
 * (DIALOG_PLOT_SCHEMATIC) — the output format, colour mode, "plot drawing
 * sheet", and background-colour options. The web port writes the file the
 * browser downloads: SVG (true vector), PNG (raster), or PDF (rendered page).
 */

import { useState, type JSX } from 'react';
import type { PlotOpts } from '../render/plot.js';

export type PlotFormat = 'svg' | 'pdf' | 'png';

interface Props {
  onPlot: (format: PlotFormat, opts: PlotOpts) => void;
  onClose: () => void;
}

const FORMATS: { id: PlotFormat; label: string }[] = [
  { id: 'svg', label: 'SVG' },
  { id: 'pdf', label: 'PDF' },
  { id: 'png', label: 'PNG' },
];

export function DialogPlot({ onPlot, onClose }: Props): JSX.Element {
  const [format, setFormat] = useState<PlotFormat>('svg');
  const [color, setColor] = useState(true);
  const [drawingSheet, setDrawingSheet] = useState(true);
  const [background, setBackground] = useState(true);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 360, maxWidth: '92vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Plot Schematic Options
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
            <span style={{ width: 100, fontSize: 12 }}>Output format:</span>
            <select
              className="ze-select"
              style={{ flex: 1 }}
              value={format}
              onChange={(e) => setFormat(e.target.value as PlotFormat)}
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ margin: '4px 0' }}>
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input type="radio" name="pmode" checked={color} onChange={() => setColor(true)} />{' '}
              Color
            </label>
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input type="radio" name="pmode" checked={!color} onChange={() => setColor(false)} />{' '}
              Black and white
            </label>
          </div>
          <label style={{ display: 'block', margin: '8px 0 4px' }}>
            <input
              type="checkbox"
              checked={drawingSheet}
              onChange={(e) => setDrawingSheet(e.target.checked)}
            />{' '}
            Plot drawing sheet (border and title block)
          </label>
          <label style={{ display: 'block', margin: '4px 0' }}>
            <input
              type="checkbox"
              checked={background}
              disabled={!color}
              onChange={(e) => setBackground(e.target.checked)}
            />{' '}
            Plot background color
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            onClick={() => onPlot(format, { color, drawingSheet, background })}
          >
            Plot
          </button>
        </div>
      </div>
    </div>
  );
}
