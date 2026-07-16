/**
 * Text Variables panel. Counterpart: `common/dialogs/panel_text_variables.cpp`
 * (PANEL_TEXT_VARIABLES) — the project's `${NAME}` substitutions, edited as a
 * name/value grid. They resolve in title-block fields and schematic text.
 */

import type { JSX } from 'react';

export interface TextVar {
  name: string;
  value: string;
}

interface Props {
  vars: TextVar[];
  onChange: (next: TextVar[]) => void;
}

export function PanelTextVariables({ vars, onChange }: Props): JSX.Element {
  const setAt = (i: number, patch: Partial<TextVar>): void =>
    onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const add = (): void => onChange([...vars, { name: '', value: '' }]);
  const remove = (i: number): void => onChange(vars.filter((_, j) => j !== i));

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Text Variables</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', width: '38%', padding: '2px 4px' }}>Variable Name</th>
            <th style={{ textAlign: 'left', padding: '2px 4px' }}>Text Substitution</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {vars.length === 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '6px 4px', color: 'var(--ze-muted, #888)' }}>
                No text variables defined.
              </td>
            </tr>
          )}
          {vars.map((v, i) => (
            <tr key={i}>
              <td style={{ padding: '2px 4px' }}>
                <input
                  className="ze-search"
                  style={inp}
                  value={v.name}
                  placeholder="MY_VARIABLE"
                  onChange={(e) => setAt(i, { name: e.target.value })}
                />
              </td>
              <td style={{ padding: '2px 4px' }}>
                <input
                  className="ze-search"
                  style={inp}
                  value={v.value}
                  onChange={(e) => setAt(i, { value: e.target.value })}
                />
              </td>
              <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                <button className="ze-btn" title="Delete" onClick={() => remove(i)}>
                  −
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ze-btn" style={{ marginTop: 8 }} onClick={add}>
        + Add Text Variable
      </button>
      <div style={{ fontSize: 11, color: 'var(--ze-muted, #888)', marginTop: 8 }}>
        Reference a variable elsewhere as{' '}
        <code>
          ${'{'}NAME{'}'}
        </code>
        .
      </div>
    </div>
  );
}
