/**
 * The launcher's project-files pane (upstream counterpart:
 * kicad/project_tree_pane.cpp). Renders the .kicad_pro root row, the
 * KiCad-sorted directory tree, and the empty-state open/select/drop hints.
 * Single click selects, double click routes each document type to its editor
 * (PROJECT_TREE_ITEM::Activate). State stays in the launcher — this pane is
 * fully controlled. Ctrl/Cmd-click multi-selects; right-click opens the
 * context menu (the web-applicable subset of upstream's popup: text viewer,
 * rename, delete).
 */

import { useEffect, useState, type JSX } from 'react';
import type { PickedHomeFile } from './files.js';
import {
  basename,
  isHiddenFile,
  isViewableTextFile,
  treeIconFor,
  type DirNode,
} from './project_tree.js';

// KiCad's own dark-theme manager icons (GPL), vendored under assets/.
const MGR_ICONS = import.meta.glob('../assets/manager/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
export const mgrUrl = (name: string): string | undefined =>
  MGR_ICONS[`../assets/manager/${name}.svg`];

export const TreeIcon = ({ name }: { name: string }): JSX.Element => {
  const url = mgrUrl(name);
  return url ? <img src={url} alt="" /> : <span style={{ width: 18, height: 18 }} />;
};

/** Sentinel used as the selection id of the project root row. */
export const ROOT_SELECTION = '\0root';

export function ProjectTreePane({
  picked,
  dirRoot,
  rootLabel,
  projectNames,
  width,
  expanded,
  onToggleDir,
  selected,
  onSelect,
  rootOpen,
  onToggleRoot,
  onRenamePath,
  onDeletePaths,
  onViewTextPath,
  onOpenPcbFile,
  onOpenSchematic,
  onOpenSymbolFile,
  onOpenFootprintFile,
  onOpenDrawingSheetFile,
  onSwitchProject,
  onOpenProjectPicker,
  onSelectFiles,
}: {
  picked: PickedHomeFile[] | null;
  dirRoot: DirNode | null;
  /** The tree root shows the full .kicad_pro filename (m_root = fn.GetFullName()). */
  rootLabel: string;
  /** Basenames (lowercased, no extension) of every .kicad_pro in the folder —
   *  KiCad's getProjects(dir). A .kicad_sch shows only when its basename is one
   *  of these (the root sheet of some project); subsheets stay hidden. */
  projectNames: ReadonlySet<string>;
  width: number;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  /** Selected tree paths (multi-select via Ctrl/Cmd-click, like upstream). */
  selected: ReadonlySet<string>;
  onSelect: (path: string, additive: boolean) => void;
  rootOpen: boolean;
  onToggleRoot: () => void;
  onRenamePath?: (path: string) => void;
  onDeletePaths?: (paths: Set<string>) => void;
  onViewTextPath?: (path: string) => void;
  onOpenPcbFile?: (file: PickedHomeFile) => void;
  onOpenSchematic: (startFile?: string) => void;
  onOpenSymbolFile?: (file: PickedHomeFile) => void;
  onOpenFootprintFile?: (file: PickedHomeFile) => void;
  onOpenDrawingSheetFile?: (file: PickedHomeFile) => void;
  /** Switch to another project (double-clicking its .kicad_pro in the tree). */
  onSwitchProject?: (proFullName: string) => void;
  onOpenProjectPicker: () => void;
  onSelectFiles: () => void;
}): JSX.Element {
  // KiCad's addItemToProjectTree: a .kicad_sch is listed only when its basename
  // is one of the folder's project names (getProjects) — i.e. the root sheet of
  // *some* project. Sub-sheets hide (they live in the editor's hierarchy
  // navigator). A folder may hold several projects: the active project's
  // .kicad_pro is the bold root row (hidden as a child, like KiCad's
  // `filename != fn.GetFullName()`); every other file — including the other
  // projects' .kicad_pro, .kicad_sch and .kicad_pcb — stays visible, and their
  // .kicad_pro can be double-clicked to switch project.
  const isHiddenNode = (name: string): boolean => {
    const base = name.split(/[\\/]/).pop() ?? name;
    if (/\.kicad_pro$/i.test(base)) return base === rootLabel;
    if (/\.kicad_sch$/i.test(base)) {
      const stem = base.replace(/\.kicad_sch$/i, '').toLowerCase();
      return !projectNames.has(stem);
    }
    return isHiddenFile(name);
  };

  // Right-click context menu (upstream popup, web-applicable subset).
  const [menu, setMenu] = useState<{ x: number; y: number; paths: Set<string> } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const openContextMenu = (e: React.MouseEvent, path: string): void => {
    e.preventDefault();
    e.stopPropagation();
    // Right-clicking an unselected row selects it (like upstream's tree).
    const paths = selected.has(path) ? new Set(selected) : new Set([path]);
    paths.delete(ROOT_SELECTION);
    if (!selected.has(path)) onSelect(path, false);
    if (paths.size > 0) setMenu({ x: e.clientX, y: e.clientY, paths });
  };

  const renderDir = (node: DirNode, depth: number): JSX.Element | null => {
    if (node.isDir) {
      const kids = node.children.filter((c) => c.isDir || !isHiddenNode(c.name));
      if (kids.length === 0) return null;
      const open = expanded.has(node.path);
      return (
        <div key={node.path}>
          <div
            className={`ze-tree-item${selected.has(node.path) ? ' active' : ''}`}
            style={{ paddingLeft: 8 + depth * 16, cursor: 'pointer' }}
            onClick={(e) =>
              e.ctrlKey || e.metaKey ? onSelect(node.path, true) : onToggleDir(node.path)
            }
            onContextMenu={(e) => openContextMenu(e, node.path)}
            title={node.path}
          >
            <span className={`twisty expandable${open ? ' open' : ''}`} />
            <TreeIcon name={open ? 'directory_open' : 'directory'} />
            <span>{node.name}</span>
          </div>
          {open && kids.map((c) => renderDir(c, depth + 1))}
        </div>
      );
    }
    if (isHiddenNode(node.name)) return null;
    const isPcb = /\.kicad_pcb$/i.test(node.name);
    const isSch = /\.kicad_sch$/i.test(node.name);
    const isSym = /\.kicad_sym$/i.test(node.name);
    const isMod = /\.kicad_mod$/i.test(node.name);
    const isWks = /\.kicad_wks$/i.test(node.name);
    const isPro = /\.kicad_pro$/i.test(node.name);
    // PROJECT_TREE_ITEM::Activate: each document type routes to the editor it
    // belongs to (a .kicad_mod to the Footprint Editor, a .kicad_sym to the
    // Symbol Editor, a board to the PCB Editor, a sheet to the Schematic Editor,
    // a drawing sheet to the Drawing Sheet Editor).
    const openFn =
      isPcb && onOpenPcbFile && node.file
        ? () => onOpenPcbFile(node.file!)
        : isSch
          ? () => onOpenSchematic(basename(node.name))
          : isSym && onOpenSymbolFile && node.file
            ? () => onOpenSymbolFile(node.file!)
            : isMod && onOpenFootprintFile && node.file
              ? () => onOpenFootprintFile(node.file!)
              : isWks && onOpenDrawingSheetFile && node.file
                ? () => onOpenDrawingSheetFile(node.file!)
                : isPro && onSwitchProject && node.file
                  ? () => onSwitchProject(node.file!.name)
                  : undefined;
    const openTitle = isPcb
      ? 'Double-click to open in the PCB Editor'
      : isSch
        ? 'Double-click to open in the Schematic Editor'
        : isSym
          ? 'Double-click to open in the Symbol Editor'
          : isMod
            ? 'Double-click to open in the Footprint Editor'
            : isWks
              ? 'Double-click to open in the Drawing Sheet Editor'
              : isPro
                ? 'Double-click to switch to this project'
                : node.path;
    // KiCad's project tree: single click selects, double click opens the file.
    return (
      <div
        key={node.path}
        className={`ze-tree-item${selected.has(node.path) ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 + 15, cursor: openFn ? 'pointer' : 'default' }}
        title={openTitle}
        onClick={(e) => onSelect(node.path, e.ctrlKey || e.metaKey)}
        onContextMenu={(e) => openContextMenu(e, node.path)}
        onDoubleClick={openFn}
      >
        <TreeIcon name={treeIconFor(node.name)} />
        <span>{node.name}</span>
      </div>
    );
  };

  return (
    <div className="ze-panel left" style={{ width }}>
      <div className="ze-panel-header">Project Files</div>
      <div className="ze-panel-body">
        {picked ? (
          <>
            {/* project root (.kicad_pro): bold, selectable, and its twisty
                collapses the whole tree — like KiCad's tree root. */}
            <div
              className={`ze-tree-item root${selected.has(ROOT_SELECTION) ? ' active' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(ROOT_SELECTION, false)}
            >
              <span
                className={`twisty expandable${rootOpen ? ' open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleRoot();
                }}
              />
              <TreeIcon name="project" />
              <span>{rootLabel}</span>
            </div>
            {/* project directory contents, flat and KiCad-sorted */}
            {rootOpen && dirRoot?.children.map((c) => renderDir(c, 1))}
          </>
        ) : (
          <>
            <div
              className="ze-tree-item"
              style={{ fontWeight: 600 }}
              onClick={onOpenProjectPicker}
              title="Open a KiCad project (the folder holding the .kicad_pro and its sheets)"
            >
              📂 Open KiCad Project…
            </div>
            <div
              className="ze-tree-item"
              onClick={onSelectFiles}
              title="If the browser blocks the folder (Downloads, Desktop…), select all the project files instead (Ctrl+A in the dialog)"
            >
              🗂 Select Project Files…
            </div>
            <div className="ze-tree-item" style={{ opacity: 0.6, cursor: 'default' }}>
              …or drag the project folder here
            </div>
          </>
        )}
      </div>
      {menu && (
        <div
          className="ze-dropdown"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const paths = [...menu.paths];
            const single = paths.length === 1 ? paths[0]! : null;
            const singleText = single !== null && isViewableTextFile(single);
            const item = (
              label: string,
              onClick: (() => void) | undefined,
              disabled = false,
            ): JSX.Element => (
              <div
                key={label}
                className={`ze-mitem${disabled || !onClick ? ' disabled' : ''}`}
                onClick={() => {
                  if (disabled || !onClick) return;
                  setMenu(null);
                  onClick();
                }}
              >
                <span className="mico" />
                <span className="lbl">{label}</span>
              </div>
            );
            return (
              <>
                {/* "New Directory…" needs file-move to be useful in the
                    file-list project model — arrives with drag-move. */}
                {item('New Directory…', undefined, true)}
                <div className="ze-msep" />
                {item(
                  'Edit in a Text Viewer',
                  singleText && onViewTextPath ? () => onViewTextPath(single) : undefined,
                  !singleText,
                )}
                <div className="ze-msep" />
                {item(
                  paths.length > 1 ? 'Rename Files…' : 'Rename File…',
                  single && onRenamePath ? () => onRenamePath(single) : undefined,
                  paths.length !== 1,
                )}
                {item('Delete', onDeletePaths ? () => onDeletePaths(new Set(paths)) : undefined)}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
