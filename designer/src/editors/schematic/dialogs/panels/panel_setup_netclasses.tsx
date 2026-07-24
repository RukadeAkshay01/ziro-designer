/**
 * Net Classes panel. Counterpart:
 * `common/dialogs/panel_setup_netclasses_base.cpp` (PANEL_SETUP_NETCLASSES) — the
 * shared net-class editor. Top: a wide "Netclasses" grid (Name + physical/visual
 * columns) with add / move-up / move-down / remove. Bottom: a "Netclass
 * Assignments" grid mapping a net-name pattern to a net class. The Default class
 * is always present and cannot be removed or reordered.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import {
  LINE_STYLES,
  blankNetClass as blankClass,
  type NetClass,
  type NetClassAssignment,
  type NetClassesData,
} from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export {
  LINE_STYLES,
  defaultNetClasses,
  type NetClass,
  type NetClassAssignment,
  type NetClassesData,
} from '../../schematic_settings.js';

interface Props {
  value: NetClassesData;
  onChange: (next: NetClassesData) => void;
}

// The editable text columns (label -> key), in KiCad's order after Name.
const NUM_COLS: { label: string; key: keyof NetClass }[] = [
  { label: 'Clearance', key: 'clearance' },
  { label: 'Track Width', key: 'trackWidth' },
  { label: 'Via Size', key: 'viaSize' },
  { label: 'Via Hole', key: 'viaHole' },
  { label: 'uVia Size', key: 'uviaSize' },
  { label: 'uVia Hole', key: 'uviaHole' },
  { label: 'DP Width', key: 'dpWidth' },
  { label: 'DP Gap', key: 'dpGap' },
  { label: 'Tuning Profile', key: 'tuningProfile' },
  { label: 'Wire Thickness', key: 'wireThickness' },
  { label: 'Bus Thickness', key: 'busThickness' },
];

export function PanelSetupNetclasses({ value, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState<number>(0);

  const setClasses = (classes: NetClass[]): void => onChange({ ...value, classes });
  const setAt = (i: number, patch: Partial<NetClass>): void =>
    setClasses(value.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const isDefault = (i: number): boolean => i === 0;

  const add = (): void => {
    onChange({ ...value, classes: [...value.classes, blankClass('')] });
    setSel(value.classes.length);
  };
  const remove = (): void => {
    if (isDefault(sel)) return; // Default cannot be removed
    setClasses(value.classes.filter((_, j) => j !== sel));
    setSel(Math.max(0, sel - 1));
  };
  const move = (dir: -1 | 1): void => {
    const j = sel + dir;
    if (sel === 0 || j <= 0 || j >= value.classes.length) return; // Default stays first
    const next = [...value.classes];
    [next[sel], next[j]] = [next[j]!, next[sel]!];
    setClasses(next);
    setSel(j);
  };

  const setAssign = (assignments: NetClassAssignment[]): void =>
    onChange({ ...value, assignments });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Netclasses grid */}
      <div style={{ fontSize: 12.5, marginBottom: 6 }}>Netclasses</div>
      <div className="ze-grid-pane" style={{ flex: '1 1 55%', minHeight: 80 }}>
        <table className="ze-grid" style={{ minWidth: 1180, width: '100%', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0 }}>Name</th>
              {NUM_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>PCB Color</th>
              <th>Color</th>
              <th>Line Style</th>
            </tr>
          </thead>
          <tbody>
            {value.classes.map((c, i) => (
              <tr
                key={i}
                className={i === sel ? 'selected' : undefined}
                onMouseDown={() => setSel(i)}
              >
                <td style={{ minWidth: 120 }}>
                  <input
                    type="text"
                    value={c.name}
                    disabled={isDefault(i)}
                    onChange={(e) => setAt(i, { name: e.target.value })}
                  />
                </td>
                {NUM_COLS.map((col) => (
                  <td key={col.key} style={{ minWidth: 74 }}>
                    <input
                      type="text"
                      value={c[col.key]}
                      onChange={(e) => setAt(i, { [col.key]: e.target.value })}
                    />
                  </td>
                ))}
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="color"
                    value={c.pcbColor || '#000000'}
                    style={{ width: 28, height: 18, border: 'none', background: 'none' }}
                    onChange={(e) => setAt(i, { pcbColor: e.target.value })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="color"
                    value={c.color || '#000000'}
                    style={{ width: 28, height: 18, border: 'none', background: 'none' }}
                    onChange={(e) => setAt(i, { color: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="ze-grid-input"
                    value={c.lineStyle}
                    onChange={(e) => setAt(i, { lineStyle: e.target.value })}
                  >
                    {LINE_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ze-grid-btns" style={{ alignItems: 'center' }}>
        <button className="ze-gridbtn" title="Add netclass" onClick={add}>
          <Icon name="plus" />
        </button>
        <button className="ze-gridbtn" title="Move up" disabled={sel <= 1} onClick={() => move(-1)}>
          <Icon name="arrowUp" />
        </button>
        <button
          className="ze-gridbtn"
          title="Move down"
          disabled={sel === 0 || sel >= value.classes.length - 1}
          onClick={() => move(1)}
        >
          <Icon name="arrowDown" />
        </button>
        <span style={{ width: 15 }} />
        <button
          className="ze-gridbtn"
          title="Remove netclass"
          disabled={isDefault(sel)}
          onClick={remove}
        >
          <Icon name="delete" />
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ze-muted, #888)' }}>
          Set color to transparent to use layer default color.
        </span>
        {/* Stubbed: copies net colors from the schematic's netclass definitions. */}
        <button className="ze-btn sm" title="Not implemented yet" style={{ marginLeft: 12 }}>
          Import colors from schematic
        </button>
      </div>

      {/* Assignments grid */}
      <div style={{ fontSize: 12.5, margin: '8px 0 6px' }}>Netclass Assignments</div>
      <div className="ze-grid-pane" style={{ flex: '1 1 45%', minHeight: 60 }}>
        <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col />
            <col style={{ width: 200 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Net Class</th>
            </tr>
          </thead>
          <tbody>
            {value.assignments.map((a, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    value={a.pattern}
                    placeholder="e.g. /CLK*"
                    onChange={(e) =>
                      setAssign(
                        value.assignments.map((x, j) =>
                          j === i ? { ...x, pattern: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    className="ze-grid-input"
                    value={a.netClass}
                    onChange={(e) =>
                      setAssign(
                        value.assignments.map((x, j) =>
                          j === i ? { ...x, netClass: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {value.classes.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ze-grid-btns">
        <button
          className="ze-gridbtn"
          title="Add assignment"
          onClick={() => setAssign([...value.assignments, { pattern: '', netClass: 'Default' }])}
        >
          <Icon name="plus" />
        </button>
        <span style={{ width: 15 }} />
        <button
          className="ze-gridbtn"
          title="Remove assignment"
          disabled={value.assignments.length === 0}
          onClick={() => setAssign(value.assignments.slice(0, -1))}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}
