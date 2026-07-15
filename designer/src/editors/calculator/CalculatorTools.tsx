/**
 * Calculator Tools frame: menu bar, collapsible navigation tree (General
 * system design / Power, current and isolation / High Speed / Memo) and the
 * active calculator panel.
 * Counterpart: KiCad `pcb_calculator/pcb_calculator_frame.cpp`.
 */

import { useState, type JSX } from 'react';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Modal } from './fields.js';
import { PanelRegulator } from './panels/panel_regulator.js';
import { PanelRCalculator } from './panels/panel_r_calculator.js';
import { PanelElectricalSpacing } from './panels/panel_electrical_spacing.js';
import { PanelViaSize } from './panels/panel_via_size.js';
import { PanelTrackWidth } from './panels/panel_track_width.js';
import { PanelFusingCurrent } from './panels/panel_fusing_current.js';
import { PanelCableSize } from './panels/panel_cable_size.js';
import { PanelWavelength } from './panels/panel_wavelength.js';
import { PanelRfAttenuators } from './panels/panel_rf_attenuators.js';
import { PanelTransline } from './panels/panel_transline.js';
import { PanelEseriesDisplay } from './panels/panel_eseries_display.js';
import { PanelColorCode } from './panels/panel_color_code.js';
import { PanelBoardClass } from './panels/panel_board_class.js';
import { PanelGalvanicCorrosion } from './panels/panel_galvanic_corrosion.js';
import './calculator.css';

interface TreeItem {
  id: string;
  name: string;
  panel: () => JSX.Element;
}

interface TreeGroup {
  name: string;
  items: TreeItem[];
}

const TREE: TreeGroup[] = [
  {
    name: 'General system design',
    items: [
      { id: 'regulators', name: 'Regulators', panel: PanelRegulator },
      { id: 'r_calculator', name: 'Resistor Calculator', panel: PanelRCalculator },
    ],
  },
  {
    name: 'Power, current and isolation',
    items: [
      { id: 'electrical_spacing', name: 'Electrical Spacing', panel: PanelElectricalSpacing },
      { id: 'via_size', name: 'Via Size', panel: PanelViaSize },
      { id: 'track_width', name: 'Track Width', panel: PanelTrackWidth },
      { id: 'fusing_current', name: 'Fusing Current', panel: PanelFusingCurrent },
      { id: 'cable_size', name: 'Cable Size', panel: PanelCableSize },
    ],
  },
  {
    name: 'High Speed',
    items: [
      { id: 'wavelength', name: 'Wavelength', panel: PanelWavelength },
      { id: 'rf_attenuators', name: 'RF Attenuators', panel: PanelRfAttenuators },
      { id: 'transmission_lines', name: 'Transmission Lines', panel: PanelTransline },
    ],
  },
  {
    name: 'Memo',
    items: [
      { id: 'eseries', name: 'E-Series', panel: PanelEseriesDisplay },
      { id: 'color_code', name: 'Color Code', panel: PanelColorCode },
      { id: 'board_classes', name: 'Board Classes', panel: PanelBoardClass },
      { id: 'galvanic_corrosion', name: 'Galvanic Corrosion', panel: PanelGalvanicCorrosion },
    ],
  },
];

export function CalculatorTools({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
  const [active, setActive] = useState('regulators');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [aboutOpen, setAboutOpen] = useState(false);

  const menus: Menu[] = [
    { label: 'File', items: [{ label: 'Close', action: onExitToHome }] },
    {
      label: 'Preferences',
      items: [
        {
          label: 'Reset stored data (regulators)',
          action: () => {
            localStorage.removeItem('ziro.calculator.regulators');
            window.location.reload();
          },
        },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          label: 'About Calculator Tools',
          action: () => setAboutOpen(true),
        },
      ],
    },
  ];

  const item = TREE.flatMap((g) => g.items).find((i) => i.id === active) ?? TREE[0]!.items[0]!;
  const Panel = item.panel;

  return (
    <div className="calc-frame ze-app">
      <MenuBar menus={menus} title="Calculator Tools" />
      <div className="calc-body">
        <nav className="calc-tree" data-testid="calc-tree">
          {TREE.map((group) => (
            <div key={group.name}>
              <div
                className="calc-tree-group"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.name)) next.delete(group.name);
                    else next.add(group.name);
                    return next;
                  })
                }
              >
                <span className="twisty">{collapsed.has(group.name) ? '▶' : '▼'}</span>
                {group.name}
              </div>
              {!collapsed.has(group.name) &&
                group.items.map((it) => (
                  <div
                    key={it.id}
                    className={`calc-tree-item${it.id === active ? ' active' : ''}`}
                    onClick={() => setActive(it.id)}
                  >
                    {it.name}
                  </div>
                ))}
            </div>
          ))}
        </nav>
        <main className="calc-panel" data-testid="calc-panel">
          <Panel />
        </main>
      </div>
      {aboutOpen && (
        <Modal
          title="About Calculator Tools"
          onClose={() => setAboutOpen(false)}
          footer={
            <button type="button" className="calc-btn primary" onClick={() => setAboutOpen(false)}>
              Close
            </button>
          }
        >
          <p style={{ margin: '0 0 8px' }}>
            Engineering calculators for PCB design, organised like KiCad's Calculator Tools:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>General system design — regulators, resistor substitution</li>
            <li>Power, current & isolation — spacing, via, track width, fusing, cable</li>
            <li>High speed — wavelength, RF attenuators, transmission lines</li>
            <li>Memo — E-series, colour code, board classes, galvanic corrosion</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}
