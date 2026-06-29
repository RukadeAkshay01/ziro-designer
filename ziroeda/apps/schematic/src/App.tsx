import { useMemo, useRef, useState, useCallback } from 'react';
import { parse, readSchematic, iuToMM, type Schematic } from '@ziroeda/core';
import { SchematicCanvas, type CanvasController } from './components/SchematicCanvas.js';
import { Toolbar } from './ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR, MENUS } from './ui/toolbars.js';
import './ui/shell.css';
import sampleText from './sample.kicad_sch?raw';

// Left-toolbar buttons that behave as mutually-exclusive radio groups.
const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'crosshairFull', 'lineMode90', 'showHierarchy', 'showProperties']);

// 100% zoom reference: 1 mm ≈ 3.7795 CSS px at 96 dpi.
const PX_PER_MM_100 = 3.7795;

export function App(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const schematic = useMemo<Schematic | null>(() => {
    try {
      return readSchematic(parse(sampleText));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const controller = useRef<CanvasController>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const onTopAction = useCallback((id: string) => {
    if (id === 'zoomFit' || id === 'zoomFitObjects') controller.current?.zoomToFit();
    else if (id === 'zoomIn') controller.current?.zoomIn();
    else if (id === 'zoomOut') controller.current?.zoomOut();
  }, []);

  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) => {
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

  const units = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (units === 'mm') return `${mm.toFixed(4)}`;
    if (units === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
    return `${(mm / 25.4).toFixed(4)}`;
  };
  const zoomPct = Math.round((scale * 10000 * dpr) / PX_PER_MM_100 * 100);

  if (error) return <pre style={{ color: 'crimson', padding: 16 }}>Failed to load schematic: {error}</pre>;
  if (!schematic) return <div style={{ padding: 16 }}>Loading…</div>;

  const title = schematic.titleBlock?.title ?? 'Root';

  return (
    <div className="ze-app">
      <div className="ze-menubar">
        {MENUS.map((m) => (
          <div key={m} className="ze-menu">{m}</div>
        ))}
      </div>

      <Toolbar entries={TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />

      <div className="ze-body">
        <Toolbar entries={LEFT_TOOLBAR} orientation="vertical" side="left" toggled={toggles} onActivate={onLeftToggle} />

        {toggles.has('showHierarchy') && (
          <div className="ze-panel left">
            <div className="ze-panel-header">Schematic Hierarchy</div>
            <div className="ze-panel-body">
              <div className="ze-tree-item active">📄 {title}</div>
            </div>
          </div>
        )}

        <div className="ze-canvas-wrap">
          <SchematicCanvas
            ref={controller}
            schematic={schematic}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
        </div>

        {toggles.has('showProperties') && (
          <div className="ze-panel right">
            <div className="ze-panel-header">Properties</div>
            <div className="ze-panel-body">
              <div className="ze-prop-row"><span className="k">Paper</span><span className="v">{schematic.paper ?? '—'}</span></div>
              <div className="ze-prop-row"><span className="k">Symbols</span><span className="v">{schematic.symbols.length}</span></div>
              <div className="ze-prop-row"><span className="k">Wires</span><span className="v">{schematic.lines.length}</span></div>
              <div className="ze-prop-row"><span className="k">Junctions</span><span className="v">{schematic.junctions.length}</span></div>
              <div className="ze-prop-row"><span className="k">Labels</span><span className="v">{schematic.labels.length}</span></div>
              <div className="ze-prop-row"><span className="k">Lib symbols</span><span className="v">{schematic.libSymbols.length}</span></div>
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
        <span className="cell grow">{schematic.symbols.length} symbol(s) · {schematic.lines.length} wire(s) — drag to pan, scroll to zoom</span>
      </div>
    </div>
  );
}
