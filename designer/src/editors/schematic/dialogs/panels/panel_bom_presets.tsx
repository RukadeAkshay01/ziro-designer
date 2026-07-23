/**
 * BOM Presets panel. Counterpart: `eeschema/dialogs/panel_bom_presets_base.cpp`
 * (PANEL_BOM_PRESETS) — two read-only "Name" grids (Bill of Materials Presets and
 * Bill of Materials Formatting Presets), each with a delete button beneath. Presets
 * are created from the Symbol Fields Table / BOM export; here they are only listed
 * and removed.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type { BomPresets } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export { defaultBomPresets, type BomPresets } from '../../schematic_settings.js';

interface Props {
  value: BomPresets;
  onChange: (next: BomPresets) => void;
}

function PresetGrid({
  title,
  names,
  onDelete,
}: {
  title: string;
  names: string[];
  onDelete: (i: number) => void;
}): JSX.Element {
  const [sel, setSel] = useState<number | null>(names.length ? 0 : null);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 12.5, margin: '4px 0 6px' }}>{title}</div>
      <div style={{ flex: 1, minHeight: 60, overflow: 'auto' }}>
        <table className="ze-grid">
          <thead>
            <tr>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {names.map((nm, i) => (
              <tr
                key={i}
                className={i === sel ? 'selected' : undefined}
                onMouseDown={() => setSel(i)}
              >
                <td>
                  <span className="ze-grid-input" style={{ display: 'block' }}>
                    {nm}
                  </span>
                </td>
              </tr>
            ))}
            {names.length === 0 && (
              <tr>
                <td style={{ padding: '6px', color: 'var(--ze-muted, #888)' }}>
                  No presets defined.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ze-grid-btns">
        <button
          className="ze-gridbtn"
          title="Delete preset"
          disabled={sel === null}
          onClick={() => {
            if (sel === null) return;
            onDelete(sel);
            setSel(names.length - 2 >= 0 ? Math.min(sel, names.length - 2) : null);
          }}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}

export function PanelBomPresets({ value, onChange }: Props): JSX.Element {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <PresetGrid
        title="Bill of Materials Presets"
        names={value.presets}
        onDelete={(i) => onChange({ ...value, presets: value.presets.filter((_, j) => j !== i) })}
      />
      <PresetGrid
        title="Bill of Materials Formatting Presets"
        names={value.fmtPresets}
        onDelete={(i) =>
          onChange({ ...value, fmtPresets: value.fmtPresets.filter((_, j) => j !== i) })
        }
      />
    </div>
  );
}
