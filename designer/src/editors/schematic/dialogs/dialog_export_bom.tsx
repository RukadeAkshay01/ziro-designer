/**
 * Generate Bill of Materials dialog. Counterpart: the Symbol Fields Table's
 * Export view (`eeschema/dialogs/dialog_symbol_fields_table.cpp`, KiCad's
 * Tools > Generate Bill of Materials) with the default "Grouped By Value"
 * preset — a live preview of the grouped rows, group/DNP options, and a CSV
 * download.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  buildBom,
  bomToCsv,
  bomFieldNames,
  DEFAULT_BOM_OPTIONS,
  type Schematic,
} from '@ziroeda/eeschema';

interface Props {
  /** Every sheet document of the project (full hierarchy BOM). */
  docs: readonly Schematic[];
  /** Suggested output base name (project/sheet name, no extension). */
  baseName: string;
  onClose: () => void;
}

export function DialogExportBom({ docs, baseName, onClose }: Props): JSX.Element {
  const [grouped, setGrouped] = useState(true);
  const [includeDNP, setIncludeDNP] = useState(false);

  const fieldNames = useMemo(() => bomFieldNames(docs), [docs]);
  // Column order mirrors the upstream default preset; extra custom fields
  // (e.g. MPN) follow the built-ins automatically.
  const columns = useMemo(() => {
    const base = ['Reference', 'Value', 'Datasheet', 'Footprint', 'Qty', 'DNP'];
    const extras = fieldNames.filter((f) => !base.includes(f));
    return [...base, ...extras];
  }, [fieldNames]);

  const rows = useMemo(
    () =>
      buildBom(docs, {
        groupBy: grouped ? DEFAULT_BOM_OPTIONS.groupBy : ['Reference'],
        includeDNP,
      }),
    [docs, grouped, includeDNP],
  );

  const exportCsv = (): void => {
    const csv = bomToCsv(rows, columns);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '3px 8px',
    fontSize: 11,
    borderBottom: '1px solid var(--chrome-border)',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '3px 8px',
    fontSize: 12,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 220,
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{
          width: 760,
          maxWidth: '96vw',
          height: 520,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Generate Bill of Materials
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, padding: '8px 14px', alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />{' '}
            Group symbols by Value + Footprint
          </label>
          <label style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={includeDNP}
              onChange={(e) => setIncludeDNP(e.target.checked)}
            />{' '}
            Include DNP
          </label>
          <span className="ze-muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', margin: '0 14px' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} style={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.refs} style={r.dnp ? { opacity: 0.55 } : undefined}>
                  {columns.map((c) => (
                    <td key={c} style={td}>
                      {c === 'Reference'
                        ? r.refs
                        : c === 'Qty'
                          ? r.qty
                          : c === 'DNP'
                            ? r.dnp
                              ? 'DNP'
                              : ''
                            : (r.fields[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td style={{ ...td, color: 'var(--ze-muted, #888)' }} colSpan={columns.length}>
                    No symbols to list — place and annotate symbols first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ze-btn primary" disabled={rows.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
