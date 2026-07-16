/**
 * Field Name Templates panel. Counterpart: `common/dialogs/
 * panel_setup_fieldname_templates.cpp` (PANEL_TEMPLATE_FIELDNAMES) — the field
 * names auto-added to new symbols, each with Visible / URL flags.
 */

import type { JSX } from 'react';

export interface FieldTemplate {
  name: string;
  visible: boolean;
  url: boolean;
}

interface Props {
  templates: FieldTemplate[];
  onChange: (next: FieldTemplate[]) => void;
}

export function PanelTemplateFieldnames({ templates, onChange }: Props): JSX.Element {
  const setAt = (i: number, patch: Partial<FieldTemplate>): void =>
    onChange(templates.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const add = (): void => onChange([...templates, { name: '', visible: true, url: false }]);
  const remove = (i: number): void => onChange(templates.filter((_, j) => j !== i));

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Field Name Templates</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '2px 4px' }}>Name</th>
            <th style={{ width: 60, padding: '2px 4px' }}>Visible</th>
            <th style={{ width: 44, padding: '2px 4px' }}>URL</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {templates.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '6px 4px', color: 'var(--ze-muted, #888)' }}>
                No field name templates defined.
              </td>
            </tr>
          )}
          {templates.map((t, i) => (
            <tr key={i}>
              <td style={{ padding: '2px 4px' }}>
                <input
                  className="ze-search"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={t.name}
                  placeholder="Field name"
                  onChange={(e) => setAt(i, { name: e.target.value })}
                />
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={t.visible}
                  onChange={(e) => setAt(i, { visible: e.target.checked })}
                />
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={t.url}
                  onChange={(e) => setAt(i, { url: e.target.checked })}
                />
              </td>
              <td style={{ textAlign: 'center' }}>
                <button className="ze-btn" title="Delete" onClick={() => remove(i)}>
                  −
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ze-btn" style={{ marginTop: 8 }} onClick={add}>
        + Add Template
      </button>
    </div>
  );
}
