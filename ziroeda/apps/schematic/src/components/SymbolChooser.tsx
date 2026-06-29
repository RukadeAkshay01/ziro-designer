import { useEffect, useMemo, useState } from 'react';
import type { LibSymbol } from '@ziroeda/core';
import { loadIndex, loadSymbol, type LibIndexEntry } from '../symbols/index.js';

interface Props {
  onPick: (lib: LibSymbol) => void;
  currentId: string | null;
}

const MAX_RESULTS = 400;

/** KiCad-style symbol chooser: search across all libraries, or browse by library. */
export function SymbolChooser({ onPick, currentId }: Props): JSX.Element {
  const [index, setIndex] = useState<LibIndexEntry[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setIndex([])); }, []);

  const pick = async (library: string, name: string) => {
    setBusy(`${library}:${name}`);
    try {
      const sym = await loadSymbol(library, name);
      if (sym) onPick(sym);
    } finally {
      setBusy(null);
    }
  };

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const out: [string, string][] = [];
    for (const lib of index) {
      for (const name of lib.symbols) {
        if (name.toLowerCase().includes(q) || `${lib.name}:${name}`.toLowerCase().includes(q)) {
          out.push([lib.name, name]);
          if (out.length >= MAX_RESULTS) return out;
        }
      }
    }
    return out;
  }, [q, index]);

  const total = index.reduce((n, l) => n + l.count, 0);

  const row = (library: string, name: string, indent = 0) => {
    const id = `${library}:${name}`;
    return (
      <div
        key={id}
        className={`ze-tree-item${currentId === id ? ' active' : ''}`}
        style={{ paddingLeft: 6 + indent }}
        onClick={() => pick(library, name)}
        title={id}
      >
        {busy === id ? '⏳ ' : ''}{name}
      </div>
    );
  };

  return (
    <div className="ze-panel left" style={{ width: 280 }}>
      <div className="ze-panel-header">Choose a Symbol</div>
      <div style={{ padding: 6, borderBottom: '1px solid var(--chrome-border)' }}>
        <input
          className="ze-search"
          placeholder={`Search ${total ? total.toLocaleString() : ''} symbols…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="ze-panel-body" style={{ paddingTop: 4 }}>
        {index.length === 0 && <div className="ze-muted">Loading libraries…</div>}

        {results ? (
          <>
            {results.length === 0 && <div className="ze-muted">No matches</div>}
            {results.map(([lib, name]) => (
              <div key={`${lib}:${name}`}>
                <span style={{ color: '#7f97b0', fontSize: 11 }}>{lib}: </span>
                {row(lib, name)}
              </div>
            ))}
            {results.length >= MAX_RESULTS && <div className="ze-muted">…refine your search</div>}
          </>
        ) : (
          index.map((lib) => {
            const open = expanded.has(lib.name);
            return (
              <div key={lib.name}>
                <div
                  className="ze-tree-item root"
                  onClick={() => setExpanded((p) => { const n = new Set(p); n.has(lib.name) ? n.delete(lib.name) : n.add(lib.name); return n; })}
                >
                  <span className="twisty">{open ? '▾' : '▸'}</span>
                  {lib.name} <span style={{ color: '#7f97b0' }}>({lib.count})</span>
                </div>
                {open && lib.symbols.map((name) => row(lib.name, name, 16))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
