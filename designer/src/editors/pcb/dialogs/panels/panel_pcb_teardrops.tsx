/**
 * Board Setup > Design Rules > Teardrops. Counterpart:
 * `pcbnew/dialogs/panel_setup_teardrops_base.cpp` (PANEL_SETUP_TEARDROPS) — three
 * groups stacked vertically (Round Shapes, Rectangular Shapes, Track-to-Track),
 * each an illustration + two field columns: Best/Maximum length & width and
 * Curved edges on the left; span / prefer-zone / track-width-limit on the right.
 * Best length, best width and the track-width limit are percentages of the pad/
 * via diameter (round) or width (rect/track); maximum length/width are mm.
 * Illustrations are KiCad's own dark-theme SVGs (BITMAPS::teardrop_*_sizes),
 * vendored like assets/constraints.
 */

import type { JSX } from 'react';

const TD_ICON = import.meta.glob('../../../../assets/teardrops/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const icon = (name: string): string | undefined =>
  TD_ICON[`../../../../assets/teardrops/${name}.svg`];

import type { TeardropsSetup, TeardropShape } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTeardrops,
  type TeardropShape,
  type TeardropsSetup,
} from '../../board_settings.js';

interface Props {
  value: TeardropsSetup;
  onChange: (next: TeardropsSetup) => void;
}

const legend: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, margin: '2px 0 6px' };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 60px max-content',
  alignItems: 'center',
  gap: '7px 6px',
  fontSize: 12,
};
const check: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '5px 0',
};

export function PanelPcbTeardrops({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const column = (
    title: string,
    key: keyof TeardropsSetup,
    opts: { img: string; ref: 'd' | 'w'; preferZone: boolean; spanLabel: string; note?: string },
  ): JSX.Element => {
    const s = value[key];
    const pct = `%(${opts.ref})`;
    const set = <K extends keyof TeardropShape>(k: K, v: TeardropShape[K]): void =>
      onChange({ ...value, [key]: { ...s, [k]: v } });
    const numRow = (label: string, k: keyof TeardropShape, unit: string): JSX.Element => (
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
    const src = icon(opts.img);
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={legend}>{title}</div>
        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
          {src && (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              style={{ width: 150, flex: '0 0 auto', opacity: 0.9 }}
            />
          )}
          {/* Left field column: sizes + curved edges. */}
          <div style={{ flex: '0 0 auto' }}>
            <div style={grid}>
              {numRow('Best length (L):', 'bestLengthPct', pct)}
              {numRow('Maximum length (L):', 'maxLengthMM', 'mm')}
              {numRow('Best width (W):', 'bestWidthPct', pct)}
              {numRow('Maximum width (W):', 'maxWidthMM', 'mm')}
            </div>
            <label style={{ ...check, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={s.curvedEdges}
                onChange={(e) => set('curvedEdges', e.target.checked)}
              />
              Curved edges
            </label>
          </div>
          {/* Right field column: span / prefer-zone / track-width-limit. */}
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <label style={check}>
              <input
                type="checkbox"
                checked={s.allowSpanTwoSegments}
                onChange={(e) => set('allowSpanTwoSegments', e.target.checked)}
              />
              {opts.spanLabel}
            </label>
            {opts.preferZone && (
              <label style={check}>
                <input
                  type="checkbox"
                  checked={s.preferZoneConnection}
                  onChange={(e) => set('preferZoneConnection', e.target.checked)}
                />
                Prefer zone connection
              </label>
            )}
            <div style={{ ...grid, marginTop: 6 }}>
              {numRow('Track width limit:', 'trackWidthLimitPct', pct)}
            </div>
            {opts.note && (
              <div className="ze-muted" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 6 }}>
                {opts.note}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '2px 2px' }}>
      {column('Default Properties for Round Shapes', 'round', {
        img: 'teardrop_sizes',
        ref: 'd',
        preferZone: true,
        spanLabel: 'Allow teardrop to span two track segments',
      })}
      {column('Default Properties for Rectangular Shapes', 'rect', {
        img: 'teardrop_rect_sizes',
        ref: 'w',
        preferZone: true,
        spanLabel: 'Allow teardrop to span track segments',
      })}
      {column('Properties for Track-to-Track Teardrops', 'trackToTrack', {
        img: 'teardrop_track_sizes',
        ref: 'w',
        preferZone: false,
        spanLabel: 'Allow teardrop to span track segments',
        note: 'Tracks which are similar in size do not need teardrops.',
      })}
    </div>
  );
}
