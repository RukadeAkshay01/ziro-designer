import { useState, type JSX } from 'react';
import type { PcbFootprint } from '@ziroeda/core';
import { footprintStringChild } from '@ziroeda/core';

/**
 * Footprint properties — the working subset of KiCad's
 * DIALOG_FOOTPRINT_PROPERTIES (pcbnew/dialogs): Reference, Value, and the
 * library Description / Keywords. (Side/layer flip and per-attribute flags are
 * staged — they need the full change-side geometry transform.)
 */
export function FootprintPropertiesDialog({ footprint, onOk, onCancel }: {
  footprint: PcbFootprint;
  onOk: (r: { reference: string; value: string; description: string; keywords: string }) => void;
  onCancel: () => void;
}): JSX.Element {
  const [reference, setReference] = useState(footprint.reference ?? '');
  const [value, setValue] = useState(footprint.value ?? '');
  const [description, setDescription] = useState(footprintStringChild(footprint, 'descr'));
  const [keywords, setKeywords] = useState(footprintStringChild(footprint, 'tags'));

  const submit = (): void => onOk({ reference, value, description, keywords });

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Footprint Properties
          <span className="x" title="Cancel" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-modal-body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 10px', padding: 14, alignItems: 'center' }}>
          <label>Reference</label>
          <input className="ze-search" autoFocus value={reference} onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onCancel(); }} />
          <label>Value</label>
          <input className="ze-search" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onCancel(); }} />
          <label>Description</label>
          <input className="ze-search" value={description} onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()} />
          <label>Keywords</label>
          <input className="ze-search" value={keywords} onChange={(e) => setKeywords(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}
