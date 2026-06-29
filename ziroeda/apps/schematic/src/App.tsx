import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parse, readSchematic, serializeSchematic, iuToMM, deleteByIds, History, type Schematic, type LibSymbol, type EditCommand, type Vec2 } from '@ziroeda/core';
import { SchematicCanvas, type CanvasController, type LineMode } from './components/SchematicCanvas.js';
import { Toolbar } from './ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR, MENUS } from './ui/toolbars.js';
import { SymbolChooser } from './components/SymbolChooser.js';
import { HomePage } from './HomePage.js';
import './ui/shell.css';
import sampleText from './sample.kicad_sch?raw';

const PROJECT_NAME = 'RoyalBlue54L-NFC-Antenna';

const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'crosshairFull', 'lineMode90', 'showHierarchy', 'showProperties']);
const PX_PER_MM_100 = 3.7795;

// KiCad's Selection Filter categories, laid out in two columns (row-major).
const FILTER_CATS: [string, string][] = [
  ['symbols', 'Symbols'], ['pins', 'Pins'],
  ['wires', 'Wires'], ['labels', 'Labels'],
  ['graphics', 'Graphics'], ['images', 'Images'],
  ['text', 'Text'], ['other', 'Other items'],
];

function SchematicEditor({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
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
  const [placeLib, setPlaceLib] = useState<LibSymbol | null>(null);
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [selFilter, setSelFilter] = useState<Set<string>>(new Set(FILTER_CATS.map((c) => c[0])));
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

  const runCommand = useCallback((cmd: EditCommand) => {
    setDoc((d) => (d ? history.current.execute(d, cmd) : d));
  }, []);

  const undo = useCallback(() => setDoc((d) => (d ? history.current.undo(d) ?? d : d)), []);
  const redo = useCallback(() => setDoc((d) => (d ? history.current.redo(d) ?? d : d)), []);

  const save = useCallback(() => {
    setDoc((d) => {
      if (!d) return d;
      const text = serializeSchematic(d);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${d.titleBlock?.title ?? 'schematic'}.kicad_sch`;
      a.click();
      URL.revokeObjectURL(url);
      return d;
    });
  }, []);

  const lineMode: LineMode = toggles.has('lineModeFree') ? 'free' : toggles.has('lineMode45') ? '45' : '90';

  const onTopAction = useCallback((id: string) => {
    if (id === 'zoomFit' || id === 'zoomFitObjects') controller.current?.zoomToFit();
    else if (id === 'zoomIn') controller.current?.zoomIn();
    else if (id === 'zoomOut') controller.current?.zoomOut();
    else if (id === 'undo') undo();
    else if (id === 'redo') redo();
    else if (id === 'save') save();
  }, [undo, redo, save]);

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
        if (activeTool !== 'select') { setActiveTool('select'); setPlaceLib(null); }
        else setSelection(new Set());
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        e.preventDefault();
        runCommand(deleteByIds(selection));
        setSelection(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, selection, runCommand, activeTool]);

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
        <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">⌂ ZiroEDA</div>
        {MENUS.map((m) => <div key={m} className="ze-menu">{m}</div>)}
      </div>

      <Toolbar entries={TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />

      <div className="ze-body">
        {activeTool === 'placeSymbol' ? (
          <SymbolChooser onPick={setPlaceLib} currentId={placeLib?.libId ?? null} />
        ) : (
          <div className="ze-leftdock">
            <div className="ze-panel grow">
              <div className="ze-panel-header">Properties</div>
              <div className="ze-panel-body">
                <div className="ze-muted">{selection.size === 0 ? 'No objects selected' : `${selection.size} item(s) selected`}</div>
              </div>
            </div>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Schematic Hierarchy</div>
              <div className="ze-panel-body"><div className="ze-tree-item active">📄 {title} (page 1)</div></div>
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
        )}

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
            onSelect={onSelect}
            onCommand={runCommand}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
        </div>

        <Toolbar entries={RIGHT_TOOLBAR} orientation="vertical" side="right" activeTool={activeTool} onActivate={setActiveTool} />
      </div>

      <div className="ze-statusbar">
        <span className="cell">Z {Number.isFinite(zoomPct) ? (zoomPct / 100).toFixed(2) : '1.00'}</span>
        <span className="cell">X {cursor ? fmt(cursor.x) : '—'}  Y {cursor ? fmt(cursor.y) : '—'}</span>
        <span className="cell">
          dx {cursor ? fmt(cursor.x) : '—'}  dy {cursor ? fmt(cursor.y) : '—'}  dist {cursor ? fmt(Math.hypot(cursor.x, cursor.y)) : '—'}
        </span>
        <span className="cell">grid {units === 'mm' ? '1.2700' : units === 'mils' ? '50' : '0.0500'}</span>
        <span className="cell grow">{units}</span>
      </div>
    </div>
  );
}

/** Top-level app: the KiCad-style project manager, then the schematic editor. */
export function App(): JSX.Element {
  const [view, setView] = useState<'home' | 'schematic'>('home');
  return view === 'home' ? (
    <HomePage projectName={PROJECT_NAME} onOpenSchematic={() => setView('schematic')} />
  ) : (
    <SchematicEditor onExitToHome={() => setView('home')} />
  );
}
