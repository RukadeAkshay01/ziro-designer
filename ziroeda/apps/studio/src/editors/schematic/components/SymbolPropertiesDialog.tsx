import { useMemo, useState } from 'react';
import {
  iuToMM, mmToIU, symbolTransform, composeMirror, orientationFromTransform,
  effectiveHorizJustify, effectiveVertJustify, storedForEffectiveHoriz, storedForEffectiveVert,
  justifyTokens, storedHJustify, storedVJustify, fieldShownText, isMandatoryField,
  DEFAULT_TEXT_SIZE, letterSubReference,
  type SchSymbol, type SchField, type LibSymbol, type SymbolEdit, type EditedField, type TextEffects,
} from '@ziroeda/core';
import { measureText } from '../../../common/strokeFont.js';

/**
 * Symbol Properties dialog, ported from KiCad's DIALOG_SYMBOL_PROPERTIES
 * (eeschema/dialogs/dialog_symbol_properties.cpp) and its fields grid
 * (fields_grid_table.cpp):
 *
 *  - one row per field with KiCad's columns — Name, Value, Show, Show Name,
 *    H Align, V Align, Italic, Bold, Text Size, Orientation, Position X/Y;
 *  - positions are shown symbol-relative (TransferDataToWindow offsets each copy
 *    by -symbol position) and in the user units (mm);
 *  - the H/V-align cells show the *effective* justification and setting them
 *    stores the possibly-flipped one (Get/SetEffectiveHorizJustify);
 *  - General: unit (multi-unit symbols), orientation 0/+90/-90/180, mirror;
 *  - Attributes: exclude from simulation / BOM / board, do not populate;
 *  - new fields are named "Field<n>", take the Reference field's angle, and start
 *    hidden (OnAddField); mandatory fields can't be renamed, deleted, or moved.
 */

interface Row {
  key: string;
  value: string;
  /** Symbol-relative position, IU (dialog convention). */
  at: { x: number; y: number };
  angle: number; // 0 (horizontal) | 90 (vertical)
  effects: TextEffects;
  nameShown: boolean;
  source?: SchField['source'];
}

interface Props {
  symbol: SchSymbol;
  lib?: LibSymbol;
  onOk: (edit: SymbolEdit) => void;
  onCancel: () => void;
}

const mmStr = (iu: number): string => {
  let s = iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0' || s === '') s = '0';
  return s;
};

/** A row as an absolute-position SchField, for the justify/box computations. */
function absField(row: Row, sym: SchSymbol): SchField {
  return {
    key: row.key,
    value: row.value,
    at: { x: row.at.x + sym.at.x, y: row.at.y + sym.at.y },
    angle: row.angle,
    effects: row.effects,
    nameShown: row.nameShown || undefined,
    source: row.source ?? ({ kind: 'list', items: [] } as SchField['source']),
  };
}

export function SymbolPropertiesDialog({ symbol, lib, onOk, onCancel }: Props): JSX.Element {
  const unitCount = useMemo(() => (lib ? lib.units.reduce((m, u) => Math.max(m, u.unit), 0) : 1), [lib]);

  const [rows, setRows] = useState<Row[]>(() =>
    symbol.fields.map((f) => ({
      key: f.key,
      value: f.value,
      at: f.at ? { x: f.at.x - symbol.at.x, y: f.at.y - symbol.at.y } : { x: 0, y: 0 },
      angle: ((f.angle % 180) + 180) % 180 === 90 ? 90 : 0,
      effects: f.effects ?? { hidden: false },
      nameShown: !!f.nameShown,
      source: f.source,
    })),
  );
  const [selRow, setSelRow] = useState(0);

  // Orientation & mirror decompose exactly as TransferDataToWindow: choices are
  // 0 / +90 / -90 / 180 (SYM_ORIENT_0/90/270/180) and none / around-X / around-Y.
  const [orient, setOrient] = useState<number>(symbol.angle === 90 ? 90 : symbol.angle === 270 ? 270 : symbol.angle === 180 ? 180 : 0);
  const [mirror, setMirror] = useState<'' | 'x' | 'y'>(symbol.mirror ?? '');
  const [unit, setUnit] = useState(symbol.unit);

  const [excludeSim, setExcludeSim] = useState(!!symbol.excludedFromSim);
  const [excludeBom, setExcludeBom] = useState(!symbol.inBom);
  const [excludeBoard, setExcludeBoard] = useState(!symbol.onBoard);
  const [dnp, setDnp] = useState(symbol.dnp);
  const [error, setError] = useState<string | null>(null);

  const patchRow = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const patchEffects = (i: number, fx: Partial<TextEffects>): void =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, effects: { ...r.effects, ...fx } } : r)));

  // Numeric cells keep free text while typing and commit on blur/Enter, like a grid.
  const [cellText, setCellText] = useState<Record<string, string>>({});
  const cellKey = (i: number, col: string): string => `${i}:${col}`;
  const numCell = (i: number, col: string, valueIU: number, commit: (iu: number) => void): JSX.Element => (
    <input
      className="ze-cell-input num"
      value={cellText[cellKey(i, col)] ?? mmStr(valueIU)}
      onChange={(e) => setCellText((t) => ({ ...t, [cellKey(i, col)]: e.target.value }))}
      onBlur={(e) => {
        const v = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(v)) commit(mmToIU(v));
        setCellText((t) => { const n = { ...t }; delete n[cellKey(i, col)]; return n; });
      }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );

  const shownFor = (row: Row): string => fieldShownText(absField(row, symbol), symbol, unitCount);

  // OnAddField: "Field<n>", the Reference field's angle, hidden, at the symbol origin.
  const addRow = (): void => {
    const refAngle = rows.find((r) => r.key === 'Reference')?.angle ?? 0;
    setRows((rs) => [...rs, {
      key: `Field${rs.length}`,
      value: '',
      at: { x: 0, y: 0 },
      angle: refAngle,
      effects: { hidden: true, fontSize: [DEFAULT_TEXT_SIZE, DEFAULT_TEXT_SIZE] },
      nameShown: false,
    }]);
    setSelRow(rows.length);
  };

  const mandatoryCount = rows.filter((r) => isMandatoryField(r.key)).length;
  const deleteRow = (): void => {
    const row = rows[selRow];
    if (!row) return;
    if (isMandatoryField(row.key)) { setError(`The first ${mandatoryCount} fields are mandatory.`); return; }
    setRows((rs) => rs.filter((_, i) => i !== selRow));
    setSelRow((i) => Math.max(0, i - 1));
  };
  const moveRow = (dir: -1 | 1): void => {
    const j = selRow + dir;
    if (j < 0 || j >= rows.length) return;
    if (isMandatoryField(rows[selRow]!.key) || isMandatoryField(rows[j]!.key)) return;
    setRows((rs) => { const n = rs.slice(); [n[selRow], n[j]] = [n[j]!, n[selRow]!]; return n; });
    setSelRow(j);
  };

  const submit = (): void => {
    // Validate(): non-mandatory fields must have a name (empty name + empty value
    // rows are silently dropped, as TransferDataFromWindow does).
    for (const r of rows) {
      if (!isMandatoryField(r.key) && r.key.trim() === '' && r.value !== '') {
        setError('Fields must have a name.');
        return;
      }
    }

    // Compose orientation then mirror exactly as the dialog's two SetOrientation
    // calls, and decompose to the canonical serialized (angle, mirror).
    let t = symbolTransform(orient, undefined);
    if (mirror) t = composeMirror(t, mirror);
    const o = orientationFromTransform(t);

    const fields: EditedField[] = rows
      .filter((r) => !(r.key.trim() === '' && r.value === ''))
      .map((r) => ({
        key: r.key.trim(),
        value: r.value,
        at: r.at,
        angle: r.angle,
        effects: r.effects,
        nameShown: r.nameShown || undefined,
        source: r.source,
      }));

    onOk({
      fields,
      angle: o.angle,
      mirror: o.mirror,
      unit,
      inBom: !excludeBom,
      onBoard: !excludeBoard,
      dnp,
      // Leave the token absent unless the file had it or the user turned it on.
      excludedFromSim: symbol.excludedFromSim !== undefined || excludeSim ? excludeSim : undefined,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-props-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Symbol Properties
          <span className="x" onClick={onCancel}>✕</span>
        </div>

        <div className="ze-props-body">
          {error && <div className="ze-props-error" onClick={() => setError(null)}>{error} — click to dismiss</div>}

          <div className="ze-props-grid-wrap">
            <table className="ze-props-grid">
              <thead>
                <tr>
                  <th>Name</th><th>Value</th><th>Show</th><th>Show Name</th>
                  <th>H Align</th><th>V Align</th><th>Italic</th><th>Bold</th>
                  <th>Text Size</th><th>Orientation</th><th>Position X</th><th>Position Y</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const f = absField(row, symbol);
                  const shown = shownFor(row);
                  const effH = effectiveHorizJustify(f, symbol, shown, measureText);
                  const effV = effectiveVertJustify(f, symbol, shown, measureText);
                  const mandatory = isMandatoryField(row.key);
                  return (
                    <tr key={i} className={i === selRow ? 'sel' : ''} onClick={() => setSelRow(i)}>
                      <td>
                        {mandatory
                          ? <span className="ze-cell-ro">{row.key}</span>
                          : <input className="ze-cell-input" value={row.key} onChange={(e) => patchRow(i, { key: e.target.value })}
                              onKeyDown={(e) => e.stopPropagation()} />}
                      </td>
                      <td>
                        <input className="ze-cell-input" value={row.value} onChange={(e) => patchRow(i, { value: e.target.value })}
                          onKeyDown={(e) => e.stopPropagation()} />
                      </td>
                      <td className="c"><input type="checkbox" checked={!row.effects.hidden} onChange={(e) => patchEffects(i, { hidden: !e.target.checked })} /></td>
                      <td className="c"><input type="checkbox" checked={row.nameShown} onChange={(e) => patchRow(i, { nameShown: e.target.checked })} /></td>
                      <td>
                        <select className="ze-cell-select" value={effH}
                          onChange={(e) => {
                            const stored = storedForEffectiveHoriz(f, symbol, shown, measureText, e.target.value as 'left' | 'center' | 'right');
                            patchEffects(i, { justify: justifyTokens(stored, storedVJustify(f)) });
                          }}>
                          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                        </select>
                      </td>
                      <td>
                        <select className="ze-cell-select" value={effV}
                          onChange={(e) => {
                            const stored = storedForEffectiveVert(f, symbol, shown, measureText, e.target.value as 'top' | 'center' | 'bottom');
                            patchEffects(i, { justify: justifyTokens(storedHJustify(f), stored) });
                          }}>
                          <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
                        </select>
                      </td>
                      <td className="c"><input type="checkbox" checked={!!row.effects.italic} onChange={(e) => patchEffects(i, { italic: e.target.checked || undefined })} /></td>
                      <td className="c"><input type="checkbox" checked={!!row.effects.bold} onChange={(e) => patchEffects(i, { bold: e.target.checked || undefined })} /></td>
                      <td>{numCell(i, 'size', row.effects.fontSize?.[0] ?? DEFAULT_TEXT_SIZE,
                        (iu) => patchEffects(i, { fontSize: [iu, iu] }))}</td>
                      <td>
                        <select className="ze-cell-select" value={row.angle === 90 ? 'Vertical' : 'Horizontal'}
                          onChange={(e) => patchRow(i, { angle: e.target.value === 'Vertical' ? 90 : 0 })}>
                          <option>Horizontal</option><option>Vertical</option>
                        </select>
                      </td>
                      <td>{numCell(i, 'posx', row.at.x, (iu) => patchRow(i, { at: { ...row.at, x: iu } }))}</td>
                      <td>{numCell(i, 'posy', row.at.y, (iu) => patchRow(i, { at: { ...row.at, y: iu } }))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ze-props-rowbtns">
            <button className="ze-btn sm" title="Add field" onClick={addRow}>+</button>
            <button className="ze-btn sm" title="Move up" onClick={() => moveRow(-1)}>↑</button>
            <button className="ze-btn sm" title="Move down" onClick={() => moveRow(1)}>↓</button>
            <span className="grow" />
            <button className="ze-btn sm" title="Delete field" onClick={deleteRow}>🗑</button>
          </div>

          <div className="ze-props-columns">
            <fieldset className="ze-props-group">
              <legend>General</legend>
              <label className="row">
                <span>Unit:</span>
                <select className="ze-select" disabled={unitCount < 2} value={unit}
                  onChange={(e) => setUnit(Number(e.target.value))}>
                  {Array.from({ length: Math.max(unitCount, 1) }, (_, k) => (
                    <option key={k + 1} value={k + 1}>Unit {letterSubReference(k + 1)}</option>
                  ))}
                </select>
              </label>
              <label className="row">
                <span>Angle:</span>
                <select className="ze-select" value={orient} onChange={(e) => setOrient(Number(e.target.value))}>
                  <option value={0}>0</option>
                  <option value={90}>+90</option>
                  <option value={270}>-90</option>
                  <option value={180}>180</option>
                </select>
              </label>
              <label className="row">
                <span>Mirror:</span>
                <select className="ze-select" value={mirror} onChange={(e) => setMirror(e.target.value as '' | 'x' | 'y')}>
                  <option value="">Not mirrored</option>
                  <option value="x">Around X axis</option>
                  <option value="y">Around Y axis</option>
                </select>
              </label>
            </fieldset>

            <fieldset className="ze-props-group">
              <legend>Attributes</legend>
              <label><input type="checkbox" checked={excludeSim} onChange={(e) => setExcludeSim(e.target.checked)} /> Exclude from simulation</label>
              <label><input type="checkbox" checked={excludeBom} onChange={(e) => setExcludeBom(e.target.checked)} /> Exclude from bill of materials</label>
              <label><input type="checkbox" checked={excludeBoard} onChange={(e) => setExcludeBoard(e.target.checked)} /> Exclude from board</label>
              <label><input type="checkbox" checked={dnp} onChange={(e) => setDnp(e.target.checked)} /> Do not populate</label>
            </fieldset>
          </div>

          <div className="ze-props-libid">
            <span className="lbl">Library link:</span>
            <span className="val" title={symbol.libId}>{symbol.libId}</span>
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
