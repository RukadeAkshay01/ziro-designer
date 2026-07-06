import { useEffect, useRef, useState } from 'react';
import type { LabelKind, LabelShape } from '@ziroeda/core';

/** Flag shapes offered for global/hierarchical labels, as in KiCad's dialog. */
const SHAPES: { value: LabelShape; label: string }[] = [
  { value: 'input', label: 'Input' },
  { value: 'output', label: 'Output' },
  { value: 'bidirectional', label: 'Bidirectional' },
  { value: 'tri_state', label: 'Tri-state' },
  { value: 'passive', label: 'Passive' },
];

const TITLES: Record<LabelKind, string> = {
  label: 'Label Properties',
  global_label: 'Global Label Properties',
  hierarchical_label: 'Hierarchical Label Properties',
  text: 'Text Properties',
};

interface Props {
  kind: LabelKind;
  onOk: (text: string, shape: LabelShape) => void;
  onCancel: () => void;
}

/**
 * KiCad-style label properties dialog: enter the net/label name and (for
 * global/hierarchical labels) pick the flag shape, before placing the label.
 */
export function LabelDialog({ kind, onOk, onCancel }: Props): JSX.Element {
  const [text, setText] = useState('');
  const [shape, setShape] = useState<LabelShape>('bidirectional');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasShape = kind === 'global_label' || kind === 'hierarchical_label';

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = (): void => { if (text.trim()) onOk(text.trim(), shape); };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {TITLES[kind]}
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-label-dialog-body">
          <label className="row">
            <span>{kind === 'text' ? 'Text:' : 'Label:'}</span>
            <input
              ref={inputRef}
              className="ze-search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
              }}
            />
          </label>
          {hasShape && (
            <label className="row">
              <span>Shape:</span>
              <select className="ze-select" value={shape} onChange={(e) => setShape(e.target.value as LabelShape)}>
                {SHAPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" disabled={!text.trim()} onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}
