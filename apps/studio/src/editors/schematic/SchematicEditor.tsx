import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parse, readSchematic, serializeSchematic, iuToMM, deleteByIds, transformItems, computeNetlist, withCleanup, refId, editSymbolProperties, copySelectionText, parsePastedText, runErc, buildSheetTree, sheetFile, findRootFile, History, type Schematic, type LibSymbol, type EditCommand, type Vec2, type TransformOp, type LabelKind, type LabelShape, type SymbolEdit, type PastePayload, type ErcViolation, type SheetTreeNode } from '@ziroeda/core';
import { SchematicCanvas, type CanvasController, type LineMode, type PendingLabel } from './components/SchematicCanvas.js';
import { LabelDialog } from './components/LabelDialog.js';
import { SymbolPropertiesDialog } from './components/SymbolPropertiesDialog.js';
import { ErcDialog } from './components/ErcDialog.js';
import { SymbolChooser } from './components/SymbolChooser.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR } from '../../ui/toolbars.js';
import { MenuBar } from '../../ui/MenuBar.js';
import { buildMenus, TOOL_HOTKEYS } from '../../ui/menus.js';
import { LoadingOverlay, nextPaint } from '../../ui/LoadingOverlay.js';
import { PreferencesDialog } from '../../prefs/PreferencesDialog.js';
import { settings, gridSizeToIU } from '../../prefs/settings.js';
import { useCommonSettings, useEeschemaSettings, useSchematicTheme } from '../../prefs/useSettings.js';
import type { RenderOpts } from './render/renderer.js';
import type { InputPrefs } from './components/SchematicCanvas.js';
import '../../ui/shell.css';

// What KiCad writes for File > New Schematic: an empty sheet on A4 paper.
// Launching the editor without a project starts here (no bundled demo).
const EMPTY_SCH = '(kicad_sch (version 20231120) (generator "ziroeda") (paper "A4")\n  (lib_symbols)\n)\n';

const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
// Local view toggles; grid/crosshair/line-mode/hidden-pins live in the settings
// store (Preferences) and are derived each render so the two stay in sync.
const DEFAULT_TOGGLES = new Set(['unitsMm', 'showHierarchy', 'showProperties']);
const SETTINGS_TOGGLES = new Set(['toggleGrid', 'toggleHiddenPins', 'crosshairSmall', 'crosshairFull', 'lineModeFree', 'lineMode90', 'lineMode45']);
const PX_PER_MM_100 = 3.7795;

// Right-toolbar tool ids that place a text label, mapped to the label kind.
const LABEL_TOOL_KINDS: Record<string, LabelKind> = {
  placeLabel: 'label',
  placeGlobalLabel: 'global_label',
  placeHierLabel: 'hierarchical_label',
  placeText: 'text',
};

// KiCad's Selection Filter categories, laid out in two columns (row-major).
const FILTER_CATS: [string, string][] = [
  ['symbols', 'Symbols'], ['pins', 'Pins'],
  ['wires', 'Wires'], ['labels', 'Labels'],
  ['graphics', 'Graphics'], ['images', 'Images'],
  ['text', 'Text'], ['other', 'Other items'],
];

/** A file picked from disk for a project open. */
export interface PickedFile { name: string; text: string }

const DEFAULT_FILE = 'untitled.kicad_sch';

export function SchematicEditor({ onExitToHome, onShowPcb, onShowSymbolEditor, initialProject, initialFile, placeRequest, onProjectChange }: {
  onExitToHome: () => void;
  onShowPcb?: () => void;
  /** Open the Symbol Editor (the top toolbar's `symbolEditor` button). */
  onShowSymbolEditor?: () => void;
  initialProject?: PickedFile[] | null;
  initialFile?: string | null;
  /** A symbol handed over by the Symbol Editor's "Add symbol to schematic": attach it to the cursor. */
  placeRequest?: { lib: LibSymbol; nonce: number } | null;
  /** Autosave hook: called (debounced) with the serialized sheets after edits. */
  onProjectChange?: (files: PickedFile[]) => void;
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
  // KiCad's "Load Schematic" progress: non-null while parsing/saving a project.
  const [loading, setLoading] = useState<string | null>(null);
  // Register the initial sheet's undo stack so returning to it keeps its history.
  useEffect(() => { histories.current.set(DEFAULT_FILE, history.current); }, []);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // The item whose net is highlighted by the Highlight-Net tool (KiCad's
  // m_highlightedConn). Distinct from selection: plain selection is never a net
  // highlight in KiCad; it's the explicit highlight action that brightens a net.
  const [highlightItem, setHighlightItem] = useState<string | null>(null);
  const history = useRef(new History());
  const controller = useRef<CanvasController>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [placeLib, setPlaceLib] = useState<LibSymbol | null>(null);
  const [pendingLabel, setPendingLabel] = useState<PendingLabel | null>(null);
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
    if (es.appearance.show_hidden_pins) t.add('toggleHiddenPins');
    t.add(es.window.cursor.fullscreen_cursor ? 'crosshairFull' : 'crosshairSmall');
    t.add(es.drawing.line_mode === 0 ? 'lineModeFree' : es.drawing.line_mode === 2 ? 'lineMode45' : 'lineMode90');
    return t;
  }, [localToggles, es]);
  const [selFilter, setSelFilter] = useState<Set<string>>(new Set(FILTER_CATS.map((c) => c[0])));
  const [cursor, setCursor] = useState<Vec2 | null>(null);
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

  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setHighlightItem(null); // a selection clears any net highlight (KiCad keeps the two exclusive)
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  }, []);

  // Highlight-Net tool: brighten a net and clear the selection (KiCad's
  // HighlightNet calls ClearSelection so the whole net shows, not a selection halo).
  const onHighlight = useCallback((id: string | null) => {
    setSelection(new Set());
    setHighlightItem(id);
  }, []);

  // Box-selection result (KiCad SelectMultiple): plain drags replace the
  // selection, shift-drags add, ctrl+shift-drags subtract.
  const onSelectBox = useCallback((ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => {
    setHighlightItem(null);
    setSelection((prev) => {
      if (subtractive) {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }
      if (additive) {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      }
      return new Set(ids);
    });
  }, []);

  // Every edit runs through KiCad's post-commit cleanup (colinear wire merge),
  // as part of the same undoable step (SCHEMATIC::CleanUp / RecalculateConnections).
  const runCommand = useCallback((cmd: EditCommand) => {
    setDoc((d) => (d ? history.current.execute(d, withCleanup(cmd)) : d));
  }, []);

  const undo = useCallback(() => setDoc((d) => (d ? history.current.undo(d) ?? d : d)), []);
  const redo = useCallback(() => setDoc((d) => (d ? history.current.redo(d) ?? d : d)), []);

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

  // Load a schematic from raw .kicad_sch text: parse (lossless), fresh history,
  // clear transient state, and fit the view. Embedded lib_symbols render as-is.
  const resetTransient = useCallback(() => {
    setSelection(new Set());
    setHighlightItem(null);
    setPendingLabel(null);
    setActiveTool('select');
    setPlaceLib(null);
    setPastePending(null);
    setErcResult(null);
    setPropsTarget(null);
  }, []);

  const loadText = useCallback(async (text: string, name?: string) => {
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
  }, [resetTransient]);

  // Open a whole KiCad project: parse every .kicad_sch, find the root (the
  // .kicad_pro's schematic, else the sheet nothing references), and show it.
  const loadProject = useCallback(async (files: PickedFile[], startFile?: string) => {
    setLoading('Loading schematic…');
    await nextPaint(); // paint the overlay before the (synchronous) sheet parse
    try {
    const docs = new Map<string, Schematic>();
    const problems: string[] = [];
    let proName: string | undefined;
    for (const f of files) {
      const base = f.name.split('/').pop()!.split('\\').pop()!;
      if (/\.kicad_pro$/i.test(base)) { proName = base; continue; }
      if (!/\.kicad_sch$/i.test(base)) continue;
      try {
        docs.set(base, { ...readSchematic(parse(f.text)), fileName: base });
      } catch (e) {
        problems.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
      }
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
      problems.push(`root schematic ${wantRoot} is not in the selection — opened ${root} instead`);
    histories.current = new Map([[start, new History()]]);
    history.current = histories.current.get(start)!;
    setCurrentFile(start);
    // Home-tree opens the root; deeper instances are entered from the canvas.
    setCurrentPath('/');
    setDoc(docs.get(start)!);
    resetTransient();
    setFileName(start);
    setError(problems.length ? `Some sheets failed to load: ${problems.join('; ')}` : null);
    requestAnimationFrame(() => controller.current?.zoomToFit());
    } finally {
      setLoading(null);
    }
  }, [resetTransient]);

  // A project handed over from the home page's Open Project picker.
  useEffect(() => {
    if (initialProject && initialProject.length > 0) void loadProject(initialProject, initialFile ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProject]);

  // Autosave: once edits settle, serialize the project's sheets and hand them
  // up (App debounces the write to IndexedDB). Fires on sheet switch/load too,
  // which just re-saves identical content — harmless.
  useEffect(() => {
    if (!doc || !onProjectChange) return;
    const t = setTimeout(() => {
      const docs = new Map(project.current.docs);
      docs.set(currentFile, doc);
      const files: PickedFile[] = [];
      for (const [file, d] of docs) {
        try { files.push({ name: file, text: serializeSchematic(d) }); } catch { /* skip a bad sheet */ }
      }
      if (files.length) onProjectChange(files);
    }, 900);
    return () => clearTimeout(t);
  }, [doc, currentFile, onProjectChange]);

  // "Add symbol to schematic" from the Symbol Editor: attach the symbol to the
  // cursor exactly as the Place Symbol tool does after its chooser.
  useEffect(() => {
    if (!placeRequest) return;
    setPlaceLib(placeRequest.lib);
    setActiveTool('placeSymbol');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeRequest?.nonce]);

  // Switch the visible sheet (KiCad's Enter Sheet / hierarchy navigation): stash
  // the edited current sheet back into the project, swap in the target document
  // and its own undo history.
  const switchSheet = useCallback((path: string, file: string) => {
    // Always record which instance is active (path is unique per instance).
    setCurrentPath(path);
    // Two instances of the same file share one document — nothing to swap, just
    // the active path changed.
    if (!doc || file === currentFile) return;
    const proj = project.current;
    proj.docs.set(currentFile, doc);
    const target = proj.docs.get(file);
    if (!target) { setError(`Sheet file not in project: ${file}`); return; }
    if (!histories.current.has(file)) histories.current.set(file, new History());
    history.current = histories.current.get(file)!;
    setCurrentFile(file);
    setDoc(target);
    resetTransient();
    requestAnimationFrame(() => controller.current?.zoomToFit());
  }, [doc, currentFile, resetTransient]);

  // KiCad's Properties action: only symbols have a properties dialog so far.
  const onEditItem = useCallback((id: string, kind: 'symbol' | 'line' | 'junction' | 'noconnect' | 'label' | 'sheet') => {
    if (kind === 'symbol') setPropsTarget(id);
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
  }, [doc, currentPath, switchSheet]);


  const openFile = useCallback((file: File) => {
    if (!/\.kicad_sch$/i.test(file.name)) { setError(`Not a .kicad_sch file: ${file.name}`); return; }
    file.text().then((t) => void loadText(t, file.name)).catch((e) => setError(String(e)));
  }, [loadText]);

  const promptOpen = useCallback(() => fileInputRef.current?.click(), []);

  const save = useCallback(() => {
    setDoc((d) => {
      if (!d) return d;
      const text = serializeSchematic(d);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFile !== DEFAULT_FILE ? currentFile : fileName ?? `${d.titleBlock?.title ?? 'schematic'}.kicad_sch`;
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
  const isTyping = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };

  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      if (isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
      e.clipboardData?.setData('text/plain', copySelectionText(doc, selection));
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
      e.clipboardData?.setData('text/plain', copySelectionText(doc, selection));
      e.preventDefault();
      runCommand(deleteByIds(selection));
      setSelection(new Set());
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (isTyping() || propsTarget !== null || !doc) return;
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
        if (d < best) { best = d; refPoint = p; }
      };
      payload.batch.symbols.forEach((s) => consider(s.at));
      payload.batch.lines.forEach((l) => { consider(l.start); consider(l.end); });
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
      if (d) setErcResult(runErc(d, new Map(d.libSymbols.map((l) => [l.libId, l]))));
      return d;
    });
  }, []);

  // Clicking a violation centres the fault and selects the offending items.
  const locateViolation = useCallback((v: ErcViolation) => {
    controller.current?.centerOn(v.at);
    setSelection(new Set(v.items));
  }, []);

  const lineMode: LineMode = es.drawing.line_mode === 0 ? 'free' : es.drawing.line_mode === 2 ? '45' : '90';

  // Display + input options handed to the canvas, straight from the settings
  // (Preferences > Display Options / Grids / Mouse and Touchpad).
  const renderOpts = useMemo<RenderOpts>(() => ({
    showHiddenPins: es.appearance.show_hidden_pins,
    showHiddenFields: es.appearance.show_hidden_fields,
    showPageLimits: es.appearance.show_page_limits,
    selectionThicknessMils: es.selection.thickness,
    highlightThicknessMils: es.selection.highlight_thickness,
    grid: {
      show: es.window.grid.show,
      sizeIU: gridSizeToIU(es.window.grid.sizes[es.window.grid.last_size_idx] ?? '50 mil'),
      style: es.window.grid.style,
      lineWidthPx: es.window.grid.line_width,
      minSpacingPx: es.window.grid.min_spacing,
    },
  }), [es]);

  const inputPrefs = useMemo<InputPrefs>(() => ({
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
    autoStartWires: es.drawing.auto_start_wires,
    crosshair: es.window.cursor.fullscreen_cursor ? 'full' : 'small',
    alwaysShowCrosshair: es.window.cursor.always_show_cursor,
  }), [common, es]);

  // Selecting a placement tool reopens its chooser/dialog (clears any attached item).
  const onToolSelect = useCallback((id: string) => {
    setActiveTool(id);
    if (id === 'placeSymbol' || id === 'placePower') setPlaceLib(null);
    if (LABEL_TOOL_KINDS[id]) setPendingLabel(null);
  }, []);

  const onTopAction = useCallback((id: string) => {
    // mirrorV = MirrorVertically (KiCad SYM_MIRROR_X); mirrorH = MirrorHorizontally (SYM_MIRROR_Y).
    const TX: Record<string, TransformOp> = { rotateCCW: 'rotateCCW', rotateCW: 'rotateCW', mirrorV: 'mirrorX', mirrorH: 'mirrorY' };
    if (id === 'zoomFit' || id === 'zoomFitObjects') controller.current?.zoomToFit();
    else if (id === 'zoomIn') controller.current?.zoomIn();
    else if (id === 'zoomOut') controller.current?.zoomOut();
    else if (id === 'undo') undo();
    else if (id === 'redo') redo();
    else if (id === 'open') promptOpen();
    else if (id === 'save') save();
    else if (id === 'erc') runErcNow();
    else if (id === 'showPcbNew') onShowPcb?.();
    else if (id === 'symbolEditor') onShowSymbolEditor?.();
    else if (id === 'openPreferences') setPrefsOpen(true);
    else if (TX[id]) setSelection((sel) => { if (sel.size > 0) runCommand(transformItems(sel, TX[id]!)); return sel; });
  }, [undo, redo, save, promptOpen, runCommand, runErcNow, onShowPcb, onShowSymbolEditor]);

  const menus = useMemo(() => buildMenus({ tool: onToolSelect, action: onTopAction }), [onToolSelect, onTopAction]);

  const onLeftToggle = useCallback((id: string) => {
    if (SETTINGS_TOGGLES.has(id)) {
      settings.updateEeschema((s) => {
        if (id === 'toggleGrid') s.window.grid.show = !s.window.grid.show;
        else if (id === 'toggleHiddenPins') s.appearance.show_hidden_pins = !s.appearance.show_hidden_pins;
        else if (id === 'crosshairSmall') s.window.cursor.fullscreen_cursor = false;
        else if (id === 'crosshairFull') s.window.cursor.fullscreen_cursor = true;
        else if (id === 'lineModeFree') s.drawing.line_mode = 0;
        else if (id === 'lineMode90') s.drawing.line_mode = 1;
        else if (id === 'lineMode45') s.drawing.line_mode = 2;
      });
      return;
    }
    setLocalToggles((prev) => {
      const next = new Set(prev);
      const group = RADIO_GROUPS.find((g) => g.includes(id));
      if (group) { for (const g of group) next.delete(g); next.add(id); }
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === 'Escape') {
        if (propsTarget !== null) setPropsTarget(null);
        else if (pastePending) setPastePending(null);
        else if (pendingLabel) { setPendingLabel(null); setActiveTool('select'); }
        else if (activeTool !== 'select') { setActiveTool('select'); setPlaceLib(null); }
        else if (selection.size > 0) setSelection(new Set());
        // "<ESC> clears net highlighting": with nothing else pending, the next
        // Escape clears the highlighted net (eeschema input.esc_clears_net_highlight).
        else if (settings.eeschema.input.esc_clears_net_highlight) setHighlightItem(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        e.preventDefault();
        runCommand(deleteByIds(selection));
        setSelection(new Set());
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // KiCad single-key tool hotkeys (A=symbol, W=wire, …). Skip while typing.
        const tgt = e.target as HTMLElement | null;
        const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable);
        if (typing) return;
        // E = Properties (KiCad SCH_ACTIONS::properties) on a single selected symbol.
        if (e.key.toLowerCase() === 'e' && selection.size === 1) {
          const id = [...selection][0]!;
          setDoc((d) => {
            if (d && d.symbols.some((s, i) => refId('symbol', s.uuid, i) === id)) {
              e.preventDefault();
              setPropsTarget(id);
            }
            return d;
          });
          return;
        }
        const toolId = TOOL_HOTKEYS[e.key.toLowerCase()];
        if (toolId) { e.preventDefault(); onToolSelect(toolId); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, promptOpen, selection, runCommand, activeTool, onToolSelect, pendingLabel, propsTarget, pastePending, duplicateSelection]);

  const units = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (units === 'mm') return `${mm.toFixed(4)}`;
    if (units === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
    return `${(mm / 25.4).toFixed(4)}`;
  };
  const zoomPct = Math.round((scale * 10000 * dpr) / PX_PER_MM_100 * 100);

  // A load failure before any document exists is fatal; once a document is open,
  // a bad Open just shows a dismissible banner and leaves the current sheet intact.
  if (!doc) {
    return error
      ? <pre style={{ color: 'crimson', padding: 16 }}>Failed to load schematic: {error}</pre>
      : <div className="ze-app"><LoadingOverlay label={loading ?? 'Loading schematic…'} /></div>;
  }

  const title = currentFile !== DEFAULT_FILE ? currentFile : fileName ?? doc.titleBlock?.title ?? 'Root';

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
        onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }}
      />
      {error && (
        <div className="ze-error-banner" onClick={() => setError(null)} title="Dismiss">
          Couldn’t open file: {error} — click to dismiss
        </div>
      )}
      <MenuBar
        menus={menus}
        leftSlot={<div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">⌂ ZiroEDA</div>}
      />

      <Toolbar entries={TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />

      <div className="ze-body">
        <div className="ze-leftdock">
          <div className="ze-panel grow">
            <div className="ze-panel-header">Properties</div>
            <div className="ze-panel-body">
              <div className="ze-muted">{selection.size === 0 ? 'No objects selected' : `${selection.size} item(s) selected`}</div>
            </div>
          </div>
          <div className="ze-panel grow">
            <div className="ze-panel-header">Schematic Hierarchy</div>
            <div className="ze-panel-body">
              {sheetTree && renderSheetNode(sheetTree, 0, currentPath, switchSheet)}
            </div>
          </div>
          <div className="ze-panel">
            <div className="ze-panel-header">Selection Filter</div>
            <div className="ze-panel-body">
              <label>
                <input
                  type="checkbox"
                  checked={selFilter.size === FILTER_CATS.length}
                  onChange={() => setSelFilter((p) => (p.size === FILTER_CATS.length ? new Set() : new Set(FILTER_CATS.map((c) => c[0]))))}
                />
                All items
              </label>
              <div className="ze-selfilter">
                {FILTER_CATS.map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={selFilter.has(key)}
                      onChange={() => setSelFilter((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Toolbar entries={LEFT_TOOLBAR} orientation="vertical" side="left" toggled={toggles} onActivate={onLeftToggle} />

        <div className="ze-canvas-wrap">
          <SchematicCanvas
            ref={controller}
            schematic={doc}
            libById={libById}
            selection={selection}
            activeTool={activeTool}
            lineMode={lineMode}
            placeLib={placeLib}
            pendingLabel={pendingLabel}
            highlight={highlightWires}
            theme={theme}
            renderOpts={renderOpts}
            inputPrefs={inputPrefs}
            onSelect={onSelect}
            onHighlight={onHighlight}
            onRequestTool={onToolSelect}
            onEditItem={onEditItem}
            onSelectBox={onSelectBox}
            pastePending={pastePending}
            onPasteDone={onPasteDone}
            ercMarkers={ercResult?.filter((v) =>
              v.severity === 'error' ? es.appearance.show_erc_errors : es.appearance.show_erc_warnings)}
            onCommand={runCommand}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
          {ercResult !== null && (
            <ErcDialog
              violations={ercResult}
              onRun={runErcNow}
              onLocate={locateViolation}
              onClose={() => setErcResult(null)}
            />
          )}
        </div>

        <Toolbar entries={RIGHT_TOOLBAR} orientation="vertical" side="right" activeTool={activeTool} onActivate={onToolSelect} />
      </div>

      <div className="ze-statusbar">
        <span className="cell">Z {Number.isFinite(zoomPct) ? (zoomPct / 100).toFixed(2) : '1.00'}</span>
        <span className="cell">X {cursor ? fmt(cursor.x) : '—'}  Y {cursor ? fmt(cursor.y) : '—'}</span>
        <span className="cell">
          dx {cursor ? fmt(cursor.x) : '—'}  dy {cursor ? fmt(cursor.y) : '—'}  dist {cursor ? fmt(Math.hypot(cursor.x, cursor.y)) : '—'}
        </span>
        <span className="cell">grid {(() => {
          const iu = renderOpts.grid.sizeIU;
          const mm = iuToMM(iu);
          return units === 'mm' ? mm.toFixed(4) : units === 'mils' ? (mm / 0.0254).toFixed(0) : (mm / 25.4).toFixed(4);
        })()}</span>
        <span className="cell">{highlightName ? `Net: ${highlightName}` : ''}</span>
        <span className="cell grow">{units}</span>
        <span className="cell" title="build">{__BUILD_STAMP__}</span>
      </div>

      {(activeTool === 'placeSymbol' || activeTool === 'placePower') && !placeLib && (
        <SymbolChooser
          onPick={setPlaceLib}
          onCancel={() => setActiveTool('select')}
          powerOnly={activeTool === 'placePower'}
          showFootprintPreview={es.appearance.footprint_preview}
        />
      )}

      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {/* Double-click / E on a symbol: KiCad's Symbol Properties dialog. */}
      {propsSymbol && propsTarget !== null && (
        <SymbolPropertiesDialog
          symbol={propsSymbol}
          lib={libById.get(propsSymbol.libId)}
          onOk={(edit: SymbolEdit) => {
            runCommand(editSymbolProperties(propsTarget, edit));
            setPropsTarget(null);
          }}
          onCancel={() => setPropsTarget(null)}
        />
      )}

      {/* Label tools: a properties dialog names the label, then it follows the cursor. */}
      {LABEL_TOOL_KINDS[activeTool] && !pendingLabel && (
        <LabelDialog
          kind={LABEL_TOOL_KINDS[activeTool]!}
          onOk={(text: string, shape: LabelShape) => setPendingLabel({ kind: LABEL_TOOL_KINDS[activeTool]!, text, shape })}
          onCancel={() => setActiveTool('select')}
        />
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
