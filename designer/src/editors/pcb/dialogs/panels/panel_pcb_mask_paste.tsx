/**
 * Board Setup > Board Stackup > Solder Mask/Paste. Counterpart:
 * `pcbnew/dialogs/panel_setup_mask_and_paste_base.cpp` (PANEL_SETUP_MASK_AND_PASTE) —
 * two groups: Solder Mask Settings (expansion, minimum web width, mask-to-copper
 * clearance, tent vias front/back) and Solder Paste Settings (clearance, relative
 * clearance %). Board-wide defaults applied to pads unless overridden.
 */

import type { JSX } from 'react';
import type { MaskPaste } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultMaskPaste, type MaskPaste } from '../../board_settings.js';

interface Props {
  value: MaskPaste;
  onChange: (next: MaskPaste) => void;
}

// Plain bold section labels (no groupbox), matching pcbnew's mask/paste page.
const sec: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, margin: '2px 0 8px' };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 90px max-content',
  alignItems: 'center',
  gap: '8px 8px',
  fontSize: 12.5,
};

export function PanelPcbMaskPaste({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const set = <K extends keyof MaskPaste>(k: K, v: MaskPaste[K]): void =>
    onChange({ ...value, [k]: v });

  const numRow = (label: string, key: keyof MaskPaste, unit: string): JSX.Element => (
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

  return (
    <div style={{ padding: '2px 2px', maxWidth: 560 }}>
      <div className="ze-muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '2px 0 14px' }}>
        Consult your PCB manufacturer&rsquo;s specifications for solder mask expansion, web width,
        and clearance settings.
      </div>

      <div style={sec}>Solder Mask Settings</div>
      <div style={grid}>
        {numRow('Solder mask expansion:', 'maskExpansionMM', 'mm')}
        {numRow('Solder mask minimum web width:', 'maskMinWebMM', 'mm')}
        {numRow('Solder mask to copper clearance:', 'maskToCopperMM', 'mm')}
      </div>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, margin: '8px 0' }}
      >
        <input
          type="checkbox"
          checked={value.allowBridged}
          onChange={(e) => set('allowBridged', e.target.checked)}
        />
        Allow bridged solder mask apertures between pads within footprints
      </label>
      <div style={{ ...grid, gridTemplateColumns: 'max-content max-content', marginTop: 2 }}>
        <span>Tent vias:</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              checked={value.tentFront}
              onChange={(e) => set('tentFront', e.target.checked)}
            />
            Front
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              checked={value.tentBack}
              onChange={(e) => set('tentBack', e.target.checked)}
            />
            Back
          </label>
        </div>
      </div>

      <div style={{ ...sec, marginTop: 18 }}>Solder Paste Settings</div>
      <div style={grid}>
        {numRow('Solder paste clearance:', 'pasteClearanceMM', 'mm')}
        {numRow('Solder paste relative clearance:', 'pasteRelativePct', '%')}
      </div>
      <div className="ze-muted" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 8 }}>
        Note: Solder paste clearances (absolute and relative) are added to determine the final
        clearance.
      </div>
    </div>
  );
}
