import type { Vec2 } from '@ziroeda/kimath';
import { iuToMM, mmToIU, type WksSheet } from '@ziroeda/common';
import {
  resolveActiveSheet,
  readSheetRef,
  writeSheetRefText,
  listProjectSheetFiles,
  parseProjectSheet,
} from '../drawingsheet/projectSheet.js';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parse } from '@ziroeda/sexpr';
import {
  readSchematic,
  serializeSchematic,
  deleteByIds,
  transformItems,
  computeNetlist,
  withCleanup,
  refId,
  editSymbolProperties,
  copySelectionText,
  parsePastedText,
  boxSelect,
  symbolBodyBBox,
  labelBox,
  emptyBBox,
  isEmpty,
  includePoint,
  instanceKey,
  getSheetPageNumber,
  getRootPageNumber,
  setSheetPageNumberCommand,
  setRootPageNumberCommand,
  setPageSettingsCommand,
  getPageSettings,
  bulkEditFieldsCommand,
  groupItemsCommand,
  ungroupItemsCommand,
  setSymbolsLockedCommand,
  expandSelectionToGroups,
  applySelectionFilter,
  defaultSelectionFilter,
  selectionFilterAll,
  type SelectionFilterOptions,
  getSelectedItemsAsText,
  type PasteMode,
  type PageSettings,
  findMatches,
  replaceCommand,
  defaultSearchData,
  annotateCommand,
  clearAnnotationCommand,
  type SchSearchData,
  type AnnotateOptions,
  runErc,
  ERC_ITEMS,
  ercExclusionKey,
  buildSheetTree,
  sheetFile,
  sheetName,
  findRootFile,
  addItems,
  makeSheet,
  addSheetPin,
  replaceSheet,
  replaceTextBox,
  replaceTable,
  replaceLabel,
  replaceLine,
  replaceJunction,
  makeImage,
  makeTextBox,
  makeTable,
  buildPropertyNode,
  History,
  type Schematic,
  type LibSymbol,
  type EditCommand,
  type SheetSide,
  type TransformOp,
  type LabelKind,
  type LabelShape,
  type SymbolEdit,
  type PastePayload,
  type ErcViolation,
  type SheetTreeNode,
  type ItemRef,
  describeItem,
  itemRefById,
  schPropertiesFor,
  type PropRow,
  getMsgPanelItems,
  type MsgPanelItem,
} from '@ziroeda/eeschema';
import {
  SchematicCanvas,
  type CanvasController,
  type LineMode,
  type PendingLabel,
} from './components/SchematicCanvas.js';
import { LabelDialog, type LabelFormat } from './components/LabelDialog.js';
import { StatusField, STATUS_FIELD_TEMPLATES } from '../../ui/StatusField.js';
import { SymbolPropertiesDialog } from './components/SymbolPropertiesDialog.js';
import { ErcDialog } from './components/ErcDialog.js';
import {
  DialogSymbolChooser,
  type PickedSymbol,
  type SymbolChooserResult,
} from './dialogs/dialog_symbol_chooser.js';
import { SymbolLibraryBrowser } from './components/SymbolLibraryBrowser.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR } from './toolbars_sch_editor.js';
import { MenuBar, ContextMenu, type MenuItem } from '../../ui/MenuBar.js';
import { buildMenus, TOOL_HOTKEYS } from './menubar.js';
import {
  SchNavigateTool,
  flattenHierarchy,
  parentPath,
  type SheetRef,
} from './sch_navigate_tool.js';
import { DialogSchematicFind } from './dialogs/dialog_schematic_find.js';
import { DialogAnnotate } from './dialogs/dialog_annotate.js';
import { DialogLineProperties, type ItemColor } from './dialogs/dialog_line_properties.js';
import { DialogPageSettings, type PageExportFlags } from './dialogs/dialog_page_settings.js';
import { DialogPasteSpecial } from './dialogs/dialog_paste_special.js';
import {
  DialogSchematicSetup,
  defaultSchematicSetup,
  type SchematicSetup,
} from './dialogs/dialog_schematic_setup.js';
import { findProjectPro, readSchematicSetup, writeSchematicSetupText } from './project_settings.js';
import {
  IU_PER_MILS,
  junctionDotDiameterIU,
  resolveEffectiveNetClass,
} from './schematic_settings.js';
import { computeNetClassOverrides } from './net_overrides.js';
import { DialogExportBom } from './dialogs/dialog_export_bom.js';
import { DialogExportNetlist } from './dialogs/dialog_export_netlist.js';
import { DialogSymbolFieldsTable, type FieldsEdits } from './dialogs/dialog_symbol_fields_table.js';
import { DialogAssignFootprints } from './dialogs/dialog_assign_footprints.js';
import { DialogPrint } from './dialogs/dialog_print.js';
import { DialogPlot, type PlotFormat } from './dialogs/dialog_plot.js';
import { printSheet, plotPng, plotSvg, plotPdf, type PlotOpts } from './render/plot.js';
import { BUILTIN_THEMES } from './theme.js';
import { LoadingOverlay, nextPaint } from '../../ui/LoadingOverlay.js';
import type { ProgressSnapshot } from '../../ui/progress_reporter.js';
import { PreferencesDialog } from '../../prefs/PreferencesDialog.js';
import { settings, gridSizeToIU } from '../../prefs/settings.js';
import {
  useCommonSettings,
  useEeschemaSettings,
  useSchematicTheme,
} from '../../prefs/useSettings.js';
import type { RenderOpts } from './render/renderer.js';
import type { InputPrefs } from './components/SchematicCanvas.js';
import { SchPropertiesPanel } from './components/SchPropertiesPanel.js';
import '../../ui/shell.css';

// What KiCad writes for File > New Schematic: an empty sheet on A4 paper.
// Launching the editor without a project starts here (no bundled demo).
const EMPTY_SCH =
  '(kicad_sch (version 20231120) (generator "ziroeda") (paper "A4")\n  (lib_symbols)\n)\n';

const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
// Local view toggles; grid/crosshair/line-mode/hidden-pins live in the settings
// store (Preferences) and are derived each render so the two stay in sync.
const DEFAULT_TOGGLES = new Set(['unitsMm', 'showHierarchy', 'showProperties']);
const SETTINGS_TOGGLES = new Set([
  'toggleGrid',
  'toggleGridOverrides',
  'toggleHiddenPins',
  'toggleHiddenFields',
  'crosshairSmall',
  'crosshairFull',
  'crosshair45',
  'lineModeFree',
  'lineMode90',
  'lineMode45',
  'annotateAuto',
]);
const PX_PER_MM_100 = 3.7795;

// The "Current Tool" status-bar field (EDA_DRAW_FRAME::DisplayToolMsg):
// TOOLS_HOLDER::PushTool shows the active action's FriendlyName; the idle
// selection tool reads "Select item(s)". Names from sch_actions.cpp /
// actions.cpp FriendlyName().
const SCH_TOOL_MSGS: Record<string, string> = {
  select: 'Select item(s)',
  selectLasso: 'Select item(s)',
  highlightNet: 'Highlight Nets',
  placeSymbol: 'Place Symbols',
  placePower: 'Place Power Symbols',
  drawWire: 'Draw Wires',
  drawBus: 'Draw Buses',
  busEntry: 'Place Wire to Bus Entries',
  noConnect: 'Place/Remove No Connect Flags',
  junction: 'Place Junctions',
  placeLabel: 'Place Net Labels',
  placeClassLabel: 'Place Directive Labels',
  placeGlobalLabel: 'Place Global Labels',
  placeHierLabel: 'Place Hierarchical Labels',
  drawSheet: 'Draw Hierarchical Sheets',
  sheetPin: 'Place Pins from Sheet',
  placeText: 'Draw Text',
  textBox: 'Draw Text Boxes',
  table: 'Draw Tables',
  rectangle: 'Draw Rectangles',
  circle: 'Draw Circles',
  arc: 'Draw Arcs',
  bezier: 'Draw Bezier Curve',
  lines: 'Draw Lines',
  image: 'Place Images',
  delete: 'Interactive Delete Tool',
  zoomTool: 'Zoom to Selection Area',
};

// Right-toolbar tool ids that place a text label, mapped to the label kind.
const LABEL_TOOL_KINDS: Record<string, LabelKind> = {
  placeLabel: 'label',
  placeGlobalLabel: 'global_label',
  placeHierLabel: 'hierarchical_label',
  placeText: 'text',
};

// KiCad's Selection Filter categories, laid out in two columns (row-major).
// Selection Filter categories, in PANEL_SCH_SELECTION_FILTER order (the
// "All items" master and "Locked items" special are handled separately).
const FILTER_CATS: [keyof SelectionFilterOptions, string][] = [
  ['ruleAreas', 'Rule Areas'],
  ['symbols', 'Symbols'],
  ['pins', 'Pins'],
  ['wires', 'Wires'],
  ['labels', 'Labels'],
  ['graphics', 'Graphics'],
  ['images', 'Images'],
  ['text', 'Text'],
  ['otherItems', 'Other items'],
];

/** A file picked from disk for a project open. */
export interface PickedFile {
  name: string;
  text: string;
}

const DEFAULT_FILE = 'untitled.kicad_sch';

// The chooser's "Recently Used" group persists across dialog openings for the
// session (sch_drawing_tools.cpp s_SymbolHistoryList / s_PowerHistoryList).
const sSymbolHistoryList: PickedSymbol[] = [];
const sPowerHistoryList: PickedSymbol[] = [];

export function SchematicEditor({
  onExitToHome,
  onShowPcb,
  onShowSymbolEditor,
  onShowFootprintEditor,
  onShowCalculator,
  initialProject,
  initialFile,
  placeRequest,
  onProjectChange,
  onPersistFiles,
  registerAutosaveFlush,
  extraSheetFiles,
  projectName,
  rootPro,
}: {
  onExitToHome: () => void;
  onShowPcb?: () => void;
  /** Open the Symbol Editor (the top toolbar's `symbolEditor` button). */
  onShowSymbolEditor?: () => void;
  /** Open the Footprint Editor (the top toolbar's `footprintEditor` button). */
  onShowFootprintEditor?: () => void;
  /** Open the Calculator Tools (Tools menu). */
  onShowCalculator?: () => void;
  initialProject?: PickedFile[] | null;
  initialFile?: string | null;
  /** A symbol handed over by the Symbol Editor's "Add symbol to schematic": attach it to the cursor. */
  placeRequest?: { lib: LibSymbol; nonce: number } | null;
  /** Autosave hook: called (debounced) with the serialized sheets after edits. */
  onProjectChange?: (files: PickedFile[]) => void;
  /** Persist project files immediately (no debounce) — used for the drawing-sheet
   *  reference in .kicad_pro so it survives a "go back and reopen". */
  onPersistFiles?: (files: PickedFile[]) => void;
  /** Register a flush the host calls before leaving/reopening, so a pending
   *  autosave is written out first (the "edit → home → reopen" case). */
  registerAutosaveFlush?: (fn: (() => void) | null) => void;
  /** `.kicad_wks` saved into the project this session (Drawing Sheet Editor →
   *  Save to Project), offered as extra Page Settings drawing-sheet choices. */
  extraSheetFiles?: PickedFile[];
  /** Project name shown as "<project> — Schematic Editor" in the menu bar. */
  projectName?: string;
  /** Basename of the active project's .kicad_pro (no extension). When a folder
   *  holds several projects, this pins which one's root sheet to load, so the
   *  editor matches the launcher tree instead of guessing the first/last pro. */
  rootPro?: string;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo<Schematic | null>(() => {
    try {
      return { ...readSchematic(parse(EMPTY_SCH)), fileName: DEFAULT_FILE };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);
  // Unsaved-changes flag ('*' in the title until the autosave hand-off; Save
  // greys when clean) — same affordance as the PCB editor / KiCad's title.
  const [dirty, setDirty] = useState(false);
  const dirtySkipRef = useRef(true);

  const [doc, setDoc] = useState<Schematic | null>(initial);
  // Multi-sheet project: every parsed document by basename, the root file, and a
  // History per sheet (KiCad keeps one undo stack per screen). `doc` is always
  // the currently-shown sheet; it is written back into `docs` when switching.
  const project = useRef<{ docs: Map<string, Schematic>; root: string }>({
    docs: new Map(initial ? [[DEFAULT_FILE, initial]] : []),
    root: DEFAULT_FILE,
  });
  const histories = useRef<Map<string, History>>(new Map());
  const [currentFile, setCurrentFile] = useState<string>(DEFAULT_FILE);
  // The active sheet *instance* (KiCad SCH_SHEET_PATH). Distinct from currentFile
  // so two instances of one shared document highlight/navigate independently.
  const [currentPath, setCurrentPath] = useState<string>('/');
  // KiCad's "Load Schematic" progress: non-null while parsing/saving a project
  // (a plain message, or a snapshot with the per-sheet parse gauge).
  const [loading, setLoading] = useState<string | ProgressSnapshot | null>(null);
  // Register the initial sheet's undo stack so returning to it keeps its history.
  useEffect(() => {
    histories.current.set(DEFAULT_FILE, history.current);
  }, []);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // The item whose net is highlighted by the Highlight-Net tool (KiCad's
  // m_highlightedConn). Distinct from selection: plain selection is never a net
  // highlight in KiCad; it's the explicit highlight action that brightens a net.
  const [highlightItem, setHighlightItem] = useState<string | null>(null);
  const history = useRef(new History());
  const controller = useRef<CanvasController>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [placeLib, setPlaceLib] = useState<LibSymbol | null>(null);
  // Unit attached to the cursor, and the chooser's checkbox state driving the
  // after-placement continuation (KeepSymbol / PlaceAllUnits stepping).
  const [placeUnit, setPlaceUnit] = useState(1);
  const placeFlags = useRef({ keepSymbol: true, placeAllUnits: false, unitCount: 1 });
  const [pendingLabel, setPendingLabel] = useState<PendingLabel | null>(null);
  // Right-toolbar drawing state: a drawn sheet awaiting its name/file, a sheet-pin
  // click awaiting its name, an image chosen and following the cursor.
  const [sheetDraw, setSheetDraw] = useState<{
    at: Vec2;
    size: { w: number; h: number };
    name: string;
    file: string;
  } | null>(null);
  const [sheetPinDraw, setSheetPinDraw] = useState<{
    index: number;
    at: Vec2;
    side: SheetSide;
    name: string;
  } | null>(null);
  const [textBoxDraw, setTextBoxDraw] = useState<{
    start: Vec2;
    end: Vec2;
    text: string;
    editIndex?: number;
  } | null>(null);
  const [tableDraw, setTableDraw] = useState<{ rows: number; cols: number } | null>(null);
  const [tableEdit, setTableEdit] = useState<{
    index: number;
    rows: number;
    cols: number;
    texts: string[];
  } | null>(null);
  const [pendingImage, setPendingImage] = useState<{ data: string } | null>(null);
  // Keyboard-initiated grabbed move (SCH_MOVE_TOOL): M leaves connected wires
  // behind, G drags them along. A fresh nonce restarts the grab.
  const [grabRequest, setGrabRequest] = useState<{
    kind: 'move' | 'drag';
    nonce: number;
  } | null>(null);
  // Right-click selection context menu (SCH_SELECTION_TOOL's TOOL_MENU):
  // client-space position plus the hit-tested item, or null when closed.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hit: ItemRef | null } | null>(
    null,
  );
  // Clarify Selection (SCH_SELECTION_TOOL::doSelectionMenu): an ambiguous
  // click lists every candidate; picking a row selects it.
  const [clarify, setClarify] = useState<{
    x: number;
    y: number;
    items: ItemRef[];
    additive: boolean;
  } | null>(null);
  // Editing an existing label's text/shape (DIALOG_LABEL_PROPERTIES).
  const [labelEdit, setLabelEdit] = useState<{
    index: number;
    kind: LabelKind;
    text: string;
    shape?: LabelShape;
  } | null>(null);
  // Editing a hierarchical sheet's name/file (DIALOG_SHEET_PROPERTIES).
  const [sheetEdit, setSheetEdit] = useState<{
    index: number;
    name: string;
    file: string;
  } | null>(null);
  // Editing the current sheet's page number (SCH_ACTIONS::editPageNumber).
  const [pageEdit, setPageEdit] = useState<{ page: string } | null>(null);
  // Editing a wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES) or a junction's
  // diameter (DIALOG_JUNCTION_PROPS).
  const [lineEdit, setLineEdit] = useState<{
    index: number;
    widthIU: number;
    style: string;
    color?: ItemColor;
  } | null>(null);
  const [junctionEdit, setJunctionEdit] = useState<{
    index: number;
    diameterIU: number;
    color?: ItemColor;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [localToggles, setLocalToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [prefsOpen, setPrefsOpen] = useState(false);
  const common = useCommonSettings();
  const es = useEeschemaSettings();
  const theme = useSchematicTheme();

  // The displayed toggle set: local toggles plus the settings-derived ones
  // (Preferences and the left toolbar drive the same EESCHEMA_SETTINGS keys).
  const toggles = useMemo(() => {
    const t = new Set(localToggles);
    if (es.window.grid.show) t.add('toggleGrid');
    if (es.window.grid.overrides_enabled) t.add('toggleGridOverrides');
    if (es.appearance.show_hidden_pins) t.add('toggleHiddenPins');
    if (es.appearance.show_hidden_fields) t.add('toggleHiddenFields');
    t.add(
      es.window.cursor.crosshair === '45'
        ? 'crosshair45'
        : es.window.cursor.crosshair === 'small'
          ? 'crosshairSmall'
          : 'crosshairFull',
    );
    t.add(
      es.drawing.line_mode === 0
        ? 'lineModeFree'
        : es.drawing.line_mode === 2
          ? 'lineMode45'
          : 'lineMode90',
    );
    if (es.annotation.automatic) t.add('annotateAuto');
    return t;
  }, [localToggles, es]);
  // Ctrl+U (ACTIONS::toggleUnits) returns to the last imperial unit, like
  // COMMON_TOOLS::m_imperialUnit (initially inches).
  const lastImperialRef = useRef<'unitsInches' | 'unitsMils'>('unitsInches');
  useEffect(() => {
    if (toggles.has('unitsInches')) lastImperialRef.current = 'unitsInches';
    else if (toggles.has('unitsMils')) lastImperialRef.current = 'unitsMils';
  }, [toggles]);
  // Selection Filter (SCH_SELECTION_FILTER_OPTIONS): gates which item types —
  // and locked items — the selection accepts.
  const [selFilter, setSelFilter] = useState<SelectionFilterOptions>(defaultSelectionFilter);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  // Status-bar relative coordinates: dx/dy/dist measure from this origin,
  // which Space resets to the cursor (ACTIONS::resetLocalCoords;
  // COMMON_TOOLS::ResetLocalCoords sets SCH_SCREEN::m_LocalOrigin).
  const [localOrigin, setLocalOrigin] = useState<Vec2>({ x: 0, y: 0 });
  const cursorRef = useRef<Vec2 | null>(null);
  cursorRef.current = cursor;
  const [scale, setScale] = useState(1);
  // The symbol whose properties dialog is open (its refId), or null.
  const [propsTarget, setPropsTarget] = useState<string | null>(null);
  // Items parsed from the clipboard, attached to the cursor until dropped.
  const [pastePending, setPastePending] = useState<PastePayload | null>(null);
  // ERC results: null = panel closed; a list (possibly empty) = panel open.
  const [ercResult, setErcResult] = useState<readonly ErcViolation[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const libById = useMemo<Map<string, LibSymbol>>(
    () => new Map((doc?.libSymbols ?? []).map((l) => [l.libId, l])),
    [doc?.libSymbols],
  );

  // Connectivity: compute the netlist, then brighten the net the Highlight-Net tool
  // picked (not the selection — KiCad keeps those separate). The renderer matches
  // wire/junction/pin ids against this set.
  const netlist = useMemo(() => (doc ? computeNetlist(doc, libById) : null), [doc, libById]);
  const { highlightWires, highlightName } = useMemo(() => {
    const items = new Set<string>();
    let name: string | null = null;
    if (netlist && highlightItem !== null) {
      const code = netlist.netByItem.get(highlightItem);
      if (code !== undefined) {
        const net = netlist.nets.find((n) => n.code === code);
        if (net) {
          name = net.name;
          for (const item of net.items) items.add(item);
        }
      }
    }
    return { highlightWires: items, highlightName: name };
  }, [netlist, highlightItem]);

  // The live document for stable callbacks (selection promotion needs groups).
  const docRef = useRef(doc);
  docRef.current = doc;
  // Group promotion (SCH_SELECTION_TOOL): clicking a member selects its whole
  // group, so every selection result expands through the document's groups.
  const promote = (ids: ReadonlySet<string>): ReadonlySet<string> =>
    docRef.current ? expandSelectionToGroups(docRef.current, ids) : ids;

  // The Selection Filter narrows a raw hit before it can enter the selection
  // (SCH_SELECTION_TOOL::itemPassesFilter): locked items and disabled item
  // types are dropped, so they can't be selected/moved/deleted.
  const selFilterRef = useRef(selFilter);
  selFilterRef.current = selFilter;
  const filterIds = (ids: ReadonlySet<string>): ReadonlySet<string> =>
    docRef.current ? applySelectionFilter(docRef.current, ids, selFilterRef.current) : ids;

  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setHighlightItem(null); // a selection clears any net highlight (KiCad keeps the two exclusive)
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      // A filtered-out hit (locked / disabled type) behaves like empty space.
      if (filterIds(new Set([id])).size === 0) return additive ? prev : new Set();
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) {
          // Toggling a grouped member off removes its whole group.
          for (const m of promote(new Set([id]))) next.delete(m);
        } else for (const m of promote(new Set([id]))) next.add(m);
        return next;
      }
      return new Set(promote(new Set([id])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight-Net tool: brighten a net and clear the selection (KiCad's
  // HighlightNet calls ClearSelection so the whole net shows, not a selection halo).
  const onHighlight = useCallback((id: string | null) => {
    setSelection(new Set());
    setHighlightItem(id);
  }, []);

  // Box-selection result (KiCad SelectMultiple): plain drags replace the
  // selection, shift-drags add, ctrl+shift-drags subtract.
  const onSelectBox = useCallback(
    (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => {
      setHighlightItem(null);
      setSelection((prev) => {
        // Box/lasso results pass through the Selection Filter before promotion
        // (KiCad narrows the collector), so locked/disabled items never enter.
        const hit = promote(filterIds(ids));
        if (subtractive) {
          const next = new Set(prev);
          for (const id of hit) next.delete(id);
          return next;
        }
        if (additive) {
          const next = new Set(prev);
          for (const id of hit) next.add(id);
          return next;
        }
        return new Set(hit);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Right-click with the select tool (SCH_SELECTION_TOOL): an unselected item
  // under the cursor becomes the selection before the menu opens; over a
  // selected item or empty canvas the selection is kept and the menu applies
  // to it (KiCad selects the item, then pops the TOOL_MENU).
  const onContextMenuRequest = useCallback(
    (x: number, y: number, hit: ItemRef | null) => {
      if (hit)
        setSelection((prev) => (prev.has(hit.id) ? prev : new Set(promote(new Set([hit.id])))));
      setCtxMenu({ x, y, hit });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Every edit runs through KiCad's post-commit cleanup (colinear wire merge),
  // as part of the same undoable step (SCHEMATIC::CleanUp / RecalculateConnections).
  const runCommand = useCallback(
    (cmd: EditCommand) => {
      setDoc((d) => (d ? history.current.execute(d, withCleanup(cmd, libById)) : d));
    },
    [libById],
  );

  const undo = useCallback(() => setDoc((d) => (d ? (history.current.undo(d) ?? d) : d)), []);
  const redo = useCallback(() => setDoc((d) => (d ? (history.current.redo(d) ?? d) : d)), []);

  // Resolve the open dialog's target symbol against the current document.
  const propsSymbol = useMemo(() => {
    if (!doc || propsTarget === null) return null;
    for (let i = 0; i < doc.symbols.length; i++) {
      const s = doc.symbols[i]!;
      if (refId('symbol', s.uuid, i) === propsTarget) return s;
    }
    return null;
  }, [doc, propsTarget]);

  // The schematic hierarchy (SCH_SHEET_LIST): rebuilt from the live documents so
  // sheet edits (adding/renaming sheets) reflect immediately.
  const sheetTree = useMemo<SheetTreeNode | null>(() => {
    if (!doc) return null;
    const docs = new Map(project.current.docs);
    docs.set(currentFile, doc);
    return buildSheetTree(docs, project.current.root);
  }, [doc, currentFile]);

  // Depth-first hierarchy order (virtual page numbers) + Back/Forward history
  // (SCH_NAVIGATE_TOOL). Sheet edits prune dead history entries (CleanHistory).
  const flatSheets = useMemo<SheetRef[]>(
    () => (sheetTree ? flattenHierarchy(sheetTree) : []),
    [sheetTree],
  );
  const navTool = useRef(new SchNavigateTool());
  useEffect(() => {
    navTool.current.cleanHistory(new Set(flatSheets.map((s) => s.path)));
  }, [flatSheets]);

  // Bumped after editing a page number in a sheet's *parent* document, so any
  // page-number display refreshes even though `doc`/`currentFile` didn't change.
  const [, forcePageRefresh] = useState(0);

  // Live documents with the on-screen sheet's edits folded in.
  const liveDocs = useCallback((): Map<string, Schematic> => {
    const docs = new Map(project.current.docs);
    if (doc) docs.set(currentFile, doc);
    return docs;
  }, [doc, currentFile]);

  // ----- Choose Symbol dialog (DIALOG_SYMBOL_CHOOSER) ----------------------------
  const chooserOpen = (activeTool === 'placeSymbol' || activeTool === 'placePower') && !placeLib;

  // The chooser's "-- Already Placed --" group: every distinct library symbol
  // used anywhere in the hierarchy, filtered to the tool's power-symbol flavour
  // (sch_drawing_tools.cpp builds the same list before PickSymbolFromLibrary).
  const alreadyPlaced = useMemo<PickedSymbol[]>(() => {
    if (!chooserOpen) return [];
    const powerOnly = activeTool === 'placePower';
    const seen = new Set<string>();
    const out: PickedSymbol[] = [];
    for (const d of liveDocs().values()) {
      const libs = new Map(d.libSymbols.map((l) => [l.libId, l]));
      for (const s of d.symbols) {
        if (seen.has(s.libId)) continue;
        seen.add(s.libId);
        const lib = libs.get(s.libId);
        if (lib && lib.isPower === powerOnly) out.push({ libId: s.libId, unit: 1, fields: [] });
      }
    }
    return out;
  }, [chooserOpen, activeTool, liveDocs]);

  // Resolve a LIB_ID from the schematics' embedded library caches, so the
  // chooser groups show descriptions/units without refetching libraries.
  const getPlacedLibSymbol = useCallback(
    (libId: string): LibSymbol | undefined => {
      const own = libById.get(libId);
      if (own) return own;
      for (const d of liveDocs().values()) {
        const hit = d.libSymbols.find((l) => l.libId === libId);
        if (hit) return hit;
      }
      return undefined;
    },
    [libById, liveDocs],
  );

  const onChooserOk = useCallback(
    (result: SymbolChooserResult | null) => {
      // OK with nothing selected returns an invalid LIB_ID; the tool ignores
      // it and the chooser comes straight back (sch_drawing_tools.cpp).
      if (!result) return;
      const { symbol, unit, fields, keepSymbol, placeAllUnits } = result;

      // Field edits (the footprint override) land on the embedded library copy.
      let lib = symbol;
      for (const [key, value] of fields) {
        const properties = lib.properties.some((p) => p.key === key)
          ? lib.properties.map((p) => (p.key === key ? { ...p, value } : p))
          : [
              ...lib.properties,
              (() => {
                const field = {
                  key,
                  value,
                  angle: 0,
                  effects: { hidden: true, fontSize: [12700, 12700] as [number, number] },
                };
                return { ...field, source: buildPropertyNode(field) };
              })(),
            ];
        lib = { ...lib, properties };
      }

      const unitCount = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0)).size || 1;
      placeFlags.current = { keepSymbol, placeAllUnits, unitCount };
      setPlaceUnit(unit > 0 ? unit : 1);

      // AddSymbolToHistory: most recent first, deduplicated by LIB_ID.
      const hist = activeTool === 'placePower' ? sPowerHistoryList : sSymbolHistoryList;
      const dup = hist.findIndex((h) => h.libId === symbol.libId);
      if (dup >= 0) hist.splice(dup, 1);
      hist.unshift({ libId: symbol.libId, unit: unit > 0 ? unit : 1, fields });

      setPlaceLib(lib);
    },
    [activeTool],
  );

  // After each placement: step to the next unit ("Place all units"), keep the
  // symbol attached ("Place repeated copies"), or clear it so the chooser
  // reopens — mirroring the continuation in SCH_DRAWING_TOOLS::PlaceSymbol.
  const onSymbolPlaced = useCallback(() => {
    const { keepSymbol, placeAllUnits, unitCount } = placeFlags.current;
    if (placeAllUnits && unitCount > 1) {
      if (placeUnit < unitCount) {
        setPlaceUnit(placeUnit + 1);
        return;
      }
      if (keepSymbol) {
        setPlaceUnit(1); // wrap around and keep cycling
        return;
      }
    } else if (keepSymbol) {
      return; // same symbol stays on the cursor
    }
    setPlaceLib(null);
    setPlaceUnit(1);
  }, [placeUnit]);

  // The stored page number of the sheet instance at `path`
  // (SCH_SHEET_PATH::GetPageNumber): the root sheet from the document-level
  // sheet_instances, a sub-sheet from its object's instances in the parent doc.
  const pageNumberOf = useCallback(
    (path: string): string => {
      const docs = liveDocs();
      const rootDoc = docs.get(project.current.root);
      if (path === '/') return rootDoc ? getRootPageNumber(rootDoc) : '';
      const rootUuid = rootDoc?.uuid;
      if (!rootUuid) return '';
      const chain = path.split('/').filter(Boolean);
      const ownUuid = chain[chain.length - 1];
      const parent = flatSheets.find((s) => s.path === (parentPath(path) ?? '/'));
      const parentDoc = docs.get(parent?.file ?? project.current.root);
      const sheet = parentDoc?.sheets.find((s) => s.uuid === ownUuid);
      return sheet ? getSheetPageNumber(sheet, instanceKey(rootUuid, chain)) : '';
    },
    [liveDocs, flatSheets],
  );

  // Set the current sheet's page number (SCH_ACTIONS::editPageNumber →
  // SCH_SHEET_PATH::SetPageNumber). The root edits its own document; a sub-sheet
  // edits its object in the *parent* document (through that doc's own history).
  const editPageNumber = useCallback(
    (page: string) => {
      if (currentPath === '/') {
        runCommand(setRootPageNumberCommand(page));
        return;
      }
      const docs = liveDocs();
      const rootUuid = docs.get(project.current.root)?.uuid;
      if (!rootUuid) return;
      const chain = currentPath.split('/').filter(Boolean);
      const ownUuid = chain[chain.length - 1];
      const parent = flatSheets.find((s) => s.path === (parentPath(currentPath) ?? '/'));
      const parentFile = parent?.file ?? project.current.root;
      const parentDoc = parentFile === currentFile ? doc : project.current.docs.get(parentFile);
      if (!parentDoc) return;
      const sheetIndex = parentDoc.sheets.findIndex((s) => s.uuid === ownUuid);
      if (sheetIndex === -1) return;
      const cmd = setSheetPageNumberCommand(sheetIndex, instanceKey(rootUuid, chain), page);
      if (parentFile === currentFile) {
        runCommand(cmd);
      } else {
        // Edit the parent document via its own undo history (SCH_COMMIT on it).
        if (!histories.current.has(parentFile)) histories.current.set(parentFile, new History());
        project.current.docs.set(
          parentFile,
          histories.current.get(parentFile)!.execute(parentDoc, withCleanup(cmd, libById)),
        );
        onProjectChange?.([
          { name: parentFile, text: serializeSchematic(project.current.docs.get(parentFile)!) },
        ]);
        forcePageRefresh((n) => n + 1);
      }
    },
    [currentPath, currentFile, doc, flatSheets, liveDocs, runCommand, onProjectChange, libById],
  );

  // Find / Find and Replace (SCH_FIND_REPLACE_TOOL): modeless dialog state
  // (false, or which mode it opened in), the search settings, and a cursor
  // over the matches across sheet instances in hierarchy order.
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [searchData, setSearchData] = useState<SchSearchData>(defaultSearchData);
  const [findStatus, setFindStatus] = useState('');
  const findCursor = useRef(-1);
  const lastMatch = useRef<{ id: string } | null>(null);
  const openFindDialog = useCallback((mode: 'find' | 'replace') => {
    setFindOpen(mode);
    // Replace mode excludes reference designators from matches unless opted in.
    setSearchData((d) => ({ ...d, searchAndReplace: mode === 'replace' }));
  }, []);

  // Annotate Schematic (SCH_EDIT_FRAME::AnnotateSymbols) dialog.
  const [annotateOpen, setAnnotateOpen] = useState(false);
  // Page Settings (DIALOG_PAGES_SETTINGS), Print (DIALOG_PRINT) and Plot
  // (DIALOG_PLOT_SCHEMATIC) dialogs — open flags.
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  // Raw project files (kept for the .kicad_pro drawing-sheet reference and the
  // project's .kicad_wks files); reseeded whenever a project is (re)opened.
  const [rawFiles, setRawFiles] = useState<PickedFile[]>(() => initialProject ?? []);
  // In-session Page Settings override of the drawing sheet: `name` '' = built-in
  // default. Persisted to .kicad_pro (schematic.page_layout_descr_file) on OK;
  // otherwise the sheet is resolved from the project like KiCad does.
  const [sheetOverride, setSheetOverride] = useState<{
    name: string;
    sheet: WksSheet | null;
  } | null>(null);
  // Project files plus any .kicad_wks saved this session (the .kicad_pro
  // reference lives in rawFiles; the sheets themselves may come from either).
  const allFiles = useMemo(
    () => (extraSheetFiles?.length ? [...rawFiles, ...extraSheetFiles] : rawFiles),
    [rawFiles, extraSheetFiles],
  );
  // The drawing sheet to draw (override else the project reference), its file
  // name for the dialog, and the project's .kicad_wks choices.
  const activeSheet = useMemo(
    () => (sheetOverride ? sheetOverride.sheet : resolveActiveSheet(allFiles)),
    [allFiles, sheetOverride],
  );
  const sheetRefName = sheetOverride ? sheetOverride.name : readSheetRef(rawFiles);
  const sheetChoices = useMemo(
    () =>
      listProjectSheetFiles(allFiles).map((name) => ({
        name,
        sheet: parseProjectSheet(allFiles, name),
      })),
    [allFiles],
  );
  const [printOpen, setPrintOpen] = useState(false);
  const [plotOpen, setPlotOpen] = useState(false);
  // Paste Special (DIALOG_PASTE_SPECIAL): pick the PASTE_MODE before pasting.
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false);
  // Schematic Setup (DIALOG_SCHEMATIC_SETUP): project-scoped settings, incl. the
  // ERC severities + pin-conflict map that the ERC checker reads.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<SchematicSetup>(defaultSchematicSetup);
  // Generate Bill of Materials (Symbol Fields Table export) dialog.
  const [bomOpen, setBomOpen] = useState(false);
  // Export Netlist (DIALOG_EXPORT_NETLIST) dialog.
  const [netlistOpen, setNetlistOpen] = useState(false);
  // Bulk Edit Symbol Fields (Symbol Fields Table edit view) dialog.
  const [fieldsTableOpen, setFieldsTableOpen] = useState(false);
  // Symbol Library Browser (SYMBOL_VIEWER_FRAME).
  const [browserOpen, setBrowserOpen] = useState(false);
  // Assign Footprints (CVPCB_MAINFRAME).
  const [assignFpOpen, setAssignFpOpen] = useState(false);
  const runAnnotate = useCallback(
    (opts: AnnotateOptions) => {
      runCommand(annotateCommand(libById, opts, selection));
      setAnnotateOpen(false);
    },
    [runCommand, libById, selection],
  );
  const runClearAnnotation = useCallback(
    (scope: AnnotateOptions['scope']) => {
      runCommand(clearAnnotationCommand(scope, selection));
    },
    [runCommand, selection],
  );

  // Page Settings (DIALOG_PAGES_SETTINGS::onOK): write paper + title block back
  // through an undoable command; fields with "Export to other sheets" checked
  // are copied into every other sheet file (upstream's OnOkClick loop), via
  // the same cross-document pattern as the bulk field edits.
  const applyPageSettings = useCallback(
    (next: PageSettings, exports: PageExportFlags, sheet: WksSheet | null, sheetName: string) => {
      runCommand(setPageSettingsCommand(next));
      // Adopt the chosen drawing sheet (name '' = built-in default) and persist
      // it into .kicad_pro (schematic.page_layout_descr_file), like KiCad.
      setSheetOverride({ name: sheetName, sheet });
      setRawFiles((prev) => {
        const pro = prev.find((f) => /\.kicad_pro$/i.test(f.name));
        if (!pro) return prev;
        const updated = writeSheetRefText(pro.text, sheetName);
        if (updated === null || updated === pro.text) return prev;
        const changed = { name: pro.name, text: updated };
        // Persist the reference now (not via the debounced autosave) so a
        // reopen straight after picking the sheet reads it back.
        onPersistFiles?.([changed]);
        return prev.map((f) => (f.name === pro.name ? changed : f));
      });
      const anyExport =
        exports.paper ||
        exports.date ||
        exports.rev ||
        exports.title ||
        exports.company ||
        exports.comments.some(Boolean);
      if (anyExport) {
        const changedFiles: PickedFile[] = [];
        for (const [file, target] of project.current.docs) {
          if (file === currentFile) continue;
          const cur = getPageSettings(target);
          const merged: PageSettings = {
            paper: exports.paper ? next.paper : cur.paper,
            date: exports.date ? next.date : cur.date,
            rev: exports.rev ? next.rev : cur.rev,
            title: exports.title ? next.title : cur.title,
            company: exports.company ? next.company : cur.company,
            comments: cur.comments.map((c, i) =>
              exports.comments[i] ? (next.comments[i] ?? c) : c,
            ),
          };
          if (!histories.current.has(file)) histories.current.set(file, new History());
          const updated = histories.current
            .get(file)!
            .execute(target, withCleanup(setPageSettingsCommand(merged), libById));
          project.current.docs.set(file, updated);
          try {
            changedFiles.push({ name: file, text: serializeSchematic(updated) });
          } catch {
            /* skip a bad sheet */
          }
        }
        if (changedFiles.length) onProjectChange?.(changedFiles);
      }
      setPageSettingsOpen(false);
    },
    [runCommand, currentFile, onProjectChange, onPersistFiles, libById],
  );

  // A base file name for a printed/plotted output (KiCad names plots after the
  // sheet file): the current sheet's name without extension, else the title.
  const outputBaseName = useCallback((): string => {
    const base = currentFile !== DEFAULT_FILE ? currentFile : (fileName ?? '');
    const noExt = base.replace(/\.kicad_sch$/i, '');
    return noExt || doc?.titleBlock?.title || 'schematic';
  }, [currentFile, fileName, doc]);

  // Commit a new SchematicSetup: adopt it and write the project's .kicad_pro
  // (SCHEMATIC_SETTINGS / ERC_SETTINGS / NET_SETTINGS all live there),
  // preserving every key the dialog does not own — same flow as the
  // drawing-sheet reference in applyPageSettings. Used by the Schematic Setup
  // dialog's OK and by dialogs that write single settings back (Annotate).
  const commitSetup = useCallback(
    (next: SchematicSetup) => {
      setSetup(next);
      setRawFiles((prev) => {
        const pro = findProjectPro(prev, rootPro ?? undefined);
        if (!pro) return prev;
        const updated = writeSchematicSetupText(pro.text, next);
        if (updated === null || updated === pro.text) return prev;
        const changed = { name: pro.name, text: updated };
        // Persist now (not via the debounced autosave) so a reopen straight
        // after the dialog reads the new settings back.
        onPersistFiles?.([changed]);
        return prev.map((f) => (f.name === pro.name ? changed : f));
      });
    },
    [rootPro, onPersistFiles],
  );

  // Per-item netclass render fallbacks (wire colour/width/style, junction
  // clamp) for the current sheet — reuses the connectivity memo; undefined
  // when no class carries a visual parameter.
  const netOverrides = useMemo(
    () => (doc ? computeNetClassOverrides(doc, libById, setup, netlist) : undefined),
    [doc, libById, setup, netlist],
  );

  // Drawing defaults shared by every output (screen, print, plot), derived
  // from Schematic Setup > Formatting the way SCH_RENDER_SETTINGS is seeded
  // from SCHEMATIC_SETTINGS upstream (eeschema_config.cpp).
  const drawingDefaults = useMemo(
    () => ({
      junctionDiameterIU: junctionDotDiameterIU(setup),
      dashLengthRatio: setup.formatting.dashLengthRatio,
      gapLengthRatio: setup.formatting.gapLengthRatio,
      // The panel stores percent (KiCad UI convention); the ratio is /100.
      textOffsetRatio: setup.formatting.labelOffsetRatio / 100,
      labelSizeRatio: setup.formatting.labelSizeRatio / 100,
      // Overbar offset is stored as the raw ratio (1.23), not percent.
      overbarHeightRatio: setup.formatting.overbarOffsetRatio,
      // 0 mils is meaningful: KiCad's per-pin text-size fallback.
      pinSymbolSizeIU: setup.formatting.pinSymbolSizeMils * IU_PER_MILS,
    }),
    [setup],
  );

  // Print (DIALOG_PRINT): render the current sheet and open the browser print
  // flow, optionally with a different colour theme (m_useColorTheme choice).
  const doPrint = useCallback(
    (opts: PlotOpts, themeId?: string) => {
      const printTheme =
        themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      // Junction dots, dash ratios, label offsets and netclass visuals print
      // at their Schematic Setup values, like the screen.
      const o: PlotOpts = {
        ...opts,
        ...drawingDefaults,
        ...(netOverrides ? { netOverrides } : {}),
        ...(activeSheet ? { sheet: activeSheet } : {}),
      };
      if (doc) printSheet(doc, printTheme, o, outputBaseName());
      setPrintOpen(false);
    },
    [doc, theme, outputBaseName, activeSheet, drawingDefaults, netOverrides],
  );

  // Print Preview (DIALOG_PRINT's Apply / OnPrintPreview): render into a new tab
  // without auto-printing, and keep the dialog open so options can be adjusted.
  const doPreview = useCallback(
    (opts: PlotOpts, themeId?: string) => {
      const printTheme =
        themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      const o: PlotOpts = {
        ...opts,
        ...drawingDefaults,
        ...(netOverrides ? { netOverrides } : {}),
        ...(activeSheet ? { sheet: activeSheet } : {}),
      };
      if (doc) printSheet(doc, printTheme, o, outputBaseName(), true);
    },
    [doc, theme, outputBaseName, activeSheet, drawingDefaults, netOverrides],
  );

  // Bulk Edit Symbol Fields: apply the changed cells per sheet — the current
  // sheet through the live undo history, other sheets through their own
  // histories (the same cross-document pattern as editPageNumber/ReplaceAll).
  const applyFieldsEdits = useCallback(
    (edits: FieldsEdits) => {
      const changedFiles: PickedFile[] = [];
      for (const [file, perSymbol] of edits) {
        const cmd = bulkEditFieldsCommand(perSymbol);
        if (file === currentFile) {
          runCommand(cmd);
          continue;
        }
        const target = project.current.docs.get(file);
        if (!target) continue;
        if (!histories.current.has(file)) histories.current.set(file, new History());
        const next = histories.current.get(file)!.execute(target, withCleanup(cmd, libById));
        project.current.docs.set(file, next);
        try {
          changedFiles.push({ name: file, text: serializeSchematic(next) });
        } catch {
          /* skip a bad sheet */
        }
      }
      if (changedFiles.length) onProjectChange?.(changedFiles);
      setFieldsTableOpen(false);
    },
    [currentFile, runCommand, onProjectChange, libById],
  );

  // Plot (DIALOG_PLOT_SCHEMATIC): write the chosen file format for download.
  // "Plot All Pages" (the upstream OK button) plots every sheet file to its
  // own download; "Plot Current Page" (wxID_APPLY) plots just this sheet.
  // `themeId` selects the plot colour theme (the "Color theme:" choice).
  const doPlot = useCallback(
    (format: PlotFormat, opts: PlotOpts, allPages: boolean, themeId?: string) => {
      const plotTheme = themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      const o: PlotOpts = {
        ...opts,
        ...drawingDefaults,
        ...(activeSheet ? { sheet: activeSheet } : {}),
      };
      const one = (d: Schematic, name: string): void => {
        // Netclass visuals resolve per sheet (each document has its own nets).
        const nov = computeNetClassOverrides(
          d,
          new Map(d.libSymbols.map((l) => [l.libId, l])),
          setup,
        );
        const od: PlotOpts = { ...o, ...(nov ? { netOverrides: nov } : {}) };
        if (format === 'svg') plotSvg(d, plotTheme, od, name);
        else if (format === 'png') void plotPng(d, plotTheme, od, name);
        else void plotPdf(d, plotTheme, od, name);
      };
      if (allPages) {
        for (const [file, d] of liveDocs())
          one(d, file.replace(/\.kicad_sch$/i, '') || outputBaseName());
      } else if (doc) one(doc, outputBaseName());
      setPlotOpen(false);
    },
    [doc, theme, outputBaseName, liveDocs, activeSheet, drawingDefaults, setup],
  );
  useEffect(() => {
    // Changed search settings restart the scan (upstream m_foundItemHighlight reset).
    findCursor.current = -1;
    lastMatch.current = null;
    setFindStatus('');
  }, [searchData]);

  // Load a schematic from raw .kicad_sch text: parse (lossless), fresh history,
  // clear transient state, and fit the view. Embedded lib_symbols render as-is.
  const resetTransient = useCallback(() => {
    setSelection(new Set());
    setHighlightItem(null);
    setPendingLabel(null);
    setActiveTool('select');
    setPlaceLib(null);
    setPlaceUnit(1);
    setPastePending(null);
    setErcResult(null);
    setPropsTarget(null);
  }, []);

  const loadText = useCallback(
    async (text: string, name?: string) => {
      setLoading('Loading schematic…');
      await nextPaint();
      try {
        const next = { ...readSchematic(parse(text)), fileName: name ?? 'untitled.kicad_sch' };
        const file = name ?? 'untitled.kicad_sch';
        project.current = { docs: new Map([[file, next]]), root: file };
        histories.current = new Map([[file, new History()]]);
        history.current = histories.current.get(file)!;
        setCurrentFile(file);
        setCurrentPath('/');
        navTool.current.resetHistory('/');
        setDoc(next);
        resetTransient();
        if (name) setFileName(name);
        setError(null);
        // Fit after React commits the new doc to the canvas.
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    },
    [resetTransient],
  );

  // Open a whole KiCad project: parse every .kicad_sch, find the root (the
  // .kicad_pro's schematic, else the sheet nothing references), and show it.
  const loadProject = useCallback(
    async (files: PickedFile[], startFile?: string) => {
      setLoading('Loading schematic…');
      await nextPaint(); // paint the overlay before the (synchronous) sheet parse
      try {
        const docs = new Map<string, Schematic>();
        const problems: string[] = [];
        let proName: string | undefined;
        // When a folder bundles several projects, the launcher pins the active
        // one via rootPro; load that project's .kicad_pro so the editor's root
        // sheet matches the tree instead of guessing the first pro found.
        const wantPro = rootPro ? `${rootPro}.kicad_pro`.toLowerCase() : null;
        // Parse sheet by sheet with a per-sheet gauge (KiCad's "Loading
        // Schematic" progress dialog), yielding a paint between sheets so the
        // bar advances even though each parse is synchronous.
        const sheets = files.filter((f) =>
          /\.kicad_sch$/i.test(f.name.split('/').pop()!.split('\\').pop()!),
        );
        let parsed = 0;
        for (const f of files) {
          const base = f.name.split('/').pop()!.split('\\').pop()!;
          if (/\.kicad_pro$/i.test(base)) {
            // Prefer the active project's .kicad_pro (rootPro) so the editor and
            // the launcher tree open the same root sheet. Absent that, fall back
            // to the FIRST .kicad_pro (matching projectNameOf and the tree root);
            // picking a later one would open a different root than the tree shows
            // and the two would then edit different sheets and diverge.
            if (wantPro && base.toLowerCase() === wantPro) proName = base;
            else proName ??= base;
            continue;
          }
          if (!/\.kicad_sch$/i.test(base)) continue;
          setLoading({
            message: `Loading schematic: ${base}`,
            detail: `${parsed + 1} of ${sheets.length} sheets`,
            value: parsed / sheets.length,
          });
          if (sheets.length > 1) await nextPaint();
          try {
            docs.set(base, { ...readSchematic(parse(f.text)), fileName: base });
          } catch (e) {
            problems.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
          }
          parsed++;
        }
        if (docs.size === 0) {
          setError(problems[0] ?? 'No .kicad_sch files in the selection');
          return;
        }
        const root = findRootFile(docs, proName);
        project.current = { docs, root };
        // Home-page tree clicks land on the clicked sheet, else the root.
        const startBase = startFile?.split('/').pop()?.split('\\').pop();
        const start = startBase && docs.has(startBase) ? startBase : root;
        const wantRoot = proName?.replace(/\.kicad_pro$/i, '.kicad_sch');
        if (wantRoot && !docs.has(wantRoot) && start === root)
          problems.push(
            `root schematic ${wantRoot} is not in the selection — opened ${root} instead`,
          );
        histories.current = new Map([[start, new History()]]);
        history.current = histories.current.get(start)!;
        setCurrentFile(start);
        // Home-tree opens the root; deeper instances are entered from the canvas.
        setCurrentPath('/');
        navTool.current.resetHistory('/');
        setDoc(docs.get(start)!);
        resetTransient();
        setFileName(start);
        setError(problems.length ? `Some sheets failed to load: ${problems.join('; ')}` : null);
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } finally {
        setLoading(null);
      }
    },
    [resetTransient, rootPro],
  );

  // A project handed over from the home page's Open Project picker.
  useEffect(() => {
    if (initialProject && initialProject.length > 0)
      void loadProject(initialProject, initialFile ?? undefined);
    // Reseed the raw files (drawing-sheet reference + .kicad_wks choices) and
    // drop any in-session sheet override for the freshly opened project.
    setRawFiles(initialProject ?? []);
    setSheetOverride(null);
    // Hydrate the Schematic Setup from the project's .kicad_pro (SCHEMATIC/ERC/
    // NET_SETTINGS live in the project file, like KiCad's project load).
    setSetup(readSchematicSetup(initialProject ?? [], rootPro ?? undefined));
    // rootPro is a dep so switching the active project (same folder, different
    // .kicad_pro) reloads with the newly-pinned root sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProject, rootPro]);

  // Serialize the project's sheets (current sheet + resident others) for autosave.
  const serializeSheets = useCallback((): PickedFile[] => {
    if (!doc) return [];
    const docs = new Map(project.current.docs);
    docs.set(currentFile, doc);
    const files: PickedFile[] = [];
    for (const [file, d] of docs) {
      try {
        files.push({ name: file, text: serializeSchematic(d) });
      } catch {
        /* skip a bad sheet */
      }
    }
    return files;
  }, [doc, currentFile]);

  // Autosave: once edits settle, hand the sheets up (App debounces the write to
  // IndexedDB). Fires on sheet switch/load too, re-saving identical content.
  useEffect(() => {
    if (!doc || !onProjectChange) return;
    const t = setTimeout(() => {
      const files = serializeSheets();
      if (files.length) onProjectChange(files);
    }, 900);
    return () => clearTimeout(t);
  }, [doc, onProjectChange, serializeSheets]);

  // Register a flush so the host can force the pending autosave out before the
  // project is reopened (the "edit → home → reopen" case).
  useEffect(() => {
    if (!registerAutosaveFlush) return;
    registerAutosaveFlush(() => {
      const files = serializeSheets();
      if (files.length) onProjectChange?.(files);
    });
    return () => registerAutosaveFlush(null);
  }, [registerAutosaveFlush, onProjectChange, serializeSheets]);

  // "Add symbol to schematic" from the Symbol Editor: attach the symbol to the
  // cursor exactly as the Place Symbol tool does after its chooser.
  useEffect(() => {
    if (!placeRequest) return;
    placeFlags.current = { keepSymbol: true, placeAllUnits: false, unitCount: 1 };
    setPlaceUnit(1);
    setPlaceLib(placeRequest.lib);
    setActiveTool('placeSymbol');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeRequest?.nonce]);

  // Switch the visible sheet (KiCad's Enter Sheet / hierarchy navigation): stash
  // the edited current sheet back into the project, swap in the target document
  // and its own undo history.
  const switchSheet = useCallback(
    (path: string, file: string, pushHistory = true) => {
      // Every sheet change lands in the Back/Forward history (changeSheet →
      // pushToHistory); Back/Forward themselves move the cursor instead.
      if (pushHistory) navTool.current.pushToHistory(path);
      // Always record which instance is active (path is unique per instance).
      setCurrentPath(path);
      // Two instances of the same file share one document — nothing to swap, just
      // the active path changed.
      if (!doc || file === currentFile) return;
      const proj = project.current;
      proj.docs.set(currentFile, doc);
      const target = proj.docs.get(file);
      if (!target) {
        setError(`Sheet file not in project: ${file}`);
        return;
      }
      if (!histories.current.has(file)) histories.current.set(file, new History());
      history.current = histories.current.get(file)!;
      setCurrentFile(file);
      setDoc(target);
      resetTransient();
      requestAnimationFrame(() => controller.current?.zoomToFit());
    },
    [doc, currentFile, resetTransient],
  );

  // FindNext/FindPrevious (SCH_FIND_REPLACE_TOOL): collect matches over the
  // sheet instances (hierarchy order, or just the current instance), advance
  // the cursor with wrap-around, then jump: switch sheet, select, centre.
  const doFind = useCallback(
    (dir: 1 | -1) => {
      const docs = new Map(project.current.docs);
      if (doc) docs.set(currentFile, doc);
      const sheets = searchData.searchCurrentSheetOnly
        ? flatSheets.filter((s) => s.path === currentPath)
        : flatSheets;
      const all = sheets.flatMap((s) => {
        const d = docs.get(s.file);
        if (!d) return [];
        // Selection scoping and net-name search only make sense on the sheet
        // that owns the selection/netlist we have live (the current sheet).
        const ctx = s.path === currentPath ? { selection, nets: netlist?.nets } : {};
        return findMatches(d, libById, searchData, ctx).map((m) => ({ ...m, sheet: s }));
      });
      if (all.length === 0) {
        findCursor.current = -1;
        lastMatch.current = null;
        setFindStatus(searchData.findString ? 'Not found' : '');
        return;
      }
      findCursor.current =
        findCursor.current === -1
          ? dir === 1
            ? 0
            : all.length - 1
          : (findCursor.current + dir + all.length) % all.length;
      const m = all[findCursor.current]!;
      lastMatch.current = { id: m.id };
      if (m.sheet.path !== currentPath) switchSheet(m.sheet.path, m.sheet.file);
      setSelection(new Set([m.id]));
      // After a sheet switch the canvas fits first (rAF); centre on the frame after.
      requestAnimationFrame(() => requestAnimationFrame(() => controller.current?.centerOn(m.pos)));
      setFindStatus(`${findCursor.current + 1} of ${all.length}`);
    },
    [
      doc,
      currentFile,
      currentPath,
      flatSheets,
      libById,
      searchData,
      selection,
      netlist,
      switchSheet,
    ],
  );

  // ReplaceAndFindNext: replace inside the current match, then find the next
  // one against the post-replace document (next frame, after setDoc lands).
  const doFindRef = useRef(doFind);
  doFindRef.current = doFind;
  const doReplaceNext = useCallback(() => {
    if (!searchData.findString) return;
    if (findCursor.current === -1 || !lastMatch.current) {
      doFind(1);
      return;
    }
    runCommand(replaceCommand(searchData, new Set([lastMatch.current.id])));
    // The replaced item usually drops out of the match list; step the cursor
    // back so the follow-up FindNext lands on the item after it.
    findCursor.current = Math.max(-1, findCursor.current - 1);
    lastMatch.current = null;
    requestAnimationFrame(() => doFindRef.current(1));
  }, [searchData, runCommand, doFind]);

  // ReplaceAll: substitute in every matched item — on the current sheet only,
  // or in every document of the project, each through its own undo history.
  const doReplaceAll = useCallback(() => {
    if (!searchData.findString) return;
    if (!searchData.searchCurrentSheetOnly) {
      for (const [file, target] of project.current.docs) {
        if (file === currentFile) continue;
        if (!histories.current.has(file)) histories.current.set(file, new History());
        project.current.docs.set(
          file,
          histories.current
            .get(file)!
            .execute(target, withCleanup(replaceCommand(searchData), libById)),
        );
      }
    }
    runCommand(replaceCommand(searchData));
    findCursor.current = -1;
    lastMatch.current = null;
    setFindStatus('');
  }, [searchData, runCommand, currentFile, libById]);

  // KiCad's Properties action: symbols have a full properties dialog; a text box
  // reopens its text editor (double-click = edit).
  const onEditItem = useCallback(
    (
      id: string,
      kind:
        | 'symbol'
        | 'line'
        | 'junction'
        | 'noconnect'
        | 'label'
        | 'sheet'
        | 'busentry'
        | 'image'
        | 'graphic'
        | 'textbox'
        | 'table',
    ) => {
      if (kind === 'symbol') setPropsTarget(id);
      if (kind === 'label' && doc) {
        const idx = doc.labels.findIndex((l, i) => refId('label', l.uuid, i) === id);
        if (idx !== -1) {
          const l = doc.labels[idx]!;
          setLabelEdit({ index: idx, kind: l.kind, text: l.text, shape: l.shape });
        }
      }
      if (kind === 'textbox' && doc) {
        const idx = doc.textBoxes.findIndex((tb, i) => refId('textbox', tb.uuid, i) === id);
        if (idx !== -1) {
          const tb = doc.textBoxes[idx]!;
          setTextBoxDraw({ start: tb.start, end: tb.end, text: tb.text, editIndex: idx });
        }
      }
      if (kind === 'table' && doc) {
        const idx = doc.tables.findIndex((t, i) => refId('table', t.uuid, i) === id);
        if (idx !== -1) {
          const t = doc.tables[idx]!;
          setTableEdit({
            index: idx,
            rows: t.rowHeights.length,
            cols: t.columnCount,
            texts: t.cells.map((c) => c.text),
          });
        }
      }
      // Double-clicking a sheet enters it (KiCad's Enter Sheet).
      if (kind === 'sheet' && doc) {
        const idx = doc.sheets.findIndex((sh, i) => refId('sheet', sh.uuid, i) === id);
        if (idx !== -1) {
          const sh = doc.sheets[idx]!;
          const file = sheetFile(sh);
          // Descend from the current instance path (KiCad's SCH_SHEET_PATH push).
          if (file) switchSheet(`${currentPath}${sh.uuid || `i${idx}`}/`, file);
        }
      }
    },
    [doc, currentPath, switchSheet],
  );

  // SCH_EDIT_TOOL::Properties — route a single item to its properties dialog:
  // symbols open the full symbol dialog, labels/text boxes/tables their
  // editors, wires/junctions/sheets their small dialogs. Shared by the E
  // hotkey and the selection context menu, like the upstream action.
  const openProperties = useCallback(
    (id: string) => {
      setDoc((d) => {
        if (!d) return d;
        if (d.symbols.some((s, i) => refId('symbol', s.uuid, i) === id)) setPropsTarget(id);
        else if (d.labels.some((l, i) => refId('label', l.uuid, i) === id)) onEditItem(id, 'label');
        else if (d.textBoxes.some((tb, i) => refId('textbox', tb.uuid, i) === id))
          onEditItem(id, 'textbox');
        else if (d.tables.some((t, i) => refId('table', t.uuid, i) === id)) onEditItem(id, 'table');
        else if (d.lines.some((l, i) => refId('line', l.uuid, i) === id)) {
          // Wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES).
          const li = d.lines.findIndex((l, i) => refId('line', l.uuid, i) === id);
          const l = d.lines[li]!;
          if (l.kind !== 'polyline')
            setLineEdit({
              index: li,
              widthIU: l.stroke?.width ?? 0,
              style: l.stroke?.type ?? 'default',
              color: l.stroke?.color,
            });
        } else if (d.junctions.some((j, i) => refId('junction', j.uuid, i) === id)) {
          const ji = d.junctions.findIndex((j, i) => refId('junction', j.uuid, i) === id);
          setJunctionEdit({
            index: ji,
            diameterIU: d.junctions[ji]!.diameter,
            color: d.junctions[ji]!.color,
          });
        } else {
          // Properties on a sheet opens its dialog (double-click enters it).
          const si = d.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === id);
          if (si !== -1) {
            const sh = d.sheets[si]!;
            setSheetEdit({
              index: si,
              name: sheetName(sh),
              // Raw Sheetfile field value (may carry a sub-path), not the basename.
              file: sh.fields.find((f) => f.key === 'Sheetfile')?.value ?? '',
            });
          }
        }
        return d;
      });
    },
    [onEditItem],
  );

  const openFile = useCallback(
    (file: File) => {
      if (!/\.kicad_sch$/i.test(file.name)) {
        setError(`Not a .kicad_sch file: ${file.name}`);
        return;
      }
      file
        .text()
        .then((t) => void loadText(t, file.name))
        .catch((e) => setError(String(e)));
    },
    [loadText],
  );

  const promptOpen = useCallback(() => fileInputRef.current?.click(), []);

  // Doc edits mark the title dirty; the flag clears after the app's coalesced
  // autosave window (1.2 s) has taken the change. Mount / file switches skip.
  useEffect(() => {
    dirtySkipRef.current = true;
  }, [currentFile]);
  useEffect(() => {
    if (dirtySkipRef.current) {
      dirtySkipRef.current = false;
      return;
    }
    setDirty(true);
    const id = setTimeout(() => setDirty(false), 1600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const save = useCallback(() => {
    setDirty(false);
    setDoc((d) => {
      if (!d) return d;
      const text = serializeSchematic(d);
      if (onPersistFiles && currentFile !== DEFAULT_FILE) {
        // Save writes into the project's file manager (cloud storage); a local
        // copy can be downloaded from there (or via Save a Copy).
        onPersistFiles([{ name: currentFile, text }]);
        return d;
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download =
        currentFile !== DEFAULT_FILE
          ? currentFile
          : (fileName ?? `${d.titleBlock?.title ?? 'schematic'}.kicad_sch`);
      a.click();
      URL.revokeObjectURL(url);
      return d;
    });
  }, [fileName, currentFile]);

  // ----- copy / cut / paste / duplicate (SCH_EDITOR_CONTROL port) -------------
  // Copy writes KiCad's clipboard format (lib_symbols + items as S-expressions),
  // so text copied here pastes into desktop KiCad and vice versa. Paste parses
  // the clipboard, gives everything fresh UUIDs, re-annotates duplicate
  // references, and attaches the items to the cursor until clicked to drop.
  // Text-entry focus only: a focused checkbox/radio (e.g. the Selection
  // Filter panel) must not swallow editor hotkeys the way a text box does.
  const isTyping = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    return (
      el.tagName === 'INPUT' &&
      !/^(checkbox|radio|button|range)$/.test((el as HTMLInputElement).type)
    );
  };

  useEffect(() => {
    // Editors stay mounted behind display:none — only the visible frame may
    // own the document clipboard events (see App's activeView stamp).
    const hidden = (): boolean => (document.body.dataset.activeView ?? 'schematic') !== 'schematic';
    const onCopy = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
      e.clipboardData?.setData('text/plain', copySelectionText(doc, selection));
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
      e.clipboardData?.setData('text/plain', copySelectionText(doc, selection));
      e.preventDefault();
      runCommand(deleteByIds(selection));
      setSelection(new Set());
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || propsTarget !== null || !doc) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const payload = parsePastedText(text, doc);
      if (!payload) return;
      e.preventDefault();
      setActiveTool('select');
      setPastePending(payload);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [doc, selection, propsTarget, runCommand]);

  // Duplicate (Ctrl+D): copy to a local buffer and paste from it. KiCad anchors
  // the copy at the connection point closest to the cursor so it doesn't jump.
  const duplicateSelection = useCallback(() => {
    if (!doc || selection.size === 0) return;
    const payload = parsePastedText(copySelectionText(doc, selection), doc);
    if (!payload) return;
    let refPoint = payload.refPoint;
    if (cursor) {
      let best = Infinity;
      const consider = (p: Vec2): void => {
        const d = (p.x - cursor.x) ** 2 + (p.y - cursor.y) ** 2;
        if (d < best) {
          best = d;
          refPoint = p;
        }
      };
      payload.batch.symbols.forEach((s) => consider(s.at));
      payload.batch.lines.forEach((l) => {
        consider(l.start);
        consider(l.end);
      });
      payload.batch.junctions.forEach((j) => consider(j.at));
      payload.batch.labels.forEach((l) => consider(l.at));
    }
    setActiveTool('select');
    setPastePending({ ...payload, refPoint });
  }, [doc, selection, cursor]);

  // The paste was dropped: keep the pasted items selected, as KiCad does.
  const onPasteDone = useCallback((ids: ReadonlySet<string>) => {
    setPastePending(null);
    setSelection(new Set(ids));
  }, []);

  // ----- ERC (Inspect > Electrical Rules Checker) ------------------------------
  const runErcNow = useCallback(() => {
    setDoc((d) => {
      // The ERC severities + pin-conflict map come from Schematic Setup.
      if (d)
        setErcResult(
          runErc(d, new Map(d.libSymbols.map((l) => [l.libId, l])), setup.erc, {
            // Formatting's connection grid feeds the off-grid endpoint test.
            connectionGridIU: setup.formatting.connectionGridMils * IU_PER_MILS,
          }),
        );
      return d;
    });
  }, [setup.erc]);

  // Clicking a violation centres the fault and selects the offending items.
  const locateViolation = useCallback((v: ErcViolation) => {
    controller.current?.centerOn(v.at);
    setSelection(new Set(v.items));
  }, []);

  const lineMode: LineMode =
    es.drawing.line_mode === 0 ? 'free' : es.drawing.line_mode === 2 ? '45' : '90';

  // Display + input options handed to the canvas, straight from the settings
  // (Preferences > Display Options / Grids / Mouse and Touchpad).
  const renderOpts = useMemo<RenderOpts>(
    () => ({
      showHiddenPins: es.appearance.show_hidden_pins,
      showHiddenFields: es.appearance.show_hidden_fields,
      showPageLimits: es.appearance.show_page_limits,
      ...(activeSheet ? { drawingSheet: activeSheet } : {}),
      // Default pen for zero-width strokes = Schematic Setup > Formatting's
      // "Default line width" (SCHEMATIC_SETTINGS::m_DefaultLineWidth), mils→IU.
      defaultPenIU: mmToIU((setup.formatting.defaultLineWidthMils * 25.4) / 1000),
      // Junction-dot size, dash ratios and label/pin text offsets from
      // Schematic Setup > Formatting (SCH_RENDER_SETTINGS seeding).
      ...drawingDefaults,
      // Wire colour/width/style + junction clamp from the resolved netclasses.
      ...(netOverrides ? { netOverrides } : {}),
      selectionThicknessMils: es.selection.thickness,
      highlightThicknessMils: es.selection.highlight_thickness,
      grid: {
        show: es.window.grid.show,
        sizeIU: gridSizeToIU(es.window.grid.sizes[es.window.grid.last_size_idx] ?? '50 mil'),
        style: es.window.grid.style,
        lineWidthPx: es.window.grid.line_width,
        minSpacingPx: es.window.grid.min_spacing,
        overrides: {
          enabled: es.window.grid.overrides_enabled,
          ...(es.window.grid.overrides.connected.enabled
            ? { connected: gridSizeToIU(es.window.grid.overrides.connected.size) }
            : {}),
          ...(es.window.grid.overrides.wires.enabled
            ? { wires: gridSizeToIU(es.window.grid.overrides.wires.size) }
            : {}),
          ...(es.window.grid.overrides.text.enabled
            ? { text: gridSizeToIU(es.window.grid.overrides.text.size) }
            : {}),
          ...(es.window.grid.overrides.graphics.enabled
            ? { graphics: gridSizeToIU(es.window.grid.overrides.graphics.size) }
            : {}),
        },
      },
    }),
    [es, activeSheet, setup, drawingDefaults, netOverrides],
  );

  const inputPrefs = useMemo<InputPrefs>(
    () => ({
      zoomSpeed: common.input.zoom_speed,
      zoomSpeedAuto: common.input.zoom_speed_auto,
      centerOnZoom: common.input.center_on_zoom,
      reverseZoom: common.input.reverse_scroll_zoom,
      scrollModZoom: common.input.scroll_modifier_zoom,
      scrollModPanH: common.input.scroll_modifier_pan_h,
      scrollModPanV: common.input.scroll_modifier_pan_v,
      reverseScrollPanH: common.input.reverse_scroll_pan_h,
      horizontalPan: common.input.horizontal_pan,
      mouseLeft: common.input.mouse_left as InputPrefs['mouseLeft'],
      mouseMiddle: common.input.mouse_middle as InputPrefs['mouseMiddle'],
      mouseRight: common.input.mouse_right as InputPrefs['mouseRight'],
      dragIsMove: es.input.drag_is_move,
      autoStartWires: es.drawing.auto_start_wires,
      crosshair: es.window.cursor.crosshair,
      alwaysShowCrosshair: es.window.cursor.always_show_cursor,
    }),
    [common, es],
  );

  // Selecting a placement tool reopens its chooser/dialog (clears any attached item).
  const onToolSelect = useCallback((id: string) => {
    // The Image tool opens a file picker; the image then follows the cursor
    // (SCH_ACTIONS::placeImage).
    if (id === 'image') {
      imageInputRef.current?.click();
      return;
    }
    // Table tool: prompt for the grid size, then place the table (SCH_TABLE).
    if (id === 'table') {
      setTableDraw({ rows: 2, cols: 2 });
      return;
    }
    setActiveTool(id);
    setPlaceLib(null);
    setPendingLabel(null);
    setPendingImage(null);
  }, []);

  // ----- right-toolbar drawing callbacks ---------------------------------------
  const onSheetDrawn = useCallback((at: Vec2, size: { w: number; h: number }) => {
    setSheetDraw({ at, size, name: 'Sheet', file: 'sheet.kicad_sch' });
  }, []);

  const onSheetPinClick = useCallback((index: number, at: Vec2, side: SheetSide) => {
    setSheetPinDraw({ index, at, side, name: '' });
  }, []);

  const onTextBoxDrawn = useCallback((start: Vec2, end: Vec2) => {
    setTextBoxDraw({ start, end, text: '' });
  }, []);

  const commitTextBox = useCallback(() => {
    setTextBoxDraw((tbd) => {
      if (!tbd?.text.trim()) return tbd;
      if (tbd.editIndex !== undefined && doc) {
        const orig = doc.textBoxes[tbd.editIndex];
        if (orig) runCommand(replaceTextBox(tbd.editIndex, { ...orig, text: tbd.text }));
      } else {
        runCommand(addItems({ textBoxes: [makeTextBox(tbd.start, tbd.end, tbd.text)] }));
      }
      return null;
    });
  }, [doc, runCommand]);

  const commitTable = useCallback(() => {
    setTableDraw((td) => {
      if (!td) return null;
      const rows = Math.max(1, Math.min(50, Math.round(td.rows)));
      const cols = Math.max(1, Math.min(50, Math.round(td.cols)));
      // Anchor at the last cursor position, or a sensible default sheet location.
      const at = cursor ?? { x: 500000, y: 500000 };
      runCommand(addItems({ tables: [makeTable(at, rows, cols)] }));
      return null;
    });
  }, [cursor, runCommand]);

  const commitTableEdit = useCallback(() => {
    setTableEdit((te) => {
      if (!te || !doc) return null;
      const orig = doc.tables[te.index];
      if (orig) {
        const cells = orig.cells.map((c, i) => ({ ...c, text: te.texts[i] ?? c.text }));
        runCommand(replaceTable(te.index, { ...orig, cells }));
      }
      return null;
    });
  }, [doc, runCommand]);

  const commitLabelEdit = useCallback(
    (text: string, shape: LabelShape, format: LabelFormat) => {
      setLabelEdit((le) => {
        if (!le || !doc) return null;
        const orig = doc.labels[le.index];
        if (!orig) return null;
        const effects = {
          hidden: false,
          ...orig.effects,
          bold: format.bold || undefined,
          italic: format.italic || undefined,
          fontSize: [format.sizeIU, format.sizeIU] as [number, number],
        };
        const changed =
          orig.text !== text ||
          (le.shape !== undefined && orig.shape !== shape) ||
          !!orig.effects?.bold !== format.bold ||
          !!orig.effects?.italic !== format.italic ||
          (orig.effects?.fontSize?.[0] ?? 12700) !== format.sizeIU;
        if (changed) {
          const next =
            le.shape !== undefined ? { ...orig, text, shape, effects } : { ...orig, text, effects };
          runCommand(replaceLabel(le.index, next));
        }
        return null;
      });
    },
    [doc, runCommand],
  );

  const commitSheetEdit = useCallback(() => {
    setSheetEdit((se) => {
      if (!se || !doc) return null;
      const orig = doc.sheets[se.index];
      const name = se.name.trim();
      if (orig && name) {
        const fields = orig.fields.map((f) =>
          f.key === 'Sheetname'
            ? { ...f, value: name }
            : f.key === 'Sheetfile'
              ? { ...f, value: se.file.trim() }
              : f,
        );
        runCommand(replaceSheet(se.index, { ...orig, fields }));
      }
      return null;
    });
  }, [doc, runCommand]);

  const commitLineEdit = useCallback(
    (widthIU: number, style: string, color?: ItemColor) => {
      setLineEdit((le) => {
        if (!le || !doc) return null;
        const orig = doc.lines[le.index];
        if (orig) {
          const stroke: { width: number; type: string; color?: ItemColor } = {
            ...(orig.stroke ?? {}),
            width: widthIU,
            type: style,
          };
          if (color) stroke.color = color;
          else delete stroke.color;
          runCommand(replaceLine(le.index, { ...orig, stroke }));
        }
        return null;
      });
    },
    [doc, runCommand],
  );

  const commitJunctionEdit = useCallback(
    (diameterIU: number, color?: ItemColor) => {
      setJunctionEdit((je) => {
        if (!je || !doc) return null;
        const orig = doc.junctions[je.index];
        if (orig) {
          const next = { ...orig, diameter: diameterIU, color };
          if (!color) delete (next as { color?: ItemColor }).color;
          runCommand(replaceJunction(je.index, next));
        }
        return null;
      });
    },
    [doc, runCommand],
  );

  const onImagePlaced = useCallback(
    (at: Vec2) => {
      setPendingImage((img) => {
        if (img) runCommand(addItems({ images: [makeImage(at, img.data)] }));
        return null;
      });
      setActiveTool('select');
    },
    [runCommand],
  );

  // The image file picker: read the chosen bitmap as base64 and attach it to the cursor.
  const onImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      const comma = res.indexOf(',');
      setPendingImage({ data: comma >= 0 ? res.slice(comma + 1) : res });
      setActiveTool('image');
    };
    reader.readAsDataURL(file);
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      // mirrorV = MirrorVertically (KiCad SYM_MIRROR_X); mirrorH = MirrorHorizontally (SYM_MIRROR_Y).
      const TX: Record<string, TransformOp> = {
        rotateCCW: 'rotateCCW',
        rotateCW: 'rotateCW',
        mirrorV: 'mirrorX',
        mirrorH: 'mirrorY',
      };
      if (id === 'zoomFit' || id === 'zoomFitObjects') controller.current?.zoomToFit();
      else if (id === 'zoomIn') controller.current?.zoomIn();
      else if (id === 'zoomOut') controller.current?.zoomOut();
      else if (id === 'zoomRedraw') controller.current?.redraw();
      else if (id === 'zoomTool') setActiveTool('zoomTool');
      else if (id === 'zoomFitSelection') {
        // Zoom to Selected Objects: fit the view to the selection's extent.
        const box = emptyBBox();
        doc?.symbols.forEach((s, i) => {
          if (selection.has(refId('symbol', s.uuid, i))) {
            const b = symbolBodyBBox(s, libById.get(s.libId));
            includePoint(box, { x: b.minX, y: b.minY });
            includePoint(box, { x: b.maxX, y: b.maxY });
          }
        });
        doc?.labels.forEach((l, i) => {
          if (selection.has(refId('label', l.uuid, i))) {
            const b = labelBox(l);
            includePoint(box, { x: b.minX, y: b.minY });
            includePoint(box, { x: b.maxX, y: b.maxY });
          }
        });
        doc?.lines.forEach((l, i) => {
          if (selection.has(refId('line', l.uuid, i))) {
            includePoint(box, l.start);
            includePoint(box, l.end);
          }
        });
        doc?.junctions.forEach((j, i) => {
          if (selection.has(refId('junction', j.uuid, i))) includePoint(box, j.at);
        });
        doc?.sheets.forEach((sh, i) => {
          if (selection.has(refId('sheet', sh.uuid, i))) {
            includePoint(box, sh.at);
            includePoint(box, { x: sh.at.x + sh.size.w, y: sh.at.y + sh.size.h });
          }
        });
        if (!isEmpty(box)) controller.current?.zoomToBox(box);
      } else if (id === 'undo') undo();
      else if (id === 'redo') redo();
      else if (id === 'open') promptOpen();
      else if (id === 'save') save();
      else if (id === 'erc') runErcNow();
      else if (id === 'showPcbNew') onShowPcb?.();
      else if (id === 'symbolEditor') onShowSymbolEditor?.();
      else if (id === 'footprintEditor') onShowFootprintEditor?.();
      else if (id === 'bom') setBomOpen(true);
      else if (id === 'exportNetlist') setNetlistOpen(true);
      else if (id === 'editSymbolFields') setFieldsTableOpen(true);
      else if (id === 'symbolBrowser') setBrowserOpen(true);
      else if (id === 'assignFootprints') setAssignFpOpen(true);
      else if (id === 'showCalculator') onShowCalculator?.();
      // ACTIONS::selectAll / unselectAll (also on Ctrl+A / Ctrl+Shift+A).
      else if (id === 'selectAll')
        setDoc((d) => {
          // Select All honors the Selection Filter (SCH_SELECTION_TOOL::SelectAll
          // runs every item through itemPassesFilter).
          if (d)
            setSelection(
              applySelectionFilter(
                d,
                boxSelect(d, libById, { x: 1e15, y: 1e15 }, { x: -1e15, y: -1e15 }),
                selFilterRef.current,
              ),
            );
          return d;
        });
      else if (id === 'unselectAll') setSelection(new Set());
      // Group / Ungroup (SCH_GROUP_TOOL): members stay selected afterwards —
      // upstream selects the new group (= its members) / the freed members.
      else if (id === 'group')
        setSelection((sel) => {
          if (sel.size >= 2) runCommand(groupItemsCommand(sel));
          return sel;
        });
      else if (id === 'ungroup')
        setSelection((sel) => {
          if (sel.size > 0) runCommand(ungroupItemsCommand(sel));
          return sel;
        });
      // Lock / Unlock / Toggle Lock (SCH_EDIT_TOOL): protect symbols from edits.
      else if (id === 'lock' || id === 'unlock' || id === 'toggleLock')
        setSelection((sel) => {
          if (sel.size > 0)
            runCommand(
              setSymbolsLockedCommand(
                sel,
                id === 'lock' ? 'lock' : id === 'unlock' ? 'unlock' : 'toggle',
              ),
            );
          return sel;
        });
      else if (id === 'openPreferences') setPrefsOpen(true);
      else if (id === 'close') onExitToHome();
      else if (id === 'find') openFindDialog('find');
      else if (id === 'findReplace') openFindDialog('replace');
      else if (id === 'annotate') setAnnotateOpen(true);
      else if (id === 'schematicSetup') setSetupOpen(true);
      else if (id === 'pageSettings') setPageSettingsOpen(true);
      else if (id === 'print') setPrintOpen(true);
      else if (id === 'plot') setPlotOpen(true);
      else if (id === 'editPageNumber') setPageEdit({ page: pageNumberOf(currentPath) });
      // Hierarchy navigation (SCH_NAVIGATE_TOOL). Back/Forward move the history
      // cursor without pushing; Up and Previous/Next go through changeSheet.
      else if (id === 'navBack' || id === 'navFwd') {
        const p = id === 'navBack' ? navTool.current.back() : navTool.current.forward();
        const target = p !== null ? flatSheets.find((s) => s.path === p) : undefined;
        if (target) switchSheet(target.path, target.file, false);
      } else if (id === 'navUp') {
        const pp = parentPath(currentPath);
        const target = pp !== null ? flatSheets.find((s) => s.path === pp) : undefined;
        if (target) switchSheet(target.path, target.file);
      } else if (id === 'navPrev' || id === 'navNext') {
        const idx = flatSheets.findIndex((s) => s.path === currentPath);
        const target = idx !== -1 ? flatSheets[idx + (id === 'navNext' ? 1 : -1)] : undefined;
        if (target) switchSheet(target.path, target.file);
      }
      // Menu Cut/Copy re-dispatch the native clipboard events our document
      // handlers already implement; Paste reads the async clipboard API (menu
      // clicks can't synthesize a trusted paste event).
      else if (id === 'cut') document.execCommand('cut');
      else if (id === 'copy') document.execCommand('copy');
      // ACTIONS::copyAsText (SCH_EDITOR_CONTROL::CopyAsText): the selected
      // items' shown texts, newline-joined, to the system clipboard.
      else if (id === 'copyAsText') {
        if (doc && selection.size > 0) {
          const text = getSelectedItemsAsText(doc, selection);
          if (text) void navigator.clipboard?.writeText(text);
        }
      } else if (id === 'pasteSpecial') setPasteSpecialOpen(true);
      else if (id === 'paste')
        void navigator.clipboard?.readText().then((text) => {
          setDoc((d) => {
            const payload = d ? parsePastedText(text, d) : null;
            if (payload) {
              setActiveTool('select');
              setPastePending(payload);
            }
            return d;
          });
        });
      else if (id === 'delete')
        setSelection((sel) => {
          if (sel.size > 0) runCommand(deleteByIds(sel));
          return new Set();
        });
      else if (TX[id])
        setSelection((sel) => {
          if (sel.size > 0) runCommand(transformItems(sel, TX[id]!));
          return sel;
        });
    },
    [
      undo,
      redo,
      save,
      promptOpen,
      runCommand,
      runErcNow,
      onShowPcb,
      onShowSymbolEditor,
      onShowFootprintEditor,
      onShowCalculator,
      onExitToHome,
      flatSheets,
      currentPath,
      switchSheet,
      doc,
      selection,
      libById,
      pageNumberOf,
    ],
  );

  // The selection context menu, assembled the way the upstream TOOL_MENU is:
  // each tool's Init() contributions in priority order — GROUP_TOOL's Grouping
  // submenu (100), SCH_MOVE_TOOL move/drag and enterSheet/leaveSheet (150),
  // SCH_EDIT_TOOL transforms + properties (200), wire placements (250), the
  // clipboard block (300), then selectAll/unselectAll (400).
  const buildContextMenu = (): MenuItem[] => {
    const hit = ctxMenu?.hit ?? null;
    const act = (label: string, id: string, shortcut?: string): MenuItem => ({
      label,
      icon: id,
      shortcut,
      action: () => onTopAction(id),
    });
    const tool = (label: string, id: string, shortcut?: string): MenuItem => ({
      label,
      icon: id,
      shortcut,
      action: () => onToolSelect(id),
    });
    const items: MenuItem[] = [];
    if (selection.size > 0) {
      items.push({
        label: 'Grouping',
        items: [act('Group Items', 'group'), act('Ungroup Items', 'ungroup')],
      });
      // Locking (SCH_SELECTION_TOOL makeLockMenu) — only symbols lock.
      const selSymbols =
        doc?.symbols.filter((s, i) => selection.has(refId('symbol', s.uuid, i))) ?? [];
      if (selSymbols.length > 0) {
        const anyUnlocked = selSymbols.some((s) => !s.locked);
        const anyLocked = selSymbols.some((s) => s.locked);
        const lockItems: MenuItem[] = [];
        if (anyUnlocked) lockItems.push(act('Lock', 'lock'));
        if (anyLocked) lockItems.push(act('Unlock', 'unlock'));
        lockItems.push(act('Toggle Lock', 'toggleLock'));
        items.push({ label: 'Locking', items: lockItems });
      }
      items.push(
        {
          label: 'Move',
          icon: 'move',
          shortcut: 'M',
          action: () => setGrabRequest((p) => ({ kind: 'move', nonce: (p?.nonce ?? 0) + 1 })),
        },
        {
          label: 'Drag',
          icon: 'drag',
          shortcut: 'G',
          action: () => setGrabRequest((p) => ({ kind: 'drag', nonce: (p?.nonce ?? 0) + 1 })),
        },
      );
      if (hit?.kind === 'sheet')
        items.push({
          label: 'Enter Sheet',
          icon: 'enterSheet',
          action: () => onEditItem(hit.id, 'sheet'),
        });
      items.push(
        { sep: true },
        act('Rotate Counterclockwise', 'rotateCCW', 'R'),
        act('Rotate Clockwise', 'rotateCW', 'Shift+R'),
        act('Mirror Vertically', 'mirrorV', 'Y'),
        act('Mirror Horizontally', 'mirrorH', 'X'),
      );
      if (selection.size === 1)
        items.push({
          label: 'Properties...',
          icon: 'properties',
          shortcut: 'E',
          action: () => openProperties([...selection][0]!),
        });
      if (hit?.kind === 'line')
        items.push(
          { sep: true },
          tool('Place Junction', 'junction', 'J'),
          tool('Place Net Label', 'placeLabel', 'L'),
          tool('Place Global Label', 'placeGlobalLabel', 'Ctrl+L'),
          tool('Place Hierarchical Label', 'placeHierLabel', 'H'),
        );
      items.push(
        { sep: true },
        act('Cut', 'cut', 'Ctrl+X'),
        act('Copy', 'copy', 'Ctrl+C'),
        act('Copy as Text', 'copyAsText', 'Ctrl+Shift+C'),
        act('Paste', 'paste', 'Ctrl+V'),
        act('Paste Special...', 'pasteSpecial', 'Ctrl+Shift+V'),
        act('Delete', 'delete', 'Delete'),
        {
          label: 'Duplicate',
          icon: 'duplicate',
          shortcut: 'Ctrl+D',
          action: duplicateSelection,
        },
      );
    } else {
      items.push(tool('Draw Wires', 'drawWire', 'W'), tool('Draw Buses', 'drawBus', 'B'));
      if (parentPath(currentPath) !== null)
        items.push({
          label: 'Leave Sheet',
          icon: 'navUp',
          shortcut: 'Alt+Bksp',
          action: () => onTopAction('navUp'),
        });
      items.push({ sep: true }, act('Paste', 'paste', 'Ctrl+V'));
    }
    items.push(
      { sep: true },
      act('Select All', 'selectAll', 'Ctrl+A'),
      act('Unselect All', 'unselectAll', 'Ctrl+Shift+A'),
    );
    return items;
  };

  const onLeftToggle = useCallback((id: string) => {
    if (SETTINGS_TOGGLES.has(id)) {
      settings.updateEeschema((s) => {
        if (id === 'toggleGrid') s.window.grid.show = !s.window.grid.show;
        else if (id === 'toggleGridOverrides')
          s.window.grid.overrides_enabled = !s.window.grid.overrides_enabled;
        else if (id === 'toggleHiddenPins')
          s.appearance.show_hidden_pins = !s.appearance.show_hidden_pins;
        else if (id === 'toggleHiddenFields')
          s.appearance.show_hidden_fields = !s.appearance.show_hidden_fields;
        else if (id === 'crosshairSmall') s.window.cursor.crosshair = 'small';
        else if (id === 'crosshairFull') s.window.cursor.crosshair = 'full';
        else if (id === 'crosshair45') s.window.cursor.crosshair = '45';
        else if (id === 'lineModeFree') s.drawing.line_mode = 0;
        else if (id === 'lineMode90') s.drawing.line_mode = 1;
        else if (id === 'lineMode45') s.drawing.line_mode = 2;
        else if (id === 'annotateAuto') s.annotation.automatic = !s.annotation.automatic;
      });
      return;
    }
    setLocalToggles((prev) => {
      const next = new Set(prev);
      const group = RADIO_GROUPS.find((g) => g.includes(id));
      if (group) {
        for (const g of group) next.delete(g);
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const menus = useMemo(
    () =>
      buildMenus(
        { tool: onToolSelect, action: onTopAction, toggle: onLeftToggle },
        {
          toggleHiddenPins: es.appearance.show_hidden_pins,
          toggleHiddenFields: es.appearance.show_hidden_fields,
          showProperties: toggles.has('showProperties'),
          showHierarchy: toggles.has('showHierarchy'),
        },
      ),
    [
      onToolSelect,
      onTopAction,
      onLeftToggle,
      es.appearance.show_hidden_pins,
      es.appearance.show_hidden_fields,
      toggles,
    ],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'schematic') !== 'schematic') return;
      // While a modal properties dialog is open, only Escape acts on the editor.
      if (propsTarget !== null && e.key !== 'Escape') return;
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setPrefsOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        promptOpen();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        // ACTIONS::print (Ctrl+P).
        e.preventDefault();
        setPrintOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        // ACTIONS::copyAsText (Ctrl+Shift+C).
        e.preventDefault();
        onTopAction('copyAsText');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        // ACTIONS::pasteSpecial (Ctrl+Shift+V).
        e.preventDefault();
        setPasteSpecialOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        // SCH_ACTIONS::placeGlobalLabel default hotkey (Ctrl+L).
        e.preventDefault();
        onToolSelect('placeGlobalLabel');
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'f') {
        // ACTIONS::findAndReplace (Ctrl+Alt+F).
        e.preventDefault();
        openFindDialog('replace');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.altKey) {
        // ACTIONS::find (Ctrl+F).
        e.preventDefault();
        openFindDialog('find');
      } else if (e.key === 'F3' && (findOpen || searchData.findString)) {
        // ACTIONS::findNext / findPrevious (F3 / Shift+F3).
        e.preventDefault();
        doFind(e.shiftKey ? -1 : 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isTyping()) {
        // ACTIONS::selectAll / unselectAll (Ctrl+A / Ctrl+Shift+A). Select-all
        // is a greedy box select over the whole plane.
        e.preventDefault();
        if (e.shiftKey) setSelection(new Set());
        else
          setDoc((d) => {
            // Honors the Selection Filter, like the menu Select All.
            if (d)
              setSelection(
                applySelectionFilter(
                  d,
                  boxSelect(d, libById, { x: 1e15, y: 1e15 }, { x: -1e15, y: -1e15 }),
                  selFilterRef.current,
                ),
              );
            return d;
          });
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        // ACTIONS::zoomFitScreen (Ctrl+0).
        e.preventDefault();
        controller.current?.zoomToFit();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
        // ACTIONS::zoomFitObjects (Ctrl+Home).
        e.preventDefault();
        controller.current?.zoomToFit();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        // ACTIONS::zoomIn (Ctrl++).
        e.preventDefault();
        controller.current?.zoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        // ACTIONS::zoomOut (Ctrl+-).
        e.preventDefault();
        controller.current?.zoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        // ACTIONS::zoomRedraw (Ctrl+R): repaint without changing the view.
        e.preventDefault();
        controller.current?.redraw();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'F5') {
        // ACTIONS::zoomTool (Ctrl+F5): drag a rectangle to zoom to it.
        e.preventDefault();
        setActiveTool('zoomTool');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u' && !e.shiftKey) {
        // ACTIONS::toggleUnits (Ctrl+U): imperial <-> metric, remembering the
        // last imperial unit (COMMON_TOOLS m_imperialUnit, initially inches).
        e.preventDefault();
        const imperial = toggles.has('unitsInches') || toggles.has('unitsMils');
        onLeftToggle(imperial ? 'unitsMm' : lastImperialRef.current);
      } else if (e.key === 'F5' && !e.altKey && !e.shiftKey) {
        // ACTIONS::zoomRedraw default hotkey (F5).
        e.preventDefault();
        controller.current?.redraw();
      } else if (e.key === 'F1' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // ACTIONS::zoomInCenter default hotkey (F1).
        e.preventDefault();
        controller.current?.zoomIn();
      } else if (e.key === 'F2' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // ACTIONS::zoomOutCenter default hotkey (F2).
        e.preventDefault();
        controller.current?.zoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h' && !e.shiftKey) {
        // SCH_ACTIONS::showHierarchy (Ctrl+H): toggle the navigator panel.
        e.preventDefault();
        onLeftToggle('showHierarchy');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        // ACTIONS::toggleGridOverrides (Ctrl+Shift+G).
        e.preventDefault();
        onLeftToggle('toggleGridOverrides');
      } else if (e.altKey && e.key === 'ArrowLeft') {
        // SCH_ACTIONS::navigateBack (Alt+Left).
        e.preventDefault();
        onTopAction('navBack');
      } else if (e.altKey && e.key === 'ArrowUp') {
        // SCH_ACTIONS::navigateUp (Alt+Up).
        e.preventDefault();
        onTopAction('navUp');
      } else if (e.altKey && e.key === 'ArrowRight') {
        // SCH_ACTIONS::navigateForward (Alt+Right).
        e.preventDefault();
        onTopAction('navFwd');
      } else if (e.altKey && e.key === 'Backspace') {
        // SCH_ACTIONS::leaveSheet (Alt+Backspace) — same as Navigate Up.
        e.preventDefault();
        onTopAction('navUp');
      } else if (e.key === 'PageUp' && !isTyping()) {
        // SCH_ACTIONS::navigatePrevious (PgUp).
        e.preventDefault();
        onTopAction('navPrev');
      } else if (e.key === 'PageDown' && !isTyping()) {
        // SCH_ACTIONS::navigateNext (PgDn).
        e.preventDefault();
        onTopAction('navNext');
      } else if (e.key === 'Escape') {
        if (propsTarget !== null) setPropsTarget(null);
        else if (pastePending) setPastePending(null);
        else if (pendingImage) {
          setPendingImage(null);
          setActiveTool('select');
        } else if (pendingLabel) {
          setPendingLabel(null);
          setActiveTool('select');
        } else if (activeTool !== 'select') {
          setActiveTool('select');
          setPlaceLib(null);
        } else if (selection.size > 0) setSelection(new Set());
        // "<ESC> clears net highlighting": with nothing else pending, the next
        // Escape clears the highlighted net (eeschema input.esc_clears_net_highlight).
        else if (settings.eeschema.input.esc_clears_net_highlight) setHighlightItem(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        e.preventDefault();
        runCommand(deleteByIds(selection));
        setSelection(new Set());
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // KiCad single-key tool hotkeys (A=symbol, W=wire, …). Skip while
        // typing — but a focused checkbox/radio isn't typing.
        const tgt = e.target as HTMLElement | null;
        const typing =
          !!tgt &&
          (tgt.tagName === 'TEXTAREA' ||
            tgt.tagName === 'SELECT' ||
            tgt.isContentEditable ||
            (tgt.tagName === 'INPUT' &&
              !/^(checkbox|radio|button|range)$/.test((tgt as HTMLInputElement).type)));
        if (typing) return;
        // R / Shift+R / X / Y — rotate & mirror the selection
        // (SCH_ACTIONS::rotateCCW/rotateCW/mirrorH/mirrorV default hotkeys).
        const txKey =
          e.key.toLowerCase() === 'r'
            ? e.shiftKey
              ? 'rotateCW'
              : 'rotateCCW'
            : e.key.toLowerCase() === 'x'
              ? 'mirrorH'
              : e.key.toLowerCase() === 'y'
                ? 'mirrorV'
                : null;
        if (txKey) {
          e.preventDefault();
          onTopAction(txKey);
          return;
        }
        // M = Move (leaves connected wires behind), G = Drag (keeps them
        // attached) — SCH_ACTIONS::move / drag. Grabs the current selection.
        if ((e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'g') && selection.size > 0) {
          e.preventDefault();
          const kind = e.key.toLowerCase() === 'm' ? 'move' : 'drag';
          setGrabRequest((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
          return;
        }
        // ` = Highlight Net tool, ~ = clear highlighting
        // (SCH_ACTIONS::highlightNet / clearHighlight).
        if (e.key === '`') {
          e.preventDefault();
          setActiveTool('highlightNet');
          return;
        }
        if (e.key === '~') {
          e.preventDefault();
          setHighlightItem(null);
          return;
        }
        // Space — reset the status bar's relative (dx/dy) origin to the
        // cursor (ACTIONS::resetLocalCoords).
        if (e.key === ' ' && !e.shiftKey) {
          e.preventDefault();
          if (cursorRef.current) setLocalOrigin({ ...cursorRef.current });
          return;
        }
        // Shift+Space — cycle the wire/bus line mode free → 90° → 45°
        // (SCH_ACTIONS::lineModeNext; SCH_EDITOR_CONTROL::NextLineMode).
        if (e.key === ' ' && e.shiftKey) {
          e.preventDefault();
          settings.updateEeschema((s) => {
            s.drawing.line_mode = s.drawing.line_mode === 0 ? 1 : s.drawing.line_mode === 1 ? 2 : 0;
          });
          return;
        }
        // N / Shift+N — next/previous grid (ACTIONS::gridNext/gridPrev).
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          settings.updateEeschema((s) => {
            const n = s.window.grid.sizes.length;
            if (n > 0)
              s.window.grid.last_size_idx =
                (s.window.grid.last_size_idx + (e.shiftKey ? n - 1 : 1)) % n;
          });
          return;
        }
        // E = Properties (KiCad SCH_ACTIONS::properties) on a single selected
        // item (openProperties routes by item kind).
        if (e.key.toLowerCase() === 'e' && selection.size === 1) {
          e.preventDefault();
          openProperties([...selection][0]!);
          return;
        }
        const toolId = TOOL_HOTKEYS[e.key.toLowerCase()];
        if (toolId) {
          e.preventDefault();
          onToolSelect(toolId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    undo,
    redo,
    save,
    promptOpen,
    selection,
    runCommand,
    activeTool,
    onToolSelect,
    onTopAction,
    onLeftToggle,
    libById,
    pendingLabel,
    propsTarget,
    pastePending,
    duplicateSelection,
    findOpen,
    searchData,
    doFind,
    openFindDialog,
    openProperties,
    toggles,
  ]);

  const units = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (units === 'mm') return `${mm.toFixed(4)}`;
    if (units === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
    return `${(mm / 25.4).toFixed(4)}`;
  };
  const zoomPct = Math.round(((scale * 10000 * dpr) / PX_PER_MM_100) * 100);

  // Properties panel rows (SCH_PROPERTIES_PANEL): the property grid for a
  // single selected item; multi-selections keep the count message for now
  // (upstream shows the properties common to the whole selection — #77).
  const propRows = useMemo<PropRow[]>(() => {
    if (!doc || selection.size !== 1) return [];
    const ref = itemRefById(doc, [...selection][0]!);
    return ref ? schPropertiesFor(doc, libById, ref) : [];
  }, [doc, selection, libById]);

  // Existing net/label names for the label dialog's completion list
  // (DIALOG_LABEL_PROPERTIES pre-loads its combo with the sheet's net names).
  const labelSuggestions = useMemo<string[]>(() => {
    if (!doc) return [];
    const names = new Set<string>();
    for (const l of doc.labels) if (l.kind !== 'text' && l.text) names.add(l.text);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [doc]);

  // Message-panel rows (EDA_MSG_PANEL): exactly one selected item shows its
  // GetMsgPanelInfo; empty and multi-selections clear the panel.
  const msgPanelItems = useMemo<MsgPanelItem[]>(() => {
    if (!doc || selection.size !== 1) return [];
    const id = [...selection][0]!;
    const ref = itemRefById(doc, id);
    if (!ref) return [];
    const code = netlist?.netByItem.get(id);
    const net = code !== undefined ? netlist?.nets.find((n) => n.code === code) : undefined;
    // Resolved Netclass (NET_SETTINGS::GetEffectiveNetClass) for the net row.
    const ncName = net ? resolveEffectiveNetClass(net.name, setup.netClasses).name : null;
    return getMsgPanelItems(doc, libById, ref, fmt, net?.name ?? null, ncName);
  }, [doc, selection, libById, netlist, fmt, setup.netClasses]);

  // Parse a distance typed into the grid, in the current units, back to IU.
  const parseDist = (text: string): number | null => {
    const n = Number(text.trim());
    if (!Number.isFinite(n)) return null;
    const mm = units === 'mm' ? n : units === 'mils' ? n * 0.0254 : n * 25.4;
    return Math.round(mmToIU(mm));
  };

  // A load failure before any document exists is fatal; once a document is open,
  // a bad Open just shows a dismissible banner and leaves the current sheet intact.
  if (!doc) {
    return error ? (
      <pre style={{ color: 'crimson', padding: 16 }}>Failed to load schematic: {error}</pre>
    ) : (
      <div className="ze-app">
        <LoadingOverlay label={loading ?? 'Loading schematic…'} />
      </div>
    );
  }

  const _title =
    currentFile !== DEFAULT_FILE ? currentFile : (fileName ?? doc.titleBlock?.title ?? 'Root');

  // Hierarchy-navigation buttons grey out when there's nowhere to go, matching
  // KiCad's SCH_NAVIGATE_TOOL enable conditions (CanGoBack/Forward, CanGoUp):
  // on a flat/root schematic Navigate Up has no parent to enter, so it disables.
  const navDisabled = new Set<string>();
  if (!navTool.current.canGoBack()) navDisabled.add('navBack');
  if (!navTool.current.canGoForward()) navDisabled.add('navFwd');
  if (parentPath(currentPath) === null) navDisabled.add('navUp');

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length > 1) {
      // Several files at once = a project drop: load them all as one hierarchy.
      Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))
        .then(loadProject)
        .catch((err) => setError(String(err)));
    } else if (files[0]) {
      openFile(files[0]);
    }
  };

  return (
    <div className="ze-app" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".kicad_sch"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImageFile(f);
          e.target.value = '';
        }}
      />
      {error && (
        <div className="ze-error-banner" onClick={() => setError(null)} title="Dismiss">
          {error} — click to dismiss
        </div>
      )}
      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title={
          <>
            <b>
              {dirty ? '*' : ''}
              {projectName || 'No project'}
            </b>
            &nbsp;—&nbsp;Schematic Editor
          </>
        }
      />

      <Toolbar
        entries={TOP_TOOLBAR}
        orientation="horizontal"
        disabledIds={dirty ? navDisabled : new Set([...(navDisabled ?? []), 'save'])}
        onActivate={onTopAction}
      />

      <div className="ze-body">
        {(toggles.has('showProperties') || toggles.has('showHierarchy')) && (
          <div className="ze-leftdock">
            {toggles.has('showProperties') && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Properties</div>
                <div className="ze-panel-body">
                  {propRows.length > 0 ? (
                    <SchPropertiesPanel
                      rows={propRows}
                      fmt={(iu) => fmt(iu)}
                      parse={parseDist}
                      onCommand={runCommand}
                    />
                  ) : (
                    <div className="ze-muted">
                      {selection.size === 0
                        ? 'No objects selected'
                        : `${selection.size} item(s) selected`}
                    </div>
                  )}
                </div>
              </div>
            )}
            {toggles.has('showHierarchy') && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Schematic Hierarchy</div>
                <div className="ze-panel-body">
                  {sheetTree && renderSheetNode(sheetTree, 0, currentPath, switchSheet)}
                </div>
              </div>
            )}
            {toggles.has('showProperties') && (
              <div className="ze-panel">
                <div className="ze-panel-header">Selection Filter</div>
                <div className="ze-panel-body">
                  {/* "All items" toggles every category (not Locked items),
                      exactly like PANEL_SCH_SELECTION_FILTER::OnFilterChanged. */}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectionFilterAll(selFilter)}
                      onChange={() => {
                        const next = !selectionFilterAll(selFilter);
                        setSelFilter((p) => ({
                          ...p,
                          symbols: next,
                          text: next,
                          wires: next,
                          labels: next,
                          pins: next,
                          graphics: next,
                          images: next,
                          ruleAreas: next,
                          otherItems: next,
                        }));
                      }}
                    />
                    All items
                  </label>
                  {/* Locked items is special (allows selecting locked items). */}
                  <label title="Allow selection of locked items">
                    <input
                      type="checkbox"
                      checked={selFilter.lockedItems}
                      onChange={(e) =>
                        setSelFilter((p) => ({ ...p, lockedItems: e.target.checked }))
                      }
                    />
                    Locked items
                  </label>
                  <div className="ze-selfilter">
                    {FILTER_CATS.map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={selFilter[key]}
                          onChange={(e) => setSelFilter((p) => ({ ...p, [key]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <Toolbar
          entries={LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <div className="ze-canvas-wrap">
          <SchematicCanvas
            ref={controller}
            schematic={doc}
            libById={libById}
            selection={selection}
            activeTool={activeTool}
            lineMode={lineMode}
            placeLib={placeLib}
            placeUnit={placeUnit}
            onSymbolPlaced={onSymbolPlaced}
            pendingLabel={pendingLabel}
            highlight={highlightWires}
            theme={theme}
            renderOpts={renderOpts}
            inputPrefs={inputPrefs}
            onSheetDrawn={onSheetDrawn}
            onTextBoxDrawn={onTextBoxDrawn}
            onSheetPinClick={onSheetPinClick}
            pendingImage={pendingImage}
            onImagePlaced={onImagePlaced}
            grabRequest={grabRequest}
            onContextMenuRequest={onContextMenuRequest}
            onClarify={(x, y, items, additive) => setClarify({ x, y, items, additive })}
            onZoomArea={(box) => {
              controller.current?.zoomToBox(box);
              setActiveTool('select');
            }}
            onSelect={onSelect}
            onHighlight={onHighlight}
            onRequestTool={onToolSelect}
            onEditItem={onEditItem}
            onSelectBox={onSelectBox}
            pastePending={pastePending}
            onPasteDone={onPasteDone}
            ercMarkers={ercResult?.filter((v) =>
              setup.ercExclusions.includes(ercExclusionKey(v))
                ? es.appearance.show_erc_exclusions
                : v.severity === 'error'
                  ? es.appearance.show_erc_errors
                  : es.appearance.show_erc_warnings,
            )}
            onCommand={runCommand}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
          {ctxMenu && (
            <ContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              items={buildContextMenu()}
              onClose={() => setCtxMenu(null)}
            />
          )}
          {clarify && doc && (
            <ContextMenu
              x={clarify.x}
              y={clarify.y}
              items={clarify.items.map((ref) => ({
                label: describeItem(doc, libById, ref),
                action: () => {
                  onSelect(ref.id, clarify.additive);
                  setClarify(null);
                },
              }))}
              onClose={() => setClarify(null)}
            />
          )}
          {ercResult !== null && (
            <ErcDialog
              violations={ercResult}
              ignoredTests={ERC_ITEMS.filter(
                (it) => setup.erc.severities[it.code] === 'ignore',
              ).map((it) => it.title)}
              filters={{
                errors: es.appearance.show_erc_errors,
                warnings: es.appearance.show_erc_warnings,
                exclusions: es.appearance.show_erc_exclusions,
              }}
              onFilterChange={(f) =>
                settings.updateEeschema((s) => {
                  s.appearance.show_erc_errors = f.errors;
                  s.appearance.show_erc_warnings = f.warnings;
                  s.appearance.show_erc_exclusions = f.exclusions;
                })
              }
              unannotated={doc?.symbols.some((s) =>
                (s.fields.find((f) => f.key === 'Reference')?.value ?? '').endsWith('?'),
              )}
              onShowAnnotate={() => setAnnotateOpen(true)}
              onRun={runErcNow}
              onLocate={locateViolation}
              onDelete={(i) => setErcResult((r) => (r ? r.filter((_, idx) => idx !== i) : r))}
              onDeleteAll={() => setErcResult([])}
              excluded={new Set(setup.ercExclusions)}
              onToggleExclude={(v) => {
                const key = ercExclusionKey(v);
                setSetup((cur) => {
                  const has = cur.ercExclusions.includes(key);
                  return {
                    ...cur,
                    ercExclusions: has
                      ? cur.ercExclusions.filter((k) => k !== key)
                      : [...cur.ercExclusions, key],
                  };
                });
              }}
              onEditSeverities={() => setSetupOpen(true)}
              onClose={() => setErcResult(null)}
            />
          )}
          {findOpen && (
            <DialogSchematicFind
              data={searchData}
              onChange={setSearchData}
              onFindNext={() => doFind(1)}
              onFindPrevious={() => doFind(-1)}
              onClose={() => setFindOpen(false)}
              status={findStatus}
              replace={findOpen === 'replace'}
              onReplace={doReplaceNext}
              onReplaceAll={doReplaceAll}
            />
          )}
          {annotateOpen && (
            <DialogAnnotate
              hasSelection={selection.size > 0}
              // Sort order, numbering method and start number are project
              // settings (SCHEMATIC_SETTINGS) — seed from Schematic Setup >
              // Annotation like DIALOG_ANNOTATE::TransferDataToWindow.
              initial={{
                order: setup.annotation.sortOrder,
                algo:
                  setup.annotation.numbering === 'sheetX100'
                    ? 'sheet_100'
                    : setup.annotation.numbering === 'sheetX1000'
                      ? 'sheet_1000'
                      : 'incremental',
                startNumber: setup.annotation.firstFreeAfter,
              }}
              onAnnotate={runAnnotate}
              onClear={runClearAnnotation}
              onClose={(s) => {
                // ~DIALOG_ANNOTATE: write changed settings back to the project.
                const numbering =
                  s.algo === 'sheet_100'
                    ? 'sheetX100'
                    : s.algo === 'sheet_1000'
                      ? 'sheetX1000'
                      : 'firstFree';
                if (
                  s.order !== setup.annotation.sortOrder ||
                  numbering !== setup.annotation.numbering ||
                  s.startNumber !== setup.annotation.firstFreeAfter
                ) {
                  commitSetup({
                    ...setup,
                    annotation: {
                      ...setup.annotation,
                      sortOrder: s.order,
                      numbering,
                      firstFreeAfter: s.startNumber,
                    },
                  });
                }
                setAnnotateOpen(false);
              }}
            />
          )}
          {pageSettingsOpen && doc && (
            <DialogPageSettings
              value={getPageSettings(doc)}
              sheetCount={flatSheets.length}
              sheetNumber={Number(pageNumberOf(currentPath)) || 1}
              sheetChoices={sheetChoices}
              drawingSheetName={sheetRefName}
              onOk={applyPageSettings}
              onCancel={() => setPageSettingsOpen(false)}
            />
          )}
          {printOpen && (
            <DialogPrint
              onPrint={doPrint}
              onPreview={doPreview}
              themeId={es.appearance.color_theme}
              onClose={() => setPrintOpen(false)}
            />
          )}
          {pasteSpecialOpen && (
            <DialogPasteSpecial
              onOk={(mode: PasteMode) => {
                setPasteSpecialOpen(false);
                void navigator.clipboard?.readText().then((text) => {
                  setDoc((d) => {
                    const payload = d ? parsePastedText(text, d, mode) : null;
                    if (payload) {
                      setActiveTool('select');
                      setPastePending(payload);
                    }
                    return d;
                  });
                });
              }}
              onCancel={() => setPasteSpecialOpen(false)}
            />
          )}
          {plotOpen && (
            <DialogPlot
              themeId={es.appearance.color_theme}
              onPlot={doPlot}
              onClose={() => setPlotOpen(false)}
            />
          )}
          {setupOpen && (
            <DialogSchematicSetup
              value={setup}
              onOk={(next) => {
                commitSetup(next);
                setSetupOpen(false);
              }}
              onCancel={() => setSetupOpen(false)}
            />
          )}
          {bomOpen && (
            <DialogExportBom
              docs={[...liveDocs().values()]}
              baseName={outputBaseName()}
              presets={setup.bomPresets}
              // Saved presets persist into schematic.bom_presets and list in
              // Schematic Setup > BOM Presets, like upstream.
              onSavePresets={(bomPresets) => commitSetup({ ...setup, bomPresets })}
              onClose={() => setBomOpen(false)}
            />
          )}
          {netlistOpen && doc && (
            <DialogExportNetlist
              doc={doc}
              libById={libById}
              baseName={outputBaseName()}
              onClose={() => setNetlistOpen(false)}
            />
          )}
          {fieldsTableOpen && (
            <DialogSymbolFieldsTable
              docs={liveDocs()}
              fieldTemplates={setup.fieldTemplates}
              onApply={applyFieldsEdits}
              onClose={() => setFieldsTableOpen(false)}
            />
          )}
          {/* Assign Footprints (cvpcb): assignments apply as Footprint field
              edits through the same per-sheet pathway as the fields table. */}
          {assignFpOpen && (
            <DialogAssignFootprints
              docs={liveDocs()}
              onApply={(edits) => {
                applyFieldsEdits(edits);
                setAssignFpOpen(false);
              }}
              onClose={() => setAssignFpOpen(false)}
            />
          )}
          {/* Symbol Library Browser: "Add Symbol to Schematic" attaches the pick
              to the cursor exactly like the Place Symbol chooser. */}
          {browserOpen && (
            <SymbolLibraryBrowser
              onPick={(lib) => {
                setBrowserOpen(false);
                placeFlags.current = { keepSymbol: true, placeAllUnits: false, unitCount: 1 };
                setPlaceUnit(1);
                setPlaceLib(lib);
                setActiveTool('placeSymbol');
              }}
              onClose={() => setBrowserOpen(false)}
            />
          )}
        </div>

        <Toolbar
          entries={RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onToolSelect}
        />
      </div>

      {/* EDA_DRAW_FRAME hosts a message panel above the 8-field status bar:
          a single selected item's GetMsgPanelInfo rows; anything else clears
          it (SCH_INSPECTION_TOOL::UpdateMessagePanel). */}
      <div className="ze-msgpanel" data-testid="sch-message-panel">
        {msgPanelItems.map((item) => (
          <div className="ze-msgpanel-item" key={`${item.upper}:${item.lower}`}>
            <div className="ze-msgpanel-upper">{item.upper}</div>
            <div className="ze-msgpanel-lower">{item.lower || ' '}</div>
          </div>
        ))}
      </div>

      {/* KISTATUSBAR's 8 fields (eda_draw_frame.cpp): message (grows) — the
          net-highlight text lands here (UpdateNetHighlightStatus) | Z zoom |
          absolute X/Y | relative dx/dy/dist | grid | units | current-tool
          (grows) | constraint (unused by eeschema). */}
      <div className="ze-statusbar">
        <span className="cell msg" data-testid="sch-status-msg">
          {highlightName ? `Highlighted net: ${highlightName}` : ''}
        </span>
        <StatusField template={STATUS_FIELD_TEMPLATES.zoom}>
          Z {Number.isFinite(zoomPct) ? (zoomPct / 100).toFixed(2) : '1.00'}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.coords}>
          X {cursor ? fmt(cursor.x) : '—'} Y {cursor ? fmt(cursor.y) : '—'}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.deltas}>
          dx {cursor ? fmt(cursor.x - localOrigin.x) : '—'} dy{' '}
          {cursor ? fmt(cursor.y - localOrigin.y) : '—'} dist{' '}
          {cursor ? fmt(Math.hypot(cursor.x - localOrigin.x, cursor.y - localOrigin.y)) : '—'}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.grid}>
          grid {(() => {
            const iu = renderOpts.grid.sizeIU;
            const mm = iuToMM(iu);
            return units === 'mm'
              ? mm.toFixed(4)
              : units === 'mils'
                ? (mm / 0.0254).toFixed(0)
                : (mm / 25.4).toFixed(4);
          })()}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.units}>
          {units === 'in' ? 'inches' : units}
        </StatusField>
        <span className="cell tool" data-testid="sch-tool-msg">
          {SCH_TOOL_MSGS[activeTool] ?? ''}
        </span>
        <StatusField template={STATUS_FIELD_TEMPLATES.constraint} />
      </div>

      {chooserOpen && (
        <DialogSymbolChooser
          powerFilter={activeTool === 'placePower'}
          showFootprints={es.appearance.footprint_preview}
          historyList={activeTool === 'placePower' ? sPowerHistoryList : sSymbolHistoryList}
          alreadyPlaced={alreadyPlaced}
          getPlacedLibSymbol={getPlacedLibSymbol}
          onOk={onChooserOk}
          onCancel={() => setActiveTool('select')}
        />
      )}

      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {/* Double-click / E on a symbol: KiCad's Symbol Properties dialog. */}
      {propsSymbol && propsTarget !== null && (
        <SymbolPropertiesDialog
          symbol={propsSymbol}
          lib={libById.get(propsSymbol.libId)}
          fieldTemplates={setup.fieldTemplates}
          onOk={(edit: SymbolEdit) => {
            runCommand(editSymbolProperties(propsTarget, edit));
            setPropsTarget(null);
          }}
          onCancel={() => setPropsTarget(null)}
        />
      )}

      {/* Label tools: a properties dialog names the label, then it follows the cursor. */}
      {LABEL_TOOL_KINDS[activeTool] && !pendingLabel && !labelEdit && (
        <LabelDialog
          kind={LABEL_TOOL_KINDS[activeTool]!}
          // New labels/text default to Schematic Setup > Formatting's text size
          // (DIALOG_LABEL_PROPERTIES seeds from m_DefaultTextSize).
          initialFormat={{
            bold: false,
            italic: false,
            sizeIU: setup.formatting.defaultTextSizeMils * IU_PER_MILS,
          }}
          suggestions={labelSuggestions}
          onOk={(text: string, shape: LabelShape, format: LabelFormat) =>
            setPendingLabel({
              kind: LABEL_TOOL_KINDS[activeTool]!,
              text,
              shape,
              bold: format.bold,
              italic: format.italic,
              fontSize: format.sizeIU,
            })
          }
          onCancel={() => setActiveTool('select')}
        />
      )}

      {/* Editing an existing label/text (Properties): same dialog, pre-filled. */}
      {labelEdit && (
        <LabelDialog
          kind={labelEdit.kind}
          initialText={labelEdit.text}
          initialShape={labelEdit.shape}
          initialFormat={{
            bold: !!doc?.labels[labelEdit.index]?.effects?.bold,
            italic: !!doc?.labels[labelEdit.index]?.effects?.italic,
            sizeIU: doc?.labels[labelEdit.index]?.effects?.fontSize?.[0] ?? 12700,
          }}
          suggestions={labelSuggestions}
          onOk={commitLabelEdit}
          onCancel={() => setLabelEdit(null)}
        />
      )}

      {/* Wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES, E on a wire). */}
      {lineEdit && (
        <DialogLineProperties
          kind="wire"
          widthIU={lineEdit.widthIU}
          style={lineEdit.style}
          color={lineEdit.color}
          onOk={commitLineEdit}
          onCancel={() => setLineEdit(null)}
        />
      )}

      {/* Junction diameter/colour (DIALOG_JUNCTION_PROPS, E on a junction). */}
      {junctionEdit && (
        <DialogLineProperties
          kind="junction"
          diameterIU={junctionEdit.diameterIU}
          color={junctionEdit.color}
          onOk={commitJunctionEdit}
          onCancel={() => setJunctionEdit(null)}
        />
      )}

      {/* Edit Sheet Page Number (SCH_ACTIONS::editPageNumber). */}
      {pageEdit && (
        <div className="ze-modal-backdrop" onMouseDown={() => setPageEdit(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Edit Sheet Page Number
              <span className="x" title="Cancel" onClick={() => setPageEdit(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Page number</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={pageEdit.page}
                  onChange={(e) => setPageEdit({ page: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      editPageNumber(pageEdit.page.trim());
                      setPageEdit(null);
                    }
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setPageEdit(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!pageEdit.page.trim()}
                onClick={() => {
                  editPageNumber(pageEdit.page.trim());
                  setPageEdit(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editing an existing sheet's name/file (DIALOG_SHEET_PROPERTIES, E key). */}
      {sheetEdit && (
        <div className="ze-modal-backdrop" onMouseDown={() => setSheetEdit(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Sheet Properties
              <span className="x" title="Cancel" onClick={() => setSheetEdit(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Sheet name</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={sheetEdit.name}
                  onChange={(e) => setSheetEdit({ ...sheetEdit, name: e.target.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label className="row">
                <span>File name</span>
                <input
                  className="ze-search"
                  value={sheetEdit.file}
                  onChange={(e) => setSheetEdit({ ...sheetEdit, file: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitSheetEdit();
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setSheetEdit(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!sheetEdit.name.trim()}
                onClick={commitSheetEdit}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchical sheet: after drawing the rectangle, name it and its file. */}
      {sheetDraw && (
        <div className="ze-modal-backdrop" onMouseDown={() => setSheetDraw(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Sheet Properties
              <span className="x" title="Cancel" onClick={() => setSheetDraw(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Sheet name</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={sheetDraw.name}
                  onChange={(e) => setSheetDraw({ ...sheetDraw, name: e.target.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label className="row">
                <span>File name</span>
                <input
                  className="ze-search"
                  value={sheetDraw.file}
                  onChange={(e) => setSheetDraw({ ...sheetDraw, file: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      runCommand(
                        addItems({
                          sheets: [
                            makeSheet(sheetDraw.at, sheetDraw.size, sheetDraw.name, sheetDraw.file),
                          ],
                        }),
                      );
                      setSheetDraw(null);
                    }
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setSheetDraw(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!sheetDraw.name.trim()}
                onClick={() => {
                  runCommand(
                    addItems({
                      sheets: [
                        makeSheet(
                          sheetDraw.at,
                          sheetDraw.size,
                          sheetDraw.name.trim(),
                          sheetDraw.file.trim(),
                        ),
                      ],
                    }),
                  );
                  setSheetDraw(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet pin: name the pin clicked onto a sheet border. */}
      {sheetPinDraw && (
        <div className="ze-modal-backdrop" onMouseDown={() => setSheetPinDraw(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Sheet Pin
              <span className="x" title="Cancel" onClick={() => setSheetPinDraw(null)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <label className="row">
                <span>Pin name</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={sheetPinDraw.name}
                  onChange={(e) => setSheetPinDraw({ ...sheetPinDraw, name: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && sheetPinDraw.name.trim() && doc) {
                      const sh = doc.sheets[sheetPinDraw.index];
                      if (sh)
                        runCommand(
                          replaceSheet(
                            sheetPinDraw.index,
                            addSheetPin(
                              sh,
                              sheetPinDraw.name.trim(),
                              sheetPinDraw.at,
                              sheetPinDraw.side,
                            ),
                          ),
                        );
                      setSheetPinDraw(null);
                    }
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setSheetPinDraw(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!sheetPinDraw.name.trim()}
                onClick={() => {
                  const sh = doc.sheets[sheetPinDraw.index];
                  if (sh)
                    runCommand(
                      replaceSheet(
                        sheetPinDraw.index,
                        addSheetPin(
                          sh,
                          sheetPinDraw.name.trim(),
                          sheetPinDraw.at,
                          sheetPinDraw.side,
                        ),
                      ),
                    );
                  setSheetPinDraw(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text box: enter the wrapped text after drawing the rectangle (SCH_TEXTBOX). */}
      {textBoxDraw && (
        <div className="ze-modal-backdrop" onMouseDown={() => setTextBoxDraw(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Text Box Properties
              <span className="x" title="Cancel" onClick={() => setTextBoxDraw(null)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <label className="row" style={{ alignItems: 'flex-start' }}>
                <span>Text</span>
                <textarea
                  className="ze-search"
                  autoFocus
                  rows={4}
                  style={{ resize: 'vertical', minWidth: 260 }}
                  value={textBoxDraw.text}
                  onChange={(e) => setTextBoxDraw({ ...textBoxDraw, text: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitTextBox();
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setTextBoxDraw(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!textBoxDraw.text.trim()}
                onClick={commitTextBox}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table: choose the grid size, then place the table (SCH_TABLE). */}
      {tableDraw && (
        <div className="ze-modal-backdrop" onMouseDown={() => setTableDraw(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Insert Table
              <span className="x" title="Cancel" onClick={() => setTableDraw(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Rows</span>
                <input
                  className="ze-search"
                  type="number"
                  min={1}
                  max={50}
                  autoFocus
                  value={tableDraw.rows}
                  onChange={(e) => setTableDraw({ ...tableDraw, rows: Number(e.target.value) })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitTable();
                  }}
                />
              </label>
              <label className="row">
                <span>Columns</span>
                <input
                  className="ze-search"
                  type="number"
                  min={1}
                  max={50}
                  value={tableDraw.cols}
                  onChange={(e) => setTableDraw({ ...tableDraw, cols: Number(e.target.value) })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitTable();
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setTableDraw(null)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitTable}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table cell editor: a grid of inputs matching the table (double-click to edit). */}
      {tableEdit && (
        <div className="ze-modal-backdrop" onMouseDown={() => setTableEdit(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Edit Table
              <span className="x" title="Cancel" onClick={() => setTableEdit(null)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${tableEdit.cols}, 1fr)`,
                  gap: 4,
                }}
              >
                {tableEdit.texts.map((txt, i) => (
                  <input
                    key={i}
                    className="ze-search"
                    value={txt}
                    style={{ minWidth: 80 }}
                    onChange={(e) =>
                      setTableEdit((te) =>
                        te
                          ? { ...te, texts: te.texts.map((t, j) => (j === i ? e.target.value : t)) }
                          : te,
                      )
                    }
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitTableEdit();
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setTableEdit(null)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitTableEdit}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <LoadingOverlay label={loading} />
    </div>
  );
}

/** One row of the hierarchy tree; children indent one level (KiCad's navigator). */
function renderSheetNode(
  node: SheetTreeNode,
  depth: number,
  currentPath: string,
  onOpen: (path: string, file: string) => void,
): JSX.Element {
  return (
    <div key={node.path}>
      <div
        className={`ze-tree-item ${node.path === currentPath ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onOpen(node.path, node.file)}
        title={node.file}
      >
        📄 {node.name}
      </div>
      {node.children.map((c) => (
        <div key={c.path}>{renderSheetNode(c, depth + 1, currentPath, onOpen)}</div>
      ))}
    </div>
  );
}
