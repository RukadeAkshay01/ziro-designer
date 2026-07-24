/**
 * Field Name Templates panel. Counterpart:
 * `eeschema/dialogs/panel_template_fieldnames_base.cpp` (PANEL_TEMPLATE_FIELDNAMES) —
 * a "Field Name Templates" title, then a Name / Visible / URL grid, then a
 * bottom-left button row: add, move up, move down, (gap) delete. The template
 * field names are auto-added to new symbols, each with Visible / URL flags.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type { FieldTemplate } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export type { FieldTemplate } from '../../schematic_settings.js';

interface Props {
  templates: FieldTemplate[];
  onChange: (next: FieldTemplate[]) => void;
}

export function PanelTemplateFieldnames({ templates, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState<number | null>(templates.length ? 0 : null);

  const setAt = (i: number, patch: Partial<FieldTemplate>): void =>
    onChange(templates.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const add = (): void => {
    onChange([...templates, { name: '', visible: true, url: false }]);
    setSel(templates.length);
  };
  const removeSel = (): void => {
    if (sel === null) return;
    onChange(templates.filter((_, j) => j !== sel));
    setSel(templates.length - 1 > sel ? sel : sel - 1 >= 0 ? sel - 1 : null);
  };
  const move = (dir: -1 | 1): void => {
    if (sel === null) return;
    const j = sel + dir;
    if (j < 0 || j >= templates.length) return;
    const next = [...templates];
    [next[sel], next[j]] = [next[j]!, next[sel]!];
    onChange(next);
    setSel(j);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      <div style={{ fontSize: 12.5, marginBottom: 6 }}>Field Name Templates</div>
      <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
        <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Visible</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t, i) => (
              <tr
                key={i}
                className={i === sel ? 'selected' : undefined}
                onFocusCapture={() => setSel(i)}
                onMouseDown={() => setSel(i)}
              >
                <td>
                  <input
                    type="text"
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
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '6px', color: 'var(--ze-muted, #888)' }}>
                  No field name templates defined.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ze-grid-btns">
        <button className="ze-gridbtn" title="Add template" onClick={add}>
          <Icon name="plus" />
        </button>
        <button
          className="ze-gridbtn"
          title="Move up"
          disabled={sel === null || sel === 0}
          onClick={() => move(-1)}
        >
          <Icon name="arrowUp" />
        </button>
        <button
          className="ze-gridbtn"
          title="Move down"
          disabled={sel === null || sel === templates.length - 1}
          onClick={() => move(1)}
        >
          <Icon name="arrowDown" />
        </button>
        <span style={{ width: 15 }} />
        <button
          className="ze-gridbtn"
          title="Delete template"
          disabled={sel === null}
          onClick={removeSel}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}
