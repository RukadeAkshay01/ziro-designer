/**
 * Board Setup > Design Rules > Tuning Profiles. Counterpart:
 * `pcbnew/dialogs/panel_setup_tuning_profiles_base.cpp` (PANEL_SETUP_TUNING_PROFILES) —
 * a notebook of tuning profiles (add/remove at the bottom), each tab a
 * PANEL_SETUP_TUNING_PROFILE_INFO form: Name, Type (single/differential), target
 * impedance, frequency, and — when time-domain tuning is enabled — the track/via
 * propagation delay settings. The deep via-delay-override matrix is not modelled
 * here yet.
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type {
  FreqUnit,
  ProfileType,
  TuningProfile,
  TuningProfilesData,
} from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTuningProfiles,
  type FreqUnit,
  type ProfileType,
  type TuningProfile,
  type TuningProfilesData,
} from '../../board_settings.js';

const FREQ_UNITS: FreqUnit[] = ['Hz', 'kHz', 'MHz', 'GHz'];

function blankProfile(name: string): TuningProfile {
  return {
    name,
    type: 'Single',
    targetImpedance: 50,
    frequency: 1,
    frequencyUnit: 'GHz',
    enableTimeDomain: false,
    modelSolderMask: true,
    globalUnitDelay: 0,
  };
}

interface Props {
  value: TuningProfilesData;
  onChange: (next: TuningProfilesData) => void;
}

const tab = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px',
  fontSize: 12.5,
  border: '1px solid var(--chrome-border)',
  borderBottom: active ? '1px solid var(--chrome-bg)' : '1px solid var(--chrome-border)',
  background: active ? 'var(--chrome-bg)' : 'var(--chrome-bg2)',
  borderTopLeftRadius: 4,
  borderTopRightRadius: 4,
  cursor: 'pointer',
  marginBottom: -1,
  whiteSpace: 'nowrap',
});
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 120px max-content',
  alignItems: 'center',
  gap: '9px 8px',
  fontSize: 12.5,
};

export function PanelPcbTuningProfiles({ value, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState(0);
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const profiles = value.profiles;
  const cur = profiles[Math.min(sel, profiles.length - 1)];

  const setProfiles = (next: TuningProfile[]): void => onChange({ profiles: next });
  const set = <K extends keyof TuningProfile>(k: K, v: TuningProfile[K]): void => {
    if (!cur) return;
    const i = Math.min(sel, profiles.length - 1);
    setProfiles(profiles.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  };
  const add = (): void => {
    setProfiles([...profiles, blankProfile(`Profile ${profiles.length + 1}`)]);
    setSel(profiles.length);
  };
  const remove = (): void => {
    if (!profiles.length) return;
    const i = Math.min(sel, profiles.length - 1);
    setProfiles(profiles.filter((_, j) => j !== i));
    setSel(Math.max(0, i - 1));
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Notebook tabs (only when there are profiles) */}
      {profiles.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 3,
            borderBottom: '1px solid var(--chrome-border)',
            minHeight: 26,
            overflowX: 'auto',
          }}
        >
          {profiles.map((p, i) => (
            <div key={i} style={tab(i === sel)} onClick={() => setSel(i)}>
              {p.name || '(unnamed)'}
            </div>
          ))}
        </div>
      )}

      {/* Selected profile form, or a centered empty state */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 4px' }}>
        {cur ? (
          <div style={{ maxWidth: 460 }}>
            <div style={grid}>
              <span>Name:</span>
              <input
                className="ze-search"
                style={{ width: '100%', gridColumn: '2 / 4', boxSizing: 'border-box' }}
                value={cur.name}
                onChange={(e) => set('name', e.target.value)}
              />
              <span>Type:</span>
              <select
                className="ze-select"
                style={{ width: '100%', gridColumn: '2 / 4' }}
                value={cur.type}
                onChange={(e) => set('type', e.target.value as ProfileType)}
              >
                <option>Single</option>
                <option>Differential</option>
              </select>
              <span>Target impedance:</span>
              <input
                className="ze-search"
                type="number"
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={cur.targetImpedance}
                onChange={(e) => set('targetImpedance', num(e.target.value))}
              />
              <span className="ze-muted" style={{ fontSize: 11 }}>
                ohms
              </span>
              <span>Frequency:</span>
              <input
                className="ze-search"
                type="number"
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={cur.frequency}
                onChange={(e) => set('frequency', num(e.target.value))}
              />
              <select
                className="ze-select"
                value={cur.frequencyUnit}
                onChange={(e) => set('frequencyUnit', e.target.value as FreqUnit)}
              >
                {FREQ_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 6px' }}>
              <input
                type="checkbox"
                checked={cur.enableTimeDomain}
                onChange={(e) => set('enableTimeDomain', e.target.checked)}
              />
              Enable time domain tuning
            </label>

            {cur.enableTimeDomain && (
              <div style={{ paddingLeft: 18 }}>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 10px' }}
                >
                  <input
                    type="checkbox"
                    checked={cur.modelSolderMask}
                    onChange={(e) => set('modelSolderMask', e.target.checked)}
                  />
                  Model Solder Mask
                </label>
                <div style={grid}>
                  <span>Global unit delay:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    value={cur.globalUnitDelay}
                    onChange={(e) => set('globalUnitDelay', num(e.target.value))}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    ps/cm
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
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
            No tuning profiles defined. Use the + button below to add one.
          </div>
        )}
      </div>

      {/* Add / remove profile */}
      <div className="ze-grid-btns">
        <button className="ze-gridbtn" title="Add tuning profile" onClick={add}>
          <Icon name="plus" />
        </button>
        <span style={{ width: 15 }} />
        <button
          className="ze-gridbtn"
          title="Remove tuning profile"
          disabled={!profiles.length}
          onClick={remove}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}
