/**
 * Board Setup dialog. Counterpart: `pcbnew/dialogs/dialog_board_setup.cpp`
 * (DIALOG_BOARD_SETUP) — a PAGED_DIALOG whose tree mirrors pcbnew exactly:
 *   Board Stackup   : Board Editor Layers, Physical Stackup, Board Finish, Solder Mask/Paste
 *   Text & Graphics : Defaults, Formatting, Text Variables
 *   Design Rules    : Constraints, Pre-defined Sizes, Zones, Teardrops,
 *                     Length-tuning Patterns, Tuning Profiles, Net Classes,
 *                     Component Classes, Custom Rules, Violation Severity
 *   Board Data      : Embedded Files
 *
 * Uses the shared PagedDialog shell. Board Setup has no "Reset to Defaults"
 * button (aShowReset=false) and an "Import Settings from Another Board..." aux
 * action, at wxSize(980, 600). Live pages: Constraints, Pre-defined Sizes
 * (PANEL_SETUP_TRACKS_AND_VIAS — Tracks / Vias / Differential Pairs), Net Classes
 * (shared PANEL_SETUP_NETCLASSES) and Text Variables (shared PANEL_TEXT_VARIABLES).
 * Values seed from the project's .kicad_pro and commit on OK.
 */
import { useState, type JSX } from 'react';
import { PagedDialog, type PagedDialogSection } from '../../../ui/PagedDialog.js';
import { Icon } from '../../../ui/icons.js';

/**
 * Original stand-in icons for the Constraints rows, one per PANEL_SETUP_CONSTRAINTS
 * row (m_bitmapClearance, m_bitmapMinTrackWidth, …). KiCad ships its own GPL
 * bitmaps; these are recognisable equivalents drawn in our SVG icon style so the
 * icon | label | value | unit layout matches upstream position-for-position.
 */
const CON_ICON: Record<string, JSX.Element> = {
  // clearance between two copper items
  clearance: (
    <>
      <rect x="1.5" y="4" width="4" height="8" rx="1" />
      <rect x="10.5" y="4" width="4" height="8" rx="1" />
      <path d="M6.6 8h2.8M7 6.9 5.8 8 7 9.1M9 6.9 10.2 8 9 9.1" />
    </>
  ),
  // minimum track width
  track: (
    <>
      <rect x="2" y="6.2" width="12" height="3.6" />
      <path d="M8 2.2v3M8 10.8v3M6.9 3.4 8 2.2l1.1 1.2M6.9 12.6 8 13.8l1.1-1.2" />
    </>
  ),
  // minimum connection width
  conn: (
    <>
      <rect x="1.5" y="5" width="7" height="6" />
      <rect x="7.5" y="5" width="7" height="6" />
    </>
  ),
  // minimum via annular width
  annular: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="2.4" />
    </>
  ),
  // minimum via diameter
  viaDia: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <path d="M2.4 8h11.2" />
    </>
  ),
  // minimum microvia diameter
  uviaDia: (
    <>
      <circle cx="8" cy="8" r="3.8" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <path d="M4.2 8h7.6" />
    </>
  ),
  // minimum microvia hole
  uviaHole: (
    <>
      <circle cx="8" cy="8" r="3.8" />
      <circle cx="8" cy="8" r="1.7" />
    </>
  ),
  // copper to hole clearance
  copperHole: (
    <>
      <circle cx="5.5" cy="8" r="3.4" />
      <circle cx="12.5" cy="8" r="1.7" />
    </>
  ),
  // copper to board edge clearance
  copperEdge: (
    <>
      <circle cx="5.5" cy="8" r="3.4" />
      <path d="M12.5 2.5v11M12.5 13.5h1.5" />
    </>
  ),
  // minimum through hole (drill)
  throughHole: (
    <>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  // hole to hole clearance
  holeToHole: (
    <>
      <circle cx="4.6" cy="8" r="2.9" />
      <circle cx="11.4" cy="8" r="2.9" />
    </>
  ),
  // allow fillets/chamfers
  fillet: (
    <>
      <path d="M13 3H6a3 3 0 0 0-3 3v7" />
      <path d="M3 13h10V3" opacity="0.4" />
    </>
  ),
  // thermal relief spokes
  spoke: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2.2v2.2M8 11.6v2.2M2.2 8h2.2M11.6 8h2.2M4.2 4.2l1.5 1.5M10.3 10.3l1.5 1.5M11.8 4.2l-1.5 1.5M5.7 10.3l-1.5 1.5" />
    </>
  ),
};

function ConIcon({ name }: { name: string }): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ opacity: 0.85 }}
    >
      {CON_ICON[name] ?? null}
    </svg>
  );
}
import {
  PanelTextVariables,
  type TextVar,
} from '../../schematic/dialogs/panels/panel_text_variables.js';
import {
  PanelSetupNetclasses,
  defaultNetClasses,
  type NetClassesData,
} from '../../schematic/dialogs/panels/panel_setup_netclasses.js';

/** PANEL_SETUP_CONSTRAINTS fields (BOARD_DESIGN_SETTINGS minimums), mm. */
export interface BoardConstraints {
  // Copper
  minClearanceMM: number;
  minTrackMM: number;
  minConnectionMM: number;
  minAnnularMM: number;
  minViaMM: number;
  minUViaMM: number;
  minUViaHoleMM: number;
  copperToHoleMM: number;
  copperToEdgeMM: number;
  // Holes
  minThroughHoleMM: number;
  minHoleToHoleMM: number;
  // Silk
  silkClearanceMM: number;
  minTextHeightMM: number;
  minTextThicknessMM: number;
  // Arc/Circle approximation
  maxDeviationMM: number;
  // Zone fill strategy
  allowFilletsOutside: boolean;
  minThermalSpokes: number;
  // Length tuning
  includeStackupHeight: boolean;
}

export interface ViaSize {
  diameter: number;
  drill: number;
}
export interface DiffPairSize {
  width: number;
  gap: number;
  viaGap: number;
}

export interface BoardSetupValues {
  constraints: BoardConstraints;
  /** Pre-defined routing sizes, mm (PANEL_SETUP_TRACKS_AND_VIAS). */
  trackWidthsMM: number[];
  viaSizesMM: ViaSize[];
  diffPairsMM: DiffPairSize[];
  /** Net classes + assignments (shared PANEL_SETUP_NETCLASSES). */
  netClasses: NetClassesData;
  /** Project text variables (shared PANEL_TEXT_VARIABLES). */
  textVars: TextVar[];
}

/** Seed values (board_design_settings.h defaults); project round-trip lands later. */
export function defaultBoardSetup(): BoardSetupValues {
  return {
    constraints: {
      minClearanceMM: 0.2,
      minTrackMM: 0.2,
      minConnectionMM: 0,
      minAnnularMM: 0.05,
      minViaMM: 0.4,
      minUViaMM: 0.2,
      minUViaHoleMM: 0.1,
      copperToHoleMM: 0,
      copperToEdgeMM: 0.01,
      minThroughHoleMM: 0.3,
      minHoleToHoleMM: 0.25,
      silkClearanceMM: 0,
      minTextHeightMM: 0.8,
      minTextThicknessMM: 0.08,
      maxDeviationMM: 0.005,
      allowFilletsOutside: true,
      minThermalSpokes: 2,
      includeStackupHeight: true,
    },
    trackWidthsMM: [],
    viaSizesMM: [],
    diffPairsMM: [],
    netClasses: defaultNetClasses(),
    textVars: [],
  };
}

type PageId =
  | 'layers'
  | 'physicalStackup'
  | 'boardFinish'
  | 'maskPaste'
  | 'defaults'
  | 'formatting'
  | 'textVars'
  | 'constraints'
  | 'sizes'
  | 'zones'
  | 'teardrops'
  | 'tuningPatterns'
  | 'tuningProfiles'
  | 'netclasses'
  | 'componentClasses'
  | 'customRules'
  | 'severities'
  | 'embedded';

interface Props {
  value: BoardSetupValues;
  initialPage?: PageId;
  onOk: (next: BoardSetupValues) => void;
  onClose: () => void;
}

export function DialogBoardSetup({ value, initialPage, onOk, onClose }: Props): JSX.Element {
  const [v, setV] = useState<BoardSetupValues>(() => structuredClone(value));

  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const setCon = (key: keyof BoardConstraints, value: number | boolean): void =>
    setV({ ...v, constraints: { ...v.constraints, [key]: value } });

  const secLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, margin: '2px 0 0' };
  const secRule: React.CSSProperties = {
    border: 'none',
    borderTop: '1px solid var(--chrome-border)',
    margin: '3px 0 8px',
  };
  const conGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '22px max-content 84px max-content',
    alignItems: 'center',
    gap: '9px 8px',
    fontSize: 12.5,
    marginBottom: 4,
  };

  // A numeric constraint row (icon | label | value | mm). Pass icon='' for rows
  // KiCad leaves un-iconed (Silk); the empty cell keeps the column aligned.
  const conRow = (icon: string, label: string, key: keyof BoardConstraints): JSX.Element => (
    <>
      <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
        {icon ? <ConIcon name={icon} /> : null}
      </span>
      <span>{label}</span>
      <input
        className="ze-search"
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={v.constraints[key] as number}
        onChange={(e) => setCon(key, num(e.target.value))}
      />
      <span className="ze-muted" style={{ fontSize: 11 }}>
        mm
      </span>
    </>
  );
  const section = (label: string): JSX.Element => (
    <>
      <div style={secLabel}>{label}</div>
      <hr style={secRule} />
    </>
  );

  const constraintsPanel = (): JSX.Element => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {/* Left column: Copper / Holes / Silk */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {section('Copper')}
        <div style={conGrid}>
          {conRow('clearance', 'Minimum clearance:', 'minClearanceMM')}
          {conRow('track', 'Minimum track width:', 'minTrackMM')}
          {conRow('conn', 'Minimum connection width:', 'minConnectionMM')}
          {conRow('annular', 'Minimum annular width:', 'minAnnularMM')}
          {conRow('viaDia', 'Minimum via diameter:', 'minViaMM')}
          {conRow('uviaDia', 'Minimum uVia diameter:', 'minUViaMM')}
          {conRow('uviaHole', 'Minimum uVia hole:', 'minUViaHoleMM')}
          {conRow('copperHole', 'Copper to hole clearance:', 'copperToHoleMM')}
          {conRow('copperEdge', 'Copper to edge clearance:', 'copperToEdgeMM')}
        </div>

        <div style={{ ...secLabel, marginTop: 14 }}>Holes</div>
        <hr style={secRule} />
        <div style={conGrid}>
          {conRow('throughHole', 'Minimum through hole:', 'minThroughHoleMM')}
          {conRow('holeToHole', 'Hole to hole clearance:', 'minHoleToHoleMM')}
        </div>

        <div style={{ ...secLabel, marginTop: 14 }}>Silk</div>
        <hr style={secRule} />
        <div style={conGrid}>
          {conRow('', 'Minimum item clearance:', 'silkClearanceMM')}
          {conRow('', 'Minimum text height:', 'minTextHeightMM')}
          {conRow('', 'Minimum text thickness:', 'minTextThicknessMM')}
        </div>
      </div>

      {/* Right column: Arc/Circle / Zone Fill / Length Tuning */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {section('Arc/Circle Approximated by Segments')}
        <div style={conGrid}>{conRow('', 'Maximum allowed deviation:', 'maxDeviationMM')}</div>
        <div className="ze-muted" style={{ fontSize: 11, marginBottom: 4 }}>
          Note: zone filling can be slow when &lt; 0.005 mm.
        </div>

        <div style={{ ...secLabel, marginTop: 14 }}>Zone Fill Strategy</div>
        <hr style={secRule} />
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, margin: '4px 0' }}
        >
          <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
            <ConIcon name="fillet" />
          </span>
          <input
            type="checkbox"
            checked={v.constraints.allowFilletsOutside}
            onChange={(e) => setCon('allowFilletsOutside', e.target.checked)}
          />
          Allow fillets/chamfers outside zone outline
        </label>
        <div
          style={{
            ...conGrid,
            gridTemplateColumns: '22px max-content 84px',
            marginTop: 6,
          }}
        >
          <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
            <ConIcon name="spoke" />
          </span>
          <span>Minimum thermal relief spoke count:</span>
          <input
            className="ze-search"
            type="number"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={v.constraints.minThermalSpokes}
            onChange={(e) => setCon('minThermalSpokes', num(e.target.value))}
          />
        </div>

        <div style={{ ...secLabel, marginTop: 14 }}>Length Tuning</div>
        <hr style={secRule} />
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, margin: '4px 0' }}
        >
          <input
            type="checkbox"
            checked={v.constraints.includeStackupHeight}
            onChange={(e) => setCon('includeStackupHeight', e.target.checked)}
          />
          Include stackup height in track length calculations
        </label>
      </div>
    </div>
  );

  // One pre-defined-size grid (Tracks / Vias / Differential Pairs). The grid area
  // is a bordered spreadsheet that fills the column height (empty when no rows),
  // with Add / Sort / Remove beneath, mirroring PANEL_SETUP_TRACKS_AND_VIAS.
  const sizeGrid = <T,>(
    title: string,
    cols: { label: string; key: keyof T }[],
    rows: T[],
    setRows: (next: T[]) => void,
    blank: T,
  ): JSX.Element => {
    const sortKey = cols[0]!.key;
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>{title}</div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            border: '1px solid var(--chrome-border)',
            borderRadius: 3,
            background: 'var(--chrome-bg2)',
          }}
        >
          <table className="ze-grid" style={{ border: 'none', width: '100%' }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={String(c.key)} style={{ position: 'sticky', top: 0 }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={String(c.key)}>
                      <input
                        type="text"
                        value={String(r[c.key])}
                        onChange={(e) => {
                          const arr = [...rows];
                          arr[i] = { ...arr[i]!, [c.key]: num(e.target.value) };
                          setRows(arr);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ze-grid-btns">
          <button className="ze-gridbtn" title="Add" onClick={() => setRows([...rows, blank])}>
            <Icon name="plus" />
          </button>
          <button
            className="ze-gridbtn"
            title="Sort ascending"
            disabled={rows.length < 2}
            onClick={() =>
              setRows([...rows].sort((a, b) => Number(a[sortKey]) - Number(b[sortKey])))
            }
          >
            <Icon name="arrowDown" />
          </button>
          <span style={{ width: 15 }} />
          <button
            className="ze-gridbtn"
            title="Remove"
            disabled={rows.length === 0}
            onClick={() => setRows(rows.slice(0, -1))}
          >
            <Icon name="delete" />
          </button>
        </div>
      </div>
    );
  };

  const sizesPanel = (): JSX.Element => (
    <div style={{ height: '100%', display: 'flex', gap: 14 }}>
      {sizeGrid<{ width: number }>(
        'Tracks',
        [{ label: 'Width (mm)', key: 'width' }],
        v.trackWidthsMM.map((width) => ({ width })),
        (rows) => setV({ ...v, trackWidthsMM: rows.map((r) => r.width) }),
        { width: 0.2 },
      )}
      {sizeGrid<ViaSize>(
        'Vias',
        [
          { label: 'Diameter (mm)', key: 'diameter' },
          { label: 'Hole (mm)', key: 'drill' },
        ],
        v.viaSizesMM,
        (rows) => setV({ ...v, viaSizesMM: rows }),
        { diameter: 0.6, drill: 0.3 },
      )}
      {sizeGrid<DiffPairSize>(
        'Differential Pairs',
        [
          { label: 'Width (mm)', key: 'width' },
          { label: 'Gap (mm)', key: 'gap' },
          { label: 'Via Gap (mm)', key: 'viaGap' },
        ],
        v.diffPairsMM,
        (rows) => setV({ ...v, diffPairsMM: rows }),
        { width: 0.2, gap: 0.2, viaGap: 0.25 },
      )}
    </div>
  );

  const todo = (): JSX.Element => (
    <div style={{ padding: 16, color: 'var(--ze-muted, #888)', fontSize: 12 }}>
      This setup page is not implemented yet.
    </div>
  );

  // The upstream page tree (DIALOG_BOARD_SETUP::DIALOG_BOARD_SETUP).
  const sections: PagedDialogSection[] = [
    {
      label: 'Board Stackup',
      pages: [
        { id: 'layers', label: 'Board Editor Layers', disabled: true, render: todo },
        { id: 'physicalStackup', label: 'Physical Stackup', disabled: true, render: todo },
        { id: 'boardFinish', label: 'Board Finish', disabled: true, render: todo },
        { id: 'maskPaste', label: 'Solder Mask/Paste', disabled: true, render: todo },
      ],
    },
    {
      label: 'Text & Graphics',
      pages: [
        { id: 'defaults', label: 'Defaults', disabled: true, render: todo },
        { id: 'formatting', label: 'Formatting', disabled: true, render: todo },
        {
          id: 'textVars',
          label: 'Text Variables',
          render: () => (
            <PanelTextVariables
              vars={v.textVars}
              onChange={(textVars) => setV({ ...v, textVars })}
            />
          ),
        },
      ],
    },
    {
      label: 'Design Rules',
      pages: [
        { id: 'constraints', label: 'Constraints', render: constraintsPanel },
        { id: 'sizes', label: 'Pre-defined Sizes', render: sizesPanel },
        { id: 'zones', label: 'Zones', disabled: true, render: todo },
        { id: 'teardrops', label: 'Teardrops', disabled: true, render: todo },
        { id: 'tuningPatterns', label: 'Length-tuning Patterns', disabled: true, render: todo },
        { id: 'tuningProfiles', label: 'Tuning Profiles', disabled: true, render: todo },
        {
          id: 'netclasses',
          label: 'Net Classes',
          render: () => (
            <PanelSetupNetclasses
              value={v.netClasses}
              onChange={(netClasses) => setV({ ...v, netClasses })}
            />
          ),
        },
        { id: 'componentClasses', label: 'Component Classes', disabled: true, render: todo },
        { id: 'customRules', label: 'Custom Rules', disabled: true, render: todo },
        { id: 'severities', label: 'Violation Severity', disabled: true, render: todo },
      ],
    },
    {
      label: 'Board Data',
      pages: [{ id: 'embedded', label: 'Embedded Files', disabled: true, render: todo }],
    },
  ];

  return (
    <PagedDialog
      title="Board Setup"
      sections={sections}
      initialPage={initialPage}
      auxiliaryAction="Import Settings from Another Board..."
      initialSize={{ width: 1150, height: 620 }}
      onOk={() => onOk(v)}
      onCancel={onClose}
    />
  );
}
