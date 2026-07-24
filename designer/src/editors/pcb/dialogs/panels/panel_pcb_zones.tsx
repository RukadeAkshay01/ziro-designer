/**
 * Board Setup > Design Rules > Zones. Counterpart:
 * `pcbnew/dialogs/panel_setup_zones_base.cpp` + the embedded PANEL_ZONE_PROPERTIES —
 * "Default Properties for New Zones": the settings a newly drawn copper zone
 * starts with (clearance, minimum width, pad connection + thermal relief, outline
 * display, corner smoothing, island removal).
 */

import type { JSX } from 'react';
import type { ZoneDefaults } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultZones, type ZoneDefaults } from '../../board_settings.js';

const PAD_CONNECTIONS = ['Solid', 'Thermal reliefs', 'Reliefs for PTH', 'None'];
const OUTLINE_DISPLAY = ['Line', 'Hatched', 'Fully hatched'];
const CORNER_SMOOTHING = ['None', 'Chamfer', 'Fillet'];
const REMOVE_ISLANDS = ['Always', 'Never', 'Below area limit'];

interface Props {
  value: ZoneDefaults;
  onChange: (next: ZoneDefaults) => void;
}

const col: React.CSSProperties = { flex: 1, minWidth: 0 };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr max-content',
  alignItems: 'center',
  gap: '8px 8px',
  fontSize: 12.5,
};

export function PanelPcbZones({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const set = <K extends keyof ZoneDefaults>(k: K, v: ZoneDefaults[K]): void =>
    onChange({ ...value, [k]: v });

  const numRow = (label: string, key: keyof ZoneDefaults, unit: string): JSX.Element => (
    <>
      <span>{label}</span>
      <input
        className="ze-search"
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={value[key] as number}
        onChange={(e) => set(key, num(e.target.value) as never)}
      />
      <span className="ze-muted" style={{ fontSize: 11 }}>
        {unit}
      </span>
    </>
  );
  const selRow = (label: string, key: keyof ZoneDefaults, options: string[]): JSX.Element => (
    <>
      <span>{label}</span>
      <select
        className="ze-select"
        style={{ width: '100%', gridColumn: '2 / 4' }}
        value={value[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </>
  );

  return (
    <div style={{ padding: '2px 2px' }}>
      <div style={{ fontSize: 12.5, marginBottom: 4 }}>Default Properties for New Zones</div>
      <hr
        style={{
          border: 'none',
          borderTop: '1px solid var(--chrome-border)',
          margin: '2px 0 12px',
        }}
      />
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        <div style={col}>
          <div style={grid}>
            <span>Zone name:</span>
            <input
              className="ze-search"
              style={{ width: '100%', gridColumn: '2 / 4', boxSizing: 'border-box' }}
              value={value.name}
              onChange={(e) => set('name', e.target.value)}
            />
            {numRow('Clearance:', 'clearanceMM', 'mm')}
            {numRow('Minimum width:', 'minWidthMM', 'mm')}
            {selRow('Pad connections:', 'padConnection', PAD_CONNECTIONS)}
            {numRow('Thermal relief gap:', 'thermalGapMM', 'mm')}
            {numRow('Thermal spoke width:', 'thermalSpokeMM', 'mm')}
          </div>
        </div>

        <div style={col}>
          <div style={grid}>
            {selRow('Outline display:', 'outlineDisplay', OUTLINE_DISPLAY)}
            {numRow('Outline hatch pitch:', 'outlineHatchPitchMM', 'mm')}
            {selRow('Corner smoothing:', 'cornerSmoothing', CORNER_SMOOTHING)}
            {numRow('Radius:', 'smoothingRadiusMM', 'mm')}
            {selRow('Remove islands:', 'removeIslands', REMOVE_ISLANDS)}
            {numRow('Area limit:', 'areaLimitMM2', 'mm²')}
          </div>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginTop: 10 }}
          >
            <input
              type="checkbox"
              checked={value.locked}
              onChange={(e) => set('locked', e.target.checked)}
            />
            Locked
          </label>
        </div>
      </div>
    </div>
  );
}
