import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  EMPTY_SOURCE, iuToMM, parse, readFootprintFile, mmToIU,
  moveFootprintItems, rotateFootprintItems, mirrorFootprintItems, deleteFootprintItems, fpItemBBox, addPad,
  setFootprintReference, setFootprintValue, setFootprintDescription, setFootprintKeywords,
  patchPad, replaceFootprintItem, parseFpItemId,
  type PadEdit, type PcbFootprint, type PcbPad, type PcbTextItem, type Vec2,
} from '@ziroeda/core';
import { FootprintPropertiesDialog, PadPropertiesDialog } from './dialogs.js';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { LoadingOverlay } from '../../ui/LoadingOverlay.js';
import { toolbarIconUrl } from '../../ui/toolbarIcons.js';
import { FP_TOP_TOOLBAR, FP_LEFT_TOOLBAR, FP_RIGHT_TOOLBAR } from './footprintToolbars.js';
import { FootprintCanvas, type FootprintCanvasController } from './FootprintCanvas.js';
import { FootprintLibraryManager, fpNameOf } from './libraryManager.js';
import { FOOTPRINT_LAYERS } from './footprintBoard.js';
import { layerColor, PCB_PAINT_ORDER } from '../pcb/pcbTheme.js';
import { DEFAULT_DRAW_OPTIONS, type PcbDrawOptions } from '../pcb/renderBoard.js';
import '../../ui/shell.css';

/**
 * The Footprint Editor frame — the web mirror of KiCad's FOOTPRINT_EDIT_FRAME
 * (pcbnew/footprint_edit_frame.cpp): menu bar (menubar_footprint_editor.cpp),
 * the three toolbars with the layer selector (toolbars_footprint_editor.cpp),
 * the footprint library tree pane (footprint_tree_pane.cpp) and the board-based
 * drawing canvas. A footprint is edited on an internal one-item board, so the
 * canvas reuses the PCB painter directly. Editing tools are staged; library
 * navigation, viewing, layer control and save are functional.
 */

export interface FootprintEditorFile { name: string; text: string }

const MM = 10000;
const PX_PER_MM = 3.7795;

const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

const ALL_FP_LAYERS = FOOTPRINT_LAYERS.map((l) => l.name);

// Left-toolbar radio groups (same convention as the PCB editor).
const RADIO_GROUPS: string[][] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
// KiCad footprint-editor defaults (grid on, mm, small crosshair, 90° line mode,
// all three side panels shown).
const DEFAULT_TOGGLES = new Set([
  'toggleGrid', 'unitsMm', 'crosshairSmall', 'lineMode90',
  'showLibraryTree', 'showLayersManager', 'showProperties',
]);

/** An fp_text item (Reference/Value) for a freshly-created footprint. */
function makeText(kind: PcbTextItem['kind'], text: string, at: Vec2, layer: string): PcbTextItem {
  return {
    kind, text, at, angle: 0, layer,
    size: { x: mmToIU(1), y: mmToIU(1) }, thickness: mmToIU(0.15),
    source: EMPTY_SOURCE,
  };
}

/** A blank footprint (FOOTPRINT_EDIT_FRAME::CreateNewFootprint default). */
function newFootprint(name: string): PcbFootprint {
  return {
    lib: name,
    at: { x: 0, y: 0 },
    angle: 0,
    layer: 'F.Cu',
    reference: 'REF**',
    value: name,
    pads: [],
    shapes: [],
    texts: [
      makeText('reference', 'REF**', { x: 0, y: mmToIU(-1) }, 'F.SilkS'),
      makeText('value', name, { x: 0, y: mmToIU(1) }, 'F.Fab'),
    ],
    models: [],
    source: EMPTY_SOURCE,
  };
}

export function FootprintEditor({ onExitToHome, initialProject }: {
  onExitToHome: () => void;
  initialProject?: FootprintEditorFile[] | null;
}): JSX.Element {
  const manager = useRef(new FootprintLibraryManager());
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const [curLib, setCurLib] = useState<string | null>(null);
  const [curName, setCurName] = useState<string | null>(null);
  const [workFp, setWorkFp] = useState<PcbFootprint | null>(null);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // Whole-footprint snapshot undo/redo (SaveCopyInUndoList), reset per load.
  const undoStack = useRef<PcbFootprint[]>([]);
  const redoStack = useRef<PcbFootprint[]>([]);

  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set(ALL_FP_LAYERS));
  const [activeLayer, setActiveLayer] = useState('F.Cu');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [activeTool, setActiveTool] = useState('select');
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  // Library tree state (LIB_TREE: search box + expandable libraries).
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  const [panelWidth, setPanelWidth] = useState(260);
  const [newLibName, setNewLibName] = useState<string | null>(null);
  const [newFpName, setNewFpName] = useState<string | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const [padDialogId, setPadDialogId] = useState<string | null>(null);

  const controller = useRef<FootprintCanvasController>(null);
  const addLibInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // ----- library bootstrap ------------------------------------------------------
  useEffect(() => {
    // Group the open project's `.kicad_mod` files by their `.pretty` directory.
    const byDir = new Map<string, { fileName: string; text: string }[]>();
    for (const f of initialProject ?? []) {
      if (!/\.kicad_mod$/i.test(f.name)) continue;
      const norm = f.name.replace(/\\/g, '/');
      const m = /([^/]+)\.pretty\//i.exec(norm);
      const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
      const list = byDir.get(dir) ?? [];
      list.push({ fileName: basename(f.name), text: f.text });
      byDir.set(dir, list);
    }
    for (const [dir, entries] of byDir) {
      const name = dir.replace(/\.pretty$/i, '').split('/').pop()!;
      manager.current.addProjectLibrary(name, dir, entries);
    }
    // Bundled global footprint libraries (names up front, files fetched lazily).
    fetch(`${import.meta.env.BASE_URL}footprints/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((idx: { name: string; footprints: string[] }[]) => {
        for (const lib of idx) manager.current.addGlobalLibrary(lib.name, lib.footprints);
        bump();
      })
      .catch(() => bump());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetLib = treeSel?.lib ?? curLib;

  const drawOpts = useMemo<PcbDrawOptions>(() => ({
    ...DEFAULT_DRAW_OPTIONS,
    padOpacity: toggles.has('padDisplayMode') ? 0.5 : 1,
  }), [toggles]);

  // ----- load / save ------------------------------------------------------------
  const loadFootprint = useCallback(async (libName: string, fpName: string) => {
    setLoading('Loading footprint…');
    try {
      const fp = await manager.current.loadFootprint(libName, fpName);
      if (!fp) { setStatus(`Footprint ${libName}:${fpName} not found`); return; }
      setCurLib(libName);
      setCurName(fpName);
      setWorkFp(fp);
      setSelection(new Set());
      undoStack.current = [];
      redoStack.current = [];
      setStatus(`Loaded ${libName}:${fpName}`);
      bump();
      requestAnimationFrame(() => controller.current?.zoomToFit());
    } finally {
      setLoading(null);
    }
  }, [bump]);

  // ----- undoable edits ---------------------------------------------------------
  /** Commit one edit: snapshot for undo, buffer to the manager, mark modified. */
  const commit = useCallback((next: PcbFootprint, description: string) => {
    setWorkFp((prev) => {
      if (!prev || !curLib || !curName) return prev;
      undoStack.current.push(prev);
      redoStack.current = [];
      manager.current.updateFootprint(curLib, curName, next);
      bump();
      setStatus(description);
      return next;
    });
  }, [curLib, curName, bump]);

  const undo = useCallback(() => {
    setWorkFp((cur) => {
      const prev = undoStack.current.pop();
      if (!prev || !cur || !curLib || !curName) return cur;
      redoStack.current.push(cur);
      manager.current.updateFootprint(curLib, curName, prev);
      bump();
      return prev;
    });
    setSelection(new Set());
  }, [curLib, curName, bump]);

  const redo = useCallback(() => {
    setWorkFp((cur) => {
      const next = redoStack.current.pop();
      if (!next || !cur || !curLib || !curName) return cur;
      undoStack.current.push(cur);
      manager.current.updateFootprint(curLib, curName, next);
      bump();
      return next;
    });
    setSelection(new Set());
  }, [curLib, curName, bump]);

  // The centre to rotate/mirror about: the selection's combined bounding box.
  const selectionCenter = useCallback((fp: PcbFootprint, sel: ReadonlySet<string>): Vec2 => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of sel) {
      const b = fpItemBBox(fp, id);
      if (!b) continue;
      if (b.minX < minX) minX = b.minX; if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX; if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX > maxX) return { x: 0, y: 0 };
    return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
  }, []);

  const moveSel = useCallback((delta: Vec2) => {
    if (!workFp || selection.size === 0) return;
    commit(moveFootprintItems(workFp, selection, delta), 'Move');
  }, [workFp, selection, commit]);

  const rotateSel = useCallback((ccw: boolean) => {
    if (!workFp || selection.size === 0) return;
    commit(rotateFootprintItems(workFp, selection, ccw, selectionCenter(workFp, selection)), ccw ? 'Rotate CCW' : 'Rotate CW');
  }, [workFp, selection, commit, selectionCenter]);

  const mirrorSel = useCallback(() => {
    if (!workFp || selection.size === 0) return;
    commit(mirrorFootprintItems(workFp, selection, selectionCenter(workFp, selection)), 'Mirror');
  }, [workFp, selection, commit, selectionCenter]);

  const deleteSel = useCallback(() => {
    if (!workFp || selection.size === 0) return;
    commit(deleteFootprintItems(workFp, selection), 'Delete');
    setSelection(new Set());
  }, [workFp, selection, commit]);

  const applyProps = useCallback((r: { reference: string; value: string; description: string; keywords: string }) => {
    setPropsOpen(false);
    if (!workFp) return;
    let next = workFp;
    if (r.reference !== (workFp.reference ?? '')) next = setFootprintReference(next, r.reference);
    if (r.value !== (workFp.value ?? '')) next = setFootprintValue(next, r.value);
    next = setFootprintDescription(next, r.description);
    next = setFootprintKeywords(next, r.keywords);
    commit(next, 'Edit Footprint Properties');
  }, [workFp, commit]);

  // The next pad number: one past the highest numeric pad (KiCad's PAD_TOOL).
  const nextPadNumber = (fp: PcbFootprint): string => {
    let max = 0;
    for (const p of fp.pads) { const n = parseInt(p.number, 10); if (Number.isFinite(n) && n > max) max = n; }
    return String(max + 1);
  };

  // Place a pad at the click (Add Pad tool). Defaults mirror KiCad's pad master:
  // a through-hole round pad, 1.524 mm / 0.762 mm drill, on all copper + mask.
  const placePadAt = useCallback((pos: Vec2) => {
    if (!workFp || !curLib || !curName) return;
    const pad: PcbPad = {
      number: nextPadNumber(workFp), type: 'thru_hole', shape: 'circle',
      at: { x: Math.round(pos.x), y: Math.round(pos.y) }, angle: 0,
      size: { x: mmToIU(1.524), y: mmToIU(1.524) },
      drill: { oblong: false, w: mmToIU(0.762), h: mmToIU(0.762) },
      layers: ['*.Cu', '*.Mask'],
      source: EMPTY_SOURCE,
    };
    commit(addPad(workFp, pad), 'Add Pad');
  }, [workFp, curLib, curName, commit]);

  const onPlace = useCallback((pos: Vec2) => {
    if (activeTool === 'placePad') placePadAt(pos);
    // Other placement tools (graphics/text) are staged.
  }, [activeTool, placePadAt]);

  // Double-click an item to edit it (pads open the pad-properties dialog).
  const onEditItem = useCallback((id: string) => {
    const ref = parseFpItemId(id);
    if (ref?.kind === 'pad') setPadDialogId(id);
    else if (workFp) setPropsOpen(true); // graphics/text → footprint properties for now
  }, [workFp]);

  const padForDialog = useMemo(() => {
    if (!padDialogId || !workFp) return null;
    const ref = parseFpItemId(padDialogId);
    return ref?.kind === 'pad' ? workFp.pads[ref.index] ?? null : null;
  }, [padDialogId, workFp]);

  const applyPadEdit = useCallback((e: PadEdit) => {
    const id = padDialogId;
    setPadDialogId(null);
    if (!id || !workFp) return;
    const ref = parseFpItemId(id);
    const pad = ref?.kind === 'pad' ? workFp.pads[ref.index] : undefined;
    if (!pad) return;
    commit(replaceFootprintItem(workFp, id, patchPad(pad, e)), 'Edit Pad');
  }, [padDialogId, workFp, commit]);

  // Click / box selection from the canvas (PCB_SELECTION_TOOL semantics).
  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      if (additive) { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }
      return new Set([id]);
    });
  }, []);
  const onSelectBox = useCallback((ids: string[], additive: boolean) => {
    setSelection((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
  }, []);

  const downloadText = (fileName: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveLibrary = useCallback((libName: string) => {
    const files = manager.current.modifiedFiles(libName);
    if (files.length === 0) { setStatus('No unsaved changes'); return; }
    for (const f of files) downloadText(f.fileName, f.text);
    setStatus(`Saved ${files.length} footprint${files.length === 1 ? '' : 's'} in '${libName}'`);
    bump();
  }, [bump]);

  const save = useCallback(() => {
    const libName = treeSel?.lib ?? curLib;
    if (libName) saveLibrary(libName);
  }, [treeSel, curLib, saveLibrary]);

  const saveAll = useCallback(() => {
    for (const name of manager.current.libraryNames()) {
      if (manager.current.isLibraryModified(name)) saveLibrary(name);
    }
  }, [saveLibrary]);

  // ----- footprint management ---------------------------------------------------
  const createFootprint = useCallback((name: string) => {
    setNewFpName(null);
    const libName = targetLib;
    if (!libName || !name.trim()) return;
    const fp = newFootprint(name.trim());
    manager.current.updateFootprint(libName, name.trim(), fp);
    setExpanded((p) => new Set([...p, libName]));
    bump();
    void loadFootprint(libName, name.trim());
  }, [targetLib, bump, loadFootprint]);

  const addLibraryFiles = useCallback(async (files: FileList) => {
    // Selecting `.kicad_mod` files adds them as a library named for their folder.
    const entries: { fileName: string; text: string }[] = [];
    for (const f of files) {
      if (!/\.kicad_mod$/i.test(f.name)) continue;
      entries.push({ fileName: f.name, text: await f.text() });
    }
    if (entries.length === 0) return;
    const name = 'Imported';
    manager.current.addProjectLibrary(name, `${name}.pretty`, entries);
    setExpanded((p) => new Set([...p, name]));
    bump();
  }, [bump]);

  const importFootprint = useCallback(async (file: File) => {
    const libName = targetLib;
    if (!libName) { setStatus('Select a library first'); return; }
    const fp = readFootprintFile(parse(await file.text()));
    if (!fp) { setStatus(`No footprint in ${file.name}`); return; }
    let name = fp.lib || fpNameOf(file.name);
    while (manager.current.footprintExists(libName, name)) name = `${name}_1`;
    manager.current.updateFootprint(libName, name, { ...fp, lib: name });
    bump();
    void loadFootprint(libName, name);
  }, [targetLib, bump, loadFootprint]);

  const deleteFootprint = useCallback((libName: string, fpName: string) => {
    if (!window.confirm(`Delete footprint '${fpName}' from library '${libName}'?`)) return;
    manager.current.removeFootprint(libName, fpName);
    if (curLib === libName && curName === fpName) { setWorkFp(null); setCurName(null); }
    bump();
  }, [curLib, curName, bump]);

  // ----- toolbar / toggles ------------------------------------------------------
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

  const showDatasheet = useCallback(() => {
    setStatus('Datasheet: not defined for this footprint');
  }, []);

  const onTopAction = useCallback((id: string) => {
    switch (id) {
      case 'newFootprint': setNewFpName(''); break;
      case 'save': save(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomRedraw': controller.current?.redraw(); break;
      case 'zoomIn': controller.current?.zoomIn(); break;
      case 'zoomOut': controller.current?.zoomOut(); break;
      case 'zoomFit': controller.current?.zoomToFit(); break;
      case 'rotateCCW': rotateSel(true); break;
      case 'rotateCW': rotateSel(false); break;
      case 'mirrorH': case 'mirrorV': mirrorSel(); break;
      case 'footprintProperties': if (workFp) setPropsOpen(true); break;
      case 'showDatasheet': showDatasheet(); break;
      default: break; // remaining editing actions are staged
    }
  }, [save, undo, redo, rotateSel, mirrorSel, showDatasheet, workFp]);

  // ----- library tree (footprint_tree_pane / LIB_TREE) --------------------------
  const libNames = manager.current.libraryNames();
  const q = query.trim().toLowerCase();
  void revision;

  const treeRows = useMemo(() => {
    interface Row { lib: string; fp?: string; modified?: boolean }
    const rows: Row[] = [];
    const mgr = manager.current;
    for (const libName of libNames) {
      const names = mgr.footprintNames(libName);
      if (q) {
        const matches = names.filter((n) => n.toLowerCase().includes(q) || `${libName}:${n}`.toLowerCase().includes(q));
        if (matches.length === 0 && !libName.toLowerCase().includes(q)) continue;
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        for (const n of (matches.length > 0 ? matches : names).slice(0, 200)) {
          rows.push({ lib: libName, fp: n, modified: mgr.isFootprintModified(libName, n) });
        }
      } else {
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        if (expanded.has(libName)) {
          for (const n of names) rows.push({ lib: libName, fp: n, modified: mgr.isFootprintModified(libName, n) });
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

  const toggleLayer = (name: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // ----- keyboard ---------------------------------------------------------------
  useEffect(() => {
    const dialogOpen = newLibName !== null || newFpName !== null || propsOpen || padDialogId !== null;
    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target as HTMLElement | null;
      const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
      if (dialogOpen) {
        if (e.key === 'Escape') { setNewLibName(null); setNewFpName(null); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { if (activeTool !== 'select') setActiveTool('select'); else setSelection(new Set()); }
      else if (typing) { /* let inputs handle their own keys */ }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateSel(!e.shiftKey); }
      else if (e.key === 'f' || e.key === 'F') controller.current?.zoomToFit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo, deleteSel, rotateSel, activeTool, newLibName, newFpName, propsOpen, padDialogId]);

  // ----- menus (menubar_footprint_editor.cpp, working subset) -------------------
  const menus: Menu[] = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'New Library…', icon: 'newLibrary', action: () => setNewLibName('') },
        { label: 'Add Library…', icon: 'addLibrary', action: () => addLibInputRef.current?.click() },
        { label: 'New Footprint…', icon: 'newFootprint', action: () => setNewFpName(''), shortcut: 'Ctrl+N', disabled: !targetLib },
        { sep: true },
        { label: 'Save', icon: 'save', action: save, shortcut: 'Ctrl+S', disabled: !manager.current.hasModifications() },
        { label: 'Save All', action: saveAll },
        { sep: true },
        { label: 'Import Footprint…', icon: 'importSymbol', action: () => importInputRef.current?.click() },
        { label: 'Export Footprint…', icon: 'exportSymbol', action: () => { const l = treeSel?.lib ?? curLib, n = treeSel?.name ?? curName; if (l && n) { const t = manager.current.saveFootprintText(l, n); if (t) downloadText(`${n}.kicad_mod`, t); } }, disabled: !curName && !treeSel?.name },
        { sep: true },
        { label: 'Footprint Properties…', icon: 'footprintProperties', action: () => workFp && setPropsOpen(true), disabled: !workFp },
        { sep: true },
        { label: 'Close Footprint Editor', action: onExitToHome },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', icon: 'undo', action: undo, shortcut: 'Ctrl+Z' },
        { label: 'Redo', icon: 'redo', action: redo, shortcut: 'Ctrl+Y' },
        { sep: true },
        { label: 'Cut', icon: 'cut', disabled: true },
        { label: 'Copy', icon: 'copy', disabled: true },
        { label: 'Paste', icon: 'paste', disabled: true },
        { label: 'Delete', icon: 'delete', action: deleteSel, shortcut: 'Del', disabled: selection.size === 0 },
        { sep: true },
        { label: 'Pad Table…', icon: 'padTable', disabled: true },
        { label: 'Default Pad Properties…', disabled: true },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', icon: 'zoomIn', action: () => controller.current?.zoomIn() },
        { label: 'Zoom Out', icon: 'zoomOut', action: () => controller.current?.zoomOut() },
        { label: 'Zoom to Fit', icon: 'zoomFit', action: () => controller.current?.zoomToFit(), shortcut: 'F' },
        { sep: true },
        { label: `${toggles.has('showLibraryTree') ? '✓ ' : ''}Footprint Tree`, action: () => onLeftToggle('showLibraryTree') },
        { label: `${toggles.has('showLayersManager') ? '✓ ' : ''}Appearance Manager`, action: () => onLeftToggle('showLayersManager') },
        { label: `${toggles.has('showProperties') ? '✓ ' : ''}Properties Manager`, action: () => onLeftToggle('showProperties') },
        { sep: true },
        { label: `${toggles.has('padDisplayMode') ? '✓ ' : ''}Sketch Pads`, action: () => onLeftToggle('padDisplayMode') },
        { label: '3D Viewer', disabled: true },
      ],
    },
    {
      label: 'Place',
      items: [
        { label: 'Pad', icon: 'placePad', action: () => setActiveTool('placePad'), disabled: !workFp },
        { label: 'Line', icon: 'drawLine', disabled: true },
        { label: 'Arc', icon: 'drawArc', disabled: true },
        { label: 'Rectangle', icon: 'drawRectangle', disabled: true },
        { label: 'Circle', icon: 'drawCircle', disabled: true },
        { label: 'Polygon', icon: 'drawPolygon', disabled: true },
        { label: 'Text', icon: 'placeText', disabled: true },
        { sep: true },
        { label: 'Set Anchor', icon: 'setAnchor', disabled: true },
        { label: 'Grid Origin', disabled: true },
      ],
    },
    {
      label: 'Inspect',
      items: [
        { label: 'Measure Tool', icon: 'measure', disabled: true },
        { sep: true },
        { label: 'Footprint Checker…', icon: 'checkFootprint', disabled: true },
        { sep: true },
        { label: 'Show Datasheet', icon: 'showDatasheet', action: showDatasheet, disabled: !workFp },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Load Footprint from Current Board…', icon: 'loadFpFromBoard', disabled: true },
        { label: 'Insert Footprint into Current Board', icon: 'saveFpToBoard', disabled: true },
        { sep: true },
        { label: 'Cleanup Graphics…', disabled: true },
        { label: 'Repair Footprint', disabled: true },
      ],
    },
    { label: 'Preferences', items: [{ label: 'Preferences…', disabled: true }] },
    { label: 'Help', items: [{ label: 'About ZiroEDA', action: () => {} }] },
  ], [save, saveAll, undo, redo, deleteSel, selection, onExitToHome, targetLib, treeSel, curLib, curName, toggles, onLeftToggle, showDatasheet, workFp]);

  // ----- title (UpdateTitle) ----------------------------------------------------
  const modified = curLib && curName ? manager.current.isFootprintModified(curLib, curName) : false;
  const title = curName ? `${modified ? '*' : ''}${curLib}:${curName} — Footprint Editor` : '[no footprint loaded] — Footprint Editor';
  useEffect(() => { document.title = title; }, [title]);

  // ----- unit display -----------------------------------------------------------
  const unitLabel = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (unitLabel === 'in') return (mm / 25.4).toFixed(4);
    if (unitLabel === 'mils') return ((mm / 25.4) * 1000).toFixed(2);
    return mm.toFixed(4);
  };
  const zoomZ = scale > 0 ? (scale * 1000).toFixed(2) : '—';

  const layerRows = useMemo(() => {
    const known = new Set(ALL_FP_LAYERS);
    const cu = ALL_FP_LAYERS.filter((n) => /\.Cu$/.test(n));
    const tech = PCB_PAINT_ORDER.filter((n) => known.has(n) && !/\.Cu$/.test(n)).reverse();
    return [...cu, ...tech];
  }, []);

  const padCount = workFp?.pads.length ?? 0;

  return (
    <div className="ze-app">
      <input
        ref={addLibInputRef} type="file" accept=".kicad_mod" multiple style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) void addLibraryFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={importInputRef} type="file" accept=".kicad_mod" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFootprint(f); e.target.value = ''; }}
      />

      <MenuBar
        menus={menus}
        leftSlot={<div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">⌂ ZiroEDA</div>}
        title={<><b>{curName ? `${curLib}:${curName}` : 'No footprint'}</b>&nbsp;—&nbsp;Footprint Editor</>}
      />

      {/* Top toolbar + grid / zoom / layer selector combos (toolbars_footprint_editor.cpp). */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Toolbar entries={FP_TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />
        <span style={{ width: 8 }} />
        <select className="ze-select" disabled title="Grid" style={{ margin: '0 4px' }}><option>Grid: 0.635 mm (25 mils)</option></select>
        <select className="ze-select" disabled title="Zoom" style={{ margin: '0 4px' }}><option>Zoom Auto</option></select>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 8px' }}>
          <span style={{ width: 12, height: 12, background: layerColor(activeLayer), borderRadius: 2, border: '1px solid #444' }} />
          <select className="ze-select" value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)} title="Active layer (+/- to switch)">
            {layerRows.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </span>
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
                  {treeRows.length === 0 && <div className="ze-muted">No footprint libraries loaded.</div>}
                  {treeRows.map((row) =>
                    row.fp === undefined ? (
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
                        key={`${row.lib}:${row.fp}`}
                        className={`ze-tree-item${curLib === row.lib && curName === row.fp ? ' active' : ''}`}
                        style={{ paddingLeft: 26, fontWeight: curLib === row.lib && curName === row.fp ? 600 : 400 }}
                        onClick={() => setTreeSel({ lib: row.lib, name: row.fp! })}
                        onDoubleClick={() => void loadFootprint(row.lib, row.fp!)}
                        title={`${row.fp} — double-click to edit`}
                      >
                        <span>{row.fp}{row.modified ? ' *' : ''}</span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar entries={FP_LEFT_TOOLBAR} orientation="vertical" side="left" toggled={toggles} onActivate={onLeftToggle} />

        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          <FootprintCanvas
            ref={controller}
            footprint={workFp}
            visible={visible}
            drawOpts={drawOpts}
            selection={selection}
            activeTool={activeTool}
            onCursorMove={setCursor}
            onScaleChange={setScale}
            onSelect={onSelect}
            onSelectBox={onSelectBox}
            onMoveItems={moveSel}
            onPlace={onPlace}
            onEditItem={onEditItem}
          />
          {!workFp && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', pointerEvents: 'none', color: '#888', fontSize: 14,
            }}>
              Double-click a footprint in the library tree to view it, or File &gt; New Footprint…
            </div>
          )}
        </div>

        {toggles.has('showLayersManager') && (
          <div className="ze-leftdock" style={{ width: 200 }}>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Appearance</div>
              <div className="ze-panel-body" style={{ overflow: 'auto' }}>
                {layerRows.map((name) => {
                  const on = visible.has(name);
                  return (
                    <div
                      key={name}
                      className={`ze-tree-item ${name === activeLayer ? 'active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
                      onClick={() => setActiveLayer(name)}
                      title="Click to make active; click the swatch to show/hide"
                    >
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleLayer(name); }}
                        style={{
                          width: 14, height: 14, borderRadius: 2, flex: '0 0 auto',
                          background: layerColor(name), border: '1px solid #444', opacity: on ? 1 : 0.25,
                        }}
                      />
                      <span style={{ opacity: on ? 1 : 0.5 }}>{name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <Toolbar entries={FP_RIGHT_TOOLBAR} orientation="vertical" side="right" activeTool={activeTool} onActivate={setActiveTool} />
      </div>

      {/* pcbnew-style status bar. */}
      <div className="ze-statusbar" style={{ gap: 18 }}>
        <span className="cell"><b>Pads</b> {padCount}</span>
        {selection.size > 0 && <span className="cell"><b>Selected</b> {selection.size}</span>}
        <span className="cell grow">{status}</span>
        <span className="cell">{curName ? `${curLib}:${curName}` : '—'}</span>
      </div>
      <div className="ze-statusbar">
        <span className="cell">Z {zoomZ}</span>
        <span className="cell">{cursor ? `X ${fmt(cursor.x)} Y ${fmt(cursor.y)}` : 'X — Y —'}</span>
        <span className="cell grow">{activeLayer}</span>
        <span className="cell">{unitLabel}</span>
      </div>

      {/* New Library dialog. */}
      {newLibName !== null && (
        <SimplePrompt
          title="New Library" label="Name" placeholder="MyFootprints" value={newLibName}
          onChange={setNewLibName}
          onCancel={() => setNewLibName(null)}
          onOk={() => { const n = newLibName.trim(); if (n) { manager.current.createLibrary(n); setExpanded((p) => new Set([...p, n])); setTreeSel({ lib: n, name: null }); setNewLibName(null); bump(); } }}
        />
      )}
      {/* New Footprint dialog. */}
      {newFpName !== null && (
        <SimplePrompt
          title="New Footprint" label="Name" placeholder="MyFootprint" value={newFpName}
          onChange={setNewFpName}
          onCancel={() => setNewFpName(null)}
          onOk={() => createFootprint(newFpName)}
        />
      )}

      {propsOpen && workFp && (
        <FootprintPropertiesDialog footprint={workFp} onOk={applyProps} onCancel={() => setPropsOpen(false)} />
      )}
      {padForDialog && (
        <PadPropertiesDialog pad={padForDialog} onOk={applyPadEdit} onCancel={() => setPadDialogId(null)} />
      )}

      <TreeSelActions treeSel={treeSel} onDelete={deleteFootprint} />
      <LoadingOverlay label={loading} />
    </div>
  );
}

/** A tiny name-prompt modal (New Library / New Footprint). */
function SimplePrompt({ title, label, placeholder, value, onChange, onOk, onCancel }: {
  title: string; label: string; placeholder: string; value: string;
  onChange: (v: string) => void; onOk: () => void; onCancel: () => void;
}): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">{title}<span className="x" onClick={onCancel}>✕</span></div>
        <div className="ze-label-dialog-body">
          <div className="row">
            <span>{label}</span>
            <input
              className="ze-search" autoFocus placeholder={placeholder} value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onOk(); else if (e.key === 'Escape') onCancel(); }}
            />
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>Cancel</button>
          <button className="ze-btn primary" disabled={!value.trim()} onClick={onOk}>Create</button>
        </div>
      </div>
    </div>
  );
}

/** Del on the library-tree selection (context-menu subset). */
function TreeSelActions({ treeSel, onDelete }: {
  treeSel: { lib: string; name: string | null } | null;
  onDelete: (lib: string, name: string) => void;
}): JSX.Element | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!treeSel?.name) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete(treeSel.lib, treeSel.name); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treeSel, onDelete]);
  return null;
}
