import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { loadIndex, loadSymbol, type LibIndexEntry } from '../symbols/index.js';
import { renderSymbolPreview } from '../render/renderer.js';
import { KICAD_CLASSIC } from '../theme.js';

interface Props {
  onPick: (lib: LibSymbol) => void;
  onCancel: () => void;
  /** Restrict to power-port libraries (KiCad's "Add Power" filters to power symbols). */
  powerOnly?: boolean;
  /** "Show footprint previews in Symbol Chooser" (Preferences > Editing Options). */
  showFootprintPreview?: boolean;
}

const MAX_RESULTS = 500;

/** KiCad-style "Choose Symbol" modal: search/browse on the left, live preview on the right. */
export function SymbolChooser({
  onPick,
  onCancel,
  powerOnly = false,
  showFootprintPreview = true,
}: Props): JSX.Element {
  const [rawIndex, setRawIndex] = useState<LibIndexEntry[]>([]);
  const index = useMemo(
    () => (powerOnly ? rawIndex.filter((l) => /power/i.test(l.name)) : rawIndex),
    [rawIndex, powerOnly],
  );
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewSym, setPreviewSym] = useState<LibSymbol | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadIndex()
      .then(setRawIndex)
      .catch(() => setRawIndex([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && previewSym) onPick(previewSym);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onPick, previewSym]);

  const highlight = async (library: string, name: string) => {
    setPreviewId(`${library}:${name}`);
    const sym = await loadSymbol(library, name);
    if (sym) setPreviewSym(sym);
  };

  // Render the preview whenever the selected symbol changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewSym) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) renderSymbolPreview(ctx, previewSym, canvas.width, canvas.height, KICAD_CLASSIC);
  }, [previewSym]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    // Score matches so exact/prefix hits rank above incidental substrings — e.g. "R"
    // surfaces Device:R, not 74xGxx:74LVC1GU04DRL. Lower score = better.
    const scored: { row: [string, string]; score: number }[] = [];
    for (const lib of index) {
      for (const name of lib.symbols) {
        const n = name.toLowerCase();
        const full = `${lib.name}:${name}`.toLowerCase();
        let score: number;
        if (n === q) score = 0;
        else if (n.startsWith(q)) score = 1;
        else if (new RegExp(`(^|[_\\s])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n))
          score = 2;
        else if (n.includes(q)) score = 3;
        else if (full.includes(q)) score = 4;
        else continue;
        scored.push({ row: [lib.name, name], score });
      }
    }
    scored.sort(
      (a, b) =>
        a.score - b.score || a.row[1].length - b.row[1].length || a.row[1].localeCompare(b.row[1]),
    );
    return scored.slice(0, MAX_RESULTS).map((s) => s.row);
  }, [q, index]);

  const total = index.reduce((n, l) => n + l.count, 0);

  const symRow = (library: string, name: string, indent: number) => {
    const id = `${library}:${name}`;
    return (
      <div
        key={id}
        className={`ze-tree-item${previewId === id ? ' active' : ''}`}
        style={{ paddingLeft: 6 + indent }}
        onClick={() => highlight(library, name)}
        onDoubleClick={() => previewSym && onPick(previewSym)}
        title={id}
      >
        {name}
      </div>
    );
  };

  const prop = (key: string) => previewSym?.properties.find((p) => p.key === key)?.value;
  const desc = prop('Description');
  const keywords = prop('ki_keywords');
  const footprint = prop('Footprint');

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {powerOnly ? 'Choose Power Symbol' : 'Choose Symbol'}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body">
          <div className="ze-chooser-tree">
            <div className="top">
              <input
                className="ze-search"
                placeholder={`Search ${total ? total.toLocaleString() : ''} symbols…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="ze-chooser-list">
              {index.length === 0 && <div className="ze-muted">Loading libraries…</div>}
              {results ? (
                <>
                  {results.length === 0 && <div className="ze-muted">No matches</div>}
                  {results.map(([lib, name]) => (
                    <div
                      key={`${lib}:${name}`}
                      className={`ze-tree-item${previewId === `${lib}:${name}` ? ' active' : ''}`}
                      onClick={() => highlight(lib, name)}
                      onDoubleClick={() => previewSym && onPick(previewSym)}
                      title={`${lib}:${name}`}
                    >
                      <span style={{ color: '#7f97b0', fontSize: 11 }}>{lib}</span>&nbsp;{name}
                    </div>
                  ))}
                  {results.length >= MAX_RESULTS && (
                    <div className="ze-muted">…refine your search</div>
                  )}
                </>
              ) : (
                index.map((lib) => {
                  const open = expanded.has(lib.name);
                  return (
                    <div key={lib.name}>
                      <div
                        className="ze-tree-item root"
                        onClick={() =>
                          setExpanded((p) => {
                            const n = new Set(p);
                            n.has(lib.name) ? n.delete(lib.name) : n.add(lib.name);
                            return n;
                          })
                        }
                      >
                        <span className="twisty">{open ? '▾' : '▸'}</span>
                        {lib.name} <span style={{ color: '#7f97b0' }}>({lib.count})</span>
                      </div>
                      {open && lib.symbols.map((name) => symRow(lib.name, name, 16))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="ze-chooser-right">
            {/* Symbol preview (top) — mirrors KiCad's SYMBOL_PREVIEW_WIDGET. */}
            <canvas ref={canvasRef} className="ze-preview-canvas" />

            {/* Footprint selector strip + preview (bottom) — mirrors the FOOTPRINT_SELECT/
                PREVIEW widgets, gated by "Show footprint previews in Symbol Chooser".
                Footprint geometry needs the footprint libraries (not bundled), so the
                pane shows the symbol's assigned footprint by name. */}
            {showFootprintPreview && (
              <>
                <div className="ze-fp-bar">
                  {previewSym ? footprint || '— no default footprint —' : ''}
                </div>
                <div className="ze-fp-preview">
                  {previewSym ? (
                    footprint ? (
                      <div className="ze-fp-note">
                        <div className="fp-name">{footprint}</div>
                        <div className="ze-muted">
                          Footprint preview needs the footprint libraries (not loaded).
                        </div>
                      </div>
                    ) : (
                      <div className="ze-muted">No footprint assigned to this symbol.</div>
                    )
                  ) : null}
                </div>
              </>
            )}

            <div className="ze-preview-info">
              {previewSym ? (
                <>
                  <div className="nm">{previewSym.libId}</div>
                  {desc && <div className="desc">{desc}</div>}
                  {keywords && <div className="kw">{keywords}</div>}
                </>
              ) : (
                <div className="ze-muted">Select a symbol to preview it.</div>
              )}
            </div>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            disabled={!previewSym}
            onClick={() => previewSym && onPick(previewSym)}
          >
            Place Symbol
          </button>
        </div>
      </div>
    </div>
  );
}
