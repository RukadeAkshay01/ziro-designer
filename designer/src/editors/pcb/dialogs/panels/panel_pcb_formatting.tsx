/**
 * Board Setup > Text & Graphics > Formatting. Counterpart:
 * `pcbnew/dialogs/panel_setup_formatting_base.cpp` (PANEL_SETUP_FORMATTING) —
 * two groups:
 *   Dashed Lines               : dash length / gap length (ratios of line width).
 *   When Adding Footprints to Board : apply board defaults to a footprint's
 *                                     fields / text / non-copper shapes /
 *                                     dimensions / barcodes.
 */

import type { JSX } from 'react';
import type { PcbFormatting } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultPcbFormatting, type PcbFormatting } from '../../board_settings.js';

interface Props {
  value: PcbFormatting;
  onChange: (next: PcbFormatting) => void;
}

const box: React.CSSProperties = {
  border: '1px solid var(--chrome-border)',
  borderRadius: 4,
  padding: '4px 10px 8px',
  margin: '0 0 12px',
  maxWidth: 460,
};
const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
const check: React.CSSProperties = { display: 'block', margin: '5px 0', fontSize: 12.5 };

export function PanelPcbFormatting({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof PcbFormatting>(k: K, val: PcbFormatting[K]): void =>
    onChange({ ...value, [k]: val });
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const APPLY: { key: keyof PcbFormatting; label: string }[] = [
    { key: 'applyFields', label: 'Apply board defaults to footprint fields' },
    { key: 'applyText', label: 'Apply board defaults to footprint text' },
    { key: 'applyShapes', label: 'Apply board defaults to non-copper footprint shapes' },
    { key: 'applyDimensions', label: 'Apply board defaults to footprint dimensions' },
    { key: 'applyBarcodes', label: 'Apply board defaults to footprint barcodes' },
  ];

  return (
    <div style={{ padding: '2px 2px' }}>
      <fieldset style={box}>
        <legend style={legend}>Dashed Lines</legend>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 68px',
            alignItems: 'center',
            gap: '6px 8px',
            fontSize: 12.5,
          }}
        >
          <span>Dash length:</span>
          <input
            className="ze-search"
            type="number"
            style={{ width: 68 }}
            value={value.dashLengthRatio}
            onChange={(e) => set('dashLengthRatio', num(e.target.value))}
          />
          <span>Gap length:</span>
          <input
            className="ze-search"
            type="number"
            style={{ width: 68 }}
            value={value.gapLengthRatio}
            onChange={(e) => set('gapLengthRatio', num(e.target.value))}
          />
        </div>
        <div className="ze-muted" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 6 }}>
          Dash and dot lengths are ratios of the line width.
        </div>
      </fieldset>

      <fieldset style={box}>
        <legend style={legend}>When Adding Footprints to Board</legend>
        {APPLY.map((a) => (
          <label key={a.key} style={check}>
            <input
              type="checkbox"
              checked={value[a.key] as boolean}
              onChange={(e) => set(a.key, e.target.checked)}
            />{' '}
            {a.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
