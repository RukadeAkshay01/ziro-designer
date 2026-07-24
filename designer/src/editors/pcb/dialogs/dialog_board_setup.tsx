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
 * KiCad's own dark-theme constraint icons, vendored under assets/constraints
 * (GPL like this project — same pattern as assets/toolbar). Filenames are the
 * KiCad BITMAPS enum names assigned in panel_setup_constraints.cpp.
 */
const CON_ICON_URLS = import.meta.glob('../../../assets/constraints/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Constraint row -> KiCad bitmap file (SetBitmap(KiBitmapBundle(BITMAPS::…))).
const CON_ICON_FILE: Record<string, string> = {
  clearance: 'ps_diff_pair_gap',
  track: 'width_track',
  conn: 'width_conn',
  annular: 'via_annulus',
  viaDia: 'via_diameter',
  uviaDia: 'via_diameter',
  uviaHole: 'via_hole_diameter',
  copperHole: 'hole_to_copper_clearance',
  copperEdge: 'edge_to_copper_clearance',
  throughHole: 'via_hole_diameter',
  holeToHole: 'hole_to_hole_clearance',
  fillet: 'zone_fillet',
  spoke: 'thermal_spokes',
};

function ConIcon({ name }: { name: string }): JSX.Element | null {
  const file = CON_ICON_FILE[name];
  const url = file ? CON_ICON_URLS[`../../../assets/constraints/${file}.svg`] : undefined;
  return url ? <img src={url} width={20} height={20} alt="" aria-hidden="true" /> : null;
}
import { PanelTextVariables } from '../../schematic/dialogs/panels/panel_text_variables.js';
import { PanelSetupNetclasses } from '../../schematic/dialogs/panels/panel_setup_netclasses.js';
import { PanelEmbeddedFiles } from '../../schematic/dialogs/panels/panel_embedded_files.js';
import { PanelPcbSeverities } from './panels/panel_pcb_severities.js';
import { PanelPcbTextGraphics } from './panels/panel_pcb_text_graphics.js';
import { PanelPcbFormatting } from './panels/panel_pcb_formatting.js';
import { PanelPcbMaskPaste } from './panels/panel_pcb_mask_paste.js';
import { PanelPcbZones } from './panels/panel_pcb_zones.js';
import { PanelPcbLayers } from './panels/panel_pcb_layers.js';
import { PanelPcbTeardrops } from './panels/panel_pcb_teardrops.js';
import { PanelPcbTuning } from './panels/panel_pcb_tuning.js';
import { PanelPcbTuningProfiles } from './panels/panel_pcb_tuning_profiles.js';
import { PanelPcbBoardFinish } from './panels/panel_pcb_board_finish.js';
import { PanelPcbStackup } from './panels/panel_pcb_stackup.js';
import { PanelPcbComponentClasses } from './panels/panel_pcb_component_classes.js';
import { PanelPcbCustomRules } from './panels/panel_pcb_custom_rules.js';
import type {
  BoardConstraints,
  BoardSetupValues,
  DiffPairSize,
  ViaSize,
} from '../board_settings.js';
import { readBoardSetupProText } from '../project_settings.js';
import { applyBoardFileSetup } from '../board_file_settings.js';
import { DialogImportSettings, type ImportSettingsOpts } from './dialog_import_settings.js';

// The aggregate model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so dialog users keep importing from the dialog module.
export {
  defaultBoardSetup,
  type BoardConstraints,
  type BoardSetupValues,
  type DiffPairSize,
  type ViaSize,
} from '../board_settings.js';

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
  const [importOpen, setImportOpen] = useState(false);

  // DIALOG_BOARD_SETUP::onAuxiliaryAction: parse the other project's files
  // and copy the selected groups into the working values (each panel's
  // ImportSettingsFrom). Layers, physical stackup and board finish are
  // linked and import together, like upstream.
  const applyImport = (files: { name: string; text: string }[], opts: ImportSettingsOpts): void => {
    const pcb = files.find((f) => /\.kicad_pcb$/i.test(f.name));
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const dru = files.find((f) => /\.kicad_dru$/i.test(f.name));
    if (!pcb || !pro) {
      // KiCad refuses when the associated project file cannot be loaded.
      window.alert(
        'Error importing settings from board:\n' +
          `Associated ${pcb ? 'project (.kicad_pro)' : 'board (.kicad_pcb)'} file could not be loaded`,
      );
      return;
    }
    const other = readBoardSetupProText(pro.text);
    if (!applyBoardFileSetup(pcb.text, other)) {
      window.alert(`Error loading board file:\n${pcb.name}`);
      return;
    }
    if (dru) other.customRules.text = dru.text;

    // PANEL_SETUP_LAYERS::CheckCopperLayerCount: warn when the import would
    // drop inner copper layers of the current board.
    if (opts.layers && other.physicalStackup.copperCount < v.physicalStackup.copperCount) {
      const ok = window.confirm(
        'Imported settings have fewer copper layers than the current board. ' +
          'Items on the vanishing layers will be deleted.\n\nContinue?',
      );
      if (!ok) return;
    }

    const next = structuredClone(v);
    if (opts.layers) {
      // Stackup, layers and board finish import together (they are linked).
      next.physicalStackup = structuredClone(other.physicalStackup);
      next.layers = structuredClone(other.layers);
      next.boardFinish = structuredClone(other.boardFinish);
    }
    if (opts.textAndGraphics) next.textGraphics = structuredClone(other.textGraphics);
    if (opts.formatting) next.formatting = structuredClone(other.formatting);
    if (opts.constraints) next.constraints = structuredClone(other.constraints);
    if (opts.netclasses) next.netClasses = structuredClone(other.netClasses);
    if (opts.componentClasses) next.componentClasses = structuredClone(other.componentClasses);
    if (opts.tracksAndVias) {
      next.trackWidthsMM = [...other.trackWidthsMM];
      next.viaSizesMM = structuredClone(other.viaSizesMM);
      next.diffPairsMM = structuredClone(other.diffPairsMM);
    }
    if (opts.zones) next.zones = structuredClone(other.zones);
    if (opts.teardrops) next.teardrops = structuredClone(other.teardrops);
    if (opts.tuningPatterns) next.tuning = structuredClone(other.tuning);
    if (opts.maskAndPaste) next.maskPaste = structuredClone(other.maskPaste);
    if (opts.customRules) next.customRules = structuredClone(other.customRules);
    if (opts.severities) next.drcSeverities = structuredClone(other.drcSeverities);
    if (opts.tuningProfiles) next.tuningProfiles = structuredClone(other.tuningProfiles);
    setV(next);
    setImportOpen(false);
  };

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
      <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center' }}>
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
          {conRow('copperHole', 'Copper to hole clearance:', 'copperToHoleMM')}
          {conRow('copperEdge', 'Copper to edge clearance:', 'copperToEdgeMM')}
        </div>

        <div style={{ ...secLabel, marginTop: 14 }}>Holes</div>
        <hr style={secRule} />
        <div style={conGrid}>
          {conRow('throughHole', 'Minimum through hole:', 'minThroughHoleMM')}
          {conRow('holeToHole', 'Hole to hole clearance:', 'minHoleToHoleMM')}
        </div>

        <div style={{ ...secLabel, marginTop: 14 }}>uVias</div>
        <hr style={secRule} />
        <div style={conGrid}>
          {conRow('uviaDia', 'Minimum uVia diameter:', 'minUViaMM')}
          {conRow('uviaHole', 'Minimum uVia hole:', 'minUViaHoleMM')}
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
          <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center' }}>
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
          <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center' }}>
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
        {
          id: 'layers',
          label: 'Board Editor Layers',
          render: () => (
            <PanelPcbLayers value={v.layers} onChange={(layers) => setV({ ...v, layers })} />
          ),
        },
        {
          id: 'physicalStackup',
          label: 'Physical Stackup',
          render: () => (
            <PanelPcbStackup
              value={v.physicalStackup}
              onChange={(physicalStackup) => setV({ ...v, physicalStackup })}
              finish={v.boardFinish}
            />
          ),
        },
        {
          id: 'boardFinish',
          label: 'Board Finish',
          render: () => (
            <PanelPcbBoardFinish
              value={v.boardFinish}
              onChange={(boardFinish) => setV({ ...v, boardFinish })}
            />
          ),
        },
        {
          id: 'maskPaste',
          label: 'Solder Mask/Paste',
          render: () => (
            <PanelPcbMaskPaste
              value={v.maskPaste}
              onChange={(maskPaste) => setV({ ...v, maskPaste })}
            />
          ),
        },
      ],
    },
    {
      label: 'Text & Graphics',
      pages: [
        {
          id: 'defaults',
          label: 'Defaults',
          render: () => (
            <PanelPcbTextGraphics
              value={v.textGraphics}
              onChange={(textGraphics) => setV({ ...v, textGraphics })}
            />
          ),
        },
        {
          id: 'formatting',
          label: 'Formatting',
          render: () => (
            <PanelPcbFormatting
              value={v.formatting}
              onChange={(formatting) => setV({ ...v, formatting })}
            />
          ),
        },
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
        {
          id: 'zones',
          label: 'Zones',
          render: () => (
            <PanelPcbZones value={v.zones} onChange={(zones) => setV({ ...v, zones })} />
          ),
        },
        {
          id: 'teardrops',
          label: 'Teardrops',
          render: () => (
            <PanelPcbTeardrops
              value={v.teardrops}
              onChange={(teardrops) => setV({ ...v, teardrops })}
            />
          ),
        },
        {
          id: 'tuningPatterns',
          label: 'Length-tuning Patterns',
          render: () => (
            <PanelPcbTuning value={v.tuning} onChange={(tuning) => setV({ ...v, tuning })} />
          ),
        },
        {
          id: 'tuningProfiles',
          label: 'Tuning Profiles',
          render: () => (
            <PanelPcbTuningProfiles
              value={v.tuningProfiles}
              onChange={(tuningProfiles) => setV({ ...v, tuningProfiles })}
            />
          ),
        },
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
        {
          id: 'componentClasses',
          label: 'Component Classes',
          render: () => (
            <PanelPcbComponentClasses
              value={v.componentClasses}
              onChange={(componentClasses) => setV({ ...v, componentClasses })}
            />
          ),
        },
        {
          id: 'customRules',
          label: 'Custom Rules',
          render: () => (
            <PanelPcbCustomRules
              value={v.customRules}
              onChange={(customRules) => setV({ ...v, customRules })}
            />
          ),
        },
        {
          id: 'severities',
          label: 'Violation Severity',
          render: () => (
            <PanelPcbSeverities
              value={v.drcSeverities}
              onChange={(drcSeverities) => setV({ ...v, drcSeverities })}
            />
          ),
        },
      ],
    },
    {
      label: 'Board Data',
      pages: [
        {
          id: 'embedded',
          label: 'Embedded Files',
          render: () => (
            <PanelEmbeddedFiles
              value={v.embeddedFiles}
              onChange={(embeddedFiles) => setV({ ...v, embeddedFiles })}
            />
          ),
        },
      ],
    },
  ];

  return (
    <>
      <PagedDialog
        title="Board Setup"
        sections={sections}
        initialPage={initialPage}
        auxiliaryAction="Import Settings from Another Board..."
        onAuxiliaryAction={() => setImportOpen(true)}
        initialSize={{ width: 1150, height: 620 }}
        onOk={() => onOk(v)}
        onCancel={onClose}
      />
      {importOpen && (
        <DialogImportSettings onImport={applyImport} onClose={() => setImportOpen(false)} />
      )}
    </>
  );
}
