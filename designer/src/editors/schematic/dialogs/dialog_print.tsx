/**
 * Print dialog. Counterpart: `eeschema/printing/dialog_print.cpp` (DIALOG_PRINT
 * for eeschema) — output mode (colour / black and white), print the drawing
 * sheet (border and title block), and print the background colour. "Print"
 * renders the current sheet and hands it to the browser's print flow.
 */

import { useState, type JSX } from 'react';
import type { PlotOpts } from '../render/plot.js';

interface Props {
  onPrint: (opts: PlotOpts) => void;
  onClose: () => void;
}

export function DialogPrint({ onPrint, onClose }: Props): JSX.Element {
  const [color, setColor] = useState(true);
  const [drawingSheet, setDrawingSheet] = useState(true);
  const [background, setBackground] = useState(false);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 340, maxWidth: '92vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Print
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ padding: '10px 14px' }}>
          <div style={{ margin: '4px 0' }}>
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input type="radio" name="mode" checked={color} onChange={() => setColor(true)} />{' '}
              Color
            </label>
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input type="radio" name="mode" checked={!color} onChange={() => setColor(false)} />{' '}
              Black and white
            </label>
          </div>
          <label style={{ display: 'block', margin: '8px 0 4px' }}>
            <input
              type="checkbox"
              checked={drawingSheet}
              onChange={(e) => setDrawingSheet(e.target.checked)}
            />{' '}
            Print drawing sheet (border and title block)
          </label>
          <label style={{ display: 'block', margin: '4px 0' }}>
            <input
              type="checkbox"
              checked={background}
              disabled={!color}
              onChange={(e) => setBackground(e.target.checked)}
            />{' '}
            Print background color
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            onClick={() => onPrint({ color, drawingSheet, background })}
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
