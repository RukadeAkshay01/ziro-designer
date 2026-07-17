/**
 * The Drawing Sheet Editor frame — the web mirror of `pl_editor`'s
 * PL_EDITOR_FRAME (pagelayout_editor/pl_editor_frame.cpp): the menu bar
 * (menubar.cpp), the top / left / right toolbars with the origin and page
 * selectors (toolbars_pl_editor.cpp), the docked properties panel
 * (dialogs/properties_frame.cpp — see PropertiesFrame), the design inspector
 * (dialogs/design_inspector.cpp — see DesignInspector), the page-preview
 * settings dialog (PageSettingsDialog), the canvas with its interactive tools
 * (DrawingSheetCanvas), and the two status-bar rows with the origin-relative
 * coordinate readout (PL_EDITOR_FRAME::UpdateStatusBar).
 *
 * The document is a `WksSheet`; File → New loads the default stationery, and
 * Open / Save read and write `.kicad_wks`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  defaultDrawingSheet,
  parseDrawingSheet,
  serializeDrawingSheet,
  layoutDrawingSheet,
  translateItem,
  mmToIU,
  iuToMM,
  type WksSheet,
  type WksItem,
  type WksCorner,
  type WksPoint,
  type WksLine,
  type WksRect,
  type WksResolveContext,
} from '@ziroeda/common';
import type { Vec2 } from '@ziroeda/kimath';
import { MenuBar, type Menu, type MenuItem } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { DS_TOP_TOOLBAR, DS_LEFT_TOOLBAR, DS_RIGHT_TOOLBAR } from './drawingSheetToolbars.js';
import { DrawingSheetCanvas, type DrawingSheetCanvasController } from './DrawingSheetCanvas.js';
import { PropertiesFrame, SyntaxHelpDialog } from './PropertiesFrame.js';
import { DesignInspector } from './DesignInspector.js';
import {
  PageSettingsDialog,
  defaultPreviewSettings,
  previewPageMM,
  paperDescription,
  type PreviewSettings,
} from './PageSettingsDialog.js';
import { imageFileToPng, decodeImageMeta } from './wksBitmap.js';
import { drawDrawingSheetItems, DS_PAGE_COLOR } from './wksRender.js';
import '../../ui/shell.css';

export interface DrawingSheetEditorFile {
  name: string;
  text: string;
}

const UNIT_GROUP = ['unitsMm', 'unitsInches', 'unitsMils'];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'layoutNormalMode']);

/** The 5 status-bar coordinate origins (PL_EDITOR_FRAME::m_originChoiceList). */
const ORIGIN_CHOICES = [
  'Left Top paper corner',
  'Right Bottom page corner',
  'Left Bottom page corner',
  'Right Top page corner',
  'Left Top page corner',
];

/** Recent-files store (FILE_HISTORY), kept in localStorage. */
const RECENT_KEY = 'ziroeda.drawingsheet.recent';
interface RecentFile {
  name: string;
  text: string;
}
function loadRecent(): RecentFile[] {
  try {
    const v = localStorage.getItem(RECENT_KEY);
    const list = v ? (JSON.parse(v) as RecentFile[]) : [];
    return Array.isArray(list) ? list.slice(0, 5) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: RecentFile[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    /* storage disabled */
  }
}

const download = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/** Backfill decoded pixel size + DPI for bitmaps loaded from a file. */
async function backfillBitmapMeta(sheet: WksSheet): Promise<WksSheet> {
  if (!sheet.items.some((it) => it.type === 'bitmap' && it.pngB64 && !(it.pxW && it.pxW > 0)))
    return sheet;
  const items = await Promise.all(
    sheet.items.map(async (it) => {
      if (it.type !== 'bitmap' || !it.pngB64 || (it.pxW && it.pxW > 0)) return it;
      try {
        const { w, h, ppi } = await decodeImageMeta(it.pngB64);
        return { ...it, pxW: w, pxH: h, ppi };
      } catch {
        return it;
      }
    }),
  );
  return { ...sheet, items };
}

/** A fresh item-base for newly placed items (AddDrawingSheetItem defaults). */
const NEW_BASE = {
  name: '',
  option: 'normal' as const,
  repeat: 1,
  incrx: 0,
  incry: 0,
  incrlabel: 1,
  comment: '',
};

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
  const [preview, setPreview] = useState<PreviewSettings>(() => ({
    ...defaultPreviewSettings(),
    title: projectName ?? '',
  }));
  const [pageNumber, setPageNumber] = useState(1); // 1 = "Page 1", 2 = "Other pages"
  const [originChoice, setOriginChoice] = useState(0);
  const [localOrigin, setLocalOrigin] = useState<Vec2>({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('Loaded default drawing sheet');
  const [moveMode, setMoveMode] = useState(false);
  const [blackBackground, setBlackBackground] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showPageDialog, setShowPageDialog] = useState(false);
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [recent, setRecent] = useState<RecentFile[]>(loadRecent);

  const controller = useRef<DrawingSheetCanvasController>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const bitmapInputRef = useRef<HTMLInputElement>(null);
  const pendingBitmapPos = useRef<WksPoint | null>(null);
  // Index of the two-click item currently being drawn, or null.
  const drawingIndex = useRef<number | null>(null);
  // One undo push per point-editor drag.
  const pointDragUndoPushed = useRef(false);
  // Internal clipboard for Edit → Cut / Copy / Paste.
  const clipboard = useRef<WksItem[]>([]);

  // Title-block display mode: normal (resolved) vs edit (raw ${…} tokens).
  const editMode = toggles.has('layoutEditMode');

  // ---- page geometry ----
  const pageMM = useMemo(() => previewPageMM(preview), [preview]);
  const pageW = mmToIU(pageMM[0]);
  const pageH = mmToIU(pageMM[1]);

  // ---- title-block resolve context (fed by the Page Settings preview data) ----
  const resolveCtx = useMemo<WksResolveContext>(
    () => ({
      pageNumber,
      sheetCount: pageNumber > 1 ? 2 : 1,
      title: preview.title,
      rev: preview.rev,
      date: preview.date,
      company: preview.company,
      comments: preview.comments,
      paper: preview.paper,
      fileName,
      sheetPath: '/',
      appVersion: 'ZiroEDA',
      rawText: editMode,
    }),
    [pageNumber, preview, fileName, editMode],
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

  /** Push the current sheet on the undo stack without changing it (in-flight edits). */
  const pushUndo = useCallback(() => {
    setSheet((cur) => {
      undoStack.current.push(cur);
      redoStack.current = [];
      return cur;
    });
    setDirty(true);
  }, []);

  /** Silent update used while dragging (no extra undo entries). */
  const updateSheet = useCallback((fn: (cur: WksSheet) => WksSheet) => {
    setSheet(fn);
  }, []);

  const undo = useCallback(() => {
    setSheet((cur) => {
      const p = undoStack.current.pop();
      if (!p) return cur;
      redoStack.current.push(cur);
      return p;
    });
    setSelection(new Set());
    drawingIndex.current = null;
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
  const addRecent = useCallback((name: string, text: string) => {
    setRecent((prev) => {
      const next = [{ name, text }, ...prev.filter((r) => r.name !== name)].slice(0, 5);
      saveRecent(next);
      return next;
    });
  }, []);

  const newSheet = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setSheet(defaultDrawingSheet());
    setSelection(new Set());
    setDirty(false);
    setFileName('drawing_sheet.kicad_wks');
    setStatus('New drawing sheet');
    requestAnimationFrame(() => controller.current?.zoomToFit());
  }, []);

  const openText = useCallback(
    async (name: string, text: string) => {
      try {
        const parsed = await backfillBitmapMeta(parseDrawingSheet(text));
        undoStack.current = [];
        redoStack.current = [];
        setSheet(parsed);
        setSelection(new Set());
        setDirty(false);
        setFileName(name);
        setStatus(`Opened ${name} (${parsed.items.length} items)`);
        addRecent(name, text);
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } catch (err) {
        setStatus(`Failed to open ${name}: ${(err as Error).message}`);
      }
    },
    [addRecent],
  );

  const openFile = useCallback(
    async (file: File) => openText(file.name, await file.text()),
    [openText],
  );

  const appendFile = useCallback(
    async (file: File) => {
      try {
        const parsed = await backfillBitmapMeta(parseDrawingSheet(await file.text()));
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
    const text = serializeDrawingSheet(sheet);
    download(fileName, text);
    addRecent(fileName, text);
    setDirty(false);
    setStatus(`Saved ${fileName}`);
  }, [fileName, sheet, addRecent]);

  const saveAs = useCallback(() => {
    const name = window.prompt('Save drawing sheet as:', fileName) || fileName;
    const finalName = /\.kicad_wks$/i.test(name) ? name : `${name}.kicad_wks`;
    const text = serializeDrawingSheet(sheet);
    setFileName(finalName);
    download(finalName, text);
    addRecent(finalName, text);
    setDirty(false);
    setStatus(`Saved ${finalName}`);
  }, [fileName, sheet, addRecent]);

  /** Print the sheet: render the page alone to a bitmap and print that. */
  const printSheet = useCallback(() => {
    const scalePx = 2480 / pageW; // ~300 DPI for an A4-wide page
    const cv = document.createElement('canvas');
    cv.width = Math.round(pageW * scalePx);
    cv.height = Math.round(pageH * scalePx);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = DS_PAGE_COLOR;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scalePx, 0, 0, scalePx, 0, 0);
    drawDrawingSheetItems(ctx, draws, new Set(), { minWidth: 1 / scalePx });
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(
      `<title>${fileName}</title><img src="${cv.toDataURL('image/png')}" style="width:100%" onload="window.print()">`,
    );
    w.document.close();
  }, [draws, pageW, pageH, fileName]);

  // ---- placement: page-space IU point → anchored mm point ----
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
        default:
          return { corner, x: round(right - px), y: round(bottom - py) };
      }
    },
    [sheet.setup, pageMM],
  );

  /** Anchored mm point → page-space IU (for the point-editor handles). */
  const anchoredToIU = useCallback(
    (p: WksPoint): Vec2 => {
      const s = sheet.setup;
      const left = s.leftMargin,
        top = s.topMargin;
      const right = pageMM[0] - s.rightMargin,
        bottom = pageMM[1] - s.bottomMargin;
      switch (p.corner) {
        case 'ltcorner':
          return { x: mmToIU(left + p.x), y: mmToIU(top + p.y) };
        case 'rtcorner':
          return { x: mmToIU(right - p.x), y: mmToIU(top + p.y) };
        case 'lbcorner':
          return { x: mmToIU(left + p.x), y: mmToIU(bottom - p.y) };
        default:
          return { x: mmToIU(right - p.x), y: mmToIU(bottom - p.y) };
      }
    },
    [sheet.setup, pageMM],
  );

  // ---- drawing tools (first click creates, motion drags, second finishes) ----
  const onDrawFirst = useCallback(
    (tool: string, at: Vec2) => {
      const pos = anchoredPoint(at, 'rbcorner');
      const item: WksLine | WksRect = {
        type: tool === 'dsAddLine' ? 'line' : 'rect',
        ...NEW_BASE,
        start: pos,
        end: pos,
        lineWidth: 0,
      };
      pushUndo();
      updateSheet((cur) => {
        drawingIndex.current = cur.items.length;
        return { ...cur, items: [...cur.items, item] };
      });
      setSelection(new Set()); // selected only once placed
    },
    [anchoredPoint, pushUndo, updateSheet],
  );

  const onDrawMove = useCallback(
    (at: Vec2) => {
      const idx = drawingIndex.current;
      if (idx === null) return;
      const end = anchoredPoint(at, 'rbcorner');
      updateSheet((cur) => {
        const items = cur.items.slice();
        const it = items[idx];
        if (!it || (it.type !== 'line' && it.type !== 'rect')) return cur;
        items[idx] = { ...it, end };
        return { ...cur, items };
      });
    },
    [anchoredPoint, updateSheet],
  );

  const onDrawSecond = useCallback(
    (at: Vec2) => {
      const idx = drawingIndex.current;
      drawingIndex.current = null;
      if (idx === null) return;
      onDrawMove(at);
      drawingIndex.current = null;
      setSelection(new Set([idx]));
      setDirty(true);
      setStatus('Item placed');
      // The tool stays active for the next placement, as upstream does.
    },
    [onDrawMove],
  );

  const cancelDrawing = useCallback(() => {
    if (drawingIndex.current === null) return;
    drawingIndex.current = null;
    undo(); // roll back the in-flight item
  }, [undo]);

  // ---- one-click tools ----
  const addItem = useCallback(
    (item: WksItem, description: string) => {
      const next = { ...sheet, items: [...sheet.items, item] };
      commit(next, description);
      setSelection(new Set([next.items.length - 1]));
    },
    [sheet, commit],
  );

  const onPlacePoint = useCallback(
    (tool: string, at: Vec2) => {
      const pos = anchoredPoint(at, 'rbcorner');
      if (tool === 'dsAddText') {
        addItem(
          {
            type: 'text',
            ...NEW_BASE,
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
        // Place → Image opens a file dialog; capture the anchor and prompt.
        pendingBitmapPos.current = pos;
        bitmapInputRef.current?.click();
      }
    },
    [anchoredPoint, addItem],
  );

  // Create a bitmap item from any image File — used by Place → Image, by pasting
  // an image, and by images the Image Converter puts on the clipboard.
  const addBitmapFromFile = useCallback(
    async (file: File, pos: WksPoint) => {
      try {
        const { b64, pxW, pxH, ppi } = await imageFileToPng(file);
        addItem(
          { type: 'bitmap', ...NEW_BASE, pos, scale: 1, pngB64: b64, ppi, pxW, pxH },
          `Add image (${file.name || 'pasted image'})`,
        );
      } catch (err) {
        setStatus(`Failed to load image: ${(err as Error).message}`);
      }
    },
    [addItem],
  );

  const centreOrCursorPoint = useCallback(
    (): WksPoint => anchoredPoint(cursor ?? { x: pageW / 2, y: pageH / 2 }, 'rbcorner'),
    [anchoredPoint, cursor, pageW, pageH],
  );

  const onPickBitmap = useCallback(
    async (file: File) => {
      const pos = pendingBitmapPos.current ?? centreOrCursorPoint();
      pendingBitmapPos.current = null;
      await addBitmapFromFile(file, pos);
    },
    [addBitmapFromFile, centreOrCursorPoint],
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

  const onDeleteClick = useCallback(
    (src: number) => {
      const items = sheet.items.filter((_, i) => i !== src);
      commit({ ...sheet, items }, 'Deleted 1 item');
      setSelection(new Set());
    },
    [sheet, commit],
  );

  const copySelection = useCallback(() => {
    if (selection.size === 0) return;
    const items = [...selection].sort((a, b) => a - b).map((i) => structuredClone(sheet.items[i]!));
    clipboard.current = items;
    // Also place a .kicad_wks fragment on the system clipboard so the selection
    // can be pasted across editor instances / tabs (and by an external tool).
    try {
      const frag = serializeDrawingSheet({ ...sheet, items });
      void navigator.clipboard?.writeText?.(frag).catch(() => {});
    } catch {
      /* clipboard unavailable */
    }
    setStatus(`Copied ${items.length} item${items.length === 1 ? '' : 's'}`);
  }, [sheet, selection]);

  // Append items to the sheet (used by clipboard paste of items / a whole sheet).
  const appendItems = useCallback(
    (incoming: WksItem[], description: string) => {
      if (incoming.length === 0) return;
      const off = { x: mmToIU(2), y: mmToIU(2) };
      const shifted = incoming.map((it) => translateItem(structuredClone(it), off));
      const start = sheet.items.length;
      commit({ ...sheet, items: [...sheet.items, ...shifted] }, description);
      setSelection(new Set(shifted.map((_, k) => start + k)));
    },
    [sheet, commit],
  );

  const pasteClipboard = useCallback(() => {
    if (clipboard.current.length === 0) return;
    appendItems(
      clipboard.current,
      `Pasted ${clipboard.current.length} item${clipboard.current.length === 1 ? '' : 's'}`,
    );
  }, [appendItems]);

  // Parse `.kicad_wks` text from the clipboard and paste its items. Returns true
  // when the text was a drawing sheet (or fragment) that yielded items.
  const pasteWksText = useCallback(
    async (text: string): Promise<boolean> => {
      let parsed: WksSheet;
      try {
        parsed = await backfillBitmapMeta(parseDrawingSheet(text));
      } catch {
        return false;
      }
      if (parsed.items.length === 0) return false;
      appendItems(
        parsed.items,
        `Pasted ${parsed.items.length} item${parsed.items.length === 1 ? '' : 's'} from clipboard`,
      );
      return true;
    },
    [appendItems],
  );

  // Menu → Paste: read the system clipboard (image → bitmap, .kicad_wks text →
  // items), falling back to the in-editor clipboard when neither is available.
  const pasteFromSystem = useCallback(async () => {
    const clip: Clipboard | undefined = navigator.clipboard;
    try {
      if (typeof clip?.read === 'function') {
        const contents = await clip.read();
        for (const item of contents) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            await addBitmapFromFile(
              new File([blob], 'pasted-image', { type: imgType }),
              centreOrCursorPoint(),
            );
            return;
          }
        }
      }
      if (typeof clip?.readText === 'function') {
        const text = await clip.readText().catch(() => '');
        if (text && (await pasteWksText(text))) return;
      }
    } catch {
      /* permission denied / unsupported → fall back */
    }
    pasteClipboard();
  }, [addBitmapFromFile, centreOrCursorPoint, pasteWksText, pasteClipboard]);

  const cutSelection = useCallback(() => {
    if (selection.size === 0) return;
    copySelection();
    deleteSelection();
  }, [selection, copySelection, deleteSelection]);

  // ---- properties ----
  const selectedIndex = selection.size === 1 ? [...selection][0]! : -1;

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

  // ---- point editor (single selected line/rect) ----
  const selectedShape =
    selectedIndex >= 0 &&
    (sheet.items[selectedIndex]?.type === 'line' || sheet.items[selectedIndex]?.type === 'rect')
      ? (sheet.items[selectedIndex] as WksLine | WksRect)
      : null;

  const editPoints = useMemo<Vec2[]>(() => {
    if (!selectedShape || moveMode) return [];
    const a = anchoredToIU(selectedShape.start);
    const b = anchoredToIU(selectedShape.end);
    if (selectedShape.type === 'line') return [a, b];
    // Rect: TL, TR, BL, BR of the current geometry.
    const minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y),
      maxY = Math.max(a.y, b.y);
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY },
    ];
  }, [selectedShape, anchoredToIU, moveMode]);

  const onPointDrag = useCallback(
    (index: number, at: Vec2) => {
      if (!selectedShape || selectedIndex < 0) return;
      if (!pointDragUndoPushed.current) {
        pointDragUndoPushed.current = true;
        pushUndo();
      }
      updateSheet((cur) => {
        const items = cur.items.slice();
        const it = items[selectedIndex];
        if (!it || (it.type !== 'line' && it.type !== 'rect')) return cur;
        const a = anchoredToIU(it.start);
        const b = anchoredToIU(it.end);
        let nextStart = it.start;
        let nextEnd = it.end;
        if (it.type === 'line') {
          if (index === 0) nextStart = anchoredPoint(at, it.start.corner);
          else nextEnd = anchoredPoint(at, it.end.corner);
        } else {
          // Rect corners: move the x of whichever endpoint holds that side,
          // and the y of whichever endpoint holds that edge (RECT_* cases).
          const leftIsStart = a.x <= b.x;
          const topIsStart = a.y <= b.y;
          const isLeft = index === 0 || index === 2;
          const isTop = index === 0 || index === 1;
          const xTarget = isLeft === leftIsStart ? 'start' : 'end';
          const yTarget = isTop === topIsStart ? 'start' : 'end';
          const sIU = { x: a.x, y: a.y };
          const eIU = { x: b.x, y: b.y };
          if (xTarget === 'start') sIU.x = at.x;
          else eIU.x = at.x;
          if (yTarget === 'start') sIU.y = at.y;
          else eIU.y = at.y;
          nextStart = anchoredPoint(sIU, it.start.corner);
          nextEnd = anchoredPoint(eIU, it.end.corner);
        }
        items[selectedIndex] = { ...it, start: nextStart, end: nextEnd };
        return { ...cur, items };
      });
    },
    [selectedShape, selectedIndex, anchoredToIU, anchoredPoint, pushUndo, updateSheet],
  );

  const onPointDragEnd = useCallback(() => {
    pointDragUndoPushed.current = false;
    setStatus('Resize');
  }, []);

  // ---- toolbars ----
  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) => {
      const next = new Set(prev);
      if (UNIT_GROUP.includes(id)) {
        for (const g of UNIT_GROUP) next.delete(g);
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setTitleBlockMode = useCallback((mode: 'layoutNormalMode' | 'layoutEditMode') => {
    setToggles((prev) => {
      const next = new Set(prev);
      next.delete('layoutNormalMode');
      next.delete('layoutEditMode');
      next.add(mode);
      return next;
    });
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'new':
          newSheet();
          break;
        case 'open':
          openInputRef.current?.click();
          break;
        case 'save':
          save();
          break;
        case 'print':
          printSheet();
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
        case 'previewSettings':
          setShowPageDialog(true);
          break;
        case 'layoutNormalMode':
          setTitleBlockMode('layoutNormalMode');
          break;
        case 'layoutEditMode':
          setTitleBlockMode('layoutEditMode');
          break;
        default:
          break;
      }
    },
    [newSheet, save, printSheet, undo, redo, setTitleBlockMode],
  );

  const onRightTool = useCallback((id: string) => {
    if (id === 'appendSheet') {
      appendInputRef.current?.click();
      return;
    }
    setMoveMode(false);
    setActiveTool(id);
  }, []);

  // ---- keyboard (pl_editor hotkeys: M move; standard undo/redo/clipboard) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target as HTMLElement | null;
      const typing =
        !!tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        newSheet();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openInputRef.current?.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (typing) {
        /* let inputs handle their keys */
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        cutSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        /* handled by the native `paste` listener (system image / .kicad_wks) */
      } else if (e.key === 'Escape') {
        if (moveMode) setMoveMode(false);
        else if (drawingIndex.current !== null) cancelDrawing();
        else if (activeTool !== 'select') setActiveTool('select');
        else setSelection(new Set());
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'm' || e.key === 'M') {
        if (selection.size > 0) setMoveMode(true);
      } else if (e.key === 'Home') {
        controller.current?.zoomToFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    save,
    newSheet,
    undo,
    redo,
    deleteSelection,
    copySelection,
    cutSelection,
    activeTool,
    moveMode,
    selection,
    cancelDrawing,
  ]);

  // ---- system-clipboard paste (Ctrl+V): image → bitmap, .kicad_wks text → items ----
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')
      )
        return;
      const dt = e.clipboardData;
      if (!dt) return;
      // 1) A pasted image (from the Image Converter, a screenshot, etc.).
      const imgItem = Array.from(dt.items).find(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      );
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          e.preventDefault();
          void addBitmapFromFile(file, centreOrCursorPoint());
          return;
        }
      }
      // 2) A pasted drawing sheet / fragment (kicad_wks S-expression text).
      const text = dt.getData('text/plain');
      if (text && /\(\s*(kicad_wks|polygon|tbtext|line|rect|bitmap)\b/.test(text)) {
        e.preventDefault();
        void pasteWksText(text);
        return;
      }
      // 3) Otherwise fall back to items copied inside this editor.
      if (clipboard.current.length) {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addBitmapFromFile, centreOrCursorPoint, pasteWksText, pasteClipboard]);

  // ---- menus (menubar.cpp) ----
  const recentItems: MenuItem[] =
    recent.length > 0
      ? [
          ...recent.map((r) => ({
            label: r.name,
            action: () => void openText(r.name, r.text),
          })),
          { sep: true },
          {
            label: 'Clear Recent Files',
            action: () => {
              setRecent([]);
              saveRecent([]);
            },
          },
        ]
      : [{ label: '(empty)', disabled: true, action: () => {} }];

  const menus: Menu[] = useMemo(
    () => [
      {
        label: 'File',
        items: [
          { label: 'New', icon: 'new', action: newSheet, shortcut: 'Ctrl+N' },
          {
            label: 'Open…',
            icon: 'open',
            action: () => openInputRef.current?.click(),
            shortcut: 'Ctrl+O',
          },
          { label: 'Open Recent', submenu: recentItems },
          { sep: true },
          { label: 'Save', icon: 'save', action: save, shortcut: 'Ctrl+S' },
          { label: 'Save As…', icon: 'saveAs', action: saveAs },
          { sep: true },
          { label: 'Print…', icon: 'print', action: printSheet },
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
          {
            label: 'Paste',
            icon: 'paste',
            action: () => void pasteFromSystem(),
            shortcut: 'Ctrl+V',
          },
          {
            label: 'Delete',
            icon: 'dsDelete',
            action: deleteSelection,
            shortcut: 'Del',
            disabled: selection.size === 0,
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
            shortcut: 'Home',
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
            label: 'Page Preview Settings…',
            icon: 'previewSettings',
            action: () => setShowPageDialog(true),
          },
        ],
      },
      {
        label: 'Place',
        items: [
          {
            label: 'Draw Lines',
            icon: 'dsAddLine',
            action: () => setActiveTool('dsAddLine'),
          },
          {
            label: 'Draw Rectangles',
            icon: 'dsAddRect',
            action: () => setActiveTool('dsAddRect'),
          },
          { label: 'Draw Text', icon: 'dsAddText', action: () => setActiveTool('dsAddText') },
          {
            label: 'Place Bitmaps',
            icon: 'dsAddBitmap',
            action: () => setActiveTool('dsAddBitmap'),
          },
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
        items: [{ label: 'Preferences…', action: () => setShowPrefs(true) }],
      },
      {
        label: 'Help',
        items: [
          { label: 'Syntax Help (text variables)', action: () => setShowSyntaxHelp(true) },
          { label: 'About ZiroEDA', action: () => setStatus('ZiroEDA Drawing Sheet Editor') },
        ],
      },
    ],
    [
      newSheet,
      save,
      saveAs,
      printSheet,
      undo,
      redo,
      cutSelection,
      copySelection,
      pasteFromSystem,
      deleteSelection,
      selection,
      onExitToHome,
      recentItems,
    ],
  );

  // ---- title ----
  const title = `${dirty ? '*' : ''}${fileName} — Drawing Sheet Editor`;
  useEffect(() => {
    document.title = title;
  }, [title]);

  // ---- status bar (UpdateStatusBar) ----
  const unit = toggles.has('unitsInches') ? 'inches' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const toUser = useCallback(
    (iu: number): number => {
      const mm = iuToMM(iu);
      return unit === 'inches' ? mm / 25.4 : unit === 'mils' ? (mm / 25.4) * 1000 : mm;
    },
    [unit],
  );
  const fmt4 = (n: number): string => String(Number(n.toPrecision(4)));

  /** Origin corner in page IU + per-axis signs (ReturnCoordOriginCorner). */
  const originInfo = useMemo((): { origin: Vec2; xs: number; ys: number } => {
    const s = sheet.setup;
    const left = mmToIU(s.leftMargin),
      top = mmToIU(s.topMargin);
    const right = mmToIU(pageMM[0] - s.rightMargin),
      bottom = mmToIU(pageMM[1] - s.bottomMargin);
    switch (originChoice) {
      case 1:
        return { origin: { x: right, y: bottom }, xs: -1, ys: -1 };
      case 2:
        return { origin: { x: left, y: bottom }, xs: 1, ys: -1 };
      case 3:
        return { origin: { x: right, y: top }, xs: -1, ys: 1 };
      case 4:
        return { origin: { x: left, y: top }, xs: 1, ys: 1 };
      default:
        return { origin: { x: 0, y: 0 }, xs: 1, ys: 1 };
    }
  }, [sheet.setup, pageMM, originChoice]);

  const absCoord = cursor
    ? `X ${fmt4(toUser((cursor.x - originInfo.origin.x) * originInfo.xs))}  Y ${fmt4(
        toUser((cursor.y - originInfo.origin.y) * originInfo.ys),
      )}`
    : 'X —  Y —';
  const relCoord = cursor
    ? `dx ${fmt4(toUser((cursor.x - localOrigin.x) * originInfo.xs))}  dy ${fmt4(
        toUser((cursor.y - localOrigin.y) * originInfo.ys),
      )}`
    : 'dx —  dy —';

  // Grid: 1 mm in metric, 0.1 in imperial (about the pl_editor defaults).
  const gridIU = unit === 'mm' ? mmToIU(1) : mmToIU(2.54);
  const gridLabel = `grid ${unit === 'mm' ? '1.0000' : unit === 'inches' ? '0.100' : '100.0'}`;

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
            <b>
              {dirty ? '*' : ''}
              {fileName}
            </b>
            &nbsp;—&nbsp;Drawing Sheet Editor
          </>
        }
      />

      {/* Top toolbar + the origin / page selector combos. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <Toolbar
          entries={DS_TOP_TOOLBAR}
          orientation="horizontal"
          toggled={toggles}
          onActivate={onTopAction}
        />
        <span style={{ width: 10 }} />
        <select
          className="ze-select"
          value={originChoice}
          onChange={(e) => setOriginChoice(Number(e.target.value))}
          title="Origin of coordinates displayed to the status bar"
          style={{ margin: '0 6px' }}
        >
          {ORIGIN_CHOICES.map((c, i) => (
            <option key={c} value={i}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="ze-select"
          value={pageNumber}
          onChange={(e) => setPageNumber(Number(e.target.value))}
          title={
            'Simulate page 1 or other pages to show how items\nwhich are not on all page are displayed'
          }
          style={{ margin: '0 6px' }}
        >
          <option value={1}>Page 1</option>
          <option value={2}>Other pages</option>
        </select>
      </div>

      <div className="ze-body">
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
          blackBackground={blackBackground}
          editPoints={editPoints}
          moveMode={moveMode}
          onCursorMove={setCursor}
          onScaleChange={setScale}
          onSelect={onSelect}
          onSelectBox={onSelectBox}
          onMoveItems={moveSelection}
          onPlacePoint={onPlacePoint}
          onDrawFirst={onDrawFirst}
          onDrawMove={onDrawMove}
          onDrawSecond={onDrawSecond}
          onDeleteClick={onDeleteClick}
          onPointDrag={onPointDrag}
          onPointDragEnd={onPointDragEnd}
          onSetLocalOrigin={setLocalOrigin}
          onMoveDrop={(d) => {
            moveSelection(d);
            setMoveMode(false);
          }}
        />

        {/* Docked properties panel (properties_frame.cpp). */}
        <div className="ze-leftdock" style={{ width: 272, minWidth: 272 }}>
          <PropertiesFrame
            sheet={sheet}
            selectedIndex={selectedIndex}
            onItemChange={updateSelected}
            onSetupChange={updateSetup}
            onShowSyntaxHelp={() => setShowSyntaxHelp(true)}
          />
        </div>

        <Toolbar
          entries={DS_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={moveMode ? '' : activeTool}
          onActivate={onRightTool}
        />
      </div>

      {/* Status bar rows (UpdateStatusBar field order). */}
      <div className="ze-statusbar" style={{ gap: 18 }}>
        <span className="cell grow">{status}</span>
        {selection.size > 0 && (
          <span className="cell">
            <b>Selected</b> {selection.size}
          </span>
        )}
        <span className="cell">{paperDescription(preview)}</span>
        <span className="cell">{pageNumber === 1 ? 'Page 1' : 'Other pages'}</span>
      </div>
      <div className="ze-statusbar">
        <span className="cell">Z {scale > 0 ? (scale * 1000).toFixed(2) : '—'}</span>
        <span className="cell" data-testid="ds-coords">
          {absCoord}
        </span>
        <span className="cell">{relCoord}</span>
        <span className="cell">{gridLabel}</span>
        <span className="cell grow">coord origin: {ORIGIN_CHOICES[originChoice]}</span>
        <span className="cell">{unit}</span>
      </div>

      {showPageDialog && (
        <PageSettingsDialog
          value={preview}
          onCancel={() => setShowPageDialog(false)}
          onOk={(next) => {
            setPreview(next);
            setShowPageDialog(false);
            setStatus(`Page: ${paperDescription(next)}`);
            requestAnimationFrame(() => controller.current?.zoomToFit());
          }}
        />
      )}

      {showInspector && (
        <DesignInspector
          items={sheet.items}
          selection={selection}
          paperDescription={paperDescription(preview)}
          onClose={() => setShowInspector(false)}
          onSelect={(i) => {
            setSelection(new Set([i]));
            requestAnimationFrame(() => controller.current?.zoomToSelection());
          }}
        />
      )}

      {showSyntaxHelp && <SyntaxHelpDialog onClose={() => setShowSyntaxHelp(false)} />}

      {showPrefs && (
        <PreferencesDialog
          blackBackground={blackBackground}
          fullCrosshair={toggles.has('crosshairFull')}
          onBlackBackground={setBlackBackground}
          onFullCrosshair={(v) =>
            setToggles((prev) => {
              const next = new Set(prev);
              if (v) next.add('crosshairFull');
              else next.delete('crosshairFull');
              return next;
            })
          }
          onClose={() => setShowPrefs(false)}
        />
      )}
    </div>
  );
}

/**
 * Preferences — the display options `pl_editor` keeps in its settings
 * (pl_editor_settings.cpp `black_background`; common display options'
 * always-show-crosshairs).
 */
function PreferencesDialog({
  blackBackground,
  fullCrosshair,
  onBlackBackground,
  onFullCrosshair,
  onClose,
}: {
  blackBackground: boolean;
  fullCrosshair: boolean;
  onBlackBackground: (v: boolean) => void;
  onFullCrosshair: (v: boolean) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Preferences
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: '10px 14px', fontSize: 12, display: 'grid', gap: 8 }}>
          <label>
            <input
              type="checkbox"
              checked={blackBackground}
              onChange={(e) => onBlackBackground(e.target.checked)}
            />{' '}
            Use a black background
          </label>
          <label>
            <input
              type="checkbox"
              checked={fullCrosshair}
              onChange={(e) => onFullCrosshair(e.target.checked)}
            />{' '}
            Always show full-window crosshairs
          </label>
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
