/**
 * The Design Inspector dialog — the web counterpart of `pl_editor`'s
 * DIALOG_INSPECTOR (pagelayout_editor/dialogs/design_inspector.cpp): a grid of
 * every item in the sheet model with a leading root "Layout" row describing
 * the page, and per-item columns for the type, repeat count, comment and text.
 * Clicking a row selects (and zooms to) that item on the canvas.
 */

import type { JSX } from 'react';
import type { WksItem, WksText } from '@ziroeda/common';

const TYPE_LABEL: Record<WksItem['type'], string> = {
  line: 'Line',
  rect: 'Rectangle',
  text: 'Text',
  bitmap: 'Image',
  polygon: 'Poly',
};

/** A compact glyph standing in for the per-type icon column. */
const TYPE_GLYPH: Record<WksItem['type'], string> = {
  line: '╱',
  rect: '▭',
  text: 'T',
  bitmap: '🖼',
  polygon: '⬠',
};

export function DesignInspector({
  items,
  selection,
  paperDescription,
  onSelect,
  onClose,
}: {
  items: WksItem[];
  selection: ReadonlySet<number>;
  /** Page description shown on the root row (e.g. "A4 297x210mm landscape"). */
  paperDescription: string;
  onSelect: (index: number) => void;
  onClose: () => void;
}): JSX.Element {
  const cell: React.CSSProperties = {
    padding: '4px 8px',
    borderBottom: '1px solid rgba(128,128,128,0.2)',
  };
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 720, maxWidth: '92vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Design Inspector
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }} data-testid="ds-inspector">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--panel, #2b2b30)',
                  textAlign: 'left',
                }}
              >
                {['', 'Type', 'Count', 'Comment', 'Text'].map((h, i) => (
                  <th key={`${h}${i}`} style={{ ...cell, borderBottomWidth: 2 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Root row: the layout itself. */}
              <tr>
                <td style={cell}>▤</td>
                <td style={cell}>Layout</td>
                <td style={cell}>-</td>
                <td style={cell}>{paperDescription}</td>
                <td style={cell} />
              </tr>
              {items.map((it, i) => (
                <tr
                  key={i}
                  style={{
                    cursor: 'pointer',
                    background: selection.has(i) ? 'rgba(74,163,255,0.18)' : undefined,
                  }}
                  onClick={() => {
                    onSelect(i);
                    onClose();
                  }}
                >
                  <td style={cell}>{TYPE_GLYPH[it.type]}</td>
                  <td style={cell}>{TYPE_LABEL[it.type]}</td>
                  <td style={cell}>{it.repeat}</td>
                  <td style={cell}>{it.comment || <span className="ze-muted">—</span>}</td>
                  <td
                    style={{
                      ...cell,
                      whiteSpace: 'nowrap',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {it.type === 'text' ? (it as WksText).text : ''}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="ze-muted" style={{ padding: 10 }}>
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
