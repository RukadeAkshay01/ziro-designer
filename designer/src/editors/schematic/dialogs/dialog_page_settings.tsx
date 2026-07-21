/**
 * Page Settings dialog. Counterpart: `common/dialogs/dialog_page_settings.cpp`
 * (DIALOG_PAGES_SETTINGS) as opened by SCH_EDIT_FRAME. Left column: Paper
 * (size, orientation, custom size, export checkbox) over a page preview.
 * Right column: Drawing Sheet file, the sheet tallies, and the Title Block
 * Parameters (issue date with "<<<" picker apply, revision, title, company,
 * nine comment lines) — each with its own "Export to other sheets" checkbox
 * that copies the field to every other sheet on OK, like upstream.
 */

import { useState, useRef, useEffect, type JSX } from 'react';
import type { PageSettings } from '@ziroeda/eeschema';
import { defaultDrawingSheet, layoutDrawingSheet, type WksSheet } from '@ziroeda/common';
import { PAPER_CHOICES, PAPER_MM } from '../../drawingsheet/PageSettingsDialog.js';
import { drawDrawingSheetItems, DS_ITEM_COLOR } from '../../drawingsheet/wksRender.js';

/** No preview item is ever selected. */
const NO_PREVIEW_SELECTION: ReadonlySet<number> = new Set();
/** IU per millimetre (schematic internal units). */
const IU_PER_MM = 10000;
/** Largest side of the preview canvas, in CSS px (KiCad's MAX_PAGE_EXAMPLE_SIZE). */
const PREVIEW_MAX_PX = 200;

/** Which fields the "Export to other sheets" checkboxes propagate on OK. */
export interface PageExportFlags {
  paper: boolean;
  date: boolean;
  rev: boolean;
  title: boolean;
  company: boolean;
  comments: boolean[];
}

interface Props {
  value: PageSettings;
  /** "Number of sheets: %d" / "Sheet number: %d" static texts. */
  sheetCount: number;
  sheetNumber: number;
  /** The project's `.kicad_wks` files (Page Settings drop-down choices). */
  sheetChoices?: { name: string; sheet: WksSheet | null }[];
  /** Currently referenced sheet file name ('' = built-in default). */
  drawingSheetName?: string;
  onOk: (
    next: PageSettings,
    exports: PageExportFlags,
    drawingSheet: WksSheet | null,
    drawingSheetName: string,
  ) => void;
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

export function DialogPageSettings({
  value,
  sheetCount,
  sheetNumber,
  sheetChoices = [],
  drawingSheetName = '',
  onOk,
  onCancel,
}: Props): JSX.Element {
  const seed = fromToken(value.paper);
  const [size, setSize] = useState(seed.size);
  const [portrait, setPortrait] = useState(seed.portrait);
  const [customW, setCustomW] = useState(seed.customW);
  const [customH, setCustomH] = useState(seed.customH);
  const [title, setTitle] = useState(value.title);
  const [date, setDate] = useState(value.date);
  const [pickDate, setPickDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rev, setRev] = useState(value.rev);
  const [company, setCompany] = useState(value.company);
  const [comments, setComments] = useState<string[]>(() => {
    const c = [...value.comments];
    while (c.length < 9) c.push('');
    return c.slice(0, 9);
  });
  const [exports, setExports] = useState<PageExportFlags>({
    paper: false,
    date: false,
    rev: false,
    title: false,
    company: false,
    comments: Array(9).fill(false) as boolean[],
  });
  // Drawing sheet: which project `.kicad_wks` to use ('' = built-in default),
  // the project counterpart of KiCad's m_DrawingSheetFileName + the File combo.
  const [sheetName, setSheetName] = useState(drawingSheetName);
  const sheet = sheetChoices.find((c) => c.name === sheetName)?.sheet ?? null;

  const submit = (): void => {
    onOk(
      {
        paper: toToken(size, portrait, customW, customH),
        title,
        date,
        rev,
        company,
        comments,
      },
      exports,
      sheet,
      sheetName,
    );
  };

  const pageMM = ((): [number, number] => {
    if (size === 'User') return [customW, customH];
    const dims = PAPER_MM[size] ?? [297, 210];
    return portrait ? [dims[1], dims[0]] : [dims[0], dims[1]];
  })();
  const [wMM, hMM] = pageMM;

  // Live preview: render the real drawing sheet with the current title-block
  // fields, the way KiCad's DIALOG_PAGES_SETTINGS::UpdateDrawingSheetExample
  // paints m_PageLayoutExampleBitmap with PrintDrawingSheet — so every field,
  // comments included, is shown in the actual stroke font instead of a static
  // outline that dropped them.
  const previewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = previewRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const wIU = wMM * IU_PER_MM;
    const hIU = hMM * IU_PER_MM;
    const scale = PREVIEW_MAX_PX / Math.max(wIU, hIU); // CSS px per IU
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(wIU * scale));
    const ch = Math.max(1, Math.round(hIU * scale));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.transform(scale, 0, 0, scale, 0, 0); // IU → CSS px
    const draws = layoutDrawingSheet(
      sheet ?? defaultDrawingSheet(),
      { widthMM: wMM, heightMM: hMM },
      {
        pageNumber: sheetNumber,
        sheetCount,
        title,
        rev,
        date,
        company,
        comments: [...comments],
        paper: toToken(size, portrait, customW, customH),
        fileName: '',
        sheetPath: '/',
        appVersion: 'ZiroEDA',
      },
    );
    drawDrawingSheetItems(ctx, draws, NO_PREVIEW_SELECTION, {
      color: DS_ITEM_COLOR,
      minWidth: 1 / scale,
    });
    ctx.restore();
  }, [
    wMM,
    hMM,
    title,
    rev,
    date,
    company,
    comments,
    size,
    portrait,
    customW,
    customH,
    sheetNumber,
    sheetCount,
    sheet,
  ]);

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 0',
  };
  const lab: React.CSSProperties = { width: 78, fontSize: 12, flex: '0 0 auto' };
  const customEnabled = size === 'User';
  const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
  const heading: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 12,
    margin: '6px 0',
    textAlign: 'center',
    borderBottom: '1px solid var(--chrome-border)',
    paddingBottom: 3,
  };
  const exportChk = (checked: boolean, set: (v: boolean) => void): JSX.Element => (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, flex: '0 0 auto' }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      Export to other sheets
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{ width: 760, maxWidth: '96vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Page Settings
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 18,
            padding: '10px 14px',
            maxHeight: '72vh',
            overflow: 'auto',
          }}
        >
          <div style={{ flex: '0 0 240px' }}>
            <div style={heading}>Paper</div>
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
            {/* Custom size is editable only for "User"; greyed otherwise, exactly
                like DIALOG_PAGES_SETTINGS::OnPaperSizeChoice enabling the controls. */}
            <div style={{ fontSize: 12, marginTop: 6, opacity: customEnabled ? 1 : 0.45 }}>
              Custom paper size:
            </div>
            <div style={row}>
              <span style={{ ...lab, opacity: customEnabled ? 1 : 0.45 }}>Height:</span>
              <input
                className="ze-search"
                type="number"
                style={{ width: 90, ...(customEnabled ? {} : disabledStyle) }}
                value={customH}
                disabled={!customEnabled}
                title="Custom paper height."
                onChange={(e) => setCustomH(Number(e.target.value) || 0)}
              />
              <span
                className="ze-muted"
                style={{ fontSize: 11, opacity: customEnabled ? 1 : 0.45 }}
              >
                mm
              </span>
            </div>
            <div style={row}>
              <span style={{ ...lab, opacity: customEnabled ? 1 : 0.45 }}>Width:</span>
              <input
                className="ze-search"
                type="number"
                style={{ width: 90, ...(customEnabled ? {} : disabledStyle) }}
                value={customW}
                disabled={!customEnabled}
                title="Custom paper width."
                onChange={(e) => setCustomW(Number(e.target.value) || 0)}
              />
              <span
                className="ze-muted"
                style={{ fontSize: 11, opacity: customEnabled ? 1 : 0.45 }}
              >
                mm
              </span>
            </div>
            {exportChk(exports.paper, (v) => setExports({ ...exports, paper: v }))}
            <div style={{ ...heading, marginTop: 16 }}>Preview</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 8,
                minHeight: PREVIEW_MAX_PX + 16,
              }}
            >
              {/* m_PageLayoutExampleBitmap: a live render of the drawing sheet. */}
              <canvas ref={previewRef} style={{ border: '1px solid #888' }} />
            </div>
            <div className="ze-muted" style={{ fontSize: 11, textAlign: 'center' }}>
              {wMM} × {hMM} mm
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={heading}>Drawing Sheet</div>
            <div style={row}>
              <span style={{ ...lab, width: 34 }}>File:</span>
              {/* Pick one of the project's .kicad_wks files (stored alongside the
                  .kicad_sch); "Default" = the built-in stationery. New sheets are
                  added from the Drawing Sheet Editor or the home file manager. */}
              <select
                className="ze-select"
                style={{ flex: 1 }}
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                title={sheetName || 'Default drawing sheet'}
              >
                <option value="">Default drawing sheet</option>
                {sheetChoices.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {/* Keep an unknown current reference visible so it isn't silently lost. */}
                {sheetName && !sheetChoices.some((c) => c.name === sheetName) && (
                  <option value={sheetName}>{sheetName} (missing)</option>
                )}
              </select>
            </div>
            <div style={{ ...heading, marginTop: 10 }}>Title Block Parameters</div>
            <div style={{ display: 'flex', fontSize: 12, margin: '2px 0 6px' }}>
              <span>Number of sheets: {sheetCount}</span>
              <span style={{ flex: 1 }} />
              <span>Sheet number: {sheetNumber}</span>
            </div>
            <div style={{ ...row, flexWrap: 'wrap' }}>
              <span style={lab}>Issue Date:</span>
              {/* Date text + "<<<" apply + native picker kept together so the
                  free-form date stays fully visible; the export checkbox wraps
                  below when the row is tight. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 240px' }}>
                <input
                  className="ze-search"
                  style={{ flex: 1, minWidth: 90 }}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <button
                  className="ze-btn"
                  title="Apply the picked date"
                  onClick={() => setDate(pickDate)}
                >
                  &lt;&lt;&lt;
                </button>
                <input
                  className="ze-search"
                  type="date"
                  style={{ width: 128, flex: '0 0 auto' }}
                  value={pickDate}
                  onChange={(e) => setPickDate(e.target.value)}
                />
              </div>
              {exportChk(exports.date, (v) => setExports({ ...exports, date: v }))}
            </div>
            <div style={row}>
              <span style={lab}>Revision:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={rev}
                onChange={(e) => setRev(e.target.value)}
              />
              {exportChk(exports.rev, (v) => setExports({ ...exports, rev: v }))}
            </div>
            <div style={row}>
              <span style={lab}>Title:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {exportChk(exports.title, (v) => setExports({ ...exports, title: v }))}
            </div>
            <div style={row}>
              <span style={lab}>Company:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
              {exportChk(exports.company, (v) => setExports({ ...exports, company: v }))}
            </div>
            {comments.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed 9 rows, never reordered
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
                {exportChk(exports.comments[i]!, (v) => {
                  const next = [...exports.comments];
                  next[i] = v;
                  setExports({ ...exports, comments: next });
                })}
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
