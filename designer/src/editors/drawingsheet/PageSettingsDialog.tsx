/**
 * Page Preview Settings — the web counterpart of the page-settings dialog
 * `pl_editor` opens for its preview data (PL_EDITOR_CONTROL::PageSetup →
 * DIALOG_PAGES_SETTINGS): the preview paper size and orientation plus the
 * title-block fields (issue date, revision, title, company, comments) that
 * the `${…}` text variables resolve against. In the standalone sheet editor
 * these are preview data only — they are not stored in the `.kicad_wks`.
 */

import { useState, type JSX } from 'react';

/** Standard paper sizes, in mm (landscape W×H), as page_info defines them. */
export const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148.5],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};

export const PAPER_CHOICES: { id: string; label: string }[] = [
  { id: 'A5', label: 'A5 148x210mm' },
  { id: 'A4', label: 'A4 210x297mm' },
  { id: 'A3', label: 'A3 297x420mm' },
  { id: 'A2', label: 'A2 420x594mm' },
  { id: 'A1', label: 'A1 594x841mm' },
  { id: 'A0', label: 'A0 841x1189mm' },
  { id: 'A', label: 'A 8.5x11in' },
  { id: 'B', label: 'B 11x17in' },
  { id: 'C', label: 'C 17x22in' },
  { id: 'D', label: 'D 22x34in' },
  { id: 'E', label: 'E 34x44in' },
  { id: 'USLetter', label: 'USLetter 8.5x11in' },
  { id: 'USLegal', label: 'USLegal 8.5x14in' },
  { id: 'USLedger', label: 'USLedger 11x17in' },
  { id: 'User', label: 'User (Custom)' },
];

/** The preview page + title block data the resolver consumes. */
export interface PreviewSettings {
  paper: string;
  portrait: boolean;
  customWidthMM: number;
  customHeightMM: number;
  date: string;
  rev: string;
  title: string;
  company: string;
  comments: string[]; // 9 entries
}

export function defaultPreviewSettings(): PreviewSettings {
  return {
    paper: 'A4',
    portrait: false,
    customWidthMM: 431.8,
    customHeightMM: 279.4,
    date: '',
    rev: '',
    title: '',
    company: '',
    comments: ['', '', '', '', '', '', '', '', ''],
  };
}

/** Resolved page size in mm for the current settings (orientation applied). */
export function previewPageMM(s: PreviewSettings): [number, number] {
  const base: [number, number] =
    s.paper === 'User' ? [s.customWidthMM, s.customHeightMM] : (PAPER_MM[s.paper] ?? PAPER_MM.A4!);
  // Custom sizes are stored as entered; standard sizes swap for portrait.
  if (s.paper === 'User') return base;
  return s.portrait ? [base[1], base[0]] : base;
}

/** Human description of the page (design-inspector root row / status bar). */
export function paperDescription(s: PreviewSettings): string {
  const [w, h] = previewPageMM(s);
  return `${s.paper} ${w}x${h}mm ${s.paper === 'User' ? '' : s.portrait ? 'portrait' : 'landscape'}`.trim();
}

export function PageSettingsDialog({
  value,
  onOk,
  onCancel,
}: {
  value: PreviewSettings;
  onOk: (next: PreviewSettings) => void;
  onCancel: () => void;
}): JSX.Element {
  const [s, setS] = useState<PreviewSettings>({ ...value, comments: [...value.comments] });
  const set = (patch: Partial<PreviewSettings>): void => setS((cur) => ({ ...cur, ...patch }));

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
        style={{ width: 560, maxWidth: '94vw' }}
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
                value={s.paper}
                onChange={(e) => set({ paper: e.target.value })}
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
                value={s.portrait ? 'portrait' : 'landscape'}
                disabled={s.paper === 'User'}
                onChange={(e) => set({ portrait: e.target.value === 'portrait' })}
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </div>
            {s.paper === 'User' && (
              <>
                <div style={row}>
                  <span style={lab}>Custom width:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={s.customWidthMM}
                    onChange={(e) => set({ customWidthMM: Number(e.target.value) || 0 })}
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
                    value={s.customHeightMM}
                    onChange={(e) => set({ customHeightMM: Number(e.target.value) || 0 })}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
              </>
            )}
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
                value={s.date}
                onChange={(e) => set({ date: e.target.value })}
              />
              <button
                className="ze-btn"
                title="Set to today"
                onClick={() => set({ date: new Date().toISOString().slice(0, 10) })}
              >
                ◀
              </button>
            </div>
            <div style={row}>
              <span style={lab}>Revision:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.rev}
                onChange={(e) => set({ rev: e.target.value })}
              />
            </div>
            <div style={row}>
              <span style={lab}>Title:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div style={row}>
              <span style={lab}>Company:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.company}
                onChange={(e) => set({ company: e.target.value })}
              />
            </div>
            {s.comments.map((c, i) => (
              <div style={row} key={i}>
                <span style={lab}>Comment{i + 1}:</span>
                <input
                  className="ze-search"
                  style={{ flex: 1 }}
                  value={c}
                  onChange={(e) => {
                    const comments = [...s.comments];
                    comments[i] = e.target.value;
                    set({ comments });
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
          <button className="ze-btn primary" onClick={() => onOk(s)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
