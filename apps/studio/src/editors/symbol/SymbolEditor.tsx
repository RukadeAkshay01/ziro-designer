import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  iuToMM, letterSubReference, parse, readSymbolLib, serializeSymbolLib, sexpr,
  EMPTY_SOURCE, type LibGraphic, type LibPin, type LibSymbol, type SchField, type Vec2,
} from '@ziroeda/core';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { LoadingOverlay } from '../../ui/LoadingOverlay.js';
import { toolbarIconUrl } from '../../ui/toolbarIcons.js';
import { SYM_TOP_TOOLBAR, SYM_LEFT_TOOLBAR, SYM_RIGHT_TOOLBAR } from './symbolToolbars.js';
import { SymbolCanvas, type SymbolCanvasController } from './SymbolCanvas.js';
import { SymbolLibraryManager, type ManagedLibrary } from './libraryManager.js';
import { loadIndex } from '../schematic/symbols/index.js';
import { useSchematicTheme } from '../../prefs/useSettings.js';
import {
  addGraphicToSymbol, addPinToSymbol, allPins, createImagePins, deleteSymbolItems,
  ensureUnitEntry, hasAlternateBodyStyle, mirrorSymbolItems, parseItemId, renameSymbol,
  replaceSymbolItem, rotateSymbolItems, setUnitCount, unitCount,
} from './edits.js';
import { GRID, MM, type SymbolViewOptions } from './render/symbolRenderer.js';
import type { SymbolHit } from './edits.js';
import {
  LibSymbolPropertiesDialog, NewSymbolDialog, PinPropertiesDialog, PinTableDialog,
  ShapePropertiesDialog, SymbolCheckDialog, SymbolTextDialog,
  type NewSymbolResult, type PinDialogResult,
} from './components/dialogs.js';
import '../../ui/shell.css';

/**
 * The Symbol Editor frame — the web mirror of KiCad's SYMBOL_EDIT_FRAME
 * (eeschema/symbol_editor/): menu bar (menubar_symbol_editor.cpp), the three
 * toolbars with the unit selector combo (toolbars_symbol_editor.cpp), the
 * library tree pane (symbol_tree_pane.cpp) and the drawing canvas, wired to a
 * buffered library manager. Undo/redo keeps whole-symbol snapshots exactly as
 * SaveCopyInUndoList duplicates the full LIB_SYMBOL.
 */

export interface SymbolEditorFile { name: string; text: string }

/** Pin defaults persisted across placements (g_LastPin* in symbol_editor_pin_tool.cpp). */
interface LastPinState {
  electricalType: string;
  shape: string;
  angle: number;
  length: number;
  nameSize: number;
  numberSize: number;
  commonUnit: boolean;
  commonBody: boolean;
  visible: boolean;
}

const DEFAULT_LAST_PIN: LastPinState = {
  electricalType: 'input', shape: 'line', angle: 0,
  length: 2.54 * MM, // DEFAULT_PIN_LENGTH = 100 mils
  nameSize: 1.27 * MM, // DEFAULT_PINNAME_SIZE = 50 mils
  numberSize: 1.27 * MM, // DEFAULT_PINNUM_SIZE = 50 mils
  commonUnit: false, commonBody: false, visible: true,
};

const DEFAULT_TOGGLES = new Set([
  'toggleGrid', 'unitsMm', 'toggleSyncedPinsMode', 'showLibraryTree', 'showProperties',
  'showDeMorganStandard',
]);

const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['showDeMorganStandard', 'showDeMorganAlternate'],
];

const PX_PER_MM_100 = 3.7795;

const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

/** Resolve a derived symbol's geometry against the live library (LIB_SYMBOL::Flatten). */
function flattenAgainst(sym: LibSymbol, lib: ManagedLibrary, depth = 0): LibSymbol {
  if (sym.extends === undefined || depth > 10) return sym;
  const parent = lib.symbols.get(sym.extends);
  if (!parent) return sym;
  const base = flattenAgainst(parent, lib, depth + 1);
  return {
    ...sym,
    units: base.units,
    isPower: sym.isPower || base.isPower,
    pinNumbersHidden: base.pinNumbersHidden,
    pinNamesHidden: base.pinNamesHidden,
    pinNameOffset: base.pinNameOffset,
  };
}

export function SymbolEditor({ onExitToHome, initialProject, onAddSymbolToSchematic }: {
  onExitToHome: () => void;
  initialProject?: SymbolEditorFile[] | null;
  /** eeschema wiring for "Add symbol to schematic" (SCH_ACTIONS::addSymbolToSchematic). */
  onAddSymbolToSchematic?: (sym: LibSymbol) => void;
}): JSX.Element {
  const manager = useRef(new SymbolLibraryManager());
  const theme = useSchematicTheme();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision(manager.current.revision + Math.random()), []);

  // Current symbol (m_symbol): a working copy owned by the frame.
  const [curLib, setCurLib] = useState<string | null>(null);
  const [curName, setCurName] = useState<string | null>(null);
  const [workSymbol, setWorkSymbol] = useState<LibSymbol | null>(null);
  const [unit, setUnit] = useState(1);
  const [bodyStyle, setBodyStyle] = useState(1);

  // Whole-symbol snapshot undo/redo (SaveCopyInUndoList), reset per loaded symbol.
  const undoStack = useRef<LibSymbol[]>([]);
  const redoStack = useRef<LibSymbol[]>([]);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [activeTool, setActiveTool] = useState('select');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  // Library tree state (LIB_TREE: search box + expandable libraries).
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  const [panelWidth, setPanelWidth] = useState(260);

  // Dialogs / pending placements.
  const [pinDialog, setPinDialog] = useState<{ pin: LibPin; isNew: boolean; editId?: string } | null>(null);
  const [pendingPin, setPendingPin] = useState<(LibPin & { _commonUnit?: boolean; _commonBody?: boolean }) | null>(null);
  const [textDialog, setTextDialog] = useState<{ editId?: string; initial?: { text: string; fontSize: number; bold: boolean; italic: boolean } } | null>(null);
  const [pendingText, setPendingText] = useState<{ text: string; fontSize: number; bold: boolean; italic: boolean } | null>(null);
  const [shapeDialog, setShapeDialog] = useState<{ editId: string } | null>(null);
  const [newSymbolOpen, setNewSymbolOpen] = useState(false);
  const [symbolPropsOpen, setSymbolPropsOpen] = useState(false);
  const [pinTableOpen, setPinTableOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [newLibName, setNewLibName] = useState<string | null>(null);

  const lastPin = useRef<LastPinState>({ ...DEFAULT_LAST_PIN });
  const controller = useRef<SymbolCanvasController>(null);
  const addLibInputRef = useRef<HTMLInputElement>(null);
  const importSymInputRef = useRef<HTMLInputElement>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // ----- library bootstrap ------------------------------------------------------
  useEffect(() => {
    // Project libraries (the open project's .kicad_sym files).
    for (const f of initialProject ?? []) {
      if (!/\.kicad_sym$/i.test(f.name)) continue;
      const name = basename(f.name).replace(/\.kicad_sym$/i, '');
      manager.current.addProjectLibrary(name, f.name, f.text);
    }
    // Bundled global libraries: names first (like KiCad's lazy library loads).
    loadIndex()
      .then((idx) => {
        for (const lib of idx) manager.current.addGlobalLibrary(lib.name, lib.symbols);
        bump();
      })
      .catch(() => bump());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- helpers -----------------------------------------------------------------
  const showDeMorgan = workSymbol ? hasAlternateBodyStyle(workSymbol) : false;
  const units = workSymbol ? unitCount(workSymbol) : 1;
  const isAlias = workSymbol?.extends !== undefined;
  const synced = toggles.has('toggleSyncedPinsMode');

  const opts: SymbolViewOptions = useMemo(() => ({
    unit, bodyStyle,
    showPinElectricalTypes: toggles.has('showElectricalTypes'),
    showHiddenPins: toggles.has('showHiddenPins'),
    showHiddenFields: toggles.has('showHiddenFields'),
  }), [unit, bodyStyle, toggles]);

  /** Commit one undoable edit (SaveCopyInUndoList + OnModify + buffer to the manager). */
  const commit = useCallback((next: LibSymbol, description: string) => {
    setWorkSymbol((prev) => {
      if (!prev || !curLib) return prev;
      undoStack.current.push(prev);
      redoStack.current = [];
      if (next.libId !== prev.libId) manager.current.renameSymbol(curLib, prev.libId, next);
      else manager.current.updateSymbol(curLib, next);
      setCurName(next.libId);
      bump();
      setStatus(description);
      return next;
    });
  }, [curLib, bump]);

  const undo = useCallback(() => {
    setWorkSymbol((cur) => {
      const prev = undoStack.current.pop();
      if (!prev || !cur || !curLib) return cur;
      redoStack.current.push(cur);
      if (prev.libId !== cur.libId) manager.current.renameSymbol(curLib, cur.libId, prev);
      else manager.current.updateSymbol(curLib, prev);
      setCurName(prev.libId);
      bump();
      return prev;
    });
    setSelection(new Set());
  }, [curLib, bump]);

  const redo = useCallback(() => {
    setWorkSymbol((cur) => {
      const next = redoStack.current.pop();
      if (!next || !cur || !curLib) return cur;
      undoStack.current.push(cur);
      if (next.libId !== cur.libId) manager.current.renameSymbol(curLib, cur.libId, next);
      else manager.current.updateSymbol(curLib, next);
      setCurName(next.libId);
      bump();
      return next;
    });
    setSelection(new Set());
  }, [curLib, bump]);

  /** LoadSymbol: buffer the working copy, load the target, reset undo, zoom to fit. */
  const loadSymbol = useCallback(async (libName: string, symName: string) => {
    setLoading('Loading symbol…');
    try {
      const lib = await manager.current.ensureLoaded(libName);
      const sym = lib?.symbols.get(symName);
      if (!lib || !sym) { setStatus(`Symbol ${libName}:${symName} not found`); return; }
      const flat = flattenAgainst(sym, lib);
      setCurLib(libName);
      setCurName(symName);
      setWorkSymbol(flat);
      setUnit(1);
      setBodyStyle(1);
      undoStack.current = [];
      redoStack.current = [];
      setSelection(new Set());
      setActiveTool('select');
      setPendingPin(null);
      setPendingText(null);
      bump();
      requestAnimationFrame(() => controller.current?.zoomToFit());
    } finally {
      setLoading(null);
    }
  }, [bump]);

  // ----- save / revert ------------------------------------------------------------
  const downloadText = (fileName: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** saveLibrary: serialize the buffered library and hand the bytes to the browser. */
  const saveLibrary = useCallback(async (libName: string) => {
    await manager.current.ensureLoaded(libName);
    const text = manager.current.saveLibraryText(libName);
    if (text !== undefined) {
      downloadText(`${libName}.kicad_sym`, text);
      setStatus(`Saved library '${libName}'`);
      bump();
    }
  }, [bump]);

  /** Save: the tree's target library, else the current symbol's library. */
  const save = useCallback(() => {
    const libName = treeSel?.lib ?? curLib;
    if (libName) void saveLibrary(libName);
  }, [treeSel, curLib, saveLibrary]);

  const saveAll = useCallback(() => {
    for (const name of manager.current.libraryNames()) {
      if (manager.current.isLibraryModified(name)) void saveLibrary(name);
    }
  }, [saveLibrary]);

  const revert = useCallback(() => {
    if (!curLib || !curName || !workSymbol) return;
    if (!manager.current.isSymbolModified(curLib, curName)) return;
    if (!window.confirm('Revert unsaved changes in this symbol?')) return;
    const orig = manager.current.revertSymbol(curLib, curName);
    if (orig) {
      const lib = manager.current.library(curLib)!;
      setWorkSymbol(flattenAgainst(orig, lib));
      undoStack.current = [];
      redoStack.current = [];
      setSelection(new Set());
    } else {
      setWorkSymbol(null);
      setCurName(null);
    }
    bump();
  }, [curLib, curName, workSymbol, bump]);

  // ----- symbol management (symbol_editor.cpp) --------------------------------------
  const targetLib = treeSel?.lib ?? curLib;

  /** CreateNewSymbol: root or derived, exactly as SYMBOL_EDIT_FRAME::CreateNewSymbol. */
  const createNewSymbol = useCallback((r: NewSymbolResult) => {
    setNewSymbolOpen(false);
    const libName = targetLib;
    if (!libName) return;
    const { atom, list, str } = sexpr;
    const field = (key: string, value: string, hidden: boolean): SchField => ({
      key, value, at: { x: 0, y: 0 }, angle: 0, effects: { hidden }, source: EMPTY_SOURCE,
    });

    let sym: LibSymbol;
    if (r.parentSymbolName === '') {
      // Root symbol: mandatory fields + the dialog's flags. The source node
      // carries the header booleans the typed model doesn't represent.
      const source = list(atom('symbol'), str(r.name),
        list(atom('exclude_from_sim'), atom('no')),
        list(atom('in_bom'), atom(r.excludeFromBom ? 'no' : 'yes')),
        list(atom('on_board'), atom(r.excludeFromBoard ? 'no' : 'yes')));
      const properties: SchField[] = [
        field('Reference', r.reference, false),
        field('Value', r.name, false),
        field('Footprint', '', true),
        field('Datasheet', '', true),
        field('Description', '', true),
      ];
      if (!r.unitsInterchangeable && r.unitCount >= 2) properties.push(field('ki_locked', '', true));
      sym = {
        libId: r.name,
        isPower: r.isPowerSymbol,
        pinNumbersHidden: !r.showPinNumber,
        pinNamesHidden: !r.showPinName,
        pinNameOffset: r.pinNameInside ? (r.pinTextPosition || 0.0254 * MM / 10) : 0,
        properties,
        units: [],
        source,
      };
      sym = ensureUnitEntry(sym, 0, 1).sym;
      for (let u = 1; u <= r.unitCount; u++) {
        if (r.unitCount > 1) sym = ensureUnitEntry(sym, u, 1).sym;
        if (r.alternateBodyStyle) sym = ensureUnitEntry(sym, u, 2).sym;
      }
    } else {
      // Derived symbol: inherit the parent's mandatory-field attributes.
      const lib = manager.current.library(libName);
      const parent = lib?.symbols.get(r.parentSymbolName);
      if (!parent) return;
      const source = list(atom('symbol'), str(r.name), list(atom('extends'), str(r.parentSymbolName)));
      const parentField = (key: string): SchField | undefined => parent.properties.find((f) => f.key === key);
      const properties: SchField[] = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'].map((key) => {
        const pf = parentField(key);
        const base: SchField = pf ? { ...pf, source: EMPTY_SOURCE } : field(key, '', key !== 'Reference' && key !== 'Value');
        if (key === 'Value') return { ...base, value: parent.isPower ? r.name : r.name };
        if (key === 'Footprint' || key === 'Datasheet') return { ...base, value: '' };
        return base;
      });
      sym = {
        libId: r.name,
        extends: r.parentSymbolName,
        isPower: parent.isPower,
        pinNumbersHidden: parent.pinNumbersHidden,
        pinNamesHidden: parent.pinNamesHidden,
        pinNameOffset: parent.pinNameOffset,
        properties,
        units: parent.units,
        source,
      };
    }
    manager.current.updateSymbol(libName, sym);
    bump();
    void loadSymbol(libName, r.name);
  }, [targetLib, bump, loadSymbol]);

  const deleteSymbol = useCallback((libName: string, symName: string) => {
    if (!window.confirm(`Delete symbol '${symName}' from library '${libName}'?`)) return;
    manager.current.removeSymbol(libName, symName);
    if (curLib === libName && curName === symName) {
      setWorkSymbol(null);
      setCurName(null);
    }
    bump();
  }, [curLib, curName, bump]);

  /** DuplicateSymbol: insert a copy with a unique name next to the source. */
  const duplicateSymbol = useCallback(async (libName: string, symName: string) => {
    const lib = await manager.current.ensureLoaded(libName);
    const src = lib?.symbols.get(symName);
    if (!lib || !src) return;
    let newName = symName;
    while (lib.symbols.has(newName)) newName = `${newName}_copy`;
    const copy = renameSymbol({ ...src, source: src.source }, newName);
    manager.current.updateSymbol(libName, copy);
    bump();
    void loadSymbol(libName, newName);
  }, [bump, loadSymbol]);

  const exportSymbol = useCallback(async () => {
    const libName = treeSel?.lib ?? curLib;
    const symName = treeSel?.name ?? curName;
    if (!libName || !symName) return;
    await manager.current.ensureLoaded(libName);
    const sym = manager.current.getSymbol(libName, symName);
    if (!sym) return;
    const lib = manager.current.library(libName)!;
    downloadText(`${symName}.kicad_sym`, serializeSymbolLib([flattenAgainst(sym, lib)]));
  }, [treeSel, curLib, curName]);

  /** ImportSymbol: append the file's first symbol to the target library. */
  const importSymbolFile = useCallback(async (file: File) => {
    const libName = targetLib;
    if (!libName) { setStatus('Select a library first'); return; }
    try {
      const symbols = readSymbolLib(parse(await file.text()));
      const first = symbols.find((s) => s.extends === undefined) ?? symbols[0];
      if (!first) { setStatus(`No symbols in ${file.name}`); return; }
      await manager.current.ensureLoaded(libName);
      const lib = manager.current.library(libName)!;
      let name = first.libId;
      while (lib.symbols.has(name)) name = `${name}_1`; // ensureUniqueName
      manager.current.updateSymbol(libName, name === first.libId ? first : renameSymbol(first, name));
      bump();
      void loadSymbol(libName, name);
    } catch (e) {
      setStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [targetLib, bump, loadSymbol]);

  const addLibraryFile = useCallback(async (file: File) => {
    const name = basename(file.name).replace(/\.kicad_sym$/i, '');
    manager.current.addProjectLibrary(name, file.name, await file.text());
    setExpanded((p) => new Set([...p, name]));
    bump();
  }, [bump]);

  // ----- tool / toolbar dispatch -----------------------------------------------------
  const onToolSelect = useCallback((id: string) => {
    setActiveTool(id);
    setPendingPin(null);
    setPendingText(null);
  }, []);

  const rotateSel = useCallback((ccw: boolean) => {
    if (!workSymbol || selection.size === 0 || isAlias) return;
    commit(rotateSymbolItems(workSymbol, selection, ccw), ccw ? 'Rotate CCW' : 'Rotate CW');
  }, [workSymbol, selection, isAlias, commit]);

  const mirrorSel = useCallback((horizontal: boolean) => {
    if (!workSymbol || selection.size === 0 || isAlias) return;
    commit(mirrorSymbolItems(workSymbol, selection, horizontal), horizontal ? 'Mirror Horizontally' : 'Mirror Vertically');
  }, [workSymbol, selection, isAlias, commit]);

  const showDatasheet = useCallback(() => {
    const url = workSymbol?.properties.find((f) => f.key === 'Datasheet')?.value ?? '';
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else setStatus(url ? `Datasheet: ${url}` : 'No datasheet defined');
  }, [workSymbol]);

  const onTopAction = useCallback((id: string) => {
    switch (id) {
      case 'newSymbol': setNewSymbolOpen(true); break;
      case 'saveAll': saveAll(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomRedraw': controller.current?.zoomToFit(); break;
      case 'zoomIn': controller.current?.zoomIn(); break;
      case 'zoomOut': controller.current?.zoomOut(); break;
      case 'zoomFit': controller.current?.zoomToFit(); break;
      case 'rotateCCW': rotateSel(true); break;
      case 'rotateCW': rotateSel(false); break;
      // mirrorV = MirrorVertically (top/bottom flip); mirrorH = MirrorHorizontally.
      case 'mirrorV': mirrorSel(false); break;
      case 'mirrorH': mirrorSel(true); break;
      case 'symbolProperties': if (workSymbol) setSymbolPropsOpen(true); break;
      case 'pinTable': if (workSymbol) setPinTableOpen(true); break;
      case 'showDatasheet': showDatasheet(); break;
      case 'checkSymbol': if (workSymbol) setCheckOpen(true); break;
      case 'showDeMorganStandard': setBodyStyle(1); setToggles((t) => radio(t, 'showDeMorganStandard')); break;
      case 'showDeMorganAlternate': setBodyStyle(2); setToggles((t) => radio(t, 'showDeMorganAlternate')); break;
      case 'toggleSyncedPinsMode': setToggles((t) => flip(t, 'toggleSyncedPinsMode')); break;
      case 'addSymbolToSchematic':
        if (workSymbol && curLib && onAddSymbolToSchematic) {
          onAddSymbolToSchematic({ ...workSymbol, libId: `${curLib}:${workSymbol.libId}` });
        } else {
          setStatus('No schematic currently open.');
        }
        break;
    }
  }, [saveAll, undo, redo, rotateSel, mirrorSel, workSymbol, curLib, onAddSymbolToSchematic, showDatasheet]);

  const radio = (t: Set<string>, id: string): Set<string> => {
    const group = RADIO_GROUPS.find((g) => g.includes(id));
    const next = new Set(t);
    if (group) for (const g of group) next.delete(g);
    next.add(id);
    return next;
  };
  const flip = (t: Set<string>, id: string): Set<string> => {
    const next = new Set(t);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) => (RADIO_GROUPS.some((g) => g.includes(id)) ? radio(prev, id) : flip(prev, id)));
  }, []);

  // ----- pin placement (SYMBOL_EDITOR_PIN_TOOL) ---------------------------------------
  const onPinToolClick = useCallback((pos: Vec2) => {
    if (!workSymbol || isAlias) return;
    const lp = lastPin.current;
    setPinDialog({
      isNew: true,
      pin: {
        electricalType: lp.electricalType, shape: lp.shape, at: pos, angle: lp.angle,
        length: lp.length, name: '', number: '', nameSize: lp.nameSize, numberSize: lp.numberSize,
        hidden: !lp.visible, source: EMPTY_SOURCE,
      },
    });
  }, [workSymbol, isAlias]);

  const onPinDialogOk = useCallback((r: PinDialogResult) => {
    const wasNew = pinDialog?.isNew;
    const editId = pinDialog?.editId;
    setPinDialog(null);
    // Persist the "last pin" defaults (g_LastPin*).
    lastPin.current = {
      electricalType: r.pin.electricalType, shape: r.pin.shape, angle: r.pin.angle,
      length: r.pin.length, nameSize: r.pin.nameSize ?? DEFAULT_LAST_PIN.nameSize,
      numberSize: r.pin.numberSize ?? DEFAULT_LAST_PIN.numberSize,
      commonUnit: r.commonToAllUnits, commonBody: r.commonToAllBodyStyles, visible: !r.pin.hidden,
    };
    if (wasNew) {
      setPendingPin({ ...r.pin, _commonUnit: r.commonToAllUnits, _commonBody: r.commonToAllBodyStyles });
    } else if (editId && workSymbol) {
      // EditPinProperties: apply the dialog and, in synchronized mode, update the
      // matching pins of the other units (same original position/orientation/
      // type/visibility/name — one per unit).
      const ref = parseItemId(editId);
      const original = ref && workSymbol.units[ref.unitIdx]?.pins[ref.itemIdx];
      let next = replaceSymbolItem(workSymbol, editId, r.pin);
      if (original && synced && units > 1) {
        const gotUnit = new Set<number>([workSymbol.units[ref!.unitIdx]!.unit]);
        next = {
          ...next,
          units: next.units.map((u, ui) => {
            if (ui === ref!.unitIdx || gotUnit.has(u.unit)) return u;
            let taken = false;
            const pins = u.pins.map((other) => {
              if (taken) return other;
              if (other.at.x === original.at.x && other.at.y === original.at.y
                && other.angle === original.angle
                && other.electricalType === original.electricalType
                && other.hidden === original.hidden
                && other.name === original.name) {
                taken = true;
                return {
                  ...other, length: r.pin.length, at: r.pin.at, shape: r.pin.shape,
                  angle: r.pin.angle, electricalType: r.pin.electricalType,
                  hidden: r.pin.hidden, name: r.pin.name,
                  nameSize: r.pin.nameSize, numberSize: r.pin.numberSize,
                };
              }
              return other;
            });
            if (taken) gotUnit.add(u.unit);
            return taken ? { ...u, pins } : u;
          }),
        };
      }
      commit(next, 'Edit Pin Properties');
    }
  }, [pinDialog, workSymbol, synced, units, commit]);

  const onPlacePendingPin = useCallback((pos: Vec2) => {
    if (!workSymbol || !pendingPin || !curLib) return;
    const { _commonUnit, _commonBody, ...pinBase } = pendingPin;
    const pin: LibPin = { ...pinBase, at: pos };
    const pinUnit = _commonUnit ? 0 : unit;
    const pinBody = _commonBody ? 0 : bodyStyle;

    // PlacePin: warn when the position is already occupied in another unit.
    if (synced) {
      const clash = allPins(workSymbol).find(({ pin: test, unitIdx }) => {
        const u = workSymbol.units[unitIdx]!;
        if (test.at.x !== pos.x || test.at.y !== pos.y) return false;
        if (u.bodyStyle && pinBody && u.bodyStyle !== pinBody) return false;
        return true;
      });
      if (clash) {
        const u = workSymbol.units[clash.unitIdx]!;
        if (!window.confirm(`This position is already occupied by another pin, in unit ${u.unit || 1}.\nPlace Pin Anyway?`)) return;
      }
    }

    let { sym: next } = addPinToSymbol(workSymbol, pin, pinUnit, pinBody);
    if (synced && units > 1) next = createImagePins(next, pin, pinUnit, pinBody);
    commit(next, 'Place Pin');
    // The tool stays active; the next click opens the dialog again (CreatePin).
    setPendingPin(null);
  }, [workSymbol, pendingPin, curLib, unit, bodyStyle, synced, units, commit]);

  // ----- text / shapes ------------------------------------------------------------------
  const onTextToolClick = useCallback(() => {
    if (!workSymbol || isAlias) return;
    setTextDialog({});
  }, [workSymbol, isAlias]);

  const onTextDialogOk = useCallback((r: { text: string; fontSize: number; bold: boolean; italic: boolean }) => {
    const editId = textDialog?.editId;
    setTextDialog(null);
    if (editId && workSymbol) {
      const ref = parseItemId(editId);
      const g = ref && workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
      if (g && g.kind === 'text') {
        const next: LibGraphic = {
          ...g, text: r.text,
          effects: { ...(g.effects ?? { hidden: false }), fontSize: [r.fontSize, r.fontSize], bold: r.bold || undefined, italic: r.italic || undefined },
        };
        commit(replaceSymbolItem(workSymbol, editId, next), 'Edit Text');
      }
    } else {
      setPendingText(r);
    }
  }, [textDialog, workSymbol, commit]);

  const onPlacePendingText = useCallback((pos: Vec2) => {
    if (!workSymbol || !pendingText) return;
    const g: LibGraphic = {
      kind: 'text', text: pendingText.text, at: pos, angle: 0,
      effects: {
        hidden: false, fontSize: [pendingText.fontSize, pendingText.fontSize],
        bold: pendingText.bold || undefined, italic: pendingText.italic || undefined,
      },
      source: EMPTY_SOURCE,
    };
    commit(addGraphicToSymbol(workSymbol, g, unit, bodyStyle).sym, 'Draw Text');
    setPendingText(null);
  }, [workSymbol, pendingText, unit, bodyStyle, commit]);

  const onPlaceShape = useCallback((g: LibGraphic) => {
    if (!workSymbol || isAlias) return;
    // New shapes take KiCad's defaults: line_width 0 ("default") and no fill.
    commit(addGraphicToSymbol(workSymbol, g, unit, bodyStyle).sym, `Add ${g.kind}`);
  }, [workSymbol, isAlias, unit, bodyStyle, commit]);

  // ----- item editing -----------------------------------------------------------------
  const onEditItem = useCallback((hit: SymbolHit) => {
    if (!workSymbol) return;
    const ref = parseItemId(hit.id);
    if (!ref) return;
    if (hit.kind === 'pin') {
      const pin = workSymbol.units[ref.unitIdx]?.pins[ref.itemIdx];
      if (pin) setPinDialog({ pin, isNew: false, editId: hit.id });
    } else if (hit.kind === 'gfx') {
      const g = workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
      if (g?.kind === 'text') {
        setTextDialog({
          editId: hit.id,
          initial: {
            text: g.text, fontSize: g.effects?.fontSize?.[0] ?? 1.27 * MM,
            bold: !!g.effects?.bold, italic: !!g.effects?.italic,
          },
        });
      } else if (g) {
        setShapeDialog({ editId: hit.id });
      }
    } else {
      setSymbolPropsOpen(true);
    }
  }, [workSymbol]);

  const onShapeDialogOk = useCallback((r: { strokeWidth: number; strokeType: string; fillType: 'none' | 'outline' | 'background' }) => {
    const editId = shapeDialog?.editId;
    setShapeDialog(null);
    if (!editId || !workSymbol) return;
    const ref = parseItemId(editId);
    const g = ref && workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
    if (!g || g.kind === 'text') return;
    const next: LibGraphic = {
      ...g,
      stroke: { width: r.strokeWidth, type: r.strokeType },
      fill: { type: r.fillType },
    };
    commit(replaceSymbolItem(workSymbol, editId, next), 'Edit Shape');
  }, [shapeDialog, workSymbol, commit]);

  /** Symbol properties dialog OK (UpdateAfterSymbolProperties). */
  const onSymbolPropsOk = useCallback((r: {
    name: string; properties: SchField[]; keywords: string; unitCount: number;
    unitsInterchangeable: boolean; isPower: boolean; pinNameInside: boolean;
    pinNameOffset: number; showPinNumbers: boolean; showPinNames: boolean;
  }) => {
    setSymbolPropsOpen(false);
    if (!workSymbol || !curLib) return;
    let next = workSymbol;

    // Rebuild the property list: dialog rows + the preserved hidden ki_* fields.
    const hiddenExtras = workSymbol.properties.filter((f) => f.key === 'ki_fp_filters');
    const props: SchField[] = [...r.properties];
    if (r.keywords.trim() !== '') {
      const old = workSymbol.properties.find((f) => f.key === 'ki_keywords');
      props.push(old ? { ...old, value: r.keywords } : {
        key: 'ki_keywords', value: r.keywords, at: { x: 0, y: 0 }, angle: 0,
        effects: { hidden: true }, source: EMPTY_SOURCE,
      });
    }
    if (!r.unitsInterchangeable && r.unitCount >= 2) {
      const old = workSymbol.properties.find((f) => f.key === 'ki_locked');
      props.push(old ?? { key: 'ki_locked', value: '', at: { x: 0, y: 0 }, angle: 0, effects: { hidden: true }, source: EMPTY_SOURCE });
    }
    props.push(...hiddenExtras);

    next = {
      ...next,
      properties: props,
      isPower: r.isPower,
      pinNumbersHidden: !r.showPinNumbers,
      pinNamesHidden: !r.showPinNames,
      pinNameOffset: r.pinNameInside ? r.pinNameOffset : 0,
    };
    next = setUnitCount(next, r.unitCount);
    if (r.name !== workSymbol.libId) next = renameSymbol(next, r.name);
    commit(next, 'Edit Symbol Properties');
  }, [workSymbol, curLib, commit]);

  // ----- keyboard (hotkeys per sch_actions defaults) --------------------------------------
  useEffect(() => {
    const anyDialogOpen = pinDialog || textDialog || shapeDialog || newSymbolOpen
      || symbolPropsOpen || pinTableOpen || checkOpen || newLibName !== null;
    const onKey = (e: KeyboardEvent): void => {
      if (anyDialogOpen && e.key !== 'Escape') return;
      const tgt = e.target as HTMLElement | null;
      const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        if (anyDialogOpen) {
          setPinDialog(null); setTextDialog(null); setShapeDialog(null); setNewSymbolOpen(false);
          setSymbolPropsOpen(false); setPinTableOpen(false); setCheckOpen(false); setNewLibName(null);
        } else if (pendingPin) setPendingPin(null);
        else if (pendingText) setPendingText(null);
        else if (activeTool !== 'select') setActiveTool('select');
        else setSelection(new Set());
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selection.size > 0) {
        e.preventDefault();
        if (workSymbol && !isAlias) {
          commit(deleteSymbolItems(workSymbol, selection), 'Delete');
          setSelection(new Set());
        }
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'r') { e.preventDefault(); rotateSel(!e.shiftKey); }
        else if (k === 'x') { e.preventDefault(); mirrorSel(false); }
        else if (k === 'y') { e.preventDefault(); mirrorSel(true); }
        else if (k === 'p') { e.preventDefault(); onToolSelect('placePin'); }
        else if (k === 't') { e.preventDefault(); onToolSelect('placeText'); }
        else if (k === 'e' && selection.size === 1 && workSymbol) {
          const id = [...selection][0]!;
          const ref = parseItemId(id);
          if (ref) {
            e.preventDefault();
            onEditItem({ id, kind: ref.kind });
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo, selection, workSymbol, isAlias, activeTool, commit, rotateSel, mirrorSel, onToolSelect, onEditItem,
    pinDialog, textDialog, shapeDialog, newSymbolOpen, symbolPropsOpen, pinTableOpen, checkOpen, newLibName, pendingPin, pendingText]);

  // ----- selection ---------------------------------------------------------------------
  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return prev.has(id) ? prev : new Set([id]);
    });
  }, []);

  const onSelectBox = useCallback((ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => {
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

  // ----- library tree (symbol_tree_pane / LIB_TREE) -----------------------------------------
  const libNames = manager.current.libraryNames();
  const q = query.trim().toLowerCase();
  void revision;

  const treeRows = useMemo(() => {
    interface Row { lib: string; sym?: string; desc?: string; modified?: boolean }
    const rows: Row[] = [];
    const mgr = manager.current;
    for (const libName of libNames) {
      const lib = mgr.library(libName)!;
      const names = mgr.symbolNames(libName);
      if (q) {
        const matches = names.filter((n) => n.toLowerCase().includes(q) || `${libName}:${n}`.toLowerCase().includes(q));
        if (matches.length === 0 && !libName.toLowerCase().includes(q)) continue;
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        for (const n of (matches.length > 0 ? matches : names).slice(0, 100)) {
          rows.push({ lib: libName, sym: n, modified: mgr.isSymbolModified(libName, n) });
        }
      } else {
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        if (expanded.has(libName)) {
          for (const n of names) {
            const sym = lib.symbols.get(n);
            const desc = sym?.properties.find((f) => f.key === 'Description' || f.key === 'ki_description')?.value;
            rows.push({ lib: libName, sym: n, ...(desc ? { desc } : {}), modified: mgr.isSymbolModified(libName, n) });
          }
        }
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libNames, q, expanded, revision]);

  const toggleLib = useCallback((libName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(libName)) next.delete(libName);
      else {
        next.add(libName);
        void manager.current.ensureLoaded(libName).then(bump);
      }
      return next;
    });
  }, [bump]);

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent): void => setPanelWidth(Math.min(500, Math.max(160, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  // ----- menus (menubar_symbol_editor.cpp, working subset) -----------------------------------
  const menus: Menu[] = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'New Library…', icon: 'newLibrary', action: () => setNewLibName('') },
        { label: 'Add Library…', icon: 'addLibrary', action: () => addLibInputRef.current?.click() },
        { label: 'New Symbol…', icon: 'newSymbol', action: () => setNewSymbolOpen(true), shortcut: 'Ctrl+N' },
        { sep: true },
        { label: 'Save', icon: 'save', action: save, shortcut: 'Ctrl+S' },
        { label: 'Save All', action: saveAll },
        { label: 'Revert', icon: 'revert', action: revert, disabled: !curName },
        { sep: true },
        { label: 'Import Symbol…', icon: 'importSymbol', action: () => importSymInputRef.current?.click() },
        { label: 'Export Symbol…', icon: 'exportSymbol', action: () => void exportSymbol(), disabled: !curName && !treeSel?.name },
        { sep: true },
        { label: 'Symbol Properties…', icon: 'symbolProperties', action: () => workSymbol && setSymbolPropsOpen(true), disabled: !workSymbol },
        { sep: true },
        { label: 'Close Library Editor', action: onExitToHome },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', icon: 'undo', action: undo, shortcut: 'Ctrl+Z' },
        { label: 'Redo', icon: 'redo', action: redo, shortcut: 'Ctrl+Y' },
        { sep: true },
        {
          label: 'Delete', icon: 'delete', shortcut: 'Del',
          action: () => {
            if (workSymbol && selection.size > 0 && !isAlias) {
              commit(deleteSymbolItems(workSymbol, selection), 'Delete');
              setSelection(new Set());
            }
          },
        },
        { sep: true },
        { label: 'Pin Table…', icon: 'pinTable', action: () => workSymbol && setPinTableOpen(true), disabled: !workSymbol },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', icon: 'zoomIn', action: () => controller.current?.zoomIn() },
        { label: 'Zoom Out', icon: 'zoomOut', action: () => controller.current?.zoomOut() },
        { label: 'Zoom to Fit', icon: 'zoomFit', action: () => controller.current?.zoomToFit() },
        { sep: true },
        { label: `${toggles.has('showHiddenPins') ? '✓ ' : ''}Show Hidden Pins`, action: () => onLeftToggle('showHiddenPins') },
        { label: `${toggles.has('showHiddenFields') ? '✓ ' : ''}Show Hidden Fields`, action: () => onLeftToggle('showHiddenFields') },
        { label: `${toggles.has('showElectricalTypes') ? '✓ ' : ''}Show Pin Electrical Types`, action: () => onLeftToggle('showElectricalTypes') },
        { sep: true },
        { label: `${toggles.has('showLibraryTree') ? '✓ ' : ''}Library Tree`, action: () => onLeftToggle('showLibraryTree') },
        { label: `${toggles.has('showProperties') ? '✓ ' : ''}Properties Manager`, action: () => onLeftToggle('showProperties') },
      ],
    },
    {
      label: 'Place',
      items: [
        { label: 'Pin', icon: 'placePin', action: () => onToolSelect('placePin'), shortcut: 'P' },
        { label: 'Text', icon: 'placeText', action: () => onToolSelect('placeText'), shortcut: 'T' },
        { label: 'Rectangle', icon: 'rectangle', action: () => onToolSelect('drawRectangle') },
        { label: 'Circle', icon: 'circle', action: () => onToolSelect('drawCircle') },
        { label: 'Arc', icon: 'arc', action: () => onToolSelect('drawArc') },
        { label: 'Lines', icon: 'lines', action: () => onToolSelect('drawLines') },
        { label: 'Polygon', icon: 'polygon', action: () => onToolSelect('drawPolygon') },
      ],
    },
    {
      label: 'Inspect',
      items: [
        { label: 'Show Datasheet', icon: 'showDatasheet', action: showDatasheet, disabled: !workSymbol },
        { sep: true },
        { label: 'Symbol Checker…', icon: 'checkSymbol', action: () => workSymbol && setCheckOpen(true), disabled: !workSymbol },
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Preferences…', disabled: true }],
    },
    {
      label: 'Help',
      items: [{ label: 'About ZiroEDA', action: () => {} }],
    },
  ], [save, saveAll, revert, undo, redo, exportSymbol, onExitToHome, workSymbol, curName, treeSel, selection, isAlias,
    toggles, commit, onLeftToggle, onToolSelect, showDatasheet]);

  // ----- title (UpdateTitle) -------------------------------------------------------------
  const modified = curLib && curName ? manager.current.isSymbolModified(curLib, curName) : false;
  const title = curName
    ? `${modified ? '*' : ''}${curLib}:${curName} — Symbol Editor`
    : '[no symbol loaded] — Symbol Editor';
  useEffect(() => { document.title = title; }, [title]);

  const unitsLabel = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (unitsLabel === 'mm') return mm.toFixed(4);
    if (unitsLabel === 'mils') return (mm / 0.0254).toFixed(2);
    return (mm / 25.4).toFixed(4);
  };
  const zoomPct = Math.round((scale * 10000 * dpr) / PX_PER_MM_100 * 100);

  const propsSummary = useMemo(() => {
    if (!workSymbol || selection.size !== 1) return null;
    const ref = parseItemId([...selection][0]!);
    if (!ref) return null;
    if (ref.kind === 'pin') {
      const p = workSymbol.units[ref.unitIdx]?.pins[ref.itemIdx];
      return p ? `Pin ${p.number} '${p.name}' — ${p.electricalType}, ${p.shape}, length ${fmt(p.length)} ${unitsLabel}` : null;
    }
    if (ref.kind === 'field') {
      const f = workSymbol.properties[ref.itemIdx];
      return f ? `Field ${f.key}: ${f.value}` : null;
    }
    const g = workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
    return g ? `Graphic: ${g.kind}` : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workSymbol, selection, unitsLabel]);

  return (
    <div className="ze-app">
      <input
        ref={addLibInputRef} type="file" accept=".kicad_sym" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void addLibraryFile(f); e.target.value = ''; }}
      />
      <input
        ref={importSymInputRef} type="file" accept=".kicad_sym" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSymbolFile(f); e.target.value = ''; }}
      />

      <MenuBar
        menus={menus}
        leftSlot={<div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">⌂ ZiroEDA</div>}
      />

      {/* Top toolbar with the unit-selector combo (ID_LIBEDIT_SELECT_UNIT_NUMBER). */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Toolbar entries={SYM_TOP_TOOLBAR} orientation="horizontal" toggled={toggles} onActivate={onTopAction} />
        <select
          className="ze-select"
          title="Select unit to edit"
          style={{ margin: '0 8px', minWidth: 110 }}
          disabled={units < 2}
          value={unit}
          onChange={(e) => { setUnit(Number(e.target.value)); setSelection(new Set()); }}
        >
          {units < 2
            ? <option value={1}></option>
            : Array.from({ length: units }, (_, k) => (
              <option key={k + 1} value={k + 1}>Unit {letterSubReference(k + 1)}</option>
            ))}
        </select>
      </div>

      <div className="ze-body">
        {toggles.has('showLibraryTree') && (
          <>
            <div className="ze-leftdock" style={{ width: panelWidth, minWidth: panelWidth }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">Libraries</div>
                <div style={{ padding: 4 }}>
                  <input
                    className="ze-search"
                    placeholder="Filter"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="ze-panel-body">
                  {treeRows.length === 0 && <div className="ze-muted">Loading libraries…</div>}
                  {treeRows.map((row) =>
                    row.sym === undefined ? (
                      <div
                        key={row.lib}
                        className={`ze-tree-item root${treeSel?.lib === row.lib && !treeSel.name ? ' active' : ''}`}
                        onClick={() => { setTreeSel({ lib: row.lib, name: null }); if (!q) toggleLib(row.lib); }}
                        title={manager.current.library(row.lib)?.fileName}
                      >
                        <span className={`twisty expandable${expanded.has(row.lib) || q ? ' open' : ''}`} />
                        {toolbarIconUrl('library') && <img src={toolbarIconUrl('library')} alt="" style={{ width: 16, height: 16 }} />}
                        <span>{row.lib}{row.modified ? ' *' : ''}</span>
                      </div>
                    ) : (
                      <div
                        key={`${row.lib}:${row.sym}`}
                        className={`ze-tree-item${curLib === row.lib && curName === row.sym ? ' active' : ''}`}
                        style={{ paddingLeft: 26, fontWeight: curLib === row.lib && curName === row.sym ? 600 : 400 }}
                        onClick={() => setTreeSel({ lib: row.lib, name: row.sym! })}
                        onDoubleClick={() => void loadSymbol(row.lib, row.sym!)}
                        title={row.desc ? `${row.sym} — ${row.desc}` : row.sym}
                      >
                        <span>{row.sym}{row.modified ? ' *' : ''}</span>
                        {row.desc && <span style={{ opacity: 0.55, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.desc}</span>}
                      </div>
                    ),
                  )}
                </div>
              </div>
              {toggles.has('showProperties') && (
                <div className="ze-panel">
                  <div className="ze-panel-header">Properties</div>
                  <div className="ze-panel-body">
                    <div className="ze-muted">
                      {selection.size === 0 ? 'No objects selected' : propsSummary ?? `${selection.size} items selected`}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar entries={SYM_LEFT_TOOLBAR} orientation="vertical" side="left" toggled={toggles} onActivate={onLeftToggle} />

        <div className="ze-canvas-wrap">
          <SymbolCanvas
            ref={controller}
            symbol={workSymbol}
            theme={theme}
            opts={opts}
            selection={selection}
            activeTool={activeTool}
            pendingPin={pendingPin}
            pendingText={pendingText}
            onSelect={onSelect}
            onSelectBox={onSelectBox}
            onCommit={commit}
            onPinToolClick={onPinToolClick}
            onPlacePendingPin={onPlacePendingPin}
            onTextToolClick={onTextToolClick}
            onPlacePendingText={onPlacePendingText}
            onPlaceShape={onPlaceShape}
            onEditItem={onEditItem}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
          {!workSymbol && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', pointerEvents: 'none', color: '#888', fontSize: 14,
            }}>
              Double-click a symbol in the library tree to edit it, or File &gt; New Symbol…
            </div>
          )}
        </div>

        <Toolbar entries={SYM_RIGHT_TOOLBAR} orientation="vertical" side="right" activeTool={activeTool} onActivate={onToolSelect} />
      </div>

      <div className="ze-statusbar">
        <span className="cell">Z {Number.isFinite(zoomPct) ? (zoomPct / 100).toFixed(2) : '1.00'}</span>
        <span className="cell">X {cursor ? fmt(cursor.x) : '—'}  Y {cursor ? fmt(cursor.y) : '—'}</span>
        <span className="cell">grid {unitsLabel === 'mm' ? '1.2700' : unitsLabel === 'mils' ? '50' : '0.0500'}</span>
        <span className="cell">{isAlias ? `derived from ${workSymbol?.extends}` : ''}</span>
        <span className="cell grow">{status}</span>
        <span className="cell">{unitsLabel}</span>
      </div>

      {/* ----- dialogs ----- */}
      {pinDialog && workSymbol && (
        <PinPropertiesDialog
          pin={pinDialog.pin}
          symbol={workSymbol}
          isNew={pinDialog.isNew}
          commonUnit={pinDialog.isNew ? lastPin.current.commonUnit : (workSymbol.units[parseItemId(pinDialog.editId ?? '')?.unitIdx ?? 0]?.unit === 0)}
          commonBody={pinDialog.isNew ? lastPin.current.commonBody : (workSymbol.units[parseItemId(pinDialog.editId ?? '')?.unitIdx ?? 0]?.bodyStyle === 0)}
          multiUnit={units > 1}
          onOk={onPinDialogOk}
          onCancel={() => setPinDialog(null)}
        />
      )}
      {textDialog && (
        <SymbolTextDialog
          {...(textDialog.initial ? { initial: textDialog.initial } : {})}
          onOk={onTextDialogOk}
          onCancel={() => { setTextDialog(null); if (!textDialog.editId) setActiveTool('select'); }}
        />
      )}
      {shapeDialog && workSymbol && (() => {
        const ref = parseItemId(shapeDialog.editId);
        const g = ref && workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
        if (!g || g.kind === 'text') return null;
        return (
          <ShapePropertiesDialog
            initial={{ strokeWidth: g.stroke?.width ?? 0, strokeType: g.stroke?.type ?? 'default', fillType: g.fill?.type ?? 'none' }}
            onOk={onShapeDialogOk}
            onCancel={() => setShapeDialog(null)}
          />
        );
      })()}
      {newSymbolOpen && (
        <NewSymbolDialog
          symbolNames={targetLib ? manager.current.symbolNames(targetLib) : []}
          onOk={createNewSymbol}
          onCancel={() => setNewSymbolOpen(false)}
        />
      )}
      {symbolPropsOpen && workSymbol && (
        <LibSymbolPropertiesDialog symbol={workSymbol} onOk={onSymbolPropsOk} onCancel={() => setSymbolPropsOpen(false)} />
      )}
      {pinTableOpen && workSymbol && (
        <PinTableDialog
          symbol={workSymbol}
          onOk={(next) => { setPinTableOpen(false); commit(next, 'Edit Pin Table'); }}
          onCancel={() => setPinTableOpen(false)}
        />
      )}
      {checkOpen && workSymbol && <SymbolCheckDialog symbol={workSymbol} onClose={() => setCheckOpen(false)} />}

      {newLibName !== null && (
        <div className="ze-modal-backdrop" onMouseDown={() => setNewLibName(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              New Library
              <span className="x" onClick={() => setNewLibName(null)}>✕</span>
            </div>
            <div className="ze-label-dialog-body">
              <div className="row">
                <span>Name</span>
                <input
                  className="ze-search" autoFocus placeholder="MyLibrary" value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && newLibName.trim()) {
                      manager.current.createLibrary(newLibName.trim());
                      setExpanded((p) => new Set([...p, newLibName.trim()]));
                      setNewLibName(null);
                      bump();
                    } else if (e.key === 'Escape') setNewLibName(null);
                  }}
                />
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setNewLibName(null)}>Cancel</button>
              <button
                className="ze-btn primary" disabled={!newLibName.trim()}
                onClick={() => {
                  manager.current.createLibrary(newLibName.trim());
                  setExpanded((p) => new Set([...p, newLibName.trim()]));
                  setNewLibName(null);
                  bump();
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tree context actions (delete/duplicate) via keyboard on the tree selection. */}
      <TreeSelActions treeSel={treeSel} onDelete={deleteSymbol} onDuplicate={(l, s) => void duplicateSymbol(l, s)} />

      <LoadingOverlay label={loading} />
    </div>
  );
}

/** Del / Ctrl+D on the library-tree selection (the context-menu subset). */
function TreeSelActions({ treeSel, onDelete, onDuplicate }: {
  treeSel: { lib: string; name: string | null } | null;
  onDelete: (lib: string, name: string) => void;
  onDuplicate: (lib: string, name: string) => void;
}): JSX.Element | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!treeSel?.name) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onDuplicate(treeSel.lib, treeSel.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treeSel, onDelete, onDuplicate]);
  return null;
}
