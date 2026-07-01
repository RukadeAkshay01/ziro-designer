import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parse, readSchematic, serializeSchematic, iuToMM, deleteByIds, transformItems, computeNetlist, withCleanup, History, type Schematic, type LibSymbol, type EditCommand, type Vec2, type TransformOp, type LabelKind, type LabelShape } from '@ziroeda/core';
import { SchematicCanvas, type CanvasController, type LineMode, type PendingLabel } from './components/SchematicCanvas.js';
import { LabelDialog } from './components/LabelDialog.js';
import { Toolbar } from './ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR } from './ui/toolbars.js';
import { MenuBar } from './ui/MenuBar.js';
import { buildMenus, TOOL_HOTKEYS } from './ui/menus.js';
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
  // The item whose net is highlighted by the Highlight-Net tool (KiCad's
  // m_highlightedConn). Distinct from selection: plain selection is never a net
  // highlight in KiCad; it's the explicit highlight action that brightens a net.
  const [highlightItem, setHighlightItem] = useState<string | null>(null);
  const history = useRef(new History());
  const controller = useRef<CanvasController>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [placeLib, setPlaceLib] = useState<LibSymbol | null>(null);
  const [pendingLabel, setPendingLabel] = useState<PendingLabel | null>(null);
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [selFilter, setSelFilter] = useState<Set<string>>(new Set(FILTER_CATS.map((c) => c[0])));
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(1);
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

  // Every edit runs through KiCad's post-commit cleanup (colinear wire merge),
  // as part of the same undoable step (SCHEMATIC::CleanUp / RecalculateConnections).
  const runCommand = useCallback((cmd: EditCommand) => {
    setDoc((d) => (d ? history.current.execute(d, withCleanup(cmd)) : d));
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
    else if (id === 'save') save();
    else if (TX[id]) setSelection((sel) => { if (sel.size > 0) runCommand(transformItems(sel, TX[id]!)); return sel; });
  }, [undo, redo, save, runCommand]);

  const menus = useMemo(() => buildMenus({ tool: onToolSelect, action: onTopAction }), [onToolSelect, onTopAction]);

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
        if (pendingLabel) { setPendingLabel(null); setActiveTool('select'); }
        else if (activeTool !== 'select') { setActiveTool('select'); setPlaceLib(null); }
        else setSelection(new Set());
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        e.preventDefault();
        runCommand(deleteByIds(selection));
        setSelection(new Set());
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // KiCad single-key tool hotkeys (A=symbol, W=wire, …). Skip while typing.
        const tgt = e.target as HTMLElement | null;
        const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
        const toolId = TOOL_HOTKEYS[e.key.toLowerCase()];
        if (!typing && toolId) { e.preventDefault(); onToolSelect(toolId); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, selection, runCommand, activeTool, onToolSelect, pendingLabel]);

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
            onSelect={onSelect}
            onHighlight={onHighlight}
            onRequestTool={onToolSelect}
            onCommand={runCommand}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
        </div>

        <Toolbar entries={RIGHT_TOOLBAR} orientation="vertical" side="right" activeTool={activeTool} onActivate={onToolSelect} />
      </div>

      <div className="ze-statusbar">
        <span className="cell">Z {Number.isFinite(zoomPct) ? (zoomPct / 100).toFixed(2) : '1.00'}</span>
        <span className="cell">X {cursor ? fmt(cursor.x) : '—'}  Y {cursor ? fmt(cursor.y) : '—'}</span>
        <span className="cell">
          dx {cursor ? fmt(cursor.x) : '—'}  dy {cursor ? fmt(cursor.y) : '—'}  dist {cursor ? fmt(Math.hypot(cursor.x, cursor.y)) : '—'}
        </span>
        <span className="cell">grid {units === 'mm' ? '1.2700' : units === 'mils' ? '50' : '0.0500'}</span>
        <span className="cell">{highlightName ? `Net: ${highlightName}` : ''}</span>
        <span className="cell grow">{units}</span>
        <span className="cell" title="build">{__BUILD_STAMP__}</span>
      </div>

      {(activeTool === 'placeSymbol' || activeTool === 'placePower') && !placeLib && (
        <SymbolChooser onPick={setPlaceLib} onCancel={() => setActiveTool('select')} powerOnly={activeTool === 'placePower'} />
      )}

      {/* Label tools: a properties dialog names the label, then it follows the cursor. */}
      {LABEL_TOOL_KINDS[activeTool] && !pendingLabel && (
        <LabelDialog
          kind={LABEL_TOOL_KINDS[activeTool]!}
          onOk={(text: string, shape: LabelShape) => setPendingLabel({ kind: LABEL_TOOL_KINDS[activeTool]!, text, shape })}
          onCancel={() => setActiveTool('select')}
        />
      )}
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
