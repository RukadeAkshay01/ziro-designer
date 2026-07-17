/**
 * Symbol Fields Table (edit view). Counterpart: `eeschema/dialogs/
 * dialog_symbol_fields_table.cpp` (Tools > Bulk Edit Symbol Fields) — a grid
 * of every symbol in the hierarchy with its fields editable in place. OK
 * applies only the changed cells, per sheet, as undoable commits.
 */

import { useMemo, useState, type JSX } from 'react';
import { compareRefs, refId, type Schematic } from '@ziroeda/eeschema';

/** One editable grid row: a symbol instance addressed by (file, refId). */
export interface FieldsRow {
  file: string;
  id: string;
  reference: string;
  /** Current field values by name. */
  values: Record<string, string>;
}

/** Changed cells, grouped by sheet file then symbol refId. */
export type FieldsEdits = Map<string, Map<string, Record<string, string>>>;

/** Build the grid rows from every sheet document (power symbols excluded). */
export function buildFieldsRows(docs: ReadonlyMap<string, Schematic>): FieldsRow[] {
  const rows: FieldsRow[] = [];
  for (const [file, doc] of docs) {
    doc.symbols.forEach((s, i) => {
      const reference = s.fields.find((f) => f.key === 'Reference')?.value ?? '';
      if (!reference || reference.startsWith('#')) return;
      const values: Record<string, string> = {};
      for (const f of s.fields) values[f.key] = f.value;
      rows.push({ file, id: refId('symbol', s.uuid, i), reference, values });
    });
  }
  rows.sort((a, b) => compareRefs(a.reference, b.reference));
  return rows;
}

const BASE_COLUMNS = ['Value', 'Footprint', 'Datasheet'];

interface Props {
  docs: ReadonlyMap<string, Schematic>;
  onApply: (edits: FieldsEdits) => void;
  onClose: () => void;
}

export function DialogSymbolFieldsTable({ docs, onApply, onClose }: Props): JSX.Element {
  const rows = useMemo(() => buildFieldsRows(docs), [docs]);
  // Columns: the built-ins plus every custom field present (Reference shown
  // read-only first — re-numbering belongs to Annotate).
  const columns = useMemo(() => {
    const extra = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.values)) {
        if (k !== 'Reference' && k !== 'Description' && !BASE_COLUMNS.includes(k)) extra.add(k);
      }
    }
    return [...BASE_COLUMNS, ...extra];
  }, [rows]);

  // Pending cell edits keyed "file\0id" -> { field: value }.
  const [pending, setPending] = useState<Map<string, Record<string, string>>>(new Map());
  const cellValue = (r: FieldsRow, col: string): string =>
    pending.get(`${r.file}\0${r.id}`)?.[col] ?? r.values[col] ?? '';
  const setCell = (r: FieldsRow, col: string, value: string): void => {
    setPending((prev) => {
      const next = new Map(prev);
      const key = `${r.file}\0${r.id}`;
      const cur = { ...(next.get(key) ?? {}) };
      if ((r.values[col] ?? '') === value) delete cur[col];
      else cur[col] = value;
      if (Object.keys(cur).length === 0) next.delete(key);
      else next.set(key, cur);
      return next;
    });
  };

  const apply = (): void => {
    const edits: FieldsEdits = new Map();
    for (const [key, change] of pending) {
      const [file, id] = key.split('\0') as [string, string];
      if (!edits.has(file)) edits.set(file, new Map());
      edits.get(file)!.set(id, change);
    }
    onApply(edits);
  };

  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '3px 8px',
    fontSize: 11,
    borderBottom: '1px solid var(--chrome-border)',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    background: 'var(--panel-bg)',
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{
          width: 820,
          maxWidth: '96vw',
          height: 540,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Symbol Fields Table
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', margin: '8px 14px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Reference</th>
                {columns.map((c) => (
                  <th key={c} style={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.file}\0${r.id}`}>
                  <td style={{ padding: '2px 8px', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {r.reference}
                  </td>
                  {columns.map((c) => (
                    <td key={c} style={{ padding: '1px 4px' }}>
                      <input
                        className="ze-search"
                        style={{
                          width: '100%',
                          minWidth: 90,
                          boxSizing: 'border-box',
                          ...(pending.get(`${r.file}\0${r.id}`)?.[c] !== undefined
                            ? { borderColor: '#e07b1a' }
                            : {}),
                        }}
                        value={cellValue(r, c)}
                        onChange={(e) => setCell(r, c, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    style={{ padding: '6px 8px', fontSize: 12, color: 'var(--ze-muted, #888)' }}
                  >
                    No symbols — place and annotate symbols first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          <span className="ze-muted" style={{ marginRight: 'auto', fontSize: 12 }}>
            {pending.size === 0
              ? `${rows.length} symbol${rows.length === 1 ? '' : 's'}`
              : `${pending.size} symbol${pending.size === 1 ? '' : 's'} modified`}
          </span>
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ze-btn primary" disabled={pending.size === 0} onClick={apply}>
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
