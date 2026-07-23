/**
 * Text Variables panel. Counterpart: `common/dialogs/panel_text_variables_base.cpp`
 * (PANEL_TEXT_VARIABLES) — the project's `${NAME}` substitutions, edited in a
 * two-column grid (Variable Name / Text Substitution) with an add and a delete
 * bitmap button at the bottom-left. Delete removes the selected row.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type { TextVar } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export { type TextVar } from '../../schematic_settings.js';

interface Props {
  vars: TextVar[];
  onChange: (next: TextVar[]) => void;
}

export function PanelTextVariables({ vars, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState<number | null>(vars.length ? 0 : null);

  const setAt = (i: number, patch: Partial<TextVar>): void =>
    onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const add = (): void => {
    onChange([...vars, { name: '', value: '' }]);
    setSel(vars.length);
  };
  const removeSel = (): void => {
    if (sel === null) return;
    onChange(vars.filter((_, j) => j !== sel));
    setSel(vars.length - 1 > sel ? sel : sel - 1 >= 0 ? sel - 1 : null);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
        <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 160 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Variable Name</th>
              <th>Text Substitution</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v, i) => (
              <tr
                key={i}
                className={i === sel ? 'selected' : undefined}
                onFocusCapture={() => setSel(i)}
                onMouseDown={() => setSel(i)}
              >
                <td>
                  <input
                    type="text"
                    value={v.name}
                    placeholder="MY_VARIABLE"
                    onChange={(e) => setAt(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={v.value}
                    onChange={(e) => setAt(i, { value: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ze-grid-btns">
        <button className="ze-gridbtn" title="Add text variable" onClick={add}>
          <Icon name="plus" />
        </button>
        <span style={{ width: 15 }} />
        <button
          className="ze-gridbtn"
          title="Delete text variable"
          disabled={sel === null}
          onClick={removeSel}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}
