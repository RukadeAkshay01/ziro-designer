/**
 * The launcher's project-files pane (upstream counterpart:
 * kicad/project_tree_pane.cpp). Renders the .kicad_pro root row, the
 * KiCad-sorted directory tree, and the empty-state open/select/drop hints.
 * Single click selects, double click routes each document type to its editor
 * (PROJECT_TREE_ITEM::Activate). State stays in the launcher — this pane is
 * fully controlled.
 */

import type { JSX } from 'react';
import type { PickedHomeFile } from './files.js';
import {
  basename,
  isHiddenFile,
  isRootFileName,
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
  projLower,
  width,
  expanded,
  onToggleDir,
  selected,
  onSelect,
  rootOpen,
  onToggleRoot,
  onOpenPcbFile,
  onOpenSchematic,
  onOpenSymbolFile,
  onOpenFootprintFile,
  onOpenProjectPicker,
  onSelectFiles,
}: {
  picked: PickedHomeFile[] | null;
  dirRoot: DirNode | null;
  /** The tree root shows the full .kicad_pro filename (m_root = fn.GetFullName()). */
  rootLabel: string;
  projLower: string;
  width: number;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  selected: string | null;
  onSelect: (path: string) => void;
  rootOpen: boolean;
  onToggleRoot: () => void;
  onOpenPcbFile?: (file: PickedHomeFile) => void;
  onOpenSchematic: (startFile?: string) => void;
  onOpenSymbolFile?: (file: PickedHomeFile) => void;
  onOpenFootprintFile?: (file: PickedHomeFile) => void;
  onOpenProjectPicker: () => void;
  onSelectFiles: () => void;
}): JSX.Element {
  // Like KiCad's addItemToProjectTree: a schematic is only listed when its
  // basename matches the project (i.e. the root sheet). Sub-sheets are hidden
  // here — they live in the Schematic Editor's hierarchy navigator.
  const isHiddenNode = (name: string): boolean =>
    isHiddenFile(name) || (/\.kicad_sch$/i.test(name) && !isRootFileName(name, projLower));

  const renderDir = (node: DirNode, depth: number): JSX.Element | null => {
    if (node.isDir) {
      const kids = node.children.filter((c) => c.isDir || !isHiddenNode(c.name));
      if (kids.length === 0) return null;
      const open = expanded.has(node.path);
      return (
        <div key={node.path}>
          <div
            className="ze-tree-item"
            style={{ paddingLeft: 8 + depth * 16, cursor: 'pointer' }}
            onClick={() => onToggleDir(node.path)}
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
    // PROJECT_TREE_ITEM::Activate: each document type routes to the editor it
    // belongs to (a .kicad_mod to the Footprint Editor, a .kicad_sym to the
    // Symbol Editor, a board to the PCB Editor, a sheet to the Schematic Editor).
    const openFn =
      isPcb && onOpenPcbFile && node.file
        ? () => onOpenPcbFile(node.file!)
        : isSch
          ? () => onOpenSchematic(basename(node.name))
          : isSym && onOpenSymbolFile && node.file
            ? () => onOpenSymbolFile(node.file!)
            : isMod && onOpenFootprintFile && node.file
              ? () => onOpenFootprintFile(node.file!)
              : undefined;
    const openTitle = isPcb
      ? 'Double-click to open in the PCB Editor'
      : isSch
        ? 'Double-click to open in the Schematic Editor'
        : isSym
          ? 'Double-click to open in the Symbol Editor'
          : isMod
            ? 'Double-click to open in the Footprint Editor'
            : node.path;
    // KiCad's project tree: single click selects, double click opens the file.
    return (
      <div
        key={node.path}
        className={`ze-tree-item${selected === node.path ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 + 15, cursor: openFn ? 'pointer' : 'default' }}
        title={openTitle}
        onClick={() => onSelect(node.path)}
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
              className={`ze-tree-item root${selected === ROOT_SELECTION ? ' active' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(ROOT_SELECTION)}
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
    </div>
  );
}
