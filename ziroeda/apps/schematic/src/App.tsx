import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parse, readSchematic, serializeSchematic, iuToMM, deleteByIds, transformItems, computeNetlist, withCleanup, refId, editSymbolProperties, copySelectionText, parsePastedText, History, type Schematic, type LibSymbol, type EditCommand, type Vec2, type TransformOp, type LabelKind, type LabelShape, type SymbolEdit, type PastePayload } from '@ziroeda/core';
import { SchematicCanvas, type CanvasController, type LineMode, type PendingLabel } from './components/SchematicCanvas.js';
import { LabelDialog } from './components/LabelDialog.js';
import { SymbolPropertiesDialog } from './components/SymbolPropertiesDialog.js';
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
  // The symbol whose properties dialog is open (its refId), or null.
  const [propsTarget, setPropsTarget] = useState<string | null>(null);
  // Items parsed from the clipboard, attached to the cursor until dropped.
  const [pastePending, setPastePending] = useState<PastePayload | null>(null);
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

  // KiCad's Properties action: only symbols have a properties dialog so far.
  const onEditItem = useCallback((id: string, kind: 'symbol' | 'line' | 'junction' | 'label') => {
    if (kind === 'symbol') setPropsTarget(id);
  }, []);

  // Resolve the open dialog's target symbol against the current document.
  const propsSymbol = useMemo(() => {
    if (!doc || propsTarget === null) return null;
    for (let i = 0; i < doc.symbols.length; i++) {
      const s = doc.symbols[i]!;
      if (refId('symbol', s.uuid, i) === propsTarget) return s;
    }
    return null;
  }, [doc, propsTarget]);

  // Load a schematic from raw .kicad_sch text: parse (lossless), fresh history,
  // clear transient state, and fit the view. Embedded lib_symbols render as-is.
  const loadText = useCallback((text: string, name?: string) => {
    try {
      const next = readSchematic(parse(text));
      history.current.clear();
      setDoc(next);
      setSelection(new Set());
      setHighlightItem(null);
      setPendingLabel(null);
      setActiveTool('select');
      setPlaceLib(null);
      if (name) setFileName(name);
      setError(null);
      // Fit after React commits the new doc to the canvas.
      requestAnimationFrame(() => controller.current?.zoomToFit());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const openFile = useCallback((file: File) => {
    if (!/\.kicad_sch$/i.test(file.name)) { setError(`Not a .kicad_sch file: ${file.name}`); return; }
    file.text().then((t) => loadText(t, file.name)).catch((e) => setError(String(e)));
  }, [loadText]);

  const promptOpen = useCallback(() => fileInputRef.current?.click(), []);

  const save = useCallback(() => {
    setDoc((d) => {
      if (!d) return d;
      const text = serializeSchematic(d);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName ?? `${d.titleBlock?.title ?? 'schematic'}.kicad_sch`;
      a.click();
      URL.revokeObjectURL(url);
      return d;
    });
  }, [fileName]);

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
    else if (id === 'open') promptOpen();
    else if (id === 'save') save();
    else if (TX[id]) setSelection((sel) => { if (sel.size > 0) runCommand(transformItems(sel, TX[id]!)); return sel; });
  }, [undo, redo, save, promptOpen, runCommand]);

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
      // While a modal properties dialog is open, only Escape acts on the editor.
      if (propsTarget !== null && e.key !== 'Escape') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
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
        else setSelection(new Set());
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
      : <div style={{ padding: 16 }}>Loading…</div>;
  }

  const title = fileName ?? doc.titleBlock?.title ?? 'Root';

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) openFile(file);
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
            onEditItem={onEditItem}
            onSelectBox={onSelectBox}
            pastePending={pastePending}
            onPasteDone={onPasteDone}
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
