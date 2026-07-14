/**
 * The Drawing Sheet Editor's docked properties panel — the web counterpart of
 * `pl_editor`'s PROPERTIES_FRAME (pagelayout_editor/dialogs/properties_frame.cpp).
 *
 * Two notebook tabs:
 *  - "Item Properties": item type + Syntax Help; the page-option choice; for
 *    text items the multiline editor with the bold/italic + alignment button
 *    bar, colour, font, size and the maxlen/maxheight constraints; comment;
 *    the Position / End Position groups with their corner combos; line
 *    thickness; rotation; bitmap DPI; and the Repeat Parameters group.
 *  - "General Options": the sheet's default text size / line & text thickness
 *    (with Set to Default) and the four page margins.
 *
 * All distances are millimetres, as in the panel this mirrors.
 */

import { useState, type JSX } from 'react';
import type {
  WksSheet,
  WksItem,
  WksText,
  WksLine,
  WksRect,
  WksBitmap,
  WksPoly,
  WksPoint,
  WksCorner,
  WksOption,
  WksColor,
} from '@ziroeda/common';

/** TB_DEFAULT_TEXTSIZE and the standard default pen widths (ds_data_model). */
const DEFAULT_TEXTSIZE = 1.5;
const DEFAULT_WIDTH = 0.15;

const TYPE_LABEL: Record<WksItem['type'], string> = {
  line: 'Line',
  rect: 'Rectangle',
  text: 'Text',
  bitmap: 'Image',
  polygon: 'Poly',
};

/** Corner combo entries, in the panel's order. */
const CORNER_CHOICES: { value: WksCorner; label: string }[] = [
  { value: 'rtcorner', label: 'Upper Right' },
  { value: 'ltcorner', label: 'Upper Left' },
  { value: 'rbcorner', label: 'Lower Right' },
  { value: 'lbcorner', label: 'Lower Left' },
];

const PAGE_CHOICES: { value: WksOption; label: string }[] = [
  { value: 'normal', label: 'Show on all pages' },
  { value: 'page1only', label: 'First page only' },
  { value: 'notonpage1', label: 'Subsequent pages only' },
];

// ---- small layout helpers ----------------------------------------------------

function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <fieldset className="ze-ds-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <div className="ze-ds-row" title={hint}>
      <span className="ze-ds-label">{label}</span>
      {children}
    </div>
  );
}

function NumField({
  value,
  onCommit,
  step = 0.1,
  width = 62,
  title,
}: {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  width?: number;
  title?: string;
}): JSX.Element {
  // Commit on blur / Enter like the wx panel (focus-lost applies the value).
  const [text, setText] = useState<string | null>(null);
  const commit = (): void => {
    if (text === null) return;
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    setText(null);
  };
  return (
    <input
      className="ze-search"
      type="number"
      step={step}
      style={{ width }}
      title={title}
      value={text ?? String(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
  );
}

function MmField(props: {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  title?: string;
}): JSX.Element {
  return (
    <>
      <NumField {...props} />
      <span className="ze-muted" style={{ fontSize: 11 }}>
        mm
      </span>
    </>
  );
}

function CornerCombo({
  value,
  onChange,
}: {
  value: WksCorner;
  onChange: (c: WksCorner) => void;
}): JSX.Element {
  return (
    <select
      className="ze-select"
      style={{ flex: 1, minWidth: 0 }}
      value={value}
      onChange={(e) => onChange(e.target.value as WksCorner)}
    >
      {CORNER_CHOICES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function PositionGroup({
  title,
  point,
  onChange,
}: {
  title: string;
  point: WksPoint;
  onChange: (p: WksPoint) => void;
}): JSX.Element {
  return (
    <Group title={title}>
      <Row label="X:">
        <MmField value={point.x} onCommit={(x) => onChange({ ...point, x })} />
      </Row>
      <Row label="Y:">
        <MmField value={point.y} onCommit={(y) => onChange({ ...point, y })} />
      </Row>
      <Row label="From:">
        <CornerCombo value={point.corner} onChange={(corner) => onChange({ ...point, corner })} />
      </Row>
    </Group>
  );
}

// ---- text formatting bar -------------------------------------------------------

function FormatButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      className={`ze-btn ze-ds-fmt${active ? ' active' : ''}`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const colorCss = (c: WksColor | undefined): string =>
  c ? `rgba(${c.r},${c.g},${c.b},${c.a})` : '#c8322d';

const hexOf = (c: WksColor | undefined): string => {
  if (!c) return '#c8322d';
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
};

// ---- the frame -----------------------------------------------------------------

export function PropertiesFrame({
  sheet,
  selectedIndex,
  onItemChange,
  onSetupChange,
  onShowSyntaxHelp,
}: {
  sheet: WksSheet;
  selectedIndex: number;
  onItemChange: (patch: Partial<WksItem>) => void;
  onSetupChange: (patch: Partial<WksSheet['setup']>) => void;
  onShowSyntaxHelp: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<'item' | 'general'>('item');
  const item = selectedIndex >= 0 ? sheet.items[selectedIndex] : undefined;

  return (
    <div
      className="ze-panel grow"
      style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}
    >
      <div className="ze-ds-tabs">
        <button className={tab === 'item' ? 'active' : ''} onClick={() => setTab('item')}>
          Item Properties
        </button>
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
          General Options
        </button>
      </div>
      <div
        className="ze-panel-body"
        data-testid="ds-properties"
        style={{ flex: 1, overflow: 'auto' }}
      >
        {tab === 'item' ? (
          item ? (
            <ItemProperties
              item={item}
              onChange={onItemChange}
              onShowSyntaxHelp={onShowSyntaxHelp}
            />
          ) : (
            <div className="ze-muted" style={{ padding: 6 }}>
              Select an item to edit its properties.
            </div>
          )
        ) : (
          <GeneralOptions setup={sheet.setup} onChange={onSetupChange} />
        )}
      </div>
    </div>
  );
}

function ItemProperties({
  item,
  onChange,
  onShowSyntaxHelp,
}: {
  item: WksItem;
  onChange: (patch: Partial<WksItem>) => void;
  onShowSyntaxHelp: () => void;
}): JSX.Element {
  const t = item.type === 'text' ? (item as WksText) : null;
  const shape = item.type === 'line' || item.type === 'rect' ? (item as WksLine | WksRect) : null;
  const bitmap = item.type === 'bitmap' ? (item as WksBitmap) : null;
  const poly = item.type === 'polygon' ? (item as WksPoly) : null;
  const patch = onChange as (p: Record<string, unknown>) => void;

  return (
    <div>
      <div className="ze-ds-row" style={{ justifyContent: 'space-between' }}>
        <b style={{ fontSize: 12 }}>Type: {TYPE_LABEL[item.type]}</b>
        <a
          href="#syntax"
          style={{ fontSize: 11 }}
          onClick={(e) => {
            e.preventDefault();
            onShowSyntaxHelp();
          }}
        >
          Syntax Help
        </a>
      </div>
      <Row label="Show:">
        <select
          className="ze-select"
          style={{ flex: 1, minWidth: 0 }}
          value={item.option}
          onChange={(e) => patch({ option: e.target.value as WksOption })}
        >
          {PAGE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Row>

      {t && (
        <>
          <textarea
            className="ze-search ze-ds-textedit"
            rows={3}
            value={t.text}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <div className="ze-ds-fmtbar">
            <FormatButton active={t.bold} title="Bold" onClick={() => patch({ bold: !t.bold })}>
              <b>B</b>
            </FormatButton>
            <FormatButton
              active={t.italic}
              title="Italic"
              onClick={() => patch({ italic: !t.italic })}
            >
              <i>I</i>
            </FormatButton>
            <span className="ze-ds-fmtsep" />
            <FormatButton
              active={t.hjustify === 'left'}
              title="Align left"
              onClick={() => patch({ hjustify: 'left' })}
            >
              ⬅
            </FormatButton>
            <FormatButton
              active={t.hjustify === 'center'}
              title="Align center"
              onClick={() => patch({ hjustify: 'center' })}
            >
              ↔
            </FormatButton>
            <FormatButton
              active={t.hjustify === 'right'}
              title="Align right"
              onClick={() => patch({ hjustify: 'right' })}
            >
              ➡
            </FormatButton>
            <span className="ze-ds-fmtsep" />
            <FormatButton
              active={t.vjustify === 'top'}
              title="Align top"
              onClick={() => patch({ vjustify: 'top' })}
            >
              ⬆
            </FormatButton>
            <FormatButton
              active={t.vjustify === 'center'}
              title="Align middle"
              onClick={() => patch({ vjustify: 'center' })}
            >
              ↕
            </FormatButton>
            <FormatButton
              active={t.vjustify === 'bottom'}
              title="Align bottom"
              onClick={() => patch({ vjustify: 'bottom' })}
            >
              ⬇
            </FormatButton>
            <span className="ze-ds-fmtsep" />
            <input
              type="color"
              title="Text color"
              value={hexOf(t.color)}
              style={{
                width: 26,
                height: 22,
                padding: 0,
                border: 'none',
                background: colorCss(t.color),
              }}
              onChange={(e) => {
                const hex = e.target.value;
                patch({
                  color: {
                    r: parseInt(hex.slice(1, 3), 16),
                    g: parseInt(hex.slice(3, 5), 16),
                    b: parseInt(hex.slice(5, 7), 16),
                    a: t.color?.a ?? 1,
                  },
                });
              }}
            />
            {t.color && (
              <button
                className="ze-btn ze-ds-fmt"
                title="Clear color override (use the sheet color)"
                onClick={() => patch({ color: undefined })}
              >
                ✕
              </button>
            )}
          </div>
          <Row label="Font:">
            <select
              className="ze-select"
              style={{ flex: 1, minWidth: 0 }}
              value={t.face ?? ''}
              onChange={(e) => patch({ face: e.target.value || undefined })}
            >
              {/* Default Font = the stroke font (empty face); a named face
                  switches the item to that outline font, as in KiCad. */}
              <option value="">Default Font (KiCad Font)</option>
              <option value="sans-serif">Sans-serif</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
            </select>
          </Row>
          <Row label="Text width:" hint="Set to 0 to use default values">
            <MmField value={t.fontW} onCommit={(fontW) => patch({ fontW })} />
          </Row>
          <Row label="Text height:" hint="Set to 0 to use default values">
            <MmField value={t.fontH} onCommit={(fontH) => patch({ fontH })} />
          </Row>
          <Row label="Maximum width:" hint="Set to 0 to disable this constraint">
            <MmField value={t.maxlen} onCommit={(maxlen) => patch({ maxlen })} />
          </Row>
          <Row label="Maximum height:" hint="Set to 0 to disable this constraint">
            <MmField value={t.maxheight} onCommit={(maxheight) => patch({ maxheight })} />
          </Row>
          <div className="ze-muted" style={{ fontSize: 10, margin: '0 6px 4px' }}>
            Set to 0 to disable a constraint
          </div>
        </>
      )}

      <Row label="Comment:">
        <input
          className="ze-search"
          style={{ flex: 1, minWidth: 0 }}
          value={item.comment}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => patch({ comment: e.target.value })}
        />
      </Row>

      {(t || bitmap || poly) && (
        <PositionGroup
          title="Position"
          point={(t ?? bitmap ?? poly)!.pos}
          onChange={(pos) => patch({ pos })}
        />
      )}
      {shape && (
        <>
          <PositionGroup
            title="Position"
            point={shape.start}
            onChange={(start) => patch({ start })}
          />
          <PositionGroup
            title="End Position"
            point={shape.end}
            onChange={(end) => patch({ end })}
          />
          <Row label="Line thickness:" hint="Set to 0 to use default values">
            <MmField
              step={0.05}
              value={shape.lineWidth}
              onCommit={(lineWidth) => patch({ lineWidth })}
            />
          </Row>
        </>
      )}
      {t && (
        <>
          <Row label="Text thickness:" hint="Set to 0 to use default values">
            <MmField
              step={0.05}
              value={t.lineWidth}
              onCommit={(lineWidth) => patch({ lineWidth })}
            />
          </Row>
          <Row label="Rotation:">
            <NumField step={90} value={t.rotate} onCommit={(rotate) => patch({ rotate })} />
            <span className="ze-muted" style={{ fontSize: 11 }}>
              deg
            </span>
          </Row>
        </>
      )}
      {poly && (
        <>
          <Row label="Line thickness:">
            <MmField
              step={0.05}
              value={poly.lineWidth}
              onCommit={(lineWidth) => patch({ lineWidth })}
            />
          </Row>
          <Row label="Rotation:">
            <NumField step={90} value={poly.rotate} onCommit={(rotate) => patch({ rotate })} />
            <span className="ze-muted" style={{ fontSize: 11 }}>
              deg
            </span>
          </Row>
        </>
      )}
      {bitmap && (
        <>
          <Row label="Bitmap DPI:">
            <NumField
              step={1}
              value={bitmap.ppi}
              onCommit={(ppi) => patch({ ppi: Math.max(1, Math.round(ppi)) })}
            />
          </Row>
          <Row label="Scale:">
            <NumField step={0.1} value={bitmap.scale} onCommit={(scale) => patch({ scale })} />
          </Row>
        </>
      )}

      <Group title="Repeat Parameters">
        <Row label="Count:">
          <NumField
            step={1}
            value={item.repeat}
            onCommit={(n) => patch({ repeat: Math.min(100, Math.max(1, Math.round(n))) })}
          />
        </Row>
        {t && (
          <Row
            label="Step text:"
            hint="Number of characters or digits to step text by for each repeat."
          >
            <NumField
              step={1}
              value={item.incrlabel}
              onCommit={(n) => patch({ incrlabel: Math.round(n) })}
            />
          </Row>
        )}
        <Row label="Step X:" hint="Distance on the X axis to step for each repeat.">
          <MmField value={item.incrx} onCommit={(incrx) => patch({ incrx })} />
        </Row>
        <Row label="Step Y:" hint="Distance to step on Y axis for each repeat.">
          <MmField value={item.incry} onCommit={(incry) => patch({ incry })} />
        </Row>
      </Group>
    </div>
  );
}

function GeneralOptions({
  setup,
  onChange,
}: {
  setup: WksSheet['setup'];
  onChange: (patch: Partial<WksSheet['setup']>) => void;
}): JSX.Element {
  return (
    <div>
      <Group title="Default Values">
        <Row label="Text width:">
          <MmField value={setup.textW} onCommit={(textW) => onChange({ textW })} />
        </Row>
        <Row label="Text height:">
          <MmField value={setup.textH} onCommit={(textH) => onChange({ textH })} />
        </Row>
        <Row label="Line thickness:">
          <MmField
            step={0.05}
            value={setup.lineWidth}
            onCommit={(lineWidth) => onChange({ lineWidth })}
          />
        </Row>
        <Row label="Text thickness:">
          <MmField
            step={0.05}
            value={setup.textLineWidth}
            onCommit={(textLineWidth) => onChange({ textLineWidth })}
          />
        </Row>
        <div className="ze-ds-row">
          <button
            className="ze-btn"
            onClick={() =>
              onChange({
                textW: DEFAULT_TEXTSIZE,
                textH: DEFAULT_TEXTSIZE,
                lineWidth: DEFAULT_WIDTH,
                textLineWidth: DEFAULT_WIDTH,
              })
            }
          >
            Set to Default
          </button>
        </div>
      </Group>
      <Group title="Page Margins">
        <Row label="Left:">
          <MmField value={setup.leftMargin} onCommit={(leftMargin) => onChange({ leftMargin })} />
        </Row>
        <Row label="Right:">
          <MmField
            value={setup.rightMargin}
            onCommit={(rightMargin) => onChange({ rightMargin })}
          />
        </Row>
        <Row label="Top:">
          <MmField value={setup.topMargin} onCommit={(topMargin) => onChange({ topMargin })} />
        </Row>
        <Row label="Bottom:">
          <MmField
            value={setup.bottomMargin}
            onCommit={(bottomMargin) => onChange({ bottomMargin })}
          />
        </Row>
      </Group>
    </div>
  );
}

/** The Syntax Help dialog body (the panel's "Predefined Keywords" message). */
export function SyntaxHelpDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const keywords: [string, string][] = [
    ['KICAD_VERSION', 'application version'],
    ['#', 'sheet number'],
    ['##', 'sheet count'],
    ['COMMENT1 … COMMENT9', 'title block comments'],
    ['COMPANY', 'company name'],
    ['FILENAME', 'file name'],
    ['ISSUE_DATE', 'issue date'],
    ['LAYER', 'layer name'],
    ['PAPER', 'paper size'],
    ['REVISION', 'revision'],
    ['SHEETNAME', 'sheet name'],
    ['SHEETPATH', 'sheet path'],
    ['TITLE', 'title'],
  ];
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Predefined Keywords
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: '8px 14px', fontSize: 12, lineHeight: 1.5 }}>
          <p>
            Texts can include keywords. Keyword notation is <code>{'${keyword}'}</code>; each
            keyword is replaced by its value at draw time.
          </p>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {keywords.map(([k, d]) => (
                <tr key={k}>
                  <td style={{ padding: '1px 14px 1px 0' }}>
                    <code>{k}</code>
                  </td>
                  <td className="ze-muted">{d}</td>
                </tr>
              ))}
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
