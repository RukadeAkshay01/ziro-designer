import { useState, type JSX } from 'react';
import type { PadEdit, PcbFootprint, PcbPad } from '@ziroeda/core';
import { footprintStringChild, iuToMM, mmToIU } from '@ziroeda/core';

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

const PAD_TYPES: { v: PcbPad['type']; label: string }[] = [
  { v: 'thru_hole', label: 'Through-hole' },
  { v: 'smd', label: 'SMD' },
  { v: 'connect', label: 'Edge connector' },
  { v: 'np_thru_hole', label: 'NPTH, mechanical' },
];
const PAD_SHAPES: { v: PcbPad['shape']; label: string }[] = [
  { v: 'circle', label: 'Circular' },
  { v: 'oval', label: 'Oval' },
  { v: 'rect', label: 'Rectangular' },
  { v: 'roundrect', label: 'Rounded rectangle' },
  { v: 'trapezoid', label: 'Trapezoidal' },
  { v: 'custom', label: 'Custom' },
];

/** Copper/mask layer sets that follow from the pad type (DIALOG_PAD_PROPERTIES). */
const layersForType = (type: PcbPad['type']): string[] =>
  type === 'smd' ? ['F.Cu', 'F.Paste', 'F.Mask']
  : type === 'np_thru_hole' ? ['*.Cu', '*.Mask']
  : ['*.Cu', '*.Mask'];

/**
 * Pad properties — the working subset of KiCad's DIALOG_PAD_PROPERTIES: number,
 * type, shape, position, size and drill. Layers follow the pad type. Values are
 * shown/entered in millimetres.
 */
export function PadPropertiesDialog({ pad, onOk, onCancel }: {
  pad: PcbPad;
  onOk: (e: PadEdit) => void;
  onCancel: () => void;
}): JSX.Element {
  const [number, setNumber] = useState(pad.number);
  const [type, setType] = useState<PcbPad['type']>(pad.type);
  const [shape, setShape] = useState<PcbPad['shape']>(pad.shape);
  const [posX, setPosX] = useState(String(iuToMM(pad.at.x)));
  const [posY, setPosY] = useState(String(iuToMM(pad.at.y)));
  const [sizeX, setSizeX] = useState(String(iuToMM(pad.size.x)));
  const [sizeY, setSizeY] = useState(String(iuToMM(pad.size.y)));
  const [drill, setDrill] = useState(String(pad.drill ? iuToMM(pad.drill.w) : 0));

  const hasDrill = type === 'thru_hole' || type === 'np_thru_hole';
  const num = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; };

  const submit = (): void => {
    const drillMM = num(drill);
    onOk({
      number, type, shape,
      at: { x: mmToIU(num(posX)), y: mmToIU(num(posY)) },
      size: { x: mmToIU(num(sizeX)), y: mmToIU(num(sizeY)) },
      drill: hasDrill && drillMM > 0 ? { oblong: false, w: mmToIU(drillMM), h: mmToIU(drillMM) } : null,
      layers: layersForType(type),
    });
  };

  const Row = ({ label, children }: { label: string; children: JSX.Element }): JSX.Element => (
    <>
      <label>{label}</label>
      {children}
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Pad Properties
          <span className="x" title="Cancel" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-modal-body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 10px', padding: 14, alignItems: 'center' }}>
          <Row label="Pad number">
            <input className="ze-search" autoFocus value={number} onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onCancel(); }} />
          </Row>
          <Row label="Pad type">
            <select className="ze-select" value={type} onChange={(e) => setType(e.target.value as PcbPad['type'])}>
              {PAD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </Row>
          <Row label="Shape">
            <select className="ze-select" value={shape} onChange={(e) => setShape(e.target.value as PcbPad['shape'])}>
              {PAD_SHAPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </Row>
          <Row label="Position (mm)">
            <span style={{ display: 'flex', gap: 6 }}>
              <input className="ze-search" style={{ width: 90 }} value={posX} onChange={(e) => setPosX(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <input className="ze-search" style={{ width: 90 }} value={posY} onChange={(e) => setPosY(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </span>
          </Row>
          <Row label="Size (mm)">
            <span style={{ display: 'flex', gap: 6 }}>
              <input className="ze-search" style={{ width: 90 }} value={sizeX} onChange={(e) => setSizeX(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <input className="ze-search" style={{ width: 90 }} value={sizeY} onChange={(e) => setSizeY(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </span>
          </Row>
          <Row label="Hole (mm)">
            <input className="ze-search" style={{ width: 90 }} value={drill} disabled={!hasDrill}
              onChange={(e) => setDrill(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </Row>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}
