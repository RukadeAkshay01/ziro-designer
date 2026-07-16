/**
 * Violation Severity panel. Counterpart: `common/dialogs/panel_setup_severities.cpp`
 * (PANEL_SETUP_SEVERITIES) as used by the Schematic Setup dialog — one row per
 * ERC rule with an Error / Warning / Ignore choice. The chosen severities feed
 * straight into runErc.
 */

import type { JSX } from 'react';
import { ERC_ITEMS, type ErcSettings, type ErcSeverityLevel } from '@ziroeda/eeschema';

interface Props {
  settings: ErcSettings;
  onChange: (next: ErcSettings) => void;
}

const LEVELS: { id: ErcSeverityLevel; label: string }[] = [
  { id: 'error', label: 'Error' },
  { id: 'warning', label: 'Warning' },
  { id: 'ignore', label: 'Ignore' },
];

export function PanelSetupSeverities({ settings, onChange }: Props): JSX.Element {
  const set = (code: (typeof ERC_ITEMS)[number]['code'], level: ErcSeverityLevel): void => {
    onChange({ ...settings, severities: { ...settings.severities, [code]: level } });
  };

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Electrical Rules</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {ERC_ITEMS.map(({ code, title }) => (
          <div
            key={code}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '3px 0',
            }}
          >
            <span style={{ fontSize: 12, flex: 1 }}>{title}</span>
            <div style={{ display: 'flex', gap: 10, flex: '0 0 auto' }}>
              {LEVELS.map((lv) => (
                <label key={lv.id} style={{ fontSize: 12, display: 'flex', gap: 3 }}>
                  <input
                    type="radio"
                    name={`sev-${code}`}
                    checked={settings.severities[code] === lv.id}
                    onChange={() => set(code, lv.id)}
                  />
                  {lv.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
