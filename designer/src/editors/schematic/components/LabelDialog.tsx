import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { LabelKind, LabelShape } from '@ziroeda/eeschema';
import { iuToMM, mmToIU } from '@ziroeda/common';

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

/** Formatting subset of DIALOG_LABEL_PROPERTIES' Formatting box. */
export interface LabelFormat {
  bold: boolean;
  italic: boolean;
  /** Text size in IU (both dimensions). */
  sizeIU: number;
}

const DEFAULT_SIZE_IU = 12700; // 1.27 mm / 50 mil

interface Props {
  kind: LabelKind;
  onOk: (text: string, shape: LabelShape, format: LabelFormat) => void;
  onCancel: () => void;
  /** Pre-fill when editing an existing label (Properties), vs placing a new one. */
  initialText?: string;
  initialShape?: LabelShape;
  initialFormat?: LabelFormat;
  /** Existing net/label names offered as completions (KiCad's m_valueCombo). */
  suggestions?: readonly string[];
}

/**
 * KiCad-style label properties dialog (DIALOG_LABEL_PROPERTIES): the net/label
 * name combo (pre-loaded with existing names), the flag shape for global/
 * hierarchical labels, and the Formatting controls (bold, italic, text size).
 * Used both to place a new label and to edit an existing one.
 */
export function LabelDialog({
  kind,
  onOk,
  onCancel,
  initialText,
  initialShape,
  initialFormat,
  suggestions,
}: Props): JSX.Element {
  const [text, setText] = useState(initialText ?? '');
  const [shape, setShape] = useState<LabelShape>(initialShape ?? 'bidirectional');
  const [bold, setBold] = useState(initialFormat?.bold ?? false);
  const [italic, setItalic] = useState(initialFormat?.italic ?? false);
  const [sizeText, setSizeText] = useState(
    `${iuToMM(initialFormat?.sizeIU ?? DEFAULT_SIZE_IU)
      .toFixed(4)
      .replace(/0+$/, '')
      .replace(/\.$/, '')}`,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const hasShape = kind === 'global_label' || kind === 'hierarchical_label';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sizeIU = (): number => {
    const n = Number(sizeText.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(mmToIU(n)) : DEFAULT_SIZE_IU;
  };

  const submit = (): void => {
    if (text.trim()) onOk(text.trim(), shape, { bold, italic, sizeIU: sizeIU() });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {TITLES[kind]}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          <label className="row">
            <span>{kind === 'text' ? 'Text:' : 'Label:'}</span>
            <input
              ref={inputRef}
              className="ze-search"
              value={text}
              list={suggestions?.length ? 'ze-label-suggestions' : undefined}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancel();
                }
              }}
            />
          </label>
          {suggestions && suggestions.length > 0 && (
            <datalist id="ze-label-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          {hasShape && (
            <fieldset
              style={{
                border: '1px solid var(--chrome-border)',
                borderRadius: 4,
                padding: '4px 10px 8px',
                margin: '8px 0 0',
              }}
            >
              <legend style={{ fontSize: 11.5, padding: '0 4px' }}>Shape</legend>
              {SHAPES.map((s) => (
                <label key={s.value} style={{ display: 'block', margin: '3px 0', fontSize: 12.5 }}>
                  <input
                    type="radio"
                    name="labelshape"
                    checked={shape === s.value}
                    onChange={() => setShape(s.value)}
                  />{' '}
                  {s.label}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset
            style={{
              border: '1px solid var(--chrome-border)',
              borderRadius: 4,
              padding: '4px 10px 8px',
              margin: '8px 0 0',
            }}
          >
            <legend style={{ fontSize: 11.5, padding: '0 4px' }}>Formatting</legend>
            <label style={{ marginRight: 12, fontSize: 12.5 }}>
              <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />{' '}
              Bold
            </label>
            <label style={{ marginRight: 12, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={italic}
                onChange={(e) => setItalic(e.target.checked)}
              />{' '}
              Italic
            </label>
            <label style={{ fontSize: 12.5 }}>
              Text size:{' '}
              <input
                style={{ width: 64 }}
                value={sizeText}
                onChange={(e) => setSizeText(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />{' '}
              mm
            </label>
          </fieldset>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" disabled={!text.trim()} onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
