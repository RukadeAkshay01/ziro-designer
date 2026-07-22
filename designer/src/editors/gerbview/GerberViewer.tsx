/**
 * The Gerber Viewer frame — the web mirror of GerbView's GERBVIEW_FRAME
 * (`gerbview/gerbview_frame.cpp`): the menu bar (`menubar.cpp`), the top / left
 * toolbars with the layer, DCode and highlight selectors
 * (`toolbars_gerber.cpp`), the docked Layers manager (GERBER_LAYER_WIDGET), the
 * canvas with its interactive tools (GerberCanvas), the List-DCodes dialog, and
 * the two status-bar rows with the coordinate readout
 * (GERBVIEW_FRAME::UpdateStatusBar).
 *
 * Files load through `readGerberOrDrill` (RS-274X Gerber or Excellon drill),
 * `.gbrjob` job files assign layer functions/colours, and zip archives expand
 * to individual layers — matching GerbView's File menu.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type JSX,
} from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Vec2 } from '@ziroeda/kimath';
import {
  readGerberOrDrill,
  parseJobFile,
  isExcellonFile,
  GERBER_DRAWLAYERS_COUNT,
  IU_PER_MM,
  type GERBER_FILE_IMAGE,
  type GERBER_DRAW_ITEM,
} from '@ziroeda/gerbview';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { GBR_TOP_TOOLBAR, GBR_LEFT_TOOLBAR, GBR_RIGHT_TOOLBAR } from './gerberToolbars.js';
import { GerberCanvas, type GerberCanvasController } from './GerberCanvas.js';
import { LayerManager, type LayerInfo } from './LayerManager.js';
import { DCodeListDialog, ItemInfoPanel } from './dialogs.js';
import { defaultLayerColor, GERBER_BG_COLOR } from './gerberColors.js';
import { exportLayersToPcb } from './exportToPcbnew.js';
import type { GerberLayerView, GerberRenderOptions } from './gerberRender.js';
import './gerbview.css';
import '../../ui/shell.css';

interface Layer {
  id: number;
  image: GERBER_FILE_IMAGE;
  color: string;
  visible: boolean;
  name: string;
  function?: string;
}

type HighlightMode = 'none' | 'net' | 'component' | 'attribute' | 'dcode';

const UNIT_GROUP = ['unitsMm', 'unitsInches', 'unitsMils'];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'showLayerManager']);
const HIGHLIGHT_COLOR = '#FFFFFF';

/** A stable, readable layer name from the image metadata / file name. */
function layerNameOf(image: GERBER_FILE_IMAGE, fileName: string): string {
  if (image.layerName) return image.layerName;
  if (image.fileFunction) return `${fileName} (${image.fileFunction.split(',')[0]})`;
  return fileName;
}

let layerIdSeq = 1;

export function GerberViewer({
  onExitToHome,
  projectName,
}: {
  onExitToHome: () => void;
  projectName?: string;
}): JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayer, setActiveLayer] = useState(0);
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [activeTool, setActiveTool] = useState<'select' | 'measure'>('select');
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('Ready — open a Gerber, drill, job or zip file');
  const [measure, setMeasure] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [picked, setPicked] = useState<GERBER_DRAW_ITEM | null>(null);
  const [showDcodeList, setShowDcodeList] = useState(false);
  const [highlight, setHighlight] = useState<{ mode: HighlightMode; value: string }>({
    mode: 'none',
    value: '',
  });

  const controller = useRef<GerberCanvasController>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const drillInputRef = useRef<HTMLInputElement>(null);
  const jobInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const unit: 'mm' | 'in' | 'mils' = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';

  // ---- loading -----------------------------------------------------------
  const addImage = useCallback((image: GERBER_FILE_IMAGE, fileName: string): void => {
    setLayers((prev) => {
      if (prev.length >= GERBER_DRAWLAYERS_COUNT) return prev;
      const id = layerIdSeq++;
      const next: Layer = {
        id,
        image,
        color: defaultLayerColor(prev.length),
        visible: true,
        name: layerNameOf(image, fileName),
        ...(image.fileFunction ? { function: image.fileFunction } : {}),
      };
      return [...prev, next];
    });
  }, []);

  const loadTextFile = useCallback(
    (name: string, text: string): void => {
      try {
        const image = readGerberOrDrill(text, name);
        if (image.items.length === 0) {
          setStatus(`No graphic items found in ${name}`);
        }
        addImage(image, name);
        setStatus(
          `Loaded ${name}: ${image.items.length} item${image.items.length === 1 ? '' : 's'}` +
            (isExcellonFile(text, name) ? ' (drill)' : ''),
        );
      } catch (err) {
        setStatus(`Failed to load ${name}: ${(err as Error).message}`);
      }
    },
    [addImage],
  );

  const loadFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const arr = Array.from(files);
      // Sort so a .gbrjob is processed last (it only re-colours), gerbers first.
      for (const f of arr) {
        const lower = f.name.toLowerCase();
        if (lower.endsWith('.zip')) {
          await loadZip(f);
        } else if (lower.endsWith('.gbrjob')) {
          applyJobFile(await f.text());
        } else {
          loadTextFile(f.name, await f.text());
        }
      }
    },
    [loadTextFile],
  );

  const loadZip = useCallback(
    async (file: File): Promise<void> => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(bytes);
        let jobText: string | null = null;
        const names = Object.keys(entries).sort();
        for (const name of names) {
          const base = name.split('/').pop() ?? name;
          if (base.startsWith('.') || name.endsWith('/')) continue;
          const lower = base.toLowerCase();
          const text = strFromU8(entries[name]!);
          if (lower.endsWith('.gbrjob')) {
            jobText = text;
            continue;
          }
          loadTextFile(base, text);
        }
        if (jobText) applyJobFile(jobText);
        setStatus(`Loaded archive ${file.name}`);
      } catch (err) {
        setStatus(`Failed to open ${file.name}: ${(err as Error).message}`);
      }
    },
    [loadTextFile],
  );

  const applyJobFile = useCallback((text: string): void => {
    const entries = parseJobFile(text);
    if (entries.length === 0) return;
    setLayers((prev) =>
      prev.map((l) => {
        const base = l.image.fileName.split('/').pop() ?? l.image.fileName;
        const match = entries.find((e) => (e.path.split('/').pop() ?? e.path) === base);
        if (match)
          return {
            ...l,
            function: match.fileFunction,
            name: `${base} (${match.fileFunction.split(',')[0]})`,
          };
        return l;
      }),
    );
    setStatus('Applied job file layer assignments');
  }, []);

  // ---- layer management --------------------------------------------------
  const clearAll = useCallback(() => {
    setLayers([]);
    setActiveLayer(0);
    setPicked(null);
    setHighlight({ mode: 'none', value: '' });
    setStatus('Cleared all layers');
  }, []);

  const toggleVisible = useCallback((index: number) => {
    setLayers((prev) => prev.map((l, i) => (i === index ? { ...l, visible: !l.visible } : l)));
  }, []);
  const setColor = useCallback((index: number, color: string) => {
    setLayers((prev) => prev.map((l, i) => (i === index ? { ...l, color } : l)));
  }, []);
  const showAll = useCallback(
    () => setLayers((prev) => prev.map((l) => ({ ...l, visible: true }))),
    [],
  );
  const hideAll = useCallback(
    () => setLayers((prev) => prev.map((l) => ({ ...l, visible: false }))),
    [],
  );
  const deleteLayer = useCallback((index: number) => {
    setLayers((prev) => prev.filter((_, i) => i !== index));
    setActiveLayer((a) => (a >= index && a > 0 ? a - 1 : a));
  }, []);
  const moveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setLayers((prev) => {
      const next = prev.slice();
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      return next;
    });
    setActiveLayer((a) => (a === index ? a - 1 : a === index - 1 ? a + 1 : a));
  }, []);
  const moveDown = useCallback((index: number) => {
    setLayers((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = prev.slice();
      [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
      return next;
    });
    setActiveLayer((a) => (a === index ? a + 1 : a === index + 1 ? a - 1 : a));
  }, []);

  // ---- render options ----------------------------------------------------
  const activeImage = layers[activeLayer]?.image ?? null;

  const highlightTest = useMemo<((it: GERBER_DRAW_ITEM) => boolean) | undefined>(() => {
    if (highlight.mode === 'none' || !highlight.value) return undefined;
    const v = highlight.value;
    switch (highlight.mode) {
      case 'net':
        return (it) => it.netMetadata.netName === v;
      case 'component':
        return (it) => it.netMetadata.componentRef === v;
      case 'attribute':
        return (it) =>
          (it.netMetadata.apertureAttributes ?? []).some((a) => a.includes(v)) ||
          (it.netMetadata.objectAttributes ?? []).some((a) => a.includes(v));
      case 'dcode':
        return (it) => it.dcodeNum === Number(v);
      default:
        return undefined;
    }
  }, [highlight]);

  const options = useMemo<GerberRenderOptions>(
    () => ({
      flashedSketch: toggles.has('flashedSketch'),
      linesSketch: toggles.has('linesSketch'),
      polygonsSketch: toggles.has('polygonsSketch'),
      showNegativeObjects: toggles.has('showNegativeObjects'),
      showDcodes: toggles.has('showDcodes'),
      diffMode: toggles.has('diffMode'),
      highContrast: toggles.has('highContrast'),
      activeLayer,
      flipView: toggles.has('flipView'),
      background: GERBER_BG_COLOR,
      ...(highlightTest ? { highlightTest, highlightColor: HIGHLIGHT_COLOR } : {}),
    }),
    [toggles, activeLayer, highlightTest],
  );

  // Draw order: active layer last (drawn on top), like GerbView.
  const renderLayers = useMemo<GerberLayerView[]>(() => {
    const others = layers.filter((_, i) => i !== activeLayer);
    const act = layers[activeLayer];
    const ordered = act ? [...others, act] : others;
    return ordered.map((l) => ({ image: l.image, color: l.color, visible: l.visible }));
  }, [layers, activeLayer]);

  const bbox = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let any = false;
    for (const l of layers) {
      if (!l.visible || l.image.items.length === 0) continue;
      const b = l.image.computeBoundingBox();
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
      any = true;
    }
    return any ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }, [layers]);

  // ---- toolbars ----------------------------------------------------------
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

  const exportToPcb = useCallback(() => {
    const visible = layers.filter((l) => l.visible && l.image.items.length > 0);
    if (visible.length === 0) {
      setStatus('Nothing to export — no visible layers with content');
      return;
    }
    const text = exportLayersToPcb(visible.map((l) => ({ image: l.image, name: l.name })));
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'gerber_export'}.kicad_pcb`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${visible.length} layer(s) to Pcbnew board file`);
  }, [layers, projectName]);

  const reloadAll = useCallback(() => {
    setLayers((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((l) => {
        if (!l.image.rawText) return l;
        try {
          const image = readGerberOrDrill(l.image.rawText, l.image.fileName);
          return { ...l, image };
        } catch {
          return l;
        }
      });
    });
    setStatus('Reloaded all layers');
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'gerbOpen':
          openInputRef.current?.click();
          break;
        case 'gerbOpenDrill':
          drillInputRef.current?.click();
          break;
        case 'gerbOpenJob':
          jobInputRef.current?.click();
          break;
        case 'gerbOpenZip':
          zipInputRef.current?.click();
          break;
        case 'gerbClear':
          clearAll();
          break;
        case 'gerbReload':
          reloadAll();
          break;
        case 'gerbExportToPcb':
          exportToPcb();
          break;
        case 'print':
          printLayers();
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
          controller.current?.zoomToFit();
          break;
        default:
          break;
      }
    },
    [clearAll, exportToPcb, reloadAll],
  );

  const onRightTool = useCallback((id: string) => {
    if (id === 'measure') setActiveTool('measure');
    else setActiveTool('select');
  }, []);

  // ---- print -------------------------------------------------------------
  const printLayers = useCallback(() => {
    const canvasEls = document.querySelectorAll('.ze-gbr-canvas-host canvas');
    const src = canvasEls[0] as HTMLCanvasElement | undefined;
    if (!src) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(
      `<title>${projectName || 'Gerber'}</title><img src="${src.toDataURL('image/png')}" style="width:100%" onload="window.print()">`,
    );
    w.document.close();
  }, [projectName]);

  // ---- keyboard ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'gerber') !== 'gerber') return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openInputRef.current?.click();
      } else if (e.key === 'Home') {
        controller.current?.zoomToFit();
      } else if (e.key === 'm' || e.key === 'M') {
        setActiveTool('measure');
      } else if (e.key === 'Escape') {
        setActiveTool('select');
        setPicked(null);
      } else if (e.key === '+' || e.key === '=') {
        controller.current?.zoomIn();
      } else if (e.key === '-') {
        controller.current?.zoomOut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- highlight option lists (from active image) ------------------------
  const highlightOptions = useMemo(() => {
    const nets = new Set<string>();
    const comps = new Set<string>();
    const attrs = new Set<string>();
    const dcodes = new Set<number>();
    if (activeImage) {
      for (const it of activeImage.items) {
        if (it.netMetadata.netName) nets.add(it.netMetadata.netName);
        if (it.netMetadata.componentRef) comps.add(it.netMetadata.componentRef);
        for (const a of it.netMetadata.apertureAttributes ?? []) attrs.add(a);
        if (it.dcodeNum) dcodes.add(it.dcodeNum);
      }
    }
    return {
      nets: [...nets].sort(),
      comps: [...comps].sort(),
      attrs: [...attrs].sort(),
      dcodes: [...dcodes].sort((a, b) => a - b),
    };
  }, [activeImage]);

  // ---- menus -------------------------------------------------------------
  const menus: Menu[] = useMemo(
    () => [
      {
        label: 'File',
        items: [
          {
            label: 'Open Gerber File(s)…',
            icon: 'gerbOpen',
            action: () => openInputRef.current?.click(),
            shortcut: 'Ctrl+O',
          },
          {
            label: 'Open Excellon Drill File(s)…',
            icon: 'gerbOpenDrill',
            action: () => drillInputRef.current?.click(),
          },
          {
            label: 'Open Gerber Job File…',
            icon: 'gerbOpenJob',
            action: () => jobInputRef.current?.click(),
          },
          {
            label: 'Open Zip Archive…',
            icon: 'gerbOpenZip',
            action: () => zipInputRef.current?.click(),
          },
          { sep: true },
          { label: 'Export to Pcbnew…', icon: 'gerbExportToPcb', action: exportToPcb },
          { label: 'Print…', icon: 'print', action: printLayers },
          { sep: true },
          { label: 'Clear All Layers', icon: 'gerbClear', action: clearAll },
          { label: 'Close Gerber Viewer', action: onExitToHome },
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
          { label: 'Redraw View', icon: 'zoomRedraw', action: () => controller.current?.redraw() },
          { sep: true },
          {
            label: 'Show Grid',
            checked: toggles.has('toggleGrid'),
            action: () => onLeftToggle('toggleGrid'),
          },
          {
            label: 'Flip View',
            checked: toggles.has('flipView'),
            action: () => onLeftToggle('flipView'),
          },
          {
            label: 'Show Layers Manager',
            checked: toggles.has('showLayerManager'),
            action: () => onLeftToggle('showLayerManager'),
          },
        ],
      },
      {
        label: 'Preferences',
        items: [
          {
            label: 'Flashed Items Sketch Mode',
            checked: toggles.has('flashedSketch'),
            action: () => onLeftToggle('flashedSketch'),
          },
          {
            label: 'Lines Sketch Mode',
            checked: toggles.has('linesSketch'),
            action: () => onLeftToggle('linesSketch'),
          },
          {
            label: 'Polygons Sketch Mode',
            checked: toggles.has('polygonsSketch'),
            action: () => onLeftToggle('polygonsSketch'),
          },
          {
            label: 'Show DCode Numbers',
            checked: toggles.has('showDcodes'),
            action: () => onLeftToggle('showDcodes'),
          },
          {
            label: 'Show Negative Objects',
            checked: toggles.has('showNegativeObjects'),
            action: () => onLeftToggle('showNegativeObjects'),
          },
          {
            label: 'Differential Mode',
            checked: toggles.has('diffMode'),
            action: () => onLeftToggle('diffMode'),
          },
          {
            label: 'High Contrast Mode',
            checked: toggles.has('highContrast'),
            action: () => onLeftToggle('highContrast'),
          },
        ],
      },
      {
        label: 'Tools',
        items: [
          { label: 'Measure', icon: 'gerbMeasure', action: () => setActiveTool('measure') },
          { label: 'List DCodes…', icon: 'gerbDcodeList', action: () => setShowDcodeList(true) },
          {
            label: 'Clear Highlight',
            action: () => setHighlight({ mode: 'none', value: '' }),
          },
        ],
      },
    ],
    [toggles, onLeftToggle, exportToPcb, clearAll, onExitToHome, printLayers],
  );

  // ---- layer manager info ------------------------------------------------
  const layerInfos: LayerInfo[] = layers.map((l, i) => ({
    index: i,
    name: l.name,
    color: l.color,
    visible: l.visible,
    hasContent: l.image.items.length > 0,
    ...(l.function ? { function: l.function } : {}),
  }));

  const renderToggles = {
    grid: toggles.has('toggleGrid'),
    dcodes: toggles.has('showDcodes'),
    negativeObjects: toggles.has('showNegativeObjects'),
    background: !toggles.has('hideBackground'),
  };
  const onRenderToggle = useCallback(
    (id: string) => {
      if (id === 'grid') onLeftToggle('toggleGrid');
      else if (id === 'dcodes') onLeftToggle('showDcodes');
      else if (id === 'negativeObjects') onLeftToggle('showNegativeObjects');
      else if (id === 'background') onLeftToggle('hideBackground');
    },
    [onLeftToggle],
  );

  // ---- status bar --------------------------------------------------------
  const fmtCoord = useCallback(
    (iu: number): string => {
      const mm = iu / IU_PER_MM;
      if (unit === 'mm') return mm.toFixed(4);
      if (unit === 'in') return (mm / 25.4).toFixed(5);
      return ((mm / 25.4) * 1000).toFixed(2);
    },
    [unit],
  );

  const polar = toggles.has('togglePolar');
  const coordText = cursor
    ? polar
      ? `r ${fmtCoord(Math.hypot(cursor.x, cursor.y))}  θ ${((Math.atan2(cursor.y, cursor.x) * 180) / Math.PI).toFixed(1)}°`
      : `X ${fmtCoord(cursor.x)}  Y ${fmtCoord(cursor.y)}`
    : 'X —  Y —';

  const measureText = measure
    ? (() => {
        const dx = measure.b.x - measure.a.x;
        const dy = measure.b.y - measure.a.y;
        const dist = Math.hypot(dx, dy);
        return `dist ${fmtCoord(dist)}  dx ${fmtCoord(dx)}  dy ${fmtCoord(dy)}`;
      })()
    : '';

  const unitLabel = unit === 'mm' ? 'mm' : unit === 'in' ? 'in' : 'mils';

  // Grid step: 1 mm metric, 0.1" imperial.
  const gridIU = unit === 'mm' ? IU_PER_MM : IU_PER_MM * 2.54;

  useEffect(() => {
    document.title = `Gerber Viewer${layers.length ? ` — ${layers.length} layer(s)` : ''}`;
  }, [layers.length]);

  const onDrop = useCallback(
    (e: ReactDragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) void loadFiles(e.dataTransfer.files);
    },
    [loadFiles],
  );

  return (
    <div
      className="ze-app"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      <input
        ref={openInputRef}
        type="file"
        accept=".gbr,.ger,.gtl,.gbl,.gto,.gbo,.gts,.gbs,.gtp,.gbp,.gko,.gm1,.pho,.art,.gbx,.rs274x,.x,.g*,text/plain"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void loadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={drillInputRef}
        type="file"
        accept=".drl,.nc,.xln,.txt,.tap,.drd"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void loadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={jobInputRef}
        type="file"
        accept=".gbrjob,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(applyJobFile);
          e.target.value = '';
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadZip(f);
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
            <b>{projectName || 'Gerber Viewer'}</b>
            &nbsp;—&nbsp;Gerber Viewer
          </>
        }
      />

      {/* Top toolbar + layer / DCode / highlight selectors. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <Toolbar entries={GBR_TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />
        <span style={{ width: 10 }} />
        <label className="ze-gbr-combo">
          Layer:
          <select
            className="ze-select"
            value={activeLayer}
            onChange={(e) => setActiveLayer(Number(e.target.value))}
          >
            {layers.length === 0 && <option value={0}>—</option>}
            {layers.map((l, i) => (
              <option key={l.id} value={i}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ze-gbr-combo">
          DCode:
          <select
            className="ze-select"
            value={highlight.mode === 'dcode' ? highlight.value : ''}
            onChange={(e) =>
              setHighlight(
                e.target.value
                  ? { mode: 'dcode', value: e.target.value }
                  : { mode: 'none', value: '' },
              )
            }
          >
            <option value="">All</option>
            {highlightOptions.dcodes.map((d) => (
              <option key={d} value={d}>
                D{d}
              </option>
            ))}
          </select>
        </label>
        <label className="ze-gbr-combo">
          Net:
          <select
            className="ze-select"
            value={highlight.mode === 'net' ? highlight.value : ''}
            onChange={(e) =>
              setHighlight(
                e.target.value
                  ? { mode: 'net', value: e.target.value }
                  : { mode: 'none', value: '' },
              )
            }
            disabled={highlightOptions.nets.length === 0}
          >
            <option value="">—</option>
            {highlightOptions.nets.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="ze-gbr-combo">
          Comp:
          <select
            className="ze-select"
            value={highlight.mode === 'component' ? highlight.value : ''}
            onChange={(e) =>
              setHighlight(
                e.target.value
                  ? { mode: 'component', value: e.target.value }
                  : { mode: 'none', value: '' },
              )
            }
            disabled={highlightOptions.comps.length === 0}
          >
            <option value="">—</option>
            {highlightOptions.comps.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ze-body">
        <Toolbar
          entries={GBR_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <div className="ze-gbr-canvas-host" style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <GerberCanvas
            ref={controller}
            layers={renderLayers}
            options={options}
            bbox={bbox}
            showGrid={toggles.has('toggleGrid')}
            gridIU={gridIU}
            fullCrosshair={toggles.has('crosshairFull')}
            activeTool={activeTool}
            onCursorMove={setCursor}
            onScaleChange={setScale}
            onMeasure={setMeasure}
            onPick={(it) => setPicked(it)}
          />
        </div>

        {toggles.has('showLayerManager') && (
          <div className="ze-rightdock ze-gbr-dock">
            <LayerManager
              layers={layerInfos}
              activeLayer={activeLayer}
              onSetActive={setActiveLayer}
              onToggleVisible={toggleVisible}
              onSetColor={setColor}
              onShowAll={showAll}
              onHideAll={hideAll}
              onDelete={deleteLayer}
              onMoveUp={moveUp}
              onMoveDown={moveDown}
              renderToggles={renderToggles}
              onRenderToggle={onRenderToggle}
            />
          </div>
        )}

        <Toolbar
          entries={GBR_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onRightTool}
        />
      </div>

      {/* Item inspector row (message panel). */}
      {picked && (
        <div className="ze-gbr-msgpanel">
          <ItemInfoPanel item={picked} unit={unit} />
        </div>
      )}

      {/* Status bar rows. */}
      <div className="ze-statusbar" style={{ gap: 18 }}>
        <span className="cell grow">{status}</span>
        <span className="cell">
          {layers.length} layer{layers.length === 1 ? '' : 's'}
        </span>
        {highlight.mode !== 'none' && (
          <span className="cell">
            Highlight: {highlight.mode} {highlight.value}
          </span>
        )}
      </div>
      <div className="ze-statusbar">
        <span className="cell">Z {scale > 0 ? (scale * 1e6).toFixed(1) : '—'}</span>
        <span className="cell" data-testid="gbr-coords">
          {coordText}
        </span>
        {measureText && <span className="cell">{measureText}</span>}
        <span className="cell grow">
          {activeTool === 'measure' ? 'Measure tool' : 'Select tool'}
        </span>
        <span className="cell">{unitLabel}</span>
      </div>

      {showDcodeList && (
        <DCodeListDialog image={activeImage} unit={unit} onClose={() => setShowDcodeList(false)} />
      )}
    </div>
  );
}
