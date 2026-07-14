/**
 * The Drawing Sheet Editor frame — the web mirror of KiCad's `pl_editor`
 * PL_EDITOR_FRAME (pagelayout_editor/pl_editor_frame.cpp): the menu bar
 * (menubar_pl_editor.cpp), the three toolbars with the grid / zoom / coordinate
 * / page selectors (toolbars_pl_editor.cpp), the "Design" tree of drawing-sheet
 * items (DS_DATA_MODEL / design_tree_frame.cpp), the item Properties + General
 * Options panels (properties_frame.cpp), the page-layout canvas, and the status
 * bar with the coordinate-origin corner selector.
 *
 * The document is a `WksSheet`; File → New loads KiCad's default template, and
 * Open / Save read and write `.kicad_wks`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  defaultDrawingSheet,
  emptyDrawingSheet,
  parseDrawingSheet,
  serializeDrawingSheet,
  layoutDrawingSheet,
  translateItem,
  mmToIU,
  iuToMM,
  type WksSheet,
  type WksItem,
  type WksCorner,
  type WksOption,
  type WksPoint,
  type WksText,
  type WksLine,
  type WksRect,
  type WksBitmap,
  type WksResolveContext,
} from '@ziroeda/common';
import type { Vec2 } from '@ziroeda/kimath';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { DS_TOP_TOOLBAR, DS_LEFT_TOOLBAR, DS_RIGHT_TOOLBAR } from './drawingSheetToolbars.js';
import { DrawingSheetCanvas, type DrawingSheetCanvasController } from './DrawingSheetCanvas.js';
import { imageFileToPng, decodeHexImageSize } from './wksBitmap.js';
import '../../ui/shell.css';

export interface DrawingSheetEditorFile {
  name: string;
  text: string;
}

/** Paper sizes in mm (landscape), from KiCad common/page_info.cpp. */
const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};
const PAPER_ORDER = ['A4', 'A3', 'A2', 'A1', 'A0', 'A5', 'USLetter', 'USLegal', 'USLedger'];

const RADIO_GROUPS: string[][] = [['unitsMm', 'unitsInches', 'unitsMils']];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm']);
const CORNERS: WksCorner[] = ['rbcorner', 'rtcorner', 'lbcorner', 'ltcorner'];
const CORNER_LABEL: Record<WksCorner, string> = {
  rbcorner: 'Right bottom',
  rtcorner: 'Right top',
  lbcorner: 'Left bottom',
  ltcorner: 'Left top',
};

const TYPE_LABEL: Record<WksItem['type'], string> = {
  line: 'Line',
  rect: 'Rectangle',
  text: 'Text',
  bitmap: 'Bitmap',
  polygon: 'Polygon',
};

const download = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Decode the natural pixel size of any bitmap loaded from a `.kicad_wks` file
 * (the format has no pixel dimensions; KiCad derives them from the PNG). Sizes
 * are cached on the model so bbox / hit-testing size the image correctly.
 */
async function backfillBitmapSizes(sheet: WksSheet): Promise<WksSheet> {
  if (!sheet.items.some((it) => it.type === 'bitmap' && it.pngB64 && !(it.pxW && it.pxW > 0)))
    return sheet;
  const items = await Promise.all(
    sheet.items.map(async (it) => {
      if (it.type !== 'bitmap' || !it.pngB64 || (it.pxW && it.pxW > 0)) return it;
      try {
        const { w, h } = await decodeHexImageSize(it.pngB64);
        return { ...it, pxW: w, pxH: h };
      } catch {
        return it;
      }
    }),
  );
  return { ...sheet, items };
}

export function DrawingSheetEditor({
  onExitToHome,
  projectName,
}: {
  onExitToHome: () => void;
  projectName?: string;
}): JSX.Element {
  const [sheet, setSheet] = useState<WksSheet>(() => defaultDrawingSheet());
  const [fileName, setFileName] = useState('drawing_sheet.kicad_wks');
  const [dirty, setDirty] = useState(false);
  const undoStack = useRef<WksSheet[]>([]);
  const redoStack = useRef<WksSheet[]>([]);

  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const [activeTool, setActiveTool] = useState('select');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [paper, setPaper] = useState('A4');
  const [portrait, setPortrait] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [originCorner, setOriginCorner] = useState<WksCorner>('rbcorner');
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('Loaded default drawing sheet');
  const [panelWidth, setPanelWidth] = useState(230);
  const [showPageDialog, setShowPageDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  // pl_editor's title-block display: 'preview' resolves ${…} to sample values,
  // 'edit' shows the raw field templates (Show title block in preview/edit mode).
  const [titleMode, setTitleMode] = useState<'preview' | 'edit'>('preview');

  const controller = useRef<DrawingSheetCanvasController>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const bitmapInputRef = useRef<HTMLInputElement>(null);
  // Anchor point captured when the bitmap tool is clicked, consumed once the
  // user chooses an image file (KiCad's Place → Image opens a file dialog).
  const pendingBitmapPos = useRef<WksPoint | null>(null);
  // Internal clipboard for Edit → Cut / Copy / Paste (pl_editor clipboard).
  const clipboard = useRef<WksItem[]>([]);

  // ---- page geometry ----
  const pageMM = useMemo<[number, number]>(() => {
    const base = PAPER_MM[paper] ?? PAPER_MM.A4!;
    return portrait ? [base[1], base[0]] : base;
  }, [paper, portrait]);
  const pageW = mmToIU(pageMM[0]);
  const pageH = mmToIU(pageMM[1]);

  // ---- title-block preview context (pl_editor's Page-1 example values) ----
  const resolveCtx = useMemo<WksResolveContext>(
    () => ({
      pageNumber,
      sheetCount: 1,
      title: projectName || 'Drawing Sheet',
      rev: 'A',
      date: new Date().toISOString().slice(0, 10),
      company: '',
      comments: [],
      paper,
      fileName: projectName ? `${projectName}.kicad_sch` : '',
      sheetPath: '/',
      appVersion: 'ZiroEDA',
      rawText: titleMode === 'edit',
    }),
    [pageNumber, projectName, paper, titleMode],
  );

  const draws = useMemo(
    () => layoutDrawingSheet(sheet, { widthMM: pageMM[0], heightMM: pageMM[1] }, resolveCtx),
    [sheet, pageMM, resolveCtx],
  );

  // ---- undoable commit ----
  const commit = useCallback((next: WksSheet, description: string) => {
    setSheet((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return next;
    });
    setDirty(true);
    setStatus(description);
  }, []);

  const undo = useCallback(() => {
    setSheet((cur) => {
      const p = undoStack.current.pop();
      if (!p) return cur;
      redoStack.current.push(cur);
      return p;
    });
    setSelection(new Set());
  }, []);
  const redo = useCallback(() => {
    setSheet((cur) => {
      const n = redoStack.current.pop();
      if (!n) return cur;
      undoStack.current.push(cur);
      return n;
    });
    setSelection(new Set());
  }, []);

  // ---- file ops ----
  const newSheet = useCallback((empty = false) => {
    undoStack.current = [];
    redoStack.current = [];
    setSheet(empty ? emptyDrawingSheet() : defaultDrawingSheet());
    setSelection(new Set());
    setDirty(false);
    setFileName('drawing_sheet.kicad_wks');
    setStatus(empty ? 'New empty drawing sheet' : 'New drawing sheet (default template)');
    requestAnimationFrame(() => controller.current?.zoomToFit());
  }, []);

  const openFile = useCallback(async (file: File) => {
    try {
      const parsed = await backfillBitmapSizes(parseDrawingSheet(await file.text()));
      undoStack.current = [];
      redoStack.current = [];
      setSheet(parsed);
      setSelection(new Set());
      setDirty(false);
      setFileName(file.name);
      setStatus(`Opened ${file.name} (${parsed.items.length} items)`);
      requestAnimationFrame(() => controller.current?.zoomToFit());
    } catch (err) {
      setStatus(`Failed to open ${file.name}: ${(err as Error).message}`);
    }
  }, []);

  const appendFile = useCallback(
    async (file: File) => {
      try {
        const parsed = await backfillBitmapSizes(parseDrawingSheet(await file.text()));
        commit(
          { ...sheet, items: [...sheet.items, ...parsed.items] },
          `Appended ${parsed.items.length} items from ${file.name}`,
        );
      } catch (err) {
        setStatus(`Failed to append ${file.name}: ${(err as Error).message}`);
      }
    },
    [sheet, commit],
  );

  const save = useCallback(() => {
    download(fileName, serializeDrawingSheet(sheet));
    setDirty(false);
    setStatus(`Saved ${fileName}`);
  }, [fileName, sheet]);

  const saveAs = useCallback(() => {
    const name = window.prompt('Save drawing sheet as:', fileName) || fileName;
    const finalName = /\.kicad_wks$/i.test(name) ? name : `${name}.kicad_wks`;
    setFileName(finalName);
    download(finalName, serializeDrawingSheet(sheet));
    setDirty(false);
    setStatus(`Saved ${finalName}`);
  }, [fileName, sheet]);

  // ---- placement (convert a page-space IU point to an anchored mm point) ----
  const anchoredPoint = useCallback(
    (p: Vec2, corner: WksCorner): WksPoint => {
      const s = sheet.setup;
      const left = s.leftMargin,
        top = s.topMargin;
      const right = pageMM[0] - s.rightMargin,
        bottom = pageMM[1] - s.bottomMargin;
      const px = iuToMM(p.x),
        py = iuToMM(p.y);
      const round = (n: number): number => Math.round(n * 1000) / 1000;
      switch (corner) {
        case 'ltcorner':
          return { corner, x: round(px - left), y: round(py - top) };
        case 'rtcorner':
          return { corner, x: round(right - px), y: round(py - top) };
        case 'lbcorner':
          return { corner, x: round(px - left), y: round(bottom - py) };
        case 'rbcorner':
        default:
          return { corner, x: round(right - px), y: round(bottom - py) };
      }
    },
    [sheet.setup, pageMM],
  );

  const addItem = useCallback(
    (item: WksItem, description: string) => {
      const next = { ...sheet, items: [...sheet.items, item] };
      commit(next, description);
      setSelection(new Set([next.items.length - 1]));
      setActiveTool('select');
    },
    [sheet, commit],
  );

  const onPlacePoint = useCallback(
    (tool: string, at: Vec2) => {
      const pos = anchoredPoint(at, originCorner);
      if (tool === 'dsAddText') {
        addItem(
          {
            type: 'text',
            name: `text ${sheet.items.length + 1}`,
            option: 'normal',
            repeat: 1,
            incrx: 0,
            incry: 0,
            incrlabel: 1,
            comment: '',
            text: 'Text',
            pos,
            fontW: 0,
            fontH: 0,
            bold: false,
            italic: false,
            lineWidth: 0,
            hjustify: 'left',
            vjustify: 'center',
            rotate: 0,
            maxlen: 0,
            maxheight: 0,
          },
          'Add text',
        );
      } else if (tool === 'dsAddBitmap') {
        // KiCad's Place → Image opens a file dialog; capture the anchor and prompt.
        pendingBitmapPos.current = pos;
        bitmapInputRef.current?.click();
        setActiveTool('select');
      }
    },
    [anchoredPoint, originCorner, addItem, sheet.items.length],
  );

  const onPickBitmap = useCallback(
    async (file: File) => {
      const pos =
        pendingBitmapPos.current ?? anchoredPoint({ x: pageW / 2, y: pageH / 2 }, originCorner);
      pendingBitmapPos.current = null;
      try {
        const { hex, pxW, pxH } = await imageFileToPng(file);
        addItem(
          {
            type: 'bitmap',
            name: `bitmap ${sheet.items.length + 1}`,
            option: 'normal',
            repeat: 1,
            incrx: 0,
            incry: 0,
            incrlabel: 1,
            comment: '',
            pos,
            scale: 1,
            pngB64: hex,
            ppi: 300,
            pxW,
            pxH,
          },
          `Add bitmap (${file.name})`,
        );
      } catch (err) {
        setStatus(`Failed to load image ${file.name}: ${(err as Error).message}`);
      }
    },
    [anchoredPoint, originCorner, addItem, sheet.items.length, pageW, pageH],
  );

  const onPlaceSegment = useCallback(
    (tool: string, a: Vec2, b: Vec2) => {
      const start = anchoredPoint(a, originCorner);
      const end = anchoredPoint(b, originCorner);
      if (tool === 'dsAddLine') {
        addItem(
          {
            type: 'line',
            name: `line ${sheet.items.length + 1}`,
            option: 'normal',
            repeat: 1,
            incrx: 0,
            incry: 0,
            incrlabel: 1,
            comment: '',
            start,
            end,
            lineWidth: 0,
          },
          'Add line',
        );
      } else if (tool === 'dsAddRect') {
        addItem(
          {
            type: 'rect',
            name: `rect ${sheet.items.length + 1}`,
            option: 'normal',
            repeat: 1,
            incrx: 0,
            incry: 0,
            incrlabel: 1,
            comment: '',
            start,
            end,
            lineWidth: 0,
          },
          'Add rectangle',
        );
      }
    },
    [anchoredPoint, originCorner, addItem, sheet.items.length],
  );

  // ---- selection edits ----
  const onSelect = useCallback((src: number | null, additive: boolean) => {
    setSelection((prev) => {
      if (src === null) return additive ? prev : new Set();
      if (additive) {
        const n = new Set(prev);
        if (n.has(src)) n.delete(src);
        else n.add(src);
        return n;
      }
      return new Set([src]);
    });
  }, []);
  const onSelectBox = useCallback((srcs: number[], additive: boolean) => {
    setSelection((prev) => (additive ? new Set([...prev, ...srcs]) : new Set(srcs)));
  }, []);

  const moveSelection = useCallback(
    (delta: Vec2) => {
      if (selection.size === 0) return;
      const items = sheet.items.map((it, i) => (selection.has(i) ? translateItem(it, delta) : it));
      commit({ ...sheet, items }, 'Move');
    },
    [sheet, selection, commit],
  );

  const deleteSelection = useCallback(() => {
    if (selection.size === 0) return;
    const items = sheet.items.filter((_, i) => !selection.has(i));
    commit({ ...sheet, items }, `Deleted ${selection.size} item${selection.size === 1 ? '' : 's'}`);
    setSelection(new Set());
  }, [sheet, selection, commit]);

  const duplicateSelection = useCallback(() => {
    if (selection.size === 0) return;
    const copies = [...selection]
      .sort((a, b) => a - b)
      .map((i) => {
        const off = { x: mmToIU(2), y: mmToIU(2) };
        return translateItem(sheet.items[i]!, off);
      });
    const next = { ...sheet, items: [...sheet.items, ...copies] };
    commit(next, `Duplicated ${copies.length} item${copies.length === 1 ? '' : 's'}`);
    setSelection(new Set(copies.map((_, k) => sheet.items.length + k)));
  }, [sheet, selection, commit]);

  const copySelection = useCallback(() => {
    if (selection.size === 0) return;
    clipboard.current = [...selection]
      .sort((a, b) => a - b)
      .map((i) => structuredClone(sheet.items[i]!));
    setStatus(
      `Copied ${clipboard.current.length} item${clipboard.current.length === 1 ? '' : 's'}`,
    );
  }, [sheet, selection]);

  const pasteClipboard = useCallback(() => {
    if (clipboard.current.length === 0) return;
    const off = { x: mmToIU(2), y: mmToIU(2) };
    const copies = clipboard.current.map((it) => translateItem(structuredClone(it), off));
    const next = { ...sheet, items: [...sheet.items, ...copies] };
    commit(next, `Pasted ${copies.length} item${copies.length === 1 ? '' : 's'}`);
    setSelection(new Set(copies.map((_, k) => sheet.items.length + k)));
  }, [sheet, commit]);

  const cutSelection = useCallback(() => {
    if (selection.size === 0) return;
    copySelection();
    deleteSelection();
  }, [selection, copySelection, deleteSelection]);

  // ---- property editing ----
  const selectedIndex = selection.size === 1 ? [...selection][0]! : -1;
  const selectedItem = selectedIndex >= 0 ? sheet.items[selectedIndex] : undefined;

  const updateSelected = useCallback(
    (patch: Partial<WksItem>) => {
      if (selectedIndex < 0) return;
      const items = sheet.items.slice();
      items[selectedIndex] = { ...items[selectedIndex]!, ...patch } as WksItem;
      commit({ ...sheet, items }, 'Edit properties');
    },
    [sheet, selectedIndex, commit],
  );

  const updateSetup = useCallback(
    (patch: Partial<WksSheet['setup']>) => {
      commit({ ...sheet, setup: { ...sheet.setup, ...patch } }, 'Edit general options');
    },
    [sheet, commit],
  );

  // ---- toolbar / toggles ----
  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) => {
      const group = RADIO_GROUPS.find((g) => g.includes(id));
      const next = new Set(prev);
      if (group) {
        for (const g of group) next.delete(g);
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'new':
          newSheet(false);
          break;
        case 'open':
          openInputRef.current?.click();
          break;
        case 'save':
          save();
          break;
        case 'pageSettings':
          setShowPageDialog(true);
          break;
        case 'print':
          window.print();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'zoomRedraw':
          controller.current?.redraw();
          break;
        case 'zoomIn':
          controller.current?.zoomIn();
          break;
        case 'zoomOut':
          controller.current?.zoomOut();
          break;
        case 'zoomFit':
          controller.current?.zoomToFit();
          break;
        case 'zoomTool':
          controller.current?.zoomToSelection();
          break;
        case 'inspect':
          setShowInspector(true);
          break;
        default:
          break;
      }
    },
    [newSheet, save, undo, redo],
  );

  const onRightTool = useCallback(
    (id: string) => {
      if (id === 'appendSheet') {
        appendInputRef.current?.click();
        setActiveTool('select');
        return;
      }
      if (id === 'dsDelete') {
        deleteSelection();
        setActiveTool('select');
        return;
      }
      setActiveTool(id);
    },
    [deleteSelection],
  );

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target as HTMLElement | null;
      const typing =
        !!tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        cutSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        pasteClipboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(new Set(sheet.items.map((_, i) => i)));
      } else if (typing) {
        /* let inputs handle their keys */
      } else if (e.key === 'Escape') {
        if (activeTool !== 'select') setActiveTool('select');
        else setSelection(new Set());
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'f' || e.key === 'F') controller.current?.zoomToFit();
      else if (e.key === 'l' || e.key === 'L') setActiveTool('dsAddLine');
      else if (e.key === 'i' || e.key === 'I') setActiveTool('dsAddRect');
      else if (e.key === 't' || e.key === 'T') setActiveTool('dsAddText');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    save,
    undo,
    redo,
    duplicateSelection,
    deleteSelection,
    copySelection,
    cutSelection,
    pasteClipboard,
    sheet.items,
    activeTool,
  ]);

  // ---- menus (menubar_pl_editor.cpp working subset) ----
  const menus: Menu[] = useMemo(
    () => [
      {
        label: 'File',
        items: [
          { label: 'New', icon: 'new', action: () => newSheet(false), shortcut: 'Ctrl+N' },
          { label: 'New (empty)', action: () => newSheet(true) },
          {
            label: 'Open…',
            icon: 'open',
            action: () => openInputRef.current?.click(),
            shortcut: 'Ctrl+O',
          },
          {
            label: 'Append Existing Drawing Sheet…',
            icon: 'appendSheet',
            action: () => appendInputRef.current?.click(),
          },
          { sep: true },
          { label: 'Save', icon: 'save', action: save, shortcut: 'Ctrl+S' },
          { label: 'Save As…', icon: 'saveAs', action: saveAs },
          { sep: true },
          { label: 'Page Settings…', icon: 'pageSettings', action: () => setShowPageDialog(true) },
          { label: 'Print…', icon: 'print', action: () => window.print() },
          { sep: true },
          { label: 'Close Drawing Sheet Editor', action: onExitToHome },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: 'undo', action: undo, shortcut: 'Ctrl+Z' },
          { label: 'Redo', icon: 'redo', action: redo, shortcut: 'Ctrl+Y' },
          { sep: true },
          {
            label: 'Cut',
            icon: 'cut',
            action: cutSelection,
            shortcut: 'Ctrl+X',
            disabled: selection.size === 0,
          },
          {
            label: 'Copy',
            icon: 'copy',
            action: copySelection,
            shortcut: 'Ctrl+C',
            disabled: selection.size === 0,
          },
          { label: 'Paste', icon: 'paste', action: pasteClipboard, shortcut: 'Ctrl+V' },
          {
            label: 'Duplicate',
            action: duplicateSelection,
            shortcut: 'Ctrl+D',
            disabled: selection.size === 0,
          },
          {
            label: 'Delete',
            icon: 'dsDelete',
            action: deleteSelection,
            shortcut: 'Del',
            disabled: selection.size === 0,
          },
          { sep: true },
          {
            label: 'Select All',
            action: () => setSelection(new Set(sheet.items.map((_, i) => i))),
            shortcut: 'Ctrl+A',
          },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom In', icon: 'zoomIn', action: () => controller.current?.zoomIn() },
          { label: 'Zoom Out', icon: 'zoomOut', action: () => controller.current?.zoomOut() },
          {
            label: 'Zoom to Fit',
            icon: 'zoomFit',
            action: () => controller.current?.zoomToFit(),
            shortcut: 'F',
          },
          {
            label: 'Zoom to Selection',
            icon: 'zoomTool',
            action: () => controller.current?.zoomToSelection(),
            disabled: selection.size === 0,
          },
          { label: 'Redraw View', icon: 'zoomRedraw', action: () => controller.current?.redraw() },
          { sep: true },
          {
            label: `${toggles.has('toggleGrid') ? '✓ ' : ''}Show Grid`,
            action: () => onLeftToggle('toggleGrid'),
          },
          {
            label: `${toggles.has('crosshairFull') ? '✓ ' : ''}Full-Window Crosshair`,
            action: () => onLeftToggle('crosshairFull'),
          },
          { sep: true },
          {
            label: `${toggles.has('unitsMm') ? '✓ ' : ''}Millimetres`,
            action: () => onLeftToggle('unitsMm'),
          },
          {
            label: `${toggles.has('unitsInches') ? '✓ ' : ''}Inches`,
            action: () => onLeftToggle('unitsInches'),
          },
          {
            label: `${toggles.has('unitsMils') ? '✓ ' : ''}Mils`,
            action: () => onLeftToggle('unitsMils'),
          },
          { sep: true },
          {
            label: `${titleMode === 'preview' ? '✓ ' : ''}Show Title Block in Preview Mode`,
            action: () => setTitleMode('preview'),
          },
          {
            label: `${titleMode === 'edit' ? '✓ ' : ''}Show Title Block in Edit Mode`,
            action: () => setTitleMode('edit'),
          },
          { label: 'Page Preview Settings…', action: () => setShowPreviewDialog(true) },
          { sep: true },
          { label: 'Show Design Inspector', icon: 'inspect', action: () => setShowInspector(true) },
        ],
      },
      {
        label: 'Place',
        items: [
          { label: 'Line', icon: 'dsAddLine', action: () => setActiveTool('dsAddLine') },
          { label: 'Rectangle', icon: 'dsAddRect', action: () => setActiveTool('dsAddRect') },
          { label: 'Text', icon: 'dsAddText', action: () => setActiveTool('dsAddText') },
          { label: 'Bitmap', icon: 'dsAddBitmap', action: () => setActiveTool('dsAddBitmap') },
          { sep: true },
          {
            label: 'Append Existing Drawing Sheet…',
            icon: 'appendSheet',
            action: () => appendInputRef.current?.click(),
          },
        ],
      },
      {
        label: 'Inspect',
        items: [
          { label: 'Show Design Inspector', icon: 'inspect', action: () => setShowInspector(true) },
        ],
      },
      {
        label: 'Preferences',
        items: [
          { label: 'Page Settings…', action: () => setShowPageDialog(true) },
          { label: 'Page Preview Settings…', action: () => setShowPreviewDialog(true) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'About ZiroEDA', action: () => setStatus('ZiroEDA Drawing Sheet Editor') },
        ],
      },
    ],
    [
      newSheet,
      save,
      saveAs,
      undo,
      redo,
      cutSelection,
      copySelection,
      pasteClipboard,
      duplicateSelection,
      deleteSelection,
      selection,
      sheet.items,
      toggles,
      onLeftToggle,
      titleMode,
      onExitToHome,
    ],
  );

  // ---- title ----
  const title = `${dirty ? '*' : ''}${fileName} — Drawing Sheet Editor`;
  useEffect(() => {
    document.title = title;
  }, [title]);

  // ---- unit-aware coordinate readout (relative to the origin corner) ----
  const unit = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const coordText = useMemo(() => {
    if (!cursor) return 'X — Y —';
    const rel = anchoredPoint(cursor, originCorner);
    const conv = (mm: number): string =>
      unit === 'in'
        ? (mm / 25.4).toFixed(4)
        : unit === 'mils'
          ? ((mm / 25.4) * 1000).toFixed(1)
          : mm.toFixed(3);
    return `X ${conv(rel.x)} Y ${conv(rel.y)}`;
  }, [cursor, anchoredPoint, originCorner, unit]);
  const gridIU =
    mmToIU(unit === 'in' ? 25.4 : unit === 'mils' ? 25.4 : 5) * (unit === 'mm' ? 1 : 0.1);

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX,
      startW = panelWidth;
    const onMove = (ev: MouseEvent): void =>
      setPanelWidth(Math.min(420, Math.max(180, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div className="ze-app">
      <input
        ref={openInputRef}
        type="file"
        accept=".kicad_wks"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={appendInputRef}
        type="file"
        accept=".kicad_wks"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void appendFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={bitmapInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickBitmap(f);
          e.target.value = '';
        }}
      />

      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title={
          <>
            <b>{fileName}</b>&nbsp;—&nbsp;Drawing Sheet Editor
          </>
        }
      />

      {/* Top toolbar + grid / zoom / coordinate-origin / page selectors. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <Toolbar entries={DS_TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />
        <span style={{ width: 8 }} />
        <label className="ze-muted" style={{ fontSize: 12, marginRight: 4 }}>
          Origin
        </label>
        <select
          className="ze-select"
          value={originCorner}
          onChange={(e) => setOriginCorner(e.target.value as WksCorner)}
          title="Coordinate reference corner"
          style={{ margin: '0 6px' }}
        >
          {CORNERS.map((c) => (
            <option key={c} value={c}>
              {CORNER_LABEL[c]}
            </option>
          ))}
        </select>
        <label className="ze-muted" style={{ fontSize: 12, marginRight: 4 }}>
          Page
        </label>
        <select
          className="ze-select"
          value={pageNumber}
          onChange={(e) => setPageNumber(Number(e.target.value))}
          title="Preview page number (drives page1only / notonpage1 and ${#})"
          style={{ margin: '0 6px' }}
        >
          <option value={1}>Page 1</option>
          <option value={2}>Page 2</option>
        </select>
        <label className="ze-muted" style={{ fontSize: 12, marginRight: 4 }}>
          Title block
        </label>
        <select
          className="ze-select"
          value={titleMode}
          onChange={(e) => setTitleMode(e.target.value as 'preview' | 'edit')}
          title="Show title block in preview mode (sample values) or edit mode (raw ${…} fields)"
          style={{ margin: '0 6px' }}
        >
          <option value="preview">Preview mode</option>
          <option value="edit">Edit mode</option>
        </select>
        <button
          className="ze-btn"
          style={{ margin: '0 6px' }}
          title="Show Design Inspector"
          onClick={() => setShowInspector(true)}
        >
          Inspect
        </button>
      </div>

      <div className="ze-body">
        {/* Design tree (DS_DATA_MODEL). */}
        <div className="ze-leftdock" style={{ width: panelWidth, minWidth: panelWidth }}>
          <div className="ze-panel grow">
            <div className="ze-panel-header">Design</div>
            <div className="ze-panel-body" data-testid="ds-design-tree">
              {sheet.items.length === 0 && (
                <div className="ze-muted">
                  No items. Use the right toolbar to add lines, rectangles, text…
                </div>
              )}
              {sheet.items.map((it, i) => (
                <div
                  key={i}
                  className={`ze-tree-item${selection.has(i) ? ' active' : ''}`}
                  onClick={(e) => onSelect(i, e.shiftKey || e.ctrlKey || e.metaKey)}
                  title={TYPE_LABEL[it.type]}
                >
                  <span
                    className="ze-muted"
                    style={{ display: 'inline-block', width: 62, fontSize: 11 }}
                  >
                    {TYPE_LABEL[it.type]}
                  </span>
                  <span>{it.name || (it.type === 'text' ? (it as WksText).text : it.type)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />

        <Toolbar
          entries={DS_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <DrawingSheetCanvas
          ref={controller}
          draws={draws}
          pageW={pageW}
          pageH={pageH}
          selection={selection}
          activeTool={activeTool}
          showGrid={toggles.has('toggleGrid')}
          gridIU={gridIU}
          fullCrosshair={toggles.has('crosshairFull')}
          onCursorMove={setCursor}
          onScaleChange={setScale}
          onSelect={onSelect}
          onSelectBox={onSelectBox}
          onMoveItems={moveSelection}
          onPlacePoint={onPlacePoint}
          onPlaceSegment={onPlaceSegment}
        />

        {/* Properties + General Options (properties_frame.cpp). */}
        <div className="ze-leftdock" style={{ width: 264, minWidth: 264 }}>
          <div className="ze-panel grow" style={{ overflow: 'auto' }}>
            <div className="ze-panel-header">Properties</div>
            <div className="ze-panel-body" data-testid="ds-properties">
              {selectedItem ? (
                <ItemProperties item={selectedItem} onChange={updateSelected} />
              ) : (
                <div className="ze-muted" style={{ padding: 6 }}>
                  {selection.size > 1
                    ? `${selection.size} items selected`
                    : 'Select an item to edit its properties.'}
                </div>
              )}
            </div>
            <div className="ze-panel-header">General Options</div>
            <div className="ze-panel-body">
              <GeneralOptions setup={sheet.setup} onChange={updateSetup} />
            </div>
          </div>
        </div>

        <Toolbar
          entries={DS_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onRightTool}
        />
      </div>

      {/* Status bar. */}
      <div className="ze-statusbar" style={{ gap: 18 }}>
        <span className="cell">
          <b>Items</b> {sheet.items.length}
        </span>
        {selection.size > 0 && (
          <span className="cell">
            <b>Selected</b> {selection.size}
          </span>
        )}
        <span className="cell grow">{status}</span>
        <span className="cell">
          {paper}
          {portrait ? ' portrait' : ' landscape'}
        </span>
      </div>
      <div className="ze-statusbar">
        <span className="cell">Z {scale > 0 ? (scale * 1000).toFixed(2) : '—'}</span>
        <span className="cell" data-testid="ds-coords">
          {coordText}
        </span>
        <span className="cell grow">Origin: {CORNER_LABEL[originCorner]}</span>
        <span className="cell">Page {pageNumber}</span>
        <span className="cell">{unit}</span>
      </div>

      {showPageDialog && (
        <PageSettingsDialog
          paper={paper}
          portrait={portrait}
          onCancel={() => setShowPageDialog(false)}
          onOk={(p, port) => {
            setPaper(p);
            setPortrait(port);
            setShowPageDialog(false);
            setStatus(`Page: ${p} ${port ? 'portrait' : 'landscape'}`);
            requestAnimationFrame(() => controller.current?.zoomToFit());
          }}
        />
      )}

      {showPreviewDialog && (
        <PreviewSettingsDialog
          pageNumber={pageNumber}
          titleMode={titleMode}
          onClose={() => setShowPreviewDialog(false)}
          onPageNumber={setPageNumber}
          onTitleMode={setTitleMode}
        />
      )}

      {showInspector && (
        <DesignInspector
          items={sheet.items}
          selection={selection}
          onClose={() => setShowInspector(false)}
          onSelect={(i) => {
            setSelection(new Set([i]));
            requestAnimationFrame(() => controller.current?.zoomToSelection());
          }}
        />
      )}
    </div>
  );
}

// ----- properties panel -------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 6px' }}>
      <span className="ze-muted" style={{ width: 78, fontSize: 11, flex: '0 0 auto' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
const inputStyle: React.CSSProperties = { width: '100%', minWidth: 0 };
const numStyle: React.CSSProperties = { width: 64 };

function NumField({
  value,
  onChange,
  step = 0.1,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
}): JSX.Element {
  return (
    <input
      className="ze-search"
      type="number"
      step={step}
      value={value}
      style={numStyle}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function PointFields({
  label,
  point,
  onChange,
}: {
  label: string;
  point: WksPoint;
  onChange: (p: WksPoint) => void;
}): JSX.Element {
  return (
    <>
      <Row label={label}>
        <NumField value={point.x} onChange={(x) => onChange({ ...point, x })} />
        <NumField value={point.y} onChange={(y) => onChange({ ...point, y })} />
      </Row>
      <Row label={`${label} corner`}>
        <select
          className="ze-select"
          style={inputStyle}
          value={point.corner}
          onChange={(e) => onChange({ ...point, corner: e.target.value as WksCorner })}
        >
          {(['rbcorner', 'rtcorner', 'lbcorner', 'ltcorner'] as WksCorner[]).map((c) => (
            <option key={c} value={c}>
              {CORNER_LABEL[c]}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}

function ItemProperties({
  item,
  onChange,
}: {
  item: WksItem;
  onChange: (patch: Partial<WksItem>) => void;
}): JSX.Element {
  const base = (
    <>
      <Row label="Name">
        <input
          className="ze-search"
          style={inputStyle}
          value={item.name}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Row>
      <Row label="Show on">
        <select
          className="ze-select"
          style={inputStyle}
          value={item.option}
          onChange={(e) => onChange({ option: e.target.value as WksOption })}
        >
          <option value="normal">All pages</option>
          <option value="page1only">Page 1 only</option>
          <option value="notonpage1">Not on page 1</option>
        </select>
      </Row>
      <Row label="Repeat">
        <NumField
          step={1}
          value={item.repeat}
          onChange={(n) => onChange({ repeat: Math.max(1, Math.round(n)) })}
        />
      </Row>
      {item.repeat > 1 && (
        <>
          <Row label="Step X (mm)">
            <NumField value={item.incrx} onChange={(n) => onChange({ incrx: n })} />
          </Row>
          <Row label="Step Y (mm)">
            <NumField value={item.incry} onChange={(n) => onChange({ incry: n })} />
          </Row>
          {item.type === 'text' && (
            <Row label="Label step">
              <NumField
                step={1}
                value={item.incrlabel}
                onChange={(n) => onChange({ incrlabel: Math.round(n) })}
              />
            </Row>
          )}
        </>
      )}
      <Row label="Comment">
        <input
          className="ze-search"
          style={inputStyle}
          value={item.comment}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ comment: e.target.value })}
        />
      </Row>
    </>
  );

  if (item.type === 'text') {
    const t = item as WksText;
    return (
      <div>
        <Row label="Text">
          <input
            className="ze-search"
            style={inputStyle}
            value={t.text}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ text: e.target.value } as Partial<WksItem>)}
          />
        </Row>
        {base}
        <PointFields
          label="Position"
          point={t.pos}
          onChange={(pos) => onChange({ pos } as Partial<WksItem>)}
        />
        <Row label="Font W/H (mm)">
          <NumField value={t.fontW} onChange={(fontW) => onChange({ fontW } as Partial<WksItem>)} />
          <NumField value={t.fontH} onChange={(fontH) => onChange({ fontH } as Partial<WksItem>)} />
        </Row>
        <Row label="Style">
          <label style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={t.bold}
              onChange={(e) => onChange({ bold: e.target.checked } as Partial<WksItem>)}
            />{' '}
            Bold
          </label>
          <label style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={t.italic}
              onChange={(e) => onChange({ italic: e.target.checked } as Partial<WksItem>)}
            />{' '}
            Italic
          </label>
        </Row>
        <Row label="H align">
          <select
            className="ze-select"
            style={inputStyle}
            value={t.hjustify}
            onChange={(e) =>
              onChange({ hjustify: e.target.value as WksText['hjustify'] } as Partial<WksItem>)
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </Row>
        <Row label="V align">
          <select
            className="ze-select"
            style={inputStyle}
            value={t.vjustify}
            onChange={(e) =>
              onChange({ vjustify: e.target.value as WksText['vjustify'] } as Partial<WksItem>)
            }
          >
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </Row>
        <Row label="Rotation">
          <NumField
            step={90}
            value={t.rotate}
            onChange={(rotate) => onChange({ rotate } as Partial<WksItem>)}
          />
        </Row>
        <Row label="Text pen (mm)">
          <NumField
            step={0.05}
            value={t.lineWidth}
            onChange={(lineWidth) => onChange({ lineWidth } as Partial<WksItem>)}
          />
        </Row>
        <Row label="Max width (mm)">
          <NumField
            value={t.maxlen}
            onChange={(maxlen) => onChange({ maxlen } as Partial<WksItem>)}
          />
        </Row>
        <Row label="Max height (mm)">
          <NumField
            value={t.maxheight}
            onChange={(maxheight) => onChange({ maxheight } as Partial<WksItem>)}
          />
        </Row>
      </div>
    );
  }

  if (item.type === 'line' || item.type === 'rect') {
    const l = item as WksLine | WksRect;
    return (
      <div>
        {base}
        <PointFields
          label="Start"
          point={l.start}
          onChange={(start) => onChange({ start } as Partial<WksItem>)}
        />
        <PointFields
          label="End"
          point={l.end}
          onChange={(end) => onChange({ end } as Partial<WksItem>)}
        />
        <Row label="Line width">
          <NumField
            step={0.05}
            value={l.lineWidth}
            onChange={(lineWidth) => onChange({ lineWidth } as Partial<WksItem>)}
          />
        </Row>
      </div>
    );
  }

  if (item.type === 'bitmap') {
    const b = item as WksBitmap;
    return (
      <div>
        {base}
        <PointFields
          label="Position"
          point={b.pos}
          onChange={(pos) => onChange({ pos } as Partial<WksItem>)}
        />
        <Row label="Scale">
          <NumField value={b.scale} onChange={(scale) => onChange({ scale } as Partial<WksItem>)} />
        </Row>
        <Row label="PPI">
          <NumField
            step={1}
            value={b.ppi}
            onChange={(ppi) => onChange({ ppi: Math.max(1, Math.round(ppi)) } as Partial<WksItem>)}
          />
        </Row>
      </div>
    );
  }

  // polygon
  return (
    <div>
      {base}
      <PointFields
        label="Position"
        point={(item as any).pos}
        onChange={(pos) => onChange({ pos } as Partial<WksItem>)}
      />
      <Row label="Rotation">
        <NumField
          step={90}
          value={(item as any).rotate}
          onChange={(rotate) => onChange({ rotate } as Partial<WksItem>)}
        />
      </Row>
      <Row label="Line width">
        <NumField
          step={0.05}
          value={(item as any).lineWidth}
          onChange={(lineWidth) => onChange({ lineWidth } as Partial<WksItem>)}
        />
      </Row>
    </div>
  );
}

function GeneralOptions({
  setup,
  onChange,
}: {
  setup: WksSheet['setup'];
  onChange: (patch: Partial<WksSheet['setup']>) => void;
}): JSX.Element {
  return (
    <div>
      <Row label="Text W/H (mm)">
        <NumField value={setup.textW} onChange={(textW) => onChange({ textW })} />
        <NumField value={setup.textH} onChange={(textH) => onChange({ textH })} />
      </Row>
      <Row label="Line width">
        <NumField
          step={0.05}
          value={setup.lineWidth}
          onChange={(lineWidth) => onChange({ lineWidth })}
        />
      </Row>
      <Row label="Text pen">
        <NumField
          step={0.05}
          value={setup.textLineWidth}
          onChange={(textLineWidth) => onChange({ textLineWidth })}
        />
      </Row>
      <Row label="Left margin">
        <NumField value={setup.leftMargin} onChange={(leftMargin) => onChange({ leftMargin })} />
      </Row>
      <Row label="Right margin">
        <NumField value={setup.rightMargin} onChange={(rightMargin) => onChange({ rightMargin })} />
      </Row>
      <Row label="Top margin">
        <NumField value={setup.topMargin} onChange={(topMargin) => onChange({ topMargin })} />
      </Row>
      <Row label="Bottom margin">
        <NumField
          value={setup.bottomMargin}
          onChange={(bottomMargin) => onChange({ bottomMargin })}
        />
      </Row>
    </div>
  );
}

function PageSettingsDialog({
  paper,
  portrait,
  onOk,
  onCancel,
}: {
  paper: string;
  portrait: boolean;
  onOk: (paper: string, portrait: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const [p, setP] = useState(paper);
  const [port, setPort] = useState(portrait);
  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Page Settings
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          <div className="row">
            <span>Paper size</span>
            <select
              className="ze-select"
              value={p}
              onChange={(e) => setP(e.target.value)}
              autoFocus
            >
              {PAPER_ORDER.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <span>Orientation</span>
            <select
              className="ze-select"
              value={port ? 'portrait' : 'landscape'}
              onChange={(e) => setPort(e.target.value === 'portrait')}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk(p, port)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Page-preview settings (pl_editor properties-frame "Page 1 / Other pages" +
 * title-block display mode): choose which page to preview and whether the title
 * block shows resolved sample values or its raw `${…}` field templates.
 */
function PreviewSettingsDialog({
  pageNumber,
  titleMode,
  onPageNumber,
  onTitleMode,
  onClose,
}: {
  pageNumber: number;
  titleMode: 'preview' | 'edit';
  onPageNumber: (n: number) => void;
  onTitleMode: (m: 'preview' | 'edit') => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Page Preview Settings
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          <div className="row">
            <span>Preview page</span>
            <select
              className="ze-select"
              value={pageNumber}
              onChange={(e) => onPageNumber(Number(e.target.value))}
              autoFocus
            >
              <option value={1}>Page 1</option>
              <option value={2}>Other pages</option>
            </select>
          </div>
          <div className="row">
            <span>Title block</span>
            <select
              className="ze-select"
              value={titleMode}
              onChange={(e) => onTitleMode(e.target.value as 'preview' | 'edit')}
            >
              <option value="preview">Show in preview mode</option>
              <option value="edit">Show in edit mode</option>
            </select>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** A one-line geometry/content summary of a drawing-sheet item for the inspector. */
function itemSummary(it: WksItem): string {
  switch (it.type) {
    case 'text':
      return `"${it.text}" @ (${it.pos.x}, ${it.pos.y}) ${it.pos.corner}`;
    case 'line':
    case 'rect':
      return `(${it.start.x}, ${it.start.y}) ${it.start.corner} → (${it.end.x}, ${it.end.y}) ${it.end.corner}`;
    case 'bitmap':
      return `@ (${it.pos.x}, ${it.pos.y}) ${it.pos.corner}, scale ${it.scale}${it.pxW ? `, ${it.pxW}×${it.pxH}px` : ''}`;
    case 'polygon':
      return `@ (${it.pos.x}, ${it.pos.y}) ${it.pos.corner}, ${it.contours.length} contour(s)`;
  }
}

/**
 * Design Inspector (pl_editor "Show Design Inspector"): a table of every item in
 * the DS_DATA_MODEL with its type, name, page option, repeat and geometry. Rows
 * are clickable to select + zoom the item on the canvas.
 */
function DesignInspector({
  items,
  selection,
  onSelect,
  onClose,
}: {
  items: WksItem[];
  selection: ReadonlySet<number>;
  onSelect: (index: number) => void;
  onClose: () => void;
}): JSX.Element {
  const SHOW: Record<WksOption, string> = {
    normal: 'All pages',
    page1only: 'Page 1 only',
    notonpage1: 'Not page 1',
  };
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 760, maxWidth: '92vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Design Inspector — {items.length} item{items.length === 1 ? '' : 's'}
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }} data-testid="ds-inspector">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--panel, #2b2b30)',
                  textAlign: 'left',
                }}
              >
                {['#', 'Type', 'Name', 'Show on', 'Repeat', 'Geometry'].map((h) => (
                  <th
                    key={h}
                    style={{ padding: '5px 8px', borderBottom: '1px solid rgba(128,128,128,0.35)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr
                  key={i}
                  className={selection.has(i) ? 'active' : ''}
                  style={{
                    cursor: 'pointer',
                    background: selection.has(i) ? 'rgba(74,163,255,0.18)' : undefined,
                  }}
                  onClick={() => {
                    onSelect(i);
                    onClose();
                  }}
                >
                  <td style={{ padding: '4px 8px' }}>{i + 1}</td>
                  <td style={{ padding: '4px 8px' }}>{TYPE_LABEL[it.type]}</td>
                  <td style={{ padding: '4px 8px' }}>
                    {it.name || <span className="ze-muted">—</span>}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{SHOW[it.option]}</td>
                  <td style={{ padding: '4px 8px' }}>{it.repeat}</td>
                  <td
                    style={{
                      padding: '4px 8px',
                      whiteSpace: 'nowrap',
                      maxWidth: 320,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {itemSummary(it)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="ze-muted" style={{ padding: 10 }}>
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
