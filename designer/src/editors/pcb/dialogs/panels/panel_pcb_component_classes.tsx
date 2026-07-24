/**
 * Board Setup > Design Rules > Component Classes. Counterpart:
 * `pcbnew/dialogs/panel_assign_component_classes_base.cpp`
 * (PANEL_ASSIGN_COMPONENT_CLASSES + PANEL_COMPONENT_CLASS_ASSIGNMENT) — an
 * "Assign component class per sheet" option and a list of custom assignments.
 * Each assignment names a component class, a Match all / Match any mode, and a
 * set of conditions (Reference / Side / Rotation / Footprint) that select the
 * footprints it applies to.
 */

import type { JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type {
  ClassCondition,
  ComponentClassAssignment,
  ComponentClassesData,
  ConditionType,
} from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultComponentClasses,
  type ClassCondition,
  type ComponentClassAssignment,
  type ComponentClassesData,
  type ConditionType,
} from '../../board_settings.js';

const CONDITION_TYPES: ConditionType[] = ['Reference', 'Side', 'Rotation', 'Footprint'];

interface Props {
  value: ComponentClassesData;
  onChange: (next: ComponentClassesData) => void;
}

export function PanelPcbComponentClasses({ value, onChange }: Props): JSX.Element {
  const setAssignments = (assignments: ComponentClassAssignment[]): void =>
    onChange({ ...value, assignments });
  const setAssignment = (i: number, patch: Partial<ComponentClassAssignment>): void =>
    setAssignments(value.assignments.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const addAssignment = (): void =>
    setAssignments([
      ...value.assignments,
      { componentClass: '', matchMode: 'all', conditions: [{ type: 'Reference', value: '' }] },
    ]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          margin: '4px 0 10px',
          fontSize: 12.5,
        }}
      >
        <input
          type="checkbox"
          checked={value.assignPerSheet}
          onChange={(e) => onChange({ ...value, assignPerSheet: e.target.checked })}
        />
        Assign component class per sheet
      </label>
      <hr
        style={{ border: 'none', borderTop: '1px solid var(--chrome-border)', margin: '0 0 10px' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, fontSize: 12.5 }}>
        <span>Custom Assignments:</span>
        <span style={{ flex: 1 }} />
        <button className="ze-btn sm" onClick={addAssignment}>
          Add Custom Assignment
        </button>
      </div>

      {/* Assignment cards */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {value.assignments.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ze-muted, #888)',
              fontSize: 12.5,
            }}
          >
            No custom assignments. Use “Add Custom Assignment” to create one.
          </div>
        ) : (
          value.assignments.map((a, i) => {
            const setConditions = (conditions: ClassCondition[]): void =>
              setAssignment(i, { conditions });
            return (
              <div
                key={i}
                style={{
                  border: '1px solid var(--chrome-border)',
                  borderRadius: 4,
                  background: 'var(--chrome-bg2)',
                  padding: 10,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span>Component class:</span>
                  <input
                    className="ze-search"
                    style={{ width: 180, boxSizing: 'border-box' }}
                    value={a.componentClass}
                    onChange={(e) => setAssignment(i, { componentClass: e.target.value })}
                  />
                  <span style={{ flex: 1 }} />
                  <button className="ze-btn sm" title="Not implemented yet">
                    Highlight matching footprints
                  </button>
                  <button
                    className="ze-gridbtn"
                    title="Delete assignment"
                    onClick={() => setAssignments(value.assignments.filter((_, j) => j !== i))}
                  >
                    <Icon name="delete" />
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 16, margin: '8px 0', fontSize: 12.5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="radio"
                      name={`match-${i}`}
                      checked={a.matchMode === 'all'}
                      onChange={() => setAssignment(i, { matchMode: 'all' })}
                    />
                    Match all
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="radio"
                      name={`match-${i}`}
                      checked={a.matchMode === 'any'}
                      onChange={() => setAssignment(i, { matchMode: 'any' })}
                    />
                    Match any
                  </label>
                </div>

                {/* Condition rows */}
                {a.conditions.map((c, ci) => (
                  <div
                    key={ci}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      margin: '5px 0',
                      fontSize: 12.5,
                    }}
                  >
                    <select
                      className="ze-select"
                      style={{ width: 130 }}
                      value={c.type}
                      onChange={(e) =>
                        setConditions(
                          a.conditions.map((x, j) =>
                            j === ci ? { ...x, type: e.target.value as ConditionType } : x,
                          ),
                        )
                      }
                    >
                      {CONDITION_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    {c.type === 'Side' ? (
                      <select
                        className="ze-select"
                        style={{ flex: 1 }}
                        value={c.value || 'Front'}
                        onChange={(e) =>
                          setConditions(
                            a.conditions.map((x, j) =>
                              j === ci ? { ...x, value: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option>Front</option>
                        <option>Back</option>
                      </select>
                    ) : (
                      <input
                        className="ze-search"
                        style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }}
                        value={c.value}
                        placeholder={
                          c.type === 'Rotation'
                            ? 'degrees'
                            : c.type === 'Footprint'
                              ? 'Library:Footprint'
                              : 'e.g. R*'
                        }
                        onChange={(e) =>
                          setConditions(
                            a.conditions.map((x, j) =>
                              j === ci ? { ...x, value: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    )}
                    <button
                      className="ze-gridbtn"
                      title="Delete row"
                      onClick={() => setConditions(a.conditions.filter((_, j) => j !== ci))}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                ))}
                <button
                  className="ze-btn sm"
                  style={{ marginTop: 4 }}
                  onClick={() => setConditions([...a.conditions, { type: 'Reference', value: '' }])}
                >
                  + Add condition
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
