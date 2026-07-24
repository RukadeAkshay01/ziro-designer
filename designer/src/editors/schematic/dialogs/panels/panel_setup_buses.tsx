/**
 * Bus Alias Definitions panel. Counterpart:
 * `eeschema/dialogs/panel_setup_buses_base.cpp` (PANEL_SETUP_BUSES) — a two-pane
 * master/detail: on the left an "Alias" grid with add/delete, on the right the
 * "Members of '<alias>'" grid (net or nested-bus names) with add/remove. When no
 * alias is selected the members pane is blank.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type { BusAlias } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export { defaultBusAliases, type BusAlias } from '../../schematic_settings.js';

interface Props {
  aliases: BusAlias[];
  onChange: (next: BusAlias[]) => void;
}

export function PanelSetupBuses({ aliases, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState<number | null>(aliases.length ? 0 : null);
  const cur = sel !== null ? aliases[sel] : undefined;

  const setAliasName = (i: number, name: string): void =>
    onChange(aliases.map((a, j) => (j === i ? { ...a, name } : a)));
  const addAlias = (): void => {
    onChange([...aliases, { name: '', members: [] }]);
    setSel(aliases.length);
  };
  const delAlias = (): void => {
    if (sel === null) return;
    onChange(aliases.filter((_, j) => j !== sel));
    setSel(aliases.length - 2 >= 0 ? Math.min(sel, aliases.length - 2) : null);
  };

  const setMembers = (members: string[]): void => {
    if (sel === null) return;
    onChange(aliases.map((a, j) => (j === sel ? { ...a, members } : a)));
  };

  return (
    <div style={{ height: '100%', display: 'flex', gap: 10 }}>
      {/* Left: alias list */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 12.5, marginBottom: 6 }}>Bus Definitions</div>
        <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
          <table className="ze-grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Alias</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((a, i) => (
                <tr
                  key={i}
                  className={i === sel ? 'selected' : undefined}
                  onMouseDown={() => setSel(i)}
                >
                  <td>
                    <input
                      type="text"
                      value={a.name}
                      placeholder="BUS_NAME"
                      onChange={(e) => setAliasName(i, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
              {aliases.length === 0 && (
                <tr>
                  <td style={{ padding: '6px', color: 'var(--ze-muted, #888)' }}>
                    No bus aliases defined.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ze-grid-btns">
          <button className="ze-gridbtn" title="Add alias" onClick={addAlias}>
            <Icon name="plus" />
          </button>
          <span style={{ width: 15 }} />
          <button
            className="ze-gridbtn"
            title="Delete alias"
            disabled={sel === null}
            onClick={delAlias}
          >
            <Icon name="delete" />
          </button>
        </div>
      </div>

      {/* Right: members of selected alias */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {cur ? (
          <>
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>
              Members of &lsquo;{cur.name || '…'}&rsquo;
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <table className="ze-grid">
                <thead>
                  <tr>
                    <th>Net or Nested Bus Name</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.members.map((m, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          type="text"
                          value={m}
                          onChange={(e) =>
                            setMembers(cur.members.map((x, j) => (j === i ? e.target.value : x)))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  {cur.members.length === 0 && (
                    <tr>
                      <td style={{ padding: '6px', color: 'var(--ze-muted, #888)' }}>
                        No members.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="ze-grid-btns">
              <button
                className="ze-gridbtn"
                title="Add member"
                onClick={() => setMembers([...cur.members, ''])}
              >
                <Icon name="plus" />
              </button>
              <span style={{ width: 15 }} />
              <button
                className="ze-gridbtn"
                title="Remove member"
                disabled={cur.members.length === 0}
                onClick={() => setMembers(cur.members.slice(0, -1))}
              >
                <Icon name="delete" />
              </button>
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--ze-muted, #888)', fontSize: 12, padding: 8 }}>
            Select a bus alias to edit its members.
          </div>
        )}
      </div>
    </div>
  );
}
