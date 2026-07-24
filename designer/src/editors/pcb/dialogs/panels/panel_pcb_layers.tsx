/**
 * Board Setup > Board Stackup > Board Editor Layers. Counterpart:
 * `pcbnew/dialogs/panel_setup_layers.cpp` (PANEL_SETUP_LAYERS) — the board's
 * layers laid out as a vertical form in physical stack order (front technical
 * layers, copper, back technical layers, then Edge.Cuts / Margin / user layers).
 * Each row is [enable checkbox] [editable name] [type]: copper layers get a
 * signal/power/mixed/jumper dropdown, other layers a descriptive label. An
 * "Add User Defined Layer..." button sits top-right.
 */

import { useState, type JSX } from 'react';
import type { BoardLayer, CopperLayerType, LayersSetup } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultLayers,
  type BoardLayer,
  type CopperLayerType,
  type LayersSetup,
} from '../../board_settings.js';

const COPPER_TYPES: CopperLayerType[] = ['signal', 'power', 'mixed', 'jumper'];

interface Props {
  value: LayersSetup;
  onChange: (next: LayersSetup) => void;
}

export function PanelPcbLayers({ value, onChange }: Props): JSX.Element {
  const setAt = (i: number, patch: Partial<BoardLayer>): void =>
    onChange({ layers: value.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  // addUserDefinedLayer: an EDA_LIST_DIALOG of the User.1-45 layers not yet on
  // the board ("Select layer to add:"); the picked one appends, enabled.
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState('');
  const availableUserLayers = Array.from({ length: 45 }, (_, i) => `User.${i + 1}`).filter(
    (id) => !value.layers.some((l) => l.id === id),
  );
  const openAdd = (): void => {
    if (availableUserLayers.length === 0) {
      window.alert('All user-defined layers have already been added.');
      return;
    }
    setAddSel(availableUserLayers[0]!);
    setAddOpen(true);
  };
  const commitAdd = (): void => {
    if (addSel) {
      onChange({
        layers: [
          ...value.layers,
          { id: addSel, name: addSel, enabled: true, kind: 'tech', desc: 'User defined' },
        ],
      });
    }
    setAddOpen(false);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      <div style={{ display: 'flex', marginBottom: 6 }}>
        <span style={{ flex: 1 }} />
        <button className="ze-btn sm" onClick={openAdd}>
          Add User Defined Layer...
        </button>
      </div>
      {addOpen && (
        <div
          className="ze-modal-backdrop"
          onMouseDown={() => setAddOpen(false)}
          style={{ zIndex: 60 }}
        >
          <div
            className="ze-modal"
            style={{ width: 280, height: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ze-modal-header">
              Add User-defined Layer
              <span className="x" title="Close" onClick={() => setAddOpen(false)}>
                ✕
              </span>
            </div>
            <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
              <div style={{ fontSize: 12.5, marginBottom: 6 }}>Select layer to add:</div>
              <select
                className="ze-select"
                size={8}
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={addSel}
                onChange={(e) => setAddSel(e.target.value)}
                onDoubleClick={commitAdd}
              >
                {availableUserLayers.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitAdd}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <hr
        style={{ border: 'none', borderTop: '1px solid var(--chrome-border)', margin: '0 0 8px' }}
      />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
        {value.layers.map((l, i) => (
          <div
            key={l.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '5px 0' }}
          >
            <input
              type="checkbox"
              checked={l.enabled}
              onChange={(e) => setAt(i, { enabled: e.target.checked })}
            />
            <input
              className="ze-search"
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }}
              value={l.name}
              disabled={!l.enabled}
              onChange={(e) => setAt(i, { name: e.target.value })}
            />
            {l.kind === 'copper' ? (
              <select
                className="ze-select"
                style={{ flex: 1, minWidth: 0 }}
                value={l.copperType ?? 'signal'}
                onChange={(e) => setAt(i, { copperType: e.target.value as CopperLayerType })}
              >
                {COPPER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="ze-muted"
                style={{ flex: 1, minWidth: 0, fontSize: 12, opacity: l.enabled ? 1 : 0.55 }}
              >
                {l.desc}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
