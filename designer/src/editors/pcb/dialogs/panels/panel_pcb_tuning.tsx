/**
 * Board Setup > Design Rules > Length-tuning Patterns. Counterpart:
 * `pcbnew/dialogs/panel_setup_tuning_patterns_base.cpp` (PANEL_SETUP_TUNING_PATTERNS)
 * — three groups stacked vertically (Single Track Tuning, Differential Pairs,
 * Differential Pair Skews), each an illustration + fields: minimum/maximum
 * amplitude, spacing, corner style (chamfer/fillet), radius (% of amplitude),
 * and single-sided. Defaults are PNS::MEANDER_SETTINGS (pns_meander.cpp).
 * Illustrations are KiCad's own dark-theme SVGs (BITMAPS::tune_*_legend).
 */

import type { JSX } from 'react';

const TUNE_ICON = import.meta.glob('../../../../assets/tuning/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const icon = (name: string): string | undefined =>
  TUNE_ICON[`../../../../assets/tuning/${name}.svg`];

import type { CornerStyle, TuningPattern, TuningSetup } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTuning,
  type CornerStyle,
  type TuningPattern,
  type TuningSetup,
} from '../../board_settings.js';

interface Props {
  value: TuningSetup;
  onChange: (next: TuningSetup) => void;
}

const legend: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, margin: '2px 0 6px' };
// Two field columns: (Min amplitude, Spacing, Corner style, Single-sided) on the
// left; (Max amplitude, Radius) on the right — aligned row-for-row, as upstream.
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 66px max-content 28px max-content 66px max-content',
  alignItems: 'center',
  gap: '8px 6px',
  fontSize: 12,
};

export function PanelPcbTuning({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const column = (title: string, key: keyof TuningSetup, img: string): JSX.Element => {
    const s = value[key];
    const set = <K extends keyof TuningPattern>(k: K, v: TuningPattern[K]): void =>
      onChange({ ...value, [key]: { ...s, [k]: v } });
    const field = (label: string, k: keyof TuningPattern, unit: string): JSX.Element => (
      <>
        <span>{label}</span>
        <input
          className="ze-search"
          type="number"
          style={{ width: '100%', boxSizing: 'border-box' }}
          value={s[k] as number}
          onChange={(e) => set(k, num(e.target.value) as never)}
        />
        <span className="ze-muted" style={{ fontSize: 11 }}>
          {unit}
        </span>
      </>
    );
    const gap = <span />;
    const src = icon(img);
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={legend}>{title}</div>
        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
          {src && (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              style={{ width: 160, flex: '0 0 auto', opacity: 0.9 }}
            />
          )}
          <div style={grid}>
            {/* Row 1: Minimum amplitude | Maximum amplitude */}
            {field('Minimum amplitude (A):', 'minAmplitudeMM', 'mm')}
            {gap}
            {field('Maximum amplitude (A):', 'maxAmplitudeMM', 'mm')}

            {/* Row 2: Spacing | — */}
            {field('Spacing (s):', 'spacingMM', 'mm')}
            {gap}
            {gap}
            {gap}
            {gap}

            {/* Row 3: Corner style | Radius */}
            <span>Corner style:</span>
            <select
              className="ze-select"
              style={{ width: '100%', gridColumn: '2 / 4' }}
              value={s.cornerStyle}
              onChange={(e) => set('cornerStyle', e.target.value as CornerStyle)}
            >
              <option>Chamfer</option>
              <option>Fillet</option>
            </select>
            {gap}
            {field('Radius (r):', 'radiusPct', '%')}

            {/* Row 4: Single-sided, under the left-column input boxes. */}
            <label
              style={{
                gridColumn: '2 / 8',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={s.singleSided}
                onChange={(e) => set('singleSided', e.target.checked)}
              />
              Single-sided
            </label>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '2px 2px' }}>
      {column(
        'Default Properties for Single Track Tuning',
        'singleTrack',
        'tune_single_track_length_legend',
      )}
      {column(
        'Default Properties for Differential Pairs',
        'diffPair',
        'tune_diff_pair_length_legend',
      )}
      {column(
        'Default Properties for Differential Pair Skews',
        'diffPairSkew',
        'tune_diff_pair_skew_legend',
      )}
    </div>
  );
}
