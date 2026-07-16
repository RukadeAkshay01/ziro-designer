/**
 * Page Settings dialog. Counterpart: `common/dialogs/dialog_page_settings.cpp`
 * (DIALOG_PAGES_SETTINGS) as opened by SCH_EDIT_FRAME — the paper size and
 * orientation on the left, the title-block parameters (issue date, revision,
 * title, company, and nine comment lines) on the right. On OK the settings are
 * written back to the schematic through an undoable command.
 */

import { useState, type JSX } from 'react';
import type { PageSettings } from '@ziroeda/eeschema';
import { PAPER_CHOICES, PAPER_MM } from '../../drawingsheet/PageSettingsDialog.js';

interface Props {
  value: PageSettings;
  onOk: (next: PageSettings) => void;
  onCancel: () => void;
}

/** Split a stored paper token into the dialog's size/orientation/custom state. */
function fromToken(paper: string): {
  size: string;
  portrait: boolean;
  customW: number;
  customH: number;
} {
  const parts = paper.split(/\s+/).filter(Boolean);
  const name = parts[0] ?? 'A4';
  if (name === 'User') {
    return {
      size: 'User',
      portrait: false,
      customW: Number(parts[1] ?? 431.8),
      customH: Number(parts[2] ?? 279.4),
    };
  }
  return { size: name, portrait: parts.includes('portrait'), customW: 431.8, customH: 279.4 };
}

/** Rebuild the stored paper token from the dialog state. */
function toToken(size: string, portrait: boolean, customW: number, customH: number): string {
  if (size === 'User') return `User ${customW} ${customH}`;
  return portrait ? `${size} portrait` : size;
}

export function DialogPageSettings({ value, onOk, onCancel }: Props): JSX.Element {
  const seed = fromToken(value.paper);
  const [size, setSize] = useState(seed.size);
  const [portrait, setPortrait] = useState(seed.portrait);
  const [customW, setCustomW] = useState(seed.customW);
  const [customH, setCustomH] = useState(seed.customH);
  const [title, setTitle] = useState(value.title);
  const [date, setDate] = useState(value.date);
  const [rev, setRev] = useState(value.rev);
  const [company, setCompany] = useState(value.company);
  const [comments, setComments] = useState<string[]>(() => {
    const c = [...value.comments];
    while (c.length < 9) c.push('');
    return c.slice(0, 9);
  });

  const submit = (): void => {
    onOk({
      paper: toToken(size, portrait, customW, customH),
      title,
      date,
      rev,
      company,
      comments,
    });
  };

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 0',
  };
  const lab: React.CSSProperties = { width: 92, fontSize: 12, flex: '0 0 auto' };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{ width: 580, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Page Settings
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', gap: 18, padding: '10px 14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Paper</div>
            <div style={row}>
              <span style={lab}>Size:</span>
              <select
                className="ze-select"
                style={{ flex: 1 }}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                autoFocus
              >
                {PAPER_CHOICES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={row}>
              <span style={lab}>Orientation:</span>
              <select
                className="ze-select"
                style={{ flex: 1 }}
                value={portrait ? 'portrait' : 'landscape'}
                disabled={size === 'User'}
                onChange={(e) => setPortrait(e.target.value === 'portrait')}
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </div>
            {size === 'User' && (
              <>
                <div style={row}>
                  <span style={lab}>Custom width:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={customW}
                    onChange={(e) => setCustomW(Number(e.target.value) || 0)}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
                <div style={row}>
                  <span style={lab}>Custom height:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={customH}
                    onChange={(e) => setCustomH(Number(e.target.value) || 0)}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
              </>
            )}
            <div className="ze-muted" style={{ fontSize: 11, marginTop: 8 }}>
              {(() => {
                const dims = PAPER_MM[size];
                if (size === 'User') return `${customW} × ${customH} mm`;
                if (!dims) return '';
                const [w, h] = portrait ? [dims[1], dims[0]] : dims;
                return `${w} × ${h} mm`;
              })()}
            </div>
          </div>
          <div style={{ flex: 1.2 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
              Title Block Parameters
            </div>
            <div style={row}>
              <span style={lab}>Issue Date:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <button
                className="ze-btn"
                title="Set to today"
                onClick={() => setDate(new Date().toISOString().slice(0, 10))}
              >
                ◀
              </button>
            </div>
            <div style={row}>
              <span style={lab}>Revision:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={rev}
                onChange={(e) => setRev(e.target.value)}
              />
            </div>
            <div style={row}>
              <span style={lab}>Title:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div style={row}>
              <span style={lab}>Company:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            {comments.map((c, i) => (
              <div style={row} key={i}>
                <span style={lab}>Comment{i + 1}:</span>
                <input
                  className="ze-search"
                  style={{ flex: 1 }}
                  value={c}
                  onChange={(e) => {
                    const next = [...comments];
                    next[i] = e.target.value;
                    setComments(next);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
