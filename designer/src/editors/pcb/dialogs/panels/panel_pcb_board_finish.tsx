/**
 * Board Setup > Board Stackup > Board Finish. Counterpart:
 * `pcbnew/board_stackup_manager/panel_board_finish_base.cpp` (PANEL_SETUP_BOARD_FINISH) —
 * plated-board-edge flag, copper finish (from the predefined list in
 * stackup_predefined_prms.cpp), and edge-card-connector option. Feeds the
 * .gbrjob fabrication file.
 */

import type { JSX } from 'react';
import { COPPER_FINISHES, type BoardFinish } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { COPPER_FINISHES, defaultBoardFinish, type BoardFinish } from '../../board_settings.js';

const EDGE_CARD = ['None', 'Yes', 'Yes, bevelled'];

interface Props {
  value: BoardFinish;
  onChange: (next: BoardFinish) => void;
}

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 200px',
  alignItems: 'center',
  gap: '10px 10px',
  fontSize: 12.5,
};

export function PanelPcbBoardFinish({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof BoardFinish>(k: K, v: BoardFinish[K]): void =>
    onChange({ ...value, [k]: v });

  return (
    <div style={{ padding: '4px 2px', maxWidth: 460 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 14px' }}>
        <input
          type="checkbox"
          checked={value.platedBoardEdge}
          onChange={(e) => set('platedBoardEdge', e.target.checked)}
        />
        Plated board edge
      </label>

      <div style={grid}>
        <span>Copper finish:</span>
        <select
          className="ze-select"
          style={{ width: '100%' }}
          value={value.copperFinish}
          onChange={(e) => set('copperFinish', e.target.value)}
        >
          {COPPER_FINISHES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>

        <span>Edge card connectors:</span>
        <select
          className="ze-select"
          style={{ width: '100%' }}
          value={value.edgeCardConnectors}
          onChange={(e) => set('edgeCardConnectors', e.target.value)}
          title="Options for edge card connectors."
        >
          {EDGE_CARD.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
