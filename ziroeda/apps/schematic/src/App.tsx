import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parse, readSchematic, iuToMM, moveWithConnections, History, type Schematic, type LibSymbol, type MoveSpec, type Vec2 } from '@ziroeda/core';
import { SchematicCanvas, type CanvasController } from './components/SchematicCanvas.js';
import { Toolbar } from './ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR, MENUS } from './ui/toolbars.js';
import './ui/shell.css';
import sampleText from './sample.kicad_sch?raw';

const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'crosshairFull', 'lineMode90', 'showHierarchy', 'showProperties']);
const PX_PER_MM_100 = 3.7795;

export function App(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo<Schematic | null>(() => {
    try {
      return readSchematic(parse(sampleText));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const [doc, setDoc] = useState<Schematic | null>(initial);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const history = useRef(new History());
  const controller = useRef<CanvasController>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(1);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const libById = useMemo<Map<string, LibSymbol>>(
    () => new Map((doc?.libSymbols ?? []).map((l) => [l.libId, l])),
    [doc?.libSymbols],
  );

  const onSelect = useCallback((id: string | null, additive: boolean) => {
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

  const onMove = useCallback((spec: MoveSpec, delta: Vec2) => {
    setDoc((d) => (d ? history.current.execute(d, moveWithConnections(spec, delta)) : d));
  }, []);

  const undo = useCallback(() => setDoc((d) => (d ? history.current.undo(d) ?? d : d)), []);
  const redo = useCallback(() => setDoc((d) => (d ? history.current.redo(d) ?? d : d)), []);

  const onTopAction = useCallback((id: string) => {
    if (id === 'zoomFit' || id === 'zoomFitObjects') controller.current?.zoomToFit();
    else if (id === 'zoomIn') controller.current?.zoomIn();
    else if (id === 'zoomOut') controller.current?.zoomOut();
    else if (id === 'undo') undo();
    else if (id === 'redo') redo();
  }, [undo, redo]);

  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) => {
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        setSelection(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const units = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (units === 'mm') return `${mm.toFixed(4)}`;
    if (units === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
    return `${(mm / 25.4).toFixed(4)}`;
  };
  const zoomPct = Math.round((scale * 10000 * dpr) / PX_PER_MM_100 * 100);

  if (error) return <pre style={{ color: 'crimson', padding: 16 }}>Failed to load schematic: {error}</pre>;
  if (!doc) return <div style={{ padding: 16 }}>Loading…</div>;

  const title = doc.titleBlock?.title ?? 'Root';

  return (
    <div className="ze-app">
      <div className="ze-menubar">
        {MENUS.map((m) => <div key={m} className="ze-menu">{m}</div>)}
      </div>

      <Toolbar entries={TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />

      <div className="ze-body">
        <Toolbar entries={LEFT_TOOLBAR} orientation="vertical" side="left" toggled={toggles} onActivate={onLeftToggle} />

        {toggles.has('showHierarchy') && (
          <div className="ze-panel left">
            <div className="ze-panel-header">Schematic Hierarchy</div>
            <div className="ze-panel-body"><div className="ze-tree-item active">📄 {title}</div></div>
          </div>
        )}

        <div className="ze-canvas-wrap">
          <SchematicCanvas
            ref={controller}
            schematic={doc}
            libById={libById}
            selection={selection}
            onSelect={onSelect}
            onMove={onMove}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
        </div>

        {toggles.has('showProperties') && (
          <div className="ze-panel right">
            <div className="ze-panel-header">Properties</div>
            <div className="ze-panel-body">
              <div className="ze-prop-row"><span className="k">Selected</span><span className="v">{selection.size}</span></div>
              <div className="ze-prop-row"><span className="k">Paper</span><span className="v">{doc.paper ?? '—'}</span></div>
              <div className="ze-prop-row"><span className="k">Symbols</span><span className="v">{doc.symbols.length}</span></div>
              <div className="ze-prop-row"><span className="k">Wires</span><span className="v">{doc.lines.length}</span></div>
              <div className="ze-prop-row"><span className="k">Junctions</span><span className="v">{doc.junctions.length}</span></div>
              <div className="ze-prop-row"><span className="k">Labels</span><span className="v">{doc.labels.length}</span></div>
            </div>
          </div>
        )}

        <Toolbar entries={RIGHT_TOOLBAR} orientation="vertical" side="right" activeTool={activeTool} onActivate={setActiveTool} />
      </div>

      <div className="ze-statusbar">
        <span className="cell">X {cursor ? fmt(cursor.x) : '—'}</span>
        <span className="cell">Y {cursor ? fmt(cursor.y) : '—'}</span>
        <span className="cell">grid {units === 'mm' ? '1.2700' : units === 'mils' ? '50.00' : '0.0500'} {units}</span>
        <span className="cell">{units}</span>
        <span className="cell">Z {Number.isFinite(zoomPct) ? zoomPct : 100}%</span>
        <span className="cell grow">{selection.size > 0 ? `${selection.size} selected — drag to move, Ctrl+Z to undo` : 'click to select · drag to move · scroll to zoom'}</span>
      </div>
    </div>
  );
}
