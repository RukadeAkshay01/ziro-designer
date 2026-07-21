/**
 * Paste Special dialog. Counterpart: `common/dialogs/dialog_paste_special.cpp`
 * (DIALOG_PASTE_SPECIAL) — the Reference Designators radio box with KiCad's
 * three paste modes, and the "Clear net assignments" option (greyed: we do
 * not store net assignments on schematic items).
 */

import { useState, type JSX } from 'react';
import type { PasteMode } from '@ziroeda/eeschema';

interface Props {
  onOk: (mode: PasteMode) => void;
  onCancel: () => void;
}

const OPTIONS: { mode: PasteMode; label: string }[] = [
  { mode: 'unique', label: 'Assign unique reference designators to pasted symbols' },
  { mode: 'keep', label: 'Keep existing reference designators, even if they are duplicated' },
  { mode: 'remove', label: 'Clear reference designators on all pasted symbols' },
];

export function DialogPasteSpecial({ onOk, onCancel }: Props): JSX.Element {
  const [mode, setMode] = useState<PasteMode>('unique');

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{ width: 440, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Paste Special
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
          <fieldset
            style={{
              border: '1px solid var(--chrome-border)',
              borderRadius: 4,
              padding: '4px 10px 8px',
              margin: 0,
            }}
          >
            <legend style={{ fontSize: 11.5, padding: '0 4px' }}>Reference Designators</legend>
            {OPTIONS.map((o) => (
              <label key={o.mode} style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
                <input
                  type="radio"
                  name="pastemode"
                  checked={mode === o.mode}
                  onChange={() => setMode(o.mode)}
                />{' '}
                {o.label}
              </label>
            ))}
          </fieldset>
          <label
            style={{ display: 'block', margin: '8px 0 0', fontSize: 12.5, opacity: 0.45 }}
            title="Remove the net information from all connected items before pasting"
          >
            <input type="checkbox" disabled /> Clear net assignments
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk(mode)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
