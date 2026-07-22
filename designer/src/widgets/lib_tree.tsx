/**
 * Widget displaying a tree of library items: filter box with a sort/expand
 * menu, the two-column (Item / Description) tree, and the details pane fed by
 * the adapter's info generator. Mirrors kicad/common/widgets/lib_tree.cpp
 * (LIB_TREE); the wxDataViewCtrl becomes a scrollable flex list here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LibTreeNode, LibTreeNodeType } from './lib_tree_model.js';
import { type LibTreeModelAdapter, SortMode } from './lib_tree_model_adapter.js';

export interface LibTreeProps {
  adapter: LibTreeModelAdapter;
  /** Bumped by the owner whenever it mutates the adapter (lazy library loads). */
  regenerateNonce?: number;
  /** Initial filter text (g_symbolSearchString persists it across openings). */
  initialSearch?: string;
  onSearchChanged?: (search: string) => void;
  /** EVT_LIBITEM_SELECTED — selection moved (null = no selection). */
  onSelect: (node: LibTreeNode | null) => void;
  /** EVT_LIBITEM_CHOSEN — double-click or Enter on an item/unit. */
  onChoose: (node: LibTreeNode) => void;
  /** A library row was expanded/collapsed (lazy load + open_libs persistence). */
  onToggleLibrary?: (node: LibTreeNode, open: boolean) => void;
  /** Pin/Unpin Library from the context menu; owner persists and re-sorts. */
  onPinLibrary?: (node: LibTreeNode, pinned: boolean) => void;
  /** Sort mode switched from the menu; owner persists it (SaveSettings). */
  onSortModeChanged?: (mode: SortMode) => void;
  /** When the panel places the details pane elsewhere (no-footprints layout). */
  hasExternalDetails?: boolean;
  /** Libraries to open initially (EESCHEMA_SETTINGS m_LibTree.open_libs). */
  openLibs?: readonly string[];
}

interface Row {
  node: LibTreeNode;
  indent: number;
  expandable: boolean;
  open: boolean;
}

export function LibTree({
  adapter,
  regenerateNonce = 0,
  initialSearch = '',
  onSearchChanged,
  onSelect,
  onChoose,
  onToggleLibrary,
  onPinLibrary,
  onSortModeChanged,
  hasExternalDetails = false,
  openLibs,
}: LibTreeProps): JSX.Element {
  const [search, setSearch] = useState(initialSearch);
  const [sortMode, setSortModeState] = useState<SortMode>(adapter.getSortMode());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(openLibs ?? []));
  const [selected, setSelected] = useState<LibTreeNode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: LibTreeNode } | null>(null);
  // The adapter's nodes are mutated in place; bump to re-render after a pass.
  const [version, setVersion] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<LibTreeNode, HTMLDivElement>());
  const debounce = useRef<number | undefined>(undefined);

  const searching = search.trim().length > 0;

  const select = useCallback(
    (node: LibTreeNode | null) => {
      setSelected(node);
      onSelect(node);
    },
    [onSelect],
  );

  // Run the scoring/sorting pass; with a query the best match gets selected
  // (upstream UpdateSearchString + showResults).
  const regenerate = useCallback(
    (query: string, selectBest: boolean) => {
      const best = adapter.updateSearchString(query);
      setVersion((v) => v + 1);
      if (selectBest) select(best);
    },
    [adapter, select],
  );

  // Initial pass — ensures a preselect node is shown even with no query.
  useEffect(() => {
    regenerate(search, true);
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The owner loaded more libraries into the adapter (lazy load update).
  useEffect(() => {
    if (regenerateNonce > 0) regenerate(search, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenerateNonce]);

  const onQueryText = (value: string) => {
    setSearch(value);
    onSearchChanged?.(value);
    // Upstream debounces tree regeneration behind a 200 ms timer.
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => regenerate(value, true), 200);
  };

  const setSortMode = (mode: SortMode) => {
    adapter.setSortMode(mode);
    setSortModeState(mode);
    onSortModeChanged?.(mode);
    regenerate(search, false);
  };

  const toggle = (node: LibTreeNode) => {
    const key = node.type === LibTreeNodeType.LIBRARY ? node.name : node.libId;
    const open = !isOpen(node);
    setExpanded((prev) => {
      const next = new Set(prev);
      open ? next.add(key) : next.delete(key);
      return next;
    });
    if (node.type === LibTreeNodeType.LIBRARY) onToggleLibrary?.(node, open);
  };

  const isOpen = (node: LibTreeNode): boolean => {
    // While searching, library ancestors of matches are auto-expanded
    // (showResults expands ancestors; unit rows stay collapsed).
    if (searching && node.type === LibTreeNodeType.LIBRARY && node.score > 1) return true;
    return expanded.has(node.type === LibTreeNodeType.LIBRARY ? node.name : node.libId);
  };

  const expandCollapseAll = (expand: boolean) => {
    if (!expand) {
      setExpanded(new Set());
      return;
    }
    const all = new Set<string>();
    for (const lib of adapter.tree.children) {
      all.add(lib.name);
      onToggleLibrary?.(lib, true);
    }
    setExpanded(all);
  };

  // Flatten the visible rows; zero-score nodes are filtered out while a
  // query is active (they aren't in the wxDataViewCtrl at all upstream).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const lib of adapter.tree.children) {
      if (searching && lib.score <= 0) continue;
      const libOpen = isOpen(lib);
      out.push({ node: lib, indent: 0, expandable: true, open: libOpen });
      if (!libOpen) continue;
      for (const item of lib.children) {
        if (searching && item.score <= 0) continue;
        const itemOpen = item.children.length > 0 && isOpen(item);
        out.push({ node: item, indent: 1, expandable: item.children.length > 0, open: itemOpen });
        if (itemOpen) {
          for (const unit of item.children)
            out.push({ node: unit, indent: 2, expandable: false, open: false });
        }
      }
    }
    return out;
    // `version` re-flattens after each in-place scoring/sorting pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, searching, expanded, version, sortMode, regenerateNonce, selected]);

  useEffect(() => {
    if (selected) rowRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected, rows]);

  // Arrow keys move the selection whether they come from the search box or
  // the tree (upstream onQueryCharHook forwards them to the tree control).
  const onNavKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = rows.findIndex((r) => r.node === selected);
      const next =
        e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
      if (rows[next]) select(rows[next]!.node);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected) activate(selected);
    } else if (e.key === 'ArrowRight' && selected && !e.currentTarget.matches('input')) {
      if (!isOpen(selected) && rows.find((r) => r.node === selected)?.expandable) toggle(selected);
    } else if (e.key === 'ArrowLeft' && selected && !e.currentTarget.matches('input')) {
      if (isOpen(selected)) toggle(selected);
    }
  };

  // wxEVT_DATAVIEW_ITEM_ACTIVATED: double-click/Enter on a container toggles
  // it, on an item/unit it chooses the item.
  const activate = (node: LibTreeNode) => {
    if (node.type === LibTreeNodeType.LIBRARY) toggle(node);
    else if (!node.parent?.isGroup || node.libId) onChoose(node);
  };

  const sortMenuAction = (action: () => void) => () => {
    action();
    setMenuOpen(false);
  };

  const sortMenu = menuOpen && (
    <div className="ze-libtree-menu" onMouseLeave={() => setMenuOpen(false)}>
      <div className="item" onClick={sortMenuAction(() => setSortMode(SortMode.BEST_MATCH))}>
        <span className="check">{sortMode === SortMode.BEST_MATCH ? '✓' : ''}</span>
        Sort by Best Match
      </div>
      <div className="item" onClick={sortMenuAction(() => setSortMode(SortMode.ALPHABETIC))}>
        <span className="check">{sortMode === SortMode.ALPHABETIC ? '✓' : ''}</span>
        Sort Alphabetically
      </div>
      <div className="sep" />
      <div className="item" onClick={sortMenuAction(() => expandCollapseAll(true))}>
        <span className="check" />
        Expand All
      </div>
      <div className="item" onClick={sortMenuAction(() => expandCollapseAll(false))}>
        <span className="check" />
        Collapse All
      </div>
    </div>
  );

  const contextMenu = ctxMenu && (
    <div
      className="ze-libtree-menu ctx"
      style={{ left: ctxMenu.x, top: ctxMenu.y }}
      onMouseLeave={() => setCtxMenu(null)}
    >
      {/* LIB_TREE::onItemContextMenu: Pin/Unpin only, on library rows only —
          Expand/Collapse All live in the sort-button menu, not here. */}
      {ctxMenu.node.type === LibTreeNodeType.LIBRARY && !ctxMenu.node.isGroup ? (
        <div
          className="item"
          onClick={() => {
            onPinLibrary?.(ctxMenu.node, !ctxMenu.node.pinned);
            setCtxMenu(null);
            regenerate(search, false);
          }}
        >
          <span className="check" />
          {ctxMenu.node.pinned ? 'Unpin Library' : 'Pin Library'}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="ze-libtree" onKeyDown={onNavKey}>
      <div className="ze-libtree-search">
        <input
          ref={searchRef}
          className="ze-search"
          type="search"
          placeholder="Filter"
          value={search}
          onChange={(e) => onQueryText(e.target.value)}
          onKeyDown={(e) => {
            // First escape cancels the search string (OnChar in the panel);
            // an empty box lets it bubble up to close the dialog.
            if (e.key === 'Escape' && search) {
              e.stopPropagation();
              onQueryText('');
            }
          }}
        />
        <div className="ze-libtree-sortbtn-wrap">
          <button
            type="button"
            className="ze-libtree-sortbtn"
            title="Sort and expand options"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⚙
          </button>
          {sortMenu}
        </div>
      </div>

      <div className="ze-libtree-cols">
        <span className="col-item">Item</span>
        <span className="col-desc">Description</span>
      </div>

      <div className="ze-libtree-list" ref={listRef} tabIndex={0}>
        {rows.map(({ node, indent, expandable, open }) => (
          <div
            key={`${node.parent?.name ?? ''}/${node.libId || node.name}${node.type === LibTreeNodeType.UNIT ? `#${node.unit}` : ''}`}
            ref={(el) => {
              el ? rowRefs.current.set(node, el) : rowRefs.current.delete(node);
            }}
            className={
              `ze-libtree-row${node === selected ? ' active' : ''}` +
              (node.type === LibTreeNodeType.LIBRARY ? ' lib' : '')
            }
            style={{ paddingLeft: 4 + indent * 16 }}
            onClick={() => select(node)}
            onDoubleClick={() => activate(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              select(node);
              // LIB_TREE::onItemContextMenu: the row menu exists only for
              // pinnable (non-group) library rows.
              if (node.type === LibTreeNodeType.LIBRARY && !node.isGroup)
                setCtxMenu({ x: e.clientX, y: e.clientY, node });
            }}
            title={node.libId || node.name}
          >
            <span
              className={`twisty${expandable ? ' expandable' : ''}${open ? ' open' : ''}`}
              onClick={(e) => {
                if (expandable) {
                  e.stopPropagation();
                  toggle(node);
                }
              }}
            />
            <span className="col-item">
              {node.pinned && node.type === LibTreeNodeType.LIBRARY ? '📌 ' : ''}
              {node.name}
            </span>
            <span className="col-desc">{node.desc}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="ze-muted" style={{ padding: 8 }}>
            No matches
          </div>
        )}
      </div>

      {!hasExternalDetails && (
        <div
          className="ze-libtree-details"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: generateInfo HTML-escapes all library data (generate_alias_info)
          dangerouslySetInnerHTML={{
            __html: selected && selected.libId ? adapter.generateInfo(selected) : '',
          }}
        />
      )}
      {contextMenu}
    </div>
  );
}
