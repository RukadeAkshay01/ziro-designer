/**
 * Schematic Setup > Annotation. Counterpart:
 * `eeschema/dialogs/panel_eeschema_annotation_options_base.cpp`
 * (PANEL_EESCHEMA_ANNOTATION_OPTIONS) — the annotation defaults, laid out as
 * three underlined sections in a single left column:
 *   Units     : Symbol unit notation dropdown.
 *   Order     : sort symbols by X or Y position (mutually exclusive).
 *   Numbering : first-free / sheet x100 / sheet x1000, plus "Allow reference reuse".
 *
 * These map to eeschema's annotation settings (m_choiceSeparatorRefId, sort
 * order, numbering start method, and refdes reuse).
 */

import type { JSX } from 'react';
import { SYMBOL_UNIT_NOTATIONS, type AnnotationSettings } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export {
  SYMBOL_UNIT_NOTATIONS,
  defaultAnnotation,
  type AnnotateSortOrder,
  type AnnotateNumbering,
  type AnnotationSettings,
} from '../../schematic_settings.js';

interface Props {
  value: AnnotationSettings;
  onChange: (next: AnnotationSettings) => void;
}

const sectionLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, margin: '2px 0 0' };
const rule: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid var(--chrome-border)',
  margin: '2px 0 6px',
};
const radioRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '4px 0',
  fontSize: 12.5,
};

export function PanelEeschemaAnnotationOptions({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof AnnotationSettings>(k: K, v: AnnotationSettings[K]): void =>
    onChange({ ...value, [k]: v });

  return (
    <div style={{ maxWidth: 460 }}>
      {/* Units */}
      <div style={sectionLabel}>Units</div>
      <hr style={rule} />
      <div style={{ ...radioRow, gap: 10 }}>
        <span>Symbol unit notation:</span>
        <span style={{ flex: 1 }} />
        <select
          className="ze-select"
          style={{ minWidth: 90 }}
          value={value.symbolUnitNotation}
          onChange={(e) => set('symbolUnitNotation', Number(e.target.value))}
        >
          {SYMBOL_UNIT_NOTATIONS.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Order */}
      <div style={{ ...sectionLabel, marginTop: 15 }}>Order</div>
      <hr style={rule} />
      <label style={radioRow}>
        <input
          type="radio"
          name="annSort"
          checked={value.sortOrder === 'x'}
          onChange={() => set('sortOrder', 'x')}
        />
        Sort symbols by X position
      </label>
      <label style={radioRow}>
        <input
          type="radio"
          name="annSort"
          checked={value.sortOrder === 'y'}
          onChange={() => set('sortOrder', 'y')}
        />
        Sort symbols by Y position
      </label>

      {/* Numbering */}
      <div style={{ ...sectionLabel, marginTop: 15 }}>Numbering</div>
      <hr style={rule} />
      <div style={radioRow}>
        <input
          type="radio"
          name="annNum"
          checked={value.numbering === 'firstFree'}
          onChange={() => set('numbering', 'firstFree')}
        />
        <span>Use first free number after:</span>
        <input
          className="ze-search"
          type="number"
          style={{ width: 60 }}
          value={value.firstFreeAfter}
          onChange={(e) => set('firstFreeAfter', Number(e.target.value))}
        />
      </div>
      <label style={radioRow}>
        <input
          type="radio"
          name="annNum"
          checked={value.numbering === 'sheetX100'}
          onChange={() => set('numbering', 'sheetX100')}
        />
        First free after sheet number X 100
      </label>
      <label style={radioRow}>
        <input
          type="radio"
          name="annNum"
          checked={value.numbering === 'sheetX1000'}
          onChange={() => set('numbering', 'sheetX1000')}
        />
        First free after sheet number X 1000
      </label>
      <label style={radioRow}>
        <input
          type="checkbox"
          checked={value.allowReuse}
          onChange={(e) => set('allowReuse', e.target.checked)}
        />
        Allow reference reuse
      </label>
    </div>
  );
}
