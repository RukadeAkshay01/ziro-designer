/**
 * Project-tree domain logic for the launcher: rebuilding the on-disk folder
 * hierarchy from picked files, the archive allow-list, root-file ordering,
 * and small display formatters. Pure functions — no React, fully testable.
 */

import type { PickedHomeFile } from './files.js';

export const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

export const fmtBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const fmtWhen = (ms: number): string => {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const treeIconFor = (file: string): string =>
  /\.kicad_pro$/i.test(file)
    ? 'project'
    : /\.kicad_sch$/i.test(file)
      ? 'icon_eeschema_16'
      : /\.kicad_pcb$/i.test(file)
        ? 'icon_pcbnew_16'
        : /\.kicad_sym$/i.test(file)
          ? 'library'
          : /\.kicad_mod$/i.test(file)
            ? 'module'
            : /\.(step|stp|wrl|wings)$/i.test(file)
              ? 'three_d'
              : /\.pdf$/i.test(file)
                ? 'file_pdf'
                : /\.(txt|md|rpt|net)$/i.test(file)
                  ? 'datasheet'
                  : 'directory_browser';

/** A node in the project's on-disk directory tree. */
export interface DirNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: PickedHomeFile;
  children: DirNode[];
}

// Files KiCad's project tree hides (config/lock/cache/backup and dotfiles).
export const isHiddenFile = (base: string): boolean =>
  base.startsWith('.') ||
  /\.(kicad_pro|kicad_prl|lck)$/i.test(base) ||
  base === 'fp-lib-table' ||
  base === 'sym-lib-table' ||
  /-backups?$/i.test(base);

// KiCad's PROJECT_ARCHIVER::Archive allow-list (common/project/project_archiver.cpp)
// with aIncludeExtraFiles=true — the flag the manager passes for "Archive Project"
// (kicad/project_tree_pane.cpp). Extension strings from wildcards_and_files_ext.cpp.
export const ARCHIVE_EXTENSIONS = new Set([
  // always archived
  'kicad_pro',
  'kicad_prl',
  'kicad_sch',
  'kicad_mbs',
  'kicad_sym',
  'kicad_pcb',
  'kicad_mod',
  'kicad_dru',
  'kicad_wks',
  'kicad_jobset',
  'json',
  'wbk',
  // extra files (aIncludeExtraFiles): legacy formats, 3D models, fab outputs…
  'pro',
  'sch',
  'lib',
  'dcm',
  'cmp',
  'brd',
  'mod',
  'stp',
  'step',
  'wrl',
  'gbrjob',
  'pos',
  'drl',
  'nc',
  'xnc',
  'd356',
  'rpt',
  'net',
  'py',
  'pdf',
  'txt',
  'cir',
  'sub',
  'model',
  'ibs',
  'pkg',
  'cad',
]);
// Extension-less files KiCad always archives (the library tables).
export const ARCHIVE_FILENAMES = new Set([
  'fp-lib-table',
  'sym-lib-table',
  'design-block-lib-table',
]);
// Gerber extensions (FILEEXT::GerberFileExtensionsRegex), matched on the ext.
export const GERBER_EXT_RE = /(gbr|gko|pho|(g[tb][alops])|(gm?\d\d*)|(gp[tb]))/i;

// Whether KiCad's archiver would include this file (its extension/name filter).
export const inArchiveAllowList = (name: string): boolean => {
  const base = name.split('/').pop()!.split('\\').pop()!;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 1 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext) return ARCHIVE_EXTENSIONS.has(ext) || GERBER_EXT_RE.test(ext);
  return ARCHIVE_FILENAMES.has(base.toLowerCase());
};

// KiCad marks a file as a project "root file" when its basename matches the
// project name (or "project-*") — PROJECT_TREE_PANE::addItemToProjectTree, and
// these sort ahead of other files (project_tree.cpp OnCompareItems).
export const isRootFileName = (name: string, projLower: string): boolean => {
  if (!projLower) return false;
  const base = name.toLowerCase().replace(/\.[^.]+$/, '');
  return base === projLower || base.startsWith(`${projLower}-`);
};

// PROJECT_TREE::OnCompareItems ordering: directories first, then root files,
// then case-insensitive by name (wxString::CmpNoCase).
export const compareTreeNodes = (a: DirNode, b: DirNode, projLower: string): number => {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  if (!a.isDir) {
    const ra = isRootFileName(a.name, projLower);
    const rb = isRootFileName(b.name, projLower);
    if (ra !== rb) return ra ? -1 : 1;
  }
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};

/**
 * Reconstruct the on-disk folder hierarchy from the picked files' relative
 * paths so the tree mirrors KiCad's project window — footprint/3D libraries
 * (CM5IO.pretty, 3d_lib, *.3dshapes) stay inside collapsible folders instead
 * of flooding the list. `stripPrefix` removes the picked folder's own name;
 * `projLower` drives KiCad's root-file-first sort.
 */
export function buildDirTree(
  files: PickedHomeFile[],
  stripPrefix: string,
  projLower: string,
): DirNode {
  const root: DirNode = { name: '', path: '', isDir: true, children: [] };
  for (const f of files) {
    let rel = f.name.replace(/\\/g, '/');
    if (stripPrefix && rel.startsWith(stripPrefix)) rel = rel.slice(stripPrefix.length);
    rel = rel.replace(/^\/+/, '');
    const parts = rel.split('/').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      let child = cur.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: (cur.path ? `${cur.path}/` : '') + part,
          isDir: !isLast,
          children: [],
        };
        cur.children.push(child);
      }
      if (isLast) {
        child.isDir = false;
        child.file = f;
      }
      cur = child;
    }
  }
  const sortRec = (n: DirNode): void => {
    n.children.sort((a, b) => compareTreeNodes(a, b, projLower));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

// --- Tree file operations (upstream: PROJECT_TREE_PANE::onRenameFile /
// onDeleteFile). Our project is an in-memory file list, so these are pure
// list transforms over tree-relative paths (after the picked-folder strip).

/** The tree-relative path of a picked file (strip the picked-folder prefix). */
const relOf = (name: string, stripPrefix: string): string => {
  let rel = name.replace(/\\/g, '/');
  if (stripPrefix && rel.startsWith(stripPrefix)) rel = rel.slice(stripPrefix.length);
  return rel.replace(/^\/+/, '');
};

/** Rename the file or directory at `path` to `newBase` (a bare name, no
 * slashes). Directory renames move every file underneath. Returns the new
 * list, or null when the name is invalid or collides with a sibling. */
export function renameTreeEntry(
  files: readonly PickedHomeFile[],
  stripPrefix: string,
  path: string,
  newBase: string,
): PickedHomeFile[] | null {
  const clean = newBase.replace(/[/\\:*?"<>|]/g, '').trim();
  if (!clean) return null;
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const newPath = parent + clean;
  if (newPath === path) return files.slice();
  const taken = files.some((f) => {
    const rel = relOf(f.name, stripPrefix);
    return rel === newPath || rel.startsWith(`${newPath}/`);
  });
  if (taken) return null;
  return files.map((f) => {
    const rel = relOf(f.name, stripPrefix);
    if (rel === path) return { ...f, name: stripPrefix + newPath };
    if (rel.startsWith(`${path}/`))
      return { ...f, name: stripPrefix + newPath + rel.slice(path.length) };
    return f;
  });
}

/** Delete the files/directories at `paths` (directories take their contents). */
export function deleteTreeEntries(
  files: readonly PickedHomeFile[],
  stripPrefix: string,
  paths: ReadonlySet<string>,
): PickedHomeFile[] {
  return files.filter((f) => {
    const rel = relOf(f.name, stripPrefix);
    for (const p of paths) if (rel === p || rel.startsWith(`${p}/`)) return false;
    return true;
  });
}

/** Text documents the in-app viewer can show (View > Open Text Viewer and the
 * tree's "Edit in a Text Viewer" — the web take on upstream's text editor). */
export const isViewableTextFile = (name: string): boolean =>
  /\.(txt|md|rpt|net|cir|csv|log|pos|gbrjob|kicad_dru)$/i.test(name) ||
  /(^|\/)(fp|sym|design-block)-lib-table$/.test(name);
