/**
 * Board Setup > Violation Severity. Counterpart: `common/dialogs/
 * panel_setup_severities.cpp` (PANEL_SETUP_SEVERITIES) as used by DIALOG_BOARD_SETUP
 * with DRC_ITEM::GetItemsWithSeverities(). One row per DRC rule with an
 * Error / Warning / Ignore choice, grouped under KiCad's bold category headings
 * (drc_item.cpp: Electrical / Design for Manufacturing / Schematic Parity /
 * Signal Integrity / Readability / Miscellaneous). A zero-code heading row is a
 * section title, exactly as upstream builds the list.
 */

import type { JSX } from 'react';

import type { DrcSeverities, DrcSeverity } from '../../board_settings.js';
import { DRC_CATEGORIES } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  DRC_CATEGORIES,
  defaultDrcSeverities,
  type DrcSeverities,
  type DrcSeverity,
} from '../../board_settings.js';

interface Props {
  value: DrcSeverities;
  onChange: (next: DrcSeverities) => void;
}

const LEVELS: { id: DrcSeverity; label: string }[] = [
  { id: 'error', label: 'Error' },
  { id: 'warning', label: 'Warning' },
  { id: 'ignore', label: 'Ignore' },
];

export function PanelPcbSeverities({ value, onChange }: Props): JSX.Element {
  const set = (code: string, level: DrcSeverity): void => onChange({ ...value, [code]: level });

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Violation Severity</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr max-content',
          alignItems: 'center',
          rowGap: 2,
          columnGap: 16,
          fontSize: 12.5,
        }}
      >
        {DRC_CATEGORIES.map((cat) => (
          <div key={cat.heading} style={{ display: 'contents' }}>
            <div style={{ gridColumn: '1 / 3', fontWeight: 700, margin: '10px 0 2px' }}>
              {cat.heading}
            </div>
            {cat.items.map((it) => (
              <div key={it.code} style={{ display: 'contents' }}>
                <span style={{ paddingLeft: 12 }}>{it.title}</span>
                <div style={{ display: 'flex', gap: 14, flex: '0 0 auto' }}>
                  {LEVELS.map((lv) => (
                    <label key={lv.id} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <input
                        type="radio"
                        name={`drc-${it.code}`}
                        checked={(value[it.code] ?? 'error') === lv.id}
                        onChange={() => set(it.code, lv.id)}
                      />
                      {lv.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
