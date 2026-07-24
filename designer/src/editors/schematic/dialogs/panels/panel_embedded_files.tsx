/**
 * Embedded Files panel. Counterpart:
 * `common/dialogs/panel_embedded_files_base.cpp` (PANEL_EMBEDDED_FILES) — a
 * read-only "Filename / Embedded Reference" grid, then a button row: add
 * (browse), remove, an "Embed fonts" checkbox, and Export. Files stored in the
 * schematic are referenced elsewhere as ${EMBED_...}.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type { EmbeddedFilesData } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export {
  defaultEmbeddedFiles,
  type EmbeddedFile,
  type EmbeddedFilesData,
} from '../../schematic_settings.js';

interface Props {
  value: EmbeddedFilesData;
  onChange: (next: EmbeddedFilesData) => void;
}

export function PanelEmbeddedFiles({ value, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState<number | null>(value.files.length ? 0 : null);

  const removeSel = (): void => {
    if (sel === null) return;
    onChange({ ...value, files: value.files.filter((_, j) => j !== sel) });
    setSel(value.files.length - 2 >= 0 ? Math.min(sel, value.files.length - 2) : null);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
        <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '40%' }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Embedded Reference</th>
            </tr>
          </thead>
          <tbody>
            {value.files.map((f, i) => (
              <tr
                key={i}
                className={i === sel ? 'selected' : undefined}
                onMouseDown={() => setSel(i)}
              >
                <td>
                  <span className="ze-grid-input" style={{ display: 'block' }}>
                    {f.name}
                  </span>
                </td>
                <td>
                  <span className="ze-grid-input" style={{ display: 'block' }}>
                    {f.reference}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ze-grid-btns" style={{ alignItems: 'center' }}>
        <button className="ze-gridbtn" title="Add embedded file">
          <Icon name="plus" />
        </button>
        <span style={{ width: 15 }} />
        <button
          className="ze-gridbtn"
          title="Remove embedded file"
          disabled={sel === null}
          onClick={removeSel}
        >
          <Icon name="delete" />
        </button>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={value.embedFonts}
            onChange={(e) => onChange({ ...value, embedFonts: e.target.checked })}
          />
          Embed fonts
        </label>
        <span style={{ flex: 1 }} />
        <button className="ze-btn" title="Export embedded files">
          Export…
        </button>
      </div>
    </div>
  );
}
