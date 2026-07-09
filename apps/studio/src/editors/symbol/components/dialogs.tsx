import { useEffect, useMemo, useRef, useState } from 'react';
import { iuToMM, mmToIU, EMPTY_SOURCE, type LibPin, type LibSymbol, type SchField, type Vec2 } from '@ziroeda/core';
import {
  PIN_ORIENTATION_NAMES,
  PIN_SHAPE_NAMES,
  PIN_TYPE_NAMES,
  drawPin,
  MM,
} from '../render/symbolRenderer.js';
import { allPins, unitCount, hasAlternateBodyStyle } from '../edits.js';
import { KICAD_CLASSIC } from '../../schematic/theme.js';

/**
 * The Symbol Editor's dialogs, ported from KiCad:
 *   - PinPropertiesDialog     <- DIALOG_PIN_PROPERTIES
 *   - NewSymbolDialog         <- DIALOG_LIB_NEW_SYMBOL
 *   - LibSymbolPropertiesDialog <- DIALOG_LIB_SYMBOL_PROPERTIES
 *   - SymbolTextDialog        <- DIALOG_TEXT_PROPERTIES (the lib-item subset)
 *   - PinTableDialog          <- DIALOG_LIB_EDIT_PIN_TABLE
 *   - SymbolCheckDialog       <- the checkSymbol result list (symbol_checker.cpp)
 *
 * Coordinates are displayed in mm with +Y up, exactly as KiCad's dialogs show
 * library space (TransferDataToWindow negates Y).
 */

const mmStr = (iu: number): string => {
  let s = iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0' || s === '') s = '0';
  return s;
};

const parseMM = (text: string): number | null => {
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) ? mmToIU(v) : null;
};

/** A labelled mm-value input row. */
function MMField({ label, value, onChange }: { label: string; value: number; onChange: (iu: number) => void }): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="row">
      <span>{label}</span>
      <input
        className="ze-search"
        value={text ?? mmStr(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { const iu = parseMM(e.target.value); if (iu !== null) onChange(iu); setText(null); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="unit">mm</span>
    </label>
  );
}

// ----- Pin properties (DIALOG_PIN_PROPERTIES) -----------------------------------

export interface PinDialogResult {
  pin: LibPin;
  commonToAllUnits: boolean;
  commonToAllBodyStyles: boolean;
}

export function PinPropertiesDialog({ pin, symbol, isNew, commonUnit, commonBody, multiUnit, onOk, onCancel }: {
  pin: LibPin;
  symbol: LibSymbol;
  isNew: boolean;
  commonUnit: boolean;
  commonBody: boolean;
  multiUnit: boolean;
  onOk: (r: PinDialogResult) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(pin.name);
  const [number, setNumber] = useState(pin.number);
  const [etype, setEtype] = useState(pin.electricalType);
  const [shape, setShape] = useState(pin.shape);
  const [angle, setAngle] = useState(pin.angle);
  const [posX, setPosX] = useState(pin.at.x);
  const [posY, setPosY] = useState(pin.at.y);
  const [length, setLength] = useState(pin.length);
  const [nameSize, setNameSize] = useState(pin.nameSize ?? 1.27 * MM);
  const [numSize, setNumSize] = useState(pin.numberSize ?? 1.27 * MM);
  const [visible, setVisible] = useState(!pin.hidden);
  const [allUnits, setAllUnits] = useState(commonUnit);
  const [allBodies, setAllBodies] = useState(commonBody);

  const preview: LibPin = useMemo(() => ({
    ...pin, name, number, electricalType: etype, shape, angle,
    at: { x: 0, y: 0 }, length, nameSize, numberSize: numSize, hidden: !visible,
  }), [pin, name, number, etype, shape, angle, length, nameSize, numSize, visible]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = KICAD_CLASSIC.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Fit the pin (plus its texts) into the preview.
    const span = Math.max(length + 6 * MM, 10 * MM);
    const scale = Math.min(canvas.width / (span * 2.2), canvas.height / (span * 1.2));
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawPin(ctx, preview, {
      pinNamesHidden: symbol.pinNamesHidden, pinNumbersHidden: symbol.pinNumbersHidden,
      pinNameOffset: symbol.pinNameOffset, showElectricalTypes: false, showHiddenPins: true,
    }, KICAD_CLASSIC);
  }, [preview, symbol, length]);

  const submit = (): void => {
    onOk({
      pin: {
        ...pin, name: name.trim(), number: number.trim().replace(/ /g, '_'),
        electricalType: etype, shape, angle,
        at: { x: posX, y: posY }, length,
        nameSize, numberSize: numSize, hidden: !visible,
      },
      commonToAllUnits: allUnits,
      commonToAllBodyStyles: allBodies,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-props-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Pin Properties
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-props-body" style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="row"><span>Pin name:</span>
              <input className="ze-search" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
            <label className="row"><span>Pin number:</span>
              <input className="ze-search" value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
            <label className="row"><span>Electrical type:</span>
              <select className="ze-select" value={etype} onChange={(e) => setEtype(e.target.value)}>
                {Object.entries(PIN_TYPE_NAMES).map(([tok, label]) => <option key={tok} value={tok}>{label}</option>)}
              </select></label>
            <label className="row"><span>Graphic style:</span>
              <select className="ze-select" value={shape} onChange={(e) => setShape(e.target.value)}>
                {Object.entries(PIN_SHAPE_NAMES).map(([tok, label]) => <option key={tok} value={tok}>{label}</option>)}
              </select></label>
            <label className="row"><span>Orientation:</span>
              <select className="ze-select" value={angle} onChange={(e) => setAngle(Number(e.target.value))}>
                {PIN_ORIENTATION_NAMES.map(([a, label]) => <option key={a} value={a}>{label}</option>)}
              </select></label>
            <MMField label="Position X:" value={posX} onChange={setPosX} />
            {/* Library space shows +Y up (the dialog negates the stored value). */}
            <MMField label="Position Y:" value={-posY} onChange={(iu) => setPosY(-iu)} />
            <MMField label="Pin length:" value={length} onChange={setLength} />
            <MMField label="Name text size:" value={nameSize} onChange={setNameSize} />
            <MMField label="Number text size:" value={numSize} onChange={setNumSize} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              <label><input type="checkbox" checked={allUnits} disabled={!multiUnit} onChange={(e) => setAllUnits(e.target.checked)} /> Common to all units in symbol</label>
              <label><input type="checkbox" checked={allBodies} onChange={(e) => setAllBodies(e.target.checked)} /> Common to all body styles (De Morgan)</label>
              <label><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible</label>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <canvas ref={canvasRef} className="ze-preview-canvas" style={{ width: '100%', height: '100%', minHeight: 240 }} />
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={submit}>{isNew ? 'OK' : 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

// ----- New symbol (DIALOG_LIB_NEW_SYMBOL) ------------------------------------------

export interface NewSymbolResult {
  name: string;
  parentSymbolName: string;
  reference: string;
  unitCount: number;
  unitsInterchangeable: boolean;
  alternateBodyStyle: boolean;
  isPowerSymbol: boolean;
  excludeFromBom: boolean;
  excludeFromBoard: boolean;
  pinNameInside: boolean;
  pinTextPosition: number; // IU
  showPinNumber: boolean;
  showPinName: boolean;
}

export function NewSymbolDialog({ symbolNames, inheritFrom, onOk, onCancel }: {
  symbolNames: string[];
  inheritFrom?: string;
  onOk: (r: NewSymbolResult) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(inheritFrom ?? '');
  const [reference, setReference] = useState('U');
  const [units, setUnits] = useState(1);
  const [interchangeable, setInterchangeable] = useState(true);
  const [deMorgan, setDeMorgan] = useState(false);
  const [power, setPower] = useState(false);
  const [exBom, setExBom] = useState(false);
  const [exBoard, setExBoard] = useState(false);
  const [nameInside, setNameInside] = useState(true);
  const [pinTextPos, setPinTextPos] = useState(mmToIU(0.508)); // 20 mils
  const [showPinNum, setShowPinNum] = useState(true);
  const [showPinName, setShowPinName] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const derived = parent !== '';

  const submit = (): void => {
    const n = name.trim();
    if (n === '') { setError('Symbol must have a name.'); return; }
    if (symbolNames.includes(n)) { setError(`Symbol '${n}' already exists in the library.`); return; }
    onOk({
      name: n, parentSymbolName: parent, reference: reference.trim() || 'U',
      unitCount: units, unitsInterchangeable: interchangeable, alternateBodyStyle: deMorgan,
      isPowerSymbol: power, excludeFromBom: exBom, excludeFromBoard: exBoard,
      pinNameInside: nameInside, pinTextPosition: pinTextPos,
      showPinNumber: showPinNum, showPinName,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          New Symbol
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-label-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {error && <div className="ze-props-error" onClick={() => setError(null)}>{error}</div>}
          <label className="row"><span>Symbol name:</span>
            <input className="ze-search" autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); }} /></label>
          <label className="row"><span>Derive from symbol:</span>
            <select className="ze-select" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">&lt;none&gt;</option>
              {symbolNames.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
          <label className="row"><span>Default reference designator:</span>
            <input className="ze-search" disabled={derived} value={reference} onChange={(e) => setReference(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
          <label className="row"><span>Number of units per package:</span>
            <input className="ze-search" type="number" min={1} max={64} disabled={derived} value={units}
              onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))} onKeyDown={(e) => e.stopPropagation()} /></label>
          <label><input type="checkbox" disabled={derived || units < 2} checked={interchangeable} onChange={(e) => setInterchangeable(e.target.checked)} /> All units are interchangeable</label>
          <label><input type="checkbox" disabled={derived} checked={deMorgan} onChange={(e) => setDeMorgan(e.target.checked)} /> Create symbol with alternate body style (De Morgan)</label>
          <label><input type="checkbox" disabled={derived} checked={power} onChange={(e) => setPower(e.target.checked)} /> Create symbol as power symbol</label>
          <label><input type="checkbox" disabled={derived} checked={exBom} onChange={(e) => setExBom(e.target.checked)} /> Exclude from schematic bill of materials</label>
          <label><input type="checkbox" disabled={derived} checked={exBoard} onChange={(e) => setExBoard(e.target.checked)} /> Exclude from board</label>
          <div style={{ borderTop: '1px solid #444', margin: '4px 0' }} />
          <label><input type="checkbox" disabled={derived} checked={nameInside} onChange={(e) => setNameInside(e.target.checked)} /> Pin name inside symbol body</label>
          {nameInside && !derived && (
            <MMField label="Position of pin names from body:" value={pinTextPos} onChange={setPinTextPos} />
          )}
          <label><input type="checkbox" disabled={derived} checked={showPinNum} onChange={(e) => setShowPinNum(e.target.checked)} /> Show pin number text</label>
          <label><input type="checkbox" disabled={derived} checked={showPinName} onChange={(e) => setShowPinName(e.target.checked)} /> Show pin name text</label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ----- Library symbol properties (DIALOG_LIB_SYMBOL_PROPERTIES) ----------------------

export interface LibSymbolPropsResult {
  name: string;
  properties: SchField[];
  keywords: string;
  unitCount: number;
  unitsInterchangeable: boolean;
  isPower: boolean;
  pinNameInside: boolean;
  pinNameOffset: number;
  showPinNumbers: boolean;
  showPinNames: boolean;
}

export function LibSymbolPropertiesDialog({ symbol, onOk, onCancel }: {
  symbol: LibSymbol;
  onOk: (r: LibSymbolPropsResult) => void;
  onCancel: () => void;
}): JSX.Element {
  interface Row { key: string; value: string; hidden: boolean; orig?: SchField }
  const USER_HIDDEN = new Set(['ki_keywords', 'ki_fp_filters', 'ki_locked']);
  const [rows, setRows] = useState<Row[]>(() =>
    symbol.properties.filter((f) => !USER_HIDDEN.has(f.key))
      .map((f) => ({ key: f.key, value: f.value, hidden: !!f.effects?.hidden, orig: f })));
  const [name, setName] = useState(symbol.libId);
  const [keywords, setKeywords] = useState(symbol.properties.find((f) => f.key === 'ki_keywords')?.value ?? '');
  const [units, setUnits] = useState(unitCount(symbol));
  const [interchangeable, setInterchangeable] = useState(!symbol.properties.some((f) => f.key === 'ki_locked'));
  const [power, setPower] = useState(symbol.isPower);
  const [nameInside, setNameInside] = useState(symbol.pinNameOffset > 0);
  const [offset, setOffset] = useState(symbol.pinNameOffset > 0 ? symbol.pinNameOffset : mmToIU(0.508));
  const [showNums, setShowNums] = useState(!symbol.pinNumbersHidden);
  const [showNames, setShowNames] = useState(!symbol.pinNamesHidden);
  const [selRow, setSelRow] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const MANDATORY = new Set(['Reference', 'Value', 'Footprint', 'Datasheet', 'Description']);

  const patchRow = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const addRow = (): void => {
    setRows((rs) => [...rs, { key: `Field${rs.length}`, value: '', hidden: true }]);
    setSelRow(rows.length);
  };
  const deleteRow = (): void => {
    const row = rows[selRow];
    if (!row) return;
    if (MANDATORY.has(row.key)) { setError('Mandatory fields cannot be deleted.'); return; }
    setRows((rs) => rs.filter((_, i) => i !== selRow));
    setSelRow((i) => Math.max(0, i - 1));
  };

  const submit = (): void => {
    const n = name.trim();
    if (n === '') { setError('Symbol must have a name.'); return; }
    const properties: SchField[] = rows.map((r) => {
      const base = r.orig ?? {
        key: r.key, value: r.value, angle: 0, at: { x: 0, y: 0 },
        effects: { hidden: r.hidden }, source: EMPTY_SOURCE,
      } as SchField;
      return {
        ...base, key: r.key, value: r.value,
        effects: { ...(base.effects ?? { hidden: false }), hidden: r.hidden },
      };
    });
    onOk({
      name: n, properties, keywords, unitCount: units, unitsInterchangeable: interchangeable,
      isPower: power, pinNameInside: nameInside, pinNameOffset: nameInside ? (offset || mmToIU(0.0254)) : 0,
      showPinNumbers: showNums, showPinNames: showNames,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-props-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Library Symbol Properties
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-props-body">
          {error && <div className="ze-props-error" onClick={() => setError(null)}>{error} — click to dismiss</div>}
          <div className="ze-props-grid-wrap">
            <table className="ze-props-grid">
              <thead><tr><th>Name</th><th>Value</th><th>Show</th></tr></thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={i === selRow ? 'sel' : ''} onClick={() => setSelRow(i)}>
                    <td>{MANDATORY.has(row.key)
                      ? <span className="ze-cell-ro">{row.key}</span>
                      : <input className="ze-cell-input" value={row.key} onChange={(e) => patchRow(i, { key: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}</td>
                    <td><input className="ze-cell-input" value={row.value} onChange={(e) => patchRow(i, { value: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></td>
                    <td className="c"><input type="checkbox" checked={!row.hidden} onChange={(e) => patchRow(i, { hidden: !e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ze-props-rowbtns">
            <button className="ze-btn sm" title="Add field" onClick={addRow}>+</button>
            <span className="grow" />
            <button className="ze-btn sm" title="Delete field" onClick={deleteRow}>🗑</button>
          </div>

          <div className="ze-props-columns">
            <fieldset className="ze-props-group">
              <legend>General</legend>
              <label className="row"><span>Symbol name:</span>
                <input className="ze-search" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
              <label className="row"><span>Keywords:</span>
                <input className="ze-search" value={keywords} onChange={(e) => setKeywords(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
              <label className="row"><span>Number of units:</span>
                <input className="ze-search" type="number" min={1} max={64} value={units}
                  onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))} onKeyDown={(e) => e.stopPropagation()} /></label>
              <label><input type="checkbox" disabled={units < 2} checked={interchangeable} onChange={(e) => setInterchangeable(e.target.checked)} /> All units are interchangeable</label>
              <label><input type="checkbox" checked={power} onChange={(e) => setPower(e.target.checked)} /> Define as power symbol</label>
            </fieldset>
            <fieldset className="ze-props-group">
              <legend>Pin Text Options</legend>
              <label><input type="checkbox" checked={showNums} onChange={(e) => setShowNums(e.target.checked)} /> Show pin number</label>
              <label><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> Show pin name</label>
              <label><input type="checkbox" checked={nameInside} onChange={(e) => setNameInside(e.target.checked)} /> Place pin names inside</label>
              {nameInside && <MMField label="Position offset:" value={offset} onChange={setOffset} />}
            </fieldset>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ----- Text item (DIALOG_TEXT_PROPERTIES, lib subset) ---------------------------------

export function SymbolTextDialog({ initial, onOk, onCancel }: {
  initial?: { text: string; fontSize: number; bold: boolean; italic: boolean };
  onOk: (r: { text: string; fontSize: number; bold: boolean; italic: boolean }) => void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState(initial?.text ?? '');
  const [size, setSize] = useState(initial?.fontSize ?? 1.27 * MM);
  const [bold, setBold] = useState(initial?.bold ?? false);
  const [italic, setItalic] = useState(initial?.italic ?? false);
  const submit = (): void => { if (text.trim() !== '') onOk({ text, fontSize: size, bold, italic }); };
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Text Properties
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-label-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="row"><span>Text:</span>
            <input className="ze-search" autoFocus value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }} /></label>
          <MMField label="Text size:" value={size} onChange={setSize} />
          <div style={{ display: 'flex', gap: 16 }}>
            <label><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold</label>
            <label><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /> Italic</label>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" disabled={!text.trim()} onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ----- Shape properties (DIALOG_SHAPE_PROPERTIES, lib subset) ----------------------------

export interface ShapePropsResult {
  strokeWidth: number;
  strokeType: string;
  fillType: 'none' | 'outline' | 'background';
}

export function ShapePropertiesDialog({ initial, onOk, onCancel }: {
  initial: { strokeWidth: number; strokeType: string; fillType: string };
  onOk: (r: ShapePropsResult) => void;
  onCancel: () => void;
}): JSX.Element {
  const [width, setWidth] = useState(initial.strokeWidth);
  const [type, setType] = useState(initial.strokeType || 'default');
  const [fill, setFill] = useState<ShapePropsResult['fillType']>(
    initial.fillType === 'outline' || initial.fillType === 'background' ? initial.fillType : 'none');
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Drawing Properties
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-label-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <MMField label="Line width:" value={width} onChange={setWidth} />
          <label className="row"><span>Line style:</span>
            <select className="ze-select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="default">Default</option>
              <option value="solid">Solid</option>
              <option value="dash">Dashed</option>
              <option value="dot">Dotted</option>
              <option value="dash_dot">Dash-Dot</option>
              <option value="dash_dot_dot">Dash-Dot-Dot</option>
            </select></label>
          <label className="row"><span>Fill:</span>
            <select className="ze-select" value={fill} onChange={(e) => setFill(e.target.value as ShapePropsResult['fillType'])}>
              <option value="none">Do not fill</option>
              <option value="outline">Fill with body outline color</option>
              <option value="background">Fill with body background color</option>
            </select></label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={() => onOk({ strokeWidth: width, strokeType: type, fillType: fill })}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ----- Pin table (DIALOG_LIB_EDIT_PIN_TABLE) --------------------------------------------

export function PinTableDialog({ symbol, onOk, onCancel }: {
  symbol: LibSymbol;
  onOk: (next: LibSymbol) => void;
  onCancel: () => void;
}): JSX.Element {
  interface Row { unitIdx: number; pinIdx: number; pin: LibPin }
  const [rows, setRows] = useState<Row[]>(() =>
    allPins(symbol)
      .map(({ pin, unitIdx, pinIdx }) => ({ unitIdx, pinIdx, pin }))
      .sort((a, b) => a.pin.number.localeCompare(b.pin.number, undefined, { numeric: true })));

  const patch = (i: number, p: Partial<LibPin>): void =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, pin: { ...r.pin, ...p } } : r)));

  const submit = (): void => {
    let next = symbol;
    const units = next.units.map((u) => ({ ...u, pins: [...u.pins] }));
    for (const r of rows) {
      const u = units[r.unitIdx];
      if (u && u.pins[r.pinIdx]) u.pins[r.pinIdx] = r.pin;
    }
    next = { ...next, units };
    onOk(next);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-props-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Pin Table
          <span className="x" onClick={onCancel}>✕</span>
        </div>
        <div className="ze-props-body">
          <div className="ze-props-grid-wrap" style={{ maxHeight: 420 }}>
            <table className="ze-props-grid">
              <thead>
                <tr>
                  <th>Number</th><th>Name</th><th>Electrical Type</th><th>Graphic Style</th>
                  <th>Orientation</th><th>Number Size</th><th>Name Size</th><th>Length</th>
                  <th>X</th><th>Y</th><th>Visible</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.unitIdx}:${r.pinIdx}`}>
                    <td><input className="ze-cell-input" value={r.pin.number} onChange={(e) => patch(i, { number: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></td>
                    <td><input className="ze-cell-input" value={r.pin.name} onChange={(e) => patch(i, { name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></td>
                    <td>
                      <select className="ze-cell-select" value={r.pin.electricalType} onChange={(e) => patch(i, { electricalType: e.target.value })}>
                        {Object.entries(PIN_TYPE_NAMES).map(([tok, label]) => <option key={tok} value={tok}>{label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="ze-cell-select" value={r.pin.shape} onChange={(e) => patch(i, { shape: e.target.value })}>
                        {Object.entries(PIN_SHAPE_NAMES).map(([tok, label]) => <option key={tok} value={tok}>{label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="ze-cell-select" value={r.pin.angle} onChange={(e) => patch(i, { angle: Number(e.target.value) })}>
                        {PIN_ORIENTATION_NAMES.map(([a, label]) => <option key={a} value={a}>{label}</option>)}
                      </select>
                    </td>
                    <td><span className="ze-cell-ro">{mmStr(r.pin.numberSize ?? 1.27 * MM)}</span></td>
                    <td><span className="ze-cell-ro">{mmStr(r.pin.nameSize ?? 1.27 * MM)}</span></td>
                    <td><span className="ze-cell-ro">{mmStr(r.pin.length)}</span></td>
                    <td><span className="ze-cell-ro">{mmStr(r.pin.at.x)}</span></td>
                    <td><span className="ze-cell-ro">{mmStr(-r.pin.at.y)}</span></td>
                    <td className="c"><input type="checkbox" checked={!r.pin.hidden} onChange={(e) => patch(i, { hidden: !e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ze-muted" style={{ padding: '6px 2px' }}>{rows.length} pins</div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ----- Symbol checker (symbol_checker.cpp CheckLibSymbol) --------------------------------

/** Port of CheckLibSymbol: reference prefix, duplicate pins, power rules, off-grid pins. */
export function checkLibSymbol(sym: LibSymbol): string[] {
  const msgs: string[] = [];
  const mmXY = (p: Vec2): string => `(${mmStr(p.x)}, ${mmStr(-p.y)})`;

  const reference = sym.properties.find((f) => f.key === 'Reference')?.value ?? '';
  if (reference === '') {
    msgs.push('Warning: reference is empty');
  } else if ('0123456789?'.includes(reference[reference.length - 1]!)) {
    msgs.push("Warning: reference prefix — a prefix ending in '0123456789?' can create issues if saved in a symbol library");
  }

  // Duplicate pins (sorted by number; different body styles don't conflict).
  const pins = allPins(sym).map((r) => ({ ...r, u: sym.units[r.unitIdx]! }));
  pins.sort((a, b) => a.pin.number.localeCompare(b.pin.number) || (a.u.bodyStyle - b.u.bodyStyle) || (a.u.unit - b.u.unit));
  for (let i = 1; i < pins.length; i++) {
    const p = pins[i - 1]!, n = pins[i]!;
    if (p.pin.number !== n.pin.number) continue;
    if (p.u.bodyStyle !== 0 && n.u.bodyStyle !== 0 && p.u.bodyStyle !== n.u.bodyStyle) continue;
    const pinName = (x: string): string => (x && x !== '~' ? ` '${x}'` : '');
    msgs.push(`Duplicate pin ${n.pin.number}${pinName(n.pin.name)} at location ${mmXY(n.pin.at)} conflicts with pin ${p.pin.number}${pinName(p.pin.name)} at location ${mmXY(p.pin.at)}.`);
  }

  // Power symbol rules.
  if (sym.isPower) {
    if (unitCount(sym) !== 1) msgs.push('A power symbol should have only one unit');
    if (hasAlternateBodyStyle(sym)) msgs.push('A power symbol should not have De Morgan variants');
    if (pins.length !== 1) msgs.push('A power symbol should have only one pin');
    const pin = pins[0]?.pin;
    if (pin && pin.electricalType !== 'power_in' && pin.electricalType !== 'power_out')
      msgs.push('Suspicious power symbol — only an input or output power pin has meaning');
    if (pin && pin.electricalType === 'power_in' && pin.hidden)
      msgs.push('Suspicious power symbol — invisible input power pins are no longer required');
  }

  // Hidden power-input pins + off-grid pins (25-mil minimum grid).
  const grid = mmToIU(0.635); // 25 mils
  for (const { pin } of pins) {
    if (!sym.isPower && pin.electricalType === 'power_in' && pin.hidden) {
      msgs.push(`Info: hidden power pin ${pin.number} at location ${mmXY(pin.at)}. (Hidden power pins will drive their pin names on to any connected nets.)`);
    }
    if (pin.at.x % grid !== 0 || pin.at.y % grid !== 0) {
      msgs.push(`Off grid pin ${pin.number} at location ${mmXY(pin.at)}.`);
    }
  }

  // Graphics sanity (zero-size circle/rectangle).
  for (const u of sym.units) {
    for (const g of u.graphics) {
      if (g.kind === 'circle' && g.radius <= 0)
        msgs.push(`Graphic circle has radius = 0 at location ${mmXY(g.center)}.`);
      if (g.kind === 'rectangle' && g.start.x === g.end.x && g.start.y === g.end.y)
        msgs.push(`Graphic rectangle has size 0 at location ${mmXY(g.start)}.`);
    }
  }
  return msgs;
}

export function SymbolCheckDialog({ symbol, onClose }: { symbol: LibSymbol; onClose: () => void }): JSX.Element {
  const messages = useMemo(() => checkLibSymbol(symbol), [symbol]);
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Symbol Warnings
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="ze-label-dialog-body" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {messages.length === 0
            ? <div className="ze-muted">No issues found.</div>
            : messages.map((m, i) => <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #333' }}>{m}</div>)}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
