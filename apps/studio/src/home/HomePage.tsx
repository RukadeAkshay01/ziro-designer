import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { zipSync, unzipSync } from 'fflate';
import { MenuBar, type Menu } from '../ui/MenuBar.js';
import { storageAvailable, listProjects, saveProject, loadProject, deleteProject, type ProjectMeta } from './projectStore.js';
import { useAuth } from '../auth/AuthProvider.js';
import { syncAllProjects, pushProject, deleteCloudProject } from '../cloud/sync.js';
import '../ui/shell.css';

/** A file picked from disk for a project open. `bytes` is the byte-exact source
 * of truth (persist/archive, like KiCad's byte-stream archiver); `text` is a
 * decoded view the editors parse — valid for text files, unused for binaries. */
export interface PickedHomeFile { name: string; text: string; bytes?: Uint8Array }

const dec = new TextDecoder();
const enc = new TextEncoder();

// Let the browser paint (a loading overlay) before we hog the main thread with
// file reads + gzip. Two rAFs guarantees a committed frame first.
const nextPaint = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

// KiCad's own dark-theme icons (GPL), vendored under assets/.
const TILE_ICONS = import.meta.glob('../assets/launcher/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const MGR_ICONS = import.meta.glob('../assets/manager/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const tileUrl = (id: string): string | undefined => TILE_ICONS[`../assets/launcher/${id}.svg`];
const mgrUrl = (name: string): string | undefined => MGR_ICONS[`../assets/manager/${name}.svg`];

interface Tile {
  id: string;
  name: string;
  desc: string;
  enabled?: boolean;
}

const TILES: Tile[] = [
  { id: 'schematic', name: 'Schematic Editor', desc: 'Edit the project schematic', enabled: true },
  { id: 'symbols', name: 'Symbol Editor', desc: 'Edit global and/or project schematic symbol libraries' },
  { id: 'pcb', name: 'PCB Editor', desc: 'Edit the project PCB design' },
  { id: 'footprints', name: 'Footprint Editor', desc: 'Edit global and/or project PCB footprint libraries' },
  { id: 'gerber', name: 'Gerber Viewer', desc: 'Preview Gerber files' },
  { id: 'image', name: 'Image Converter', desc: 'Convert bitmap images to schematic symbols or PCB footprints' },
  { id: 'calculator', name: 'Calculator Tools', desc: 'Show tools for calculating resistance, current capacity, etc.' },
  { id: 'drawingsheet', name: 'Drawing Sheet Editor', desc: 'Edit drawing sheet borders and title blocks for use in schematics and PCB designs' },
  { id: 'pcm', name: 'Plugin and Content Manager', desc: 'Manage downloadable packages from KiCad and 3rd party repositories' },
];

// KiCad project-manager left toolbar (toolbars_kicad_manager.cpp). "Browse
// Project Files" is dropped: a browser can't open the OS file manager, and the
// left panel already is the project tree.
type MgrAction = 'open' | 'new' | 'archive' | 'unarchive' | 'refresh';
const MGR_TOOLS: ({ icon: string; title: string; action: MgrAction } | 'sep')[] = [
  { icon: 'new_project_from_template', title: 'New Project…', action: 'new' },
  { icon: 'open_project', title: 'Open Project…', action: 'open' },
  'sep',
  { icon: 'zip', title: 'Archive Project…', action: 'archive' },
  { icon: 'unzip', title: 'Unarchive Project…', action: 'unarchive' },
  'sep',
  { icon: 'refresh', title: 'Refresh', action: 'refresh' },
];

const tileIcon = (id: string): JSX.Element => {
  const url = tileUrl(id);
  return url ? <img src={url} alt="" /> : <span style={{ width: 44, height: 44 }} />;
};

const TreeIcon = ({ name }: { name: string }): JSX.Element => {
  const url = mgrUrl(name);
  return url ? <img src={url} alt="" /> : <span style={{ width: 18, height: 18 }} />;
};

const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const fmtWhen = (ms: number): string => {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// What pcbnew writes for File > New Board: default 2-layer stack.
const EMPTY_PCB = `(kicad_pcb (version 20241229) (generator "ziroeda")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (9 "F.Adhes" user "F.Adhesive")
    (11 "B.Adhes" user "B.Adhesive")
    (13 "F.Paste" user)
    (15 "B.Paste" user)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (17 "Dwgs.User" user "User.Drawings")
    (19 "Cmts.User" user "User.Comments")
    (21 "Eco1.User" user "User.Eco1")
    (23 "Eco2.User" user "User.Eco2")
    (25 "Edge.Cuts" user)
    (27 "Margin" user)
    (31 "F.CrtYd" user "F.Courtyard")
    (29 "B.CrtYd" user "B.Courtyard")
    (35 "F.Fab" user)
    (33 "B.Fab" user)
  )
  (net 0 "")
)
`;

// What eeschema writes for File > New Schematic: an empty root sheet (A4,
// page 1). The uuid is the sheet's own id, referenced from the .kicad_pro
// "sheets" list (KiCad ties the project's root sheet to this uuid).
const emptySch = (uuid: string): string => `(kicad_sch
	(version 20250114)
	(generator "eeschema")
	(generator_version "9.0")
	(uuid "${uuid}")
	(paper "A4")
	(lib_symbols)
	(sheet_instances
		(path "/"
			(page "1")
		)
	)
)
`;

// KiCad's default project file (kicad_pro): JSON settings written by File > New
// Project. Only the essentials KiCad always emits — the app derives the project
// name from `meta.filename` and ties the root schematic via `sheets`.
const projectJson = (name: string, rootUuid: string): string =>
  JSON.stringify(
    {
      board: {
        design_settings: { defaults: {}, rules: {}, track_widths: [], via_dimensions: [] },
        layer_presets: [],
        viewports: [],
      },
      boards: [],
      cvpcb: { equivalence_files: [] },
      erc: { rule_severities: {}, pin_map: [], erc_exclusions: [] },
      libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
      meta: { filename: `${name}.kicad_pro`, version: 3 },
      net_settings: { classes: [{ name: 'Default', clearance: 0.2 }], meta: { version: 3 } },
      pcbnew: { last_paths: {}, page_layout_descr_file: '' },
      schematic: {
        annotate_start_num: 0,
        drawing: {},
        legacy_lib_dir: '',
        legacy_lib_list: [],
        meta: { version: 1 },
        net_format_name: '',
        spice_current_sheet_as_root: false,
      },
      sheets: [[rootUuid, '']],
      text_variables: {},
    },
    null,
    2,
  ) + '\n';

// Build the three files KiCad's File > New Project writes from scratch, nested
// under a folder named for the project (mirrors KiCad's project directory). The
// root schematic shares the .kicad_pro basename so the editor pairs them.
const newProjectFiles = (name: string): PickedHomeFile[] => {
  const uuid = (): string =>
    crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rootUuid = uuid();
  const dir = `${name}/`;
  const mk = (path: string, text: string): PickedHomeFile => ({ name: path, text, bytes: enc.encode(text) });
  return [
    mk(`${dir}${name}.kicad_pro`, projectJson(name, rootUuid)),
    mk(`${dir}${name}.kicad_sch`, emptySch(rootUuid)),
    mk(`${dir}${name}.kicad_pcb`, EMPTY_PCB),
  ];
};

// KiCad rejects these in project names (invalid on common filesystems).
const sanitizeProjectName = (s: string): string => s.replace(/[/\\:*?"<>|]/g, '').trim();

const treeIconFor = (file: string): string =>
  /\.kicad_pro$/i.test(file) ? 'project_kicad'
  : /\.kicad_sch$/i.test(file) ? 'icon_eeschema_16'
  : /\.kicad_pcb$/i.test(file) ? 'icon_pcbnew_16'
  : /\.kicad_sym$/i.test(file) ? 'library'
  : /\.kicad_mod$/i.test(file) ? 'module'
  : /\.(step|stp|wrl|wings)$/i.test(file) ? 'three_d'
  : /\.pdf$/i.test(file) ? 'file_pdf'
  : /\.(txt|md|rpt|net)$/i.test(file) ? 'datasheet'
  : 'directory_browser';

/** A node in the project's on-disk directory tree. */
interface DirNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: PickedHomeFile;
  children: DirNode[];
}

// Files KiCad's project tree hides (config/lock/cache/backup and dotfiles).
const isHiddenFile = (base: string): boolean =>
  base.startsWith('.') ||
  /\.(kicad_pro|kicad_prl|lck)$/i.test(base) ||
  base === 'fp-lib-table' ||
  base === 'sym-lib-table' ||
  /-backups?$/i.test(base);

// KiCad's PROJECT_ARCHIVER::Archive allow-list (common/project/project_archiver.cpp)
// with aIncludeExtraFiles=true — the flag the manager passes for "Archive Project"
// (kicad/project_tree_pane.cpp). Extension strings from wildcards_and_files_ext.cpp.
const ARCHIVE_EXTENSIONS = new Set([
  // always archived
  'kicad_pro', 'kicad_prl', 'kicad_sch', 'kicad_mbs', 'kicad_sym', 'kicad_pcb',
  'kicad_mod', 'kicad_dru', 'kicad_wks', 'kicad_jobset', 'json', 'wbk',
  // extra files (aIncludeExtraFiles): legacy formats, 3D models, fab outputs…
  'pro', 'sch', 'lib', 'dcm', 'cmp', 'brd', 'mod', 'stp', 'step', 'wrl',
  'gbrjob', 'pos', 'drl', 'nc', 'xnc', 'd356', 'rpt', 'net', 'py', 'pdf',
  'txt', 'cir', 'sub', 'model', 'ibs', 'pkg', 'cad',
]);
// Extension-less files KiCad always archives (the library tables).
const ARCHIVE_FILENAMES = new Set(['fp-lib-table', 'sym-lib-table', 'design-block-lib-table']);
// Gerber extensions (FILEEXT::GerberFileExtensionsRegex), matched on the ext.
const GERBER_EXT_RE = /(gbr|gko|pho|(g[tb][alops])|(gm?\d\d*)|(gp[tb]))/i;

// Whether KiCad's archiver would include this file (its extension/name filter).
const inArchiveAllowList = (name: string): boolean => {
  const base = name.split('/').pop()!.split('\\').pop()!;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 1 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext) return ARCHIVE_EXTENSIONS.has(ext) || GERBER_EXT_RE.test(ext);
  return ARCHIVE_FILENAMES.has(base.toLowerCase());
};

// KiCad marks a file as a project "root file" when its basename matches the
// project name (or "project-*") — PROJECT_TREE_PANE::addItemToProjectTree, and
// these sort ahead of other files (project_tree.cpp OnCompareItems).
const isRootFileName = (name: string, projLower: string): boolean => {
  if (!projLower) return false;
  const base = name.toLowerCase().replace(/\.[^.]+$/, '');
  return base === projLower || base.startsWith(projLower + '-');
};

// PROJECT_TREE::OnCompareItems ordering: directories first, then root files,
// then case-insensitive by name (wxString::CmpNoCase).
const compareTreeNodes = (a: DirNode, b: DirNode, projLower: string): number => {
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
function buildDirTree(files: PickedHomeFile[], stripPrefix: string, projLower: string): DirNode {
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
        child = { name: part, path: (cur.path ? cur.path + '/' : '') + part, isDir: !isLast, children: [] };
        cur.children.push(child);
      }
      if (isLast) { child.isDir = false; child.file = f; }
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

/**
 * KiCad-style project manager: open a project folder, see its files in the
 * tree, then launch the Schematic Editor on it — the same workflow as the
 * desktop app's project window. Until a project is opened, the bundled demo
 * project is shown.
 */
export function HomePage({ onOpenSchematic, onOpenProject, onOpenPcb, initialFiles }: {
  onOpenSchematic: () => void;
  onOpenProject?: (files: PickedHomeFile[], startFile?: string) => void;
  onOpenPcb?: (file: PickedHomeFile, files?: PickedHomeFile[]) => void;
  /** A project already open in the app: keep it in the tree on return to home. */
  initialFiles?: PickedHomeFile[] | null;
}): JSX.Element {
  const { session, signOut } = useAuth();
  const dirInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  // The picked project's files (shown in the tree until the editor is launched).
  const [picked, setPicked] = useState<PickedHomeFile[] | null>(initialFiles ?? null);
  // Saved projects (IndexedDB) — the offline half of cloud persistence.
  const [saved, setSaved] = useState<ProjectMeta[]>([]);
  // Expanded directory-tree folder paths (collapsed by default, like KiCad).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // New Project dialog (KiCad's File > New Project name prompt).
  const [newName, setNewName] = useState<string | null>(null);
  // Project-tree pane width (px), draggable like KiCad's wxAUI sash.
  const [panelWidth, setPanelWidth] = useState(290);
  // Non-null while opening/saving a project — drives KiCad's "Load Schematic"
  // style progress overlay so the UI doesn't look frozen mid-load.
  const [loading, setLoading] = useState<string | null>(null);
  const refreshSaved = (): void => { if (storageAvailable()) void listProjects().then(setSaved); };
  useEffect(refreshSaved, []);

  // Sign-in (or session restore): pull the user's cloud projects into the local
  // store and push any local-only ones up, then refresh the list.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || !storageAvailable()) return;
    let cancelled = false;
    void syncAllProjects(userId)
      .then(() => { if (!cancelled) refreshSaved(); })
      .catch((e) => console.warn('Cloud sync failed:', e));
    return () => { cancelled = true; };
  }, [userId]);

  // Derive a project name from the .kicad_pro (else the root .kicad_sch, else folder).
  const projectNameOf = (files: PickedHomeFile[]): string => {
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const src = pro?.name ?? files.find((f) => /\.kicad_sch$/i.test(f.name))?.name ?? files[0]?.name ?? 'Project';
    return basename(src).replace(/\.(kicad_pro|kicad_sch|kicad_pcb)$/i, '');
  };

  // Read the contents of *every* picked file — not just the KiCad documents —
  // so the whole project (footprint/symbol libs, net/report/text files, etc.)
  // survives a save, archive, and reopen instead of collapsing to sch+pcb. The
  // storage layer gzips text ~10x, so keeping the libs is cheap. The project is
  // persisted to IndexedDB so it survives a reload with no login.
  const ingest = async (files: { name: string; bytesOf: () => Promise<Uint8Array> }[], persist = true): Promise<void> => {
    setLoading('Reading files…');
    await nextPaint(); // show the overlay before the main thread gets busy
    try {
      const out: PickedHomeFile[] = [];
      for (const f of files) {
        const base = f.name.split('/').pop()!;
        if (base.startsWith('.')) continue;
        const bytes = await f.bytesOf();
        out.push({ name: f.name, text: dec.decode(bytes), bytes });
      }
      if (out.length === 0) return;
      setPicked(out);
      if (persist && storageAvailable()) {
        try {
          // Persist every file's raw bytes (empty files carry nothing to reopen).
          const withBytes = out.filter((f) => f.bytes && f.bytes.length > 0);
          if (withBytes.length > 0) {
            setLoading('Saving project…');
            const name = projectNameOf(out);
            // Reuse an existing record of the same name so reopening a folder
            // updates it rather than piling up duplicates.
            const existing = (await listProjects()).find((p) => p.name === name);
            const pid = await saveProject(name, withBytes.map((f) => ({ name: f.name, bytes: f.bytes! })), existing?.id);
            refreshSaved();
            // Mirror to the cloud when signed in (best-effort, non-blocking).
            if (userId) void pushProject(userId, pid).catch((e) => console.warn('Cloud push failed:', e));
          }
        } catch { /* storage disabled (private mode) — the app still works */ }
      }
    } finally {
      setLoading(null);
    }
  };

  // File > New Project: create a blank project from scratch (the three files
  // KiCad writes — .kicad_pro, root .kicad_sch, .kicad_pcb), show it in the
  // manager tree, and persist it like an opened project. KiCad leaves the new
  // project in the manager; the user then launches an editor from a tile.
  const createNewProject = async (): Promise<void> => {
    const name = sanitizeProjectName(newName ?? '');
    if (!name) return;
    const files = newProjectFiles(name);
    setPicked(files);
    setExpanded(new Set());
    setNewName(null);
    if (storageAvailable()) {
      try {
        // Reuse an existing record of the same name (overwrite, don't duplicate).
        const existing = (await listProjects()).find((p) => p.name === name);
        const pid = await saveProject(name, files.map((f) => ({ name: f.name, bytes: f.bytes! })), existing?.id);
        refreshSaved();
        if (userId) void pushProject(userId, pid).catch((e) => console.warn('Cloud push failed:', e));
      } catch { /* storage disabled (private mode) — the app still works */ }
    }
  };

  // Reopen a project straight from IndexedDB — no folder picker needed.
  const openStored = async (id: string): Promise<void> => {
    setLoading('Opening project…');
    await nextPaint();
    try {
      const loaded = await loadProject(id);
      if (loaded) setPicked(loaded.files.map((f) => ({ name: f.name, text: dec.decode(f.bytes), bytes: f.bytes })));
    } finally {
      setLoading(null);
    }
  };

  const removeStored = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    await deleteProject(id);
    refreshSaved();
    if (userId) void deleteCloudProject(id).catch((e) => console.warn('Cloud delete failed:', e));
  };

  const onPicked = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    await ingest([...list].map((f) => ({
      name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      bytesOf: async () => new Uint8Array(await f.arrayBuffer()),
    })));
  };

  // Open Project: KiCad opens the .kicad_pro and pulls in the whole project.
  // A browser cannot read a file's siblings, so the closest equivalent is the
  // directory picker (File System Access API), which grants the project folder
  // in one gesture. Chrome refuses that picker for "system" locations — the
  // Downloads folder, the profile root, Desktop — so anything but a plain user
  // cancel falls back to the classic webkitdirectory input, which has no such
  // blocklist. Multi-file selection and folder drag-and-drop cover the rest.
  const openProjectPicker = async (): Promise<void> => {
    interface DirHandle { values: () => AsyncIterable<FsEntry> }
    interface FsEntry { kind: string; name: string; getFile: () => Promise<File>; values: () => AsyncIterable<FsEntry> }
    const w = window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> };
    if (w.showDirectoryPicker) {
      try {
        const dir = await w.showDirectoryPicker();
        const files: { name: string; bytesOf: () => Promise<Uint8Array> }[] = [];
        // Recurse so footprint/3D-model subfolders (CM5IO.pretty, 3d_lib …)
        // populate the directory tree, not just the top level.
        const walkHandle = async (handle: DirHandle, prefix: string, depth: number): Promise<void> => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') files.push({ name: prefix + entry.name, bytesOf: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer()) });
            else if (entry.kind === 'directory' && depth < 6) await walkHandle(entry, `${prefix}${entry.name}/`, depth + 1);
          }
        };
        await walkHandle(dir, '', 0);
        await ingest(files);
        return;
      } catch (e) {
        // AbortError = the user closed the dialog; anything else (blocked
        // folder, SecurityError, unsupported) gets the fallback input.
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    dirInputRef.current?.click();
  };

  // Folder drag-and-drop: walk the dropped directory entries (no blocklist,
  // works for Downloads/Desktop) and ingest every file found.
  const onDropProject = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    interface Entry { isFile: boolean; isDirectory: boolean; name: string; file: (ok: (f: File) => void, err: (e: unknown) => void) => void; createReader: () => { readEntries: (ok: (b: Entry[]) => void, err: () => void) => void } }
    const readAll = (dir: Entry): Promise<Entry[]> => new Promise((res) => {
      const reader = dir.createReader();
      const all: Entry[] = [];
      const next = (): void => reader.readEntries((batch) => {
        if (batch.length === 0) res(all);
        else { all.push(...batch); next(); }
      }, () => res(all));
      next();
    });
    const files: { name: string; bytesOf: () => Promise<Uint8Array> }[] = [];
    // Keep the relative path (prefix) so the directory tree reconstructs folders.
    const walk = async (entry: Entry, prefix: string, depth: number): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => entry.file(res, rej)).catch(() => null);
        if (file) files.push({ name: prefix + file.name, bytesOf: async () => new Uint8Array(await file.arrayBuffer()) });
      } else if (entry.isDirectory && depth < 6) {
        for (const child of await readAll(entry)) await walk(child, `${prefix}${entry.name}/`, depth + 1);
      }
    };
    const entries = [...e.dataTransfer.items]
      .map((i) => i.webkitGetAsEntry() as unknown as Entry | null)
      .filter((x): x is Entry => !!x);
    for (const en of entries) await walk(en, '', 0);
    await ingest(files);
  };

  // Path relative to the project's own folder ("proj/proj.kicad_sch" ->
  // "proj.kicad_sch", "proj/sub/a.kicad_sch" -> "sub/a.kicad_sch").
  const relPath = (name: string): string => {
    const p = name.replace(/\\/g, '/');
    return p.includes('/') ? p.slice(p.indexOf('/') + 1) : p;
  };

  // Archive Project: KiCad zips the whole project folder, reading each file as a
  // raw byte stream (PROJECT_ARCHIVER::Archive). We do the same — zip every
  // file's bytes byte-exact (so binaries survive), re-nested under a folder
  // named for the project (so it unzips the way KiCad expects).
  const archiveProject = (): void => {
    if (!picked) return;
    // KiCad archives only its allow-listed file types (gerbers/backups/images
    // and other stray files are skipped), reading each as raw bytes.
    const withBytes = picked.filter((f) => f.bytes && f.bytes.length > 0 && inArchiveAllowList(f.name));
    if (withBytes.length === 0) return;
    const name = projectNameOf(picked);
    const entries: Record<string, Uint8Array> = {};
    for (const f of withBytes) entries[`${name}/${relPath(f.name)}`] = f.bytes!;
    const blob = new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Unarchive Project: read a .zip, expand it in memory, and feed its files
  // through the same ingest path as a folder open (so it lands in the tree and
  // persists). Entries are raw bytes — byte-exact, like KiCad's Unarchive.
  const onUnarchive = async (list: FileList | null): Promise<void> => {
    const file = list?.[0];
    if (!file) return;
    let entries: Record<string, Uint8Array>;
    try { entries = unzipSync(new Uint8Array(await file.arrayBuffer())); }
    catch { return; /* not a valid zip */ }
    const files = Object.entries(entries)
      .filter(([name, data]) => !name.endsWith('/') && data.length > 0)
      .map(([name, data]) => ({ name, bytesOf: async () => data }));
    await ingest(files);
  };

  const runMgrAction = (action: MgrAction): void => {
    switch (action) {
      case 'open': void openProjectPicker(); break;
      case 'new': setNewName(''); break;
      case 'archive': archiveProject(); break;
      case 'unarchive': zipInputRef.current?.click(); break;
      case 'refresh': refreshSaved(); break;
    }
  };

  // Drag the sash to resize the project-tree pane (clamped like KiCad's panes).
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent): void =>
      setPanelWidth(Math.min(600, Math.max(180, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  const proFile = useMemo(() => picked?.find((f) => /\.kicad_pro$/i.test(f.name)) ?? null, [picked]);
  const displayName = proFile ? basename(proFile.name).replace(/\.kicad_pro$/i, '') : '';

  // The project name drives KiCad's root-file detection (which schematic shows,
  // and the sort weight). Falls back to the root .kicad_sch / first file.
  const projName = useMemo(() => (picked ? projectNameOf(picked) : ''), [picked]);
  const projLower = projName.toLowerCase();

  const launchSchematic = (startFile?: string): void => {
    if (picked && onOpenProject) onOpenProject(picked, startFile);
    else onOpenSchematic();
  };

  const pcbFile = useMemo(
    () => picked?.find((f) => /\.kicad_pcb$/i.test(basename(f.name))) ?? null,
    [picked],
  );
  // Like standalone pcbnew: with no project, the PCB Editor opens a new empty
  // board (KiCad's default 2-layer stack with the full tech layer table).
  const launchPcb = (): void => {
    if (!onOpenPcb) return;
    // Carry the whole project so the board editor can jump to the schematic.
    if (pcbFile && picked) onOpenPcb(pcbFile, picked);
    else onOpenPcb({ name: 'untitled.kicad_pcb', text: EMPTY_PCB });
  };

  // The on-disk directory tree, sorted exactly like KiCad's project window
  // (dirs first, root files next, then case-insensitive by name). Footprint/3D
  // libraries stay inside collapsible folders instead of flooding the list.
  const dirRoot = useMemo<DirNode | null>(() => {
    if (!picked) return null;
    const anyPath = (proFile?.name ?? picked[0]?.name ?? '').replace(/\\/g, '/');
    const firstSeg = anyPath.includes('/') ? anyPath.split('/')[0] + '/' : '';
    const strip = firstSeg && picked.every((f) => f.name.replace(/\\/g, '/').startsWith(firstSeg)) ? firstSeg : '';
    return buildDirTree(picked, strip, projLower);
  }, [picked, proFile, projLower]);

  const toggleDir = (path: string): void =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });

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
            onClick={() => toggleDir(node.path)}
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
    const openFn =
      isPcb && onOpenPcb && node.file ? () => onOpenPcb(node.file!, picked ?? undefined)
      : isSch ? () => launchSchematic(basename(node.name))
      : undefined;
    return (
      <div
        key={node.path}
        className="ze-tree-item"
        style={{ paddingLeft: 8 + depth * 16 + 15, cursor: openFn ? 'pointer' : 'default' }}
        title={isPcb ? 'Open in the PCB Editor' : isSch ? 'Open in the Schematic Editor' : node.path}
        onClick={openFn}
      >
        <TreeIcon name={treeIconFor(node.name)} />
        <span>{node.name}</span>
      </div>
    );
  };

  // KiCad's project-manager File menu (the working subset).
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New Project…', action: () => setNewName(''), shortcut: 'Ctrl+N' },
        { label: 'Open Project…', icon: 'open', action: () => void openProjectPicker(), shortcut: 'Ctrl+O' },
        { label: 'Select Project Files…', action: () => filesInputRef.current?.click() },
        { sep: true },
        { label: 'Archive Project…', action: () => archiveProject(), disabled: !picked },
        { label: 'Unarchive Project…', action: () => zipInputRef.current?.click() },
        { sep: true },
        { label: 'Close Project', action: () => setPicked(null), disabled: !picked },
      ],
    },
    { label: 'View', items: [{ label: 'Refresh', action: () => {} }] },
    {
      label: 'Tools',
      items: [{ label: 'Edit Schematic', action: () => launchSchematic(), shortcut: 'Ctrl+E' }],
    },
    { label: 'Help', items: [{ label: 'About ZiroEDA', action: () => {} }] },
  ];

  return (
    <div className="ze-app">
      <input
        ref={dirInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        // Non-standard but universally supported attribute: pick a whole folder.
        {...{ webkitdirectory: '' }}
        onChange={(e) => { void onPicked(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept=".kicad_pro,.kicad_sch,.kicad_pcb,.kicad_dru,.kicad_prl,.kicad_wks,.kicad_sym,.md,.txt"
        style={{ display: 'none' }}
        onChange={(e) => { void onPicked(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => { void onUnarchive(e.target.files); e.target.value = ''; }}
      />

      <MenuBar
        menus={menus}
        rightSlot={
          session ? (
            <div className="ze-account">
              <span className="ze-account-email">{session.user.email}</span>
              <button className="ze-account-signout" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : undefined
        }
      />

      <div
        className="ze-home-body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void onDropProject(e)}
      >
        {/* far-left vertical toolbar */}
        <div className="ze-mgrbar">
          {MGR_TOOLS.map((t, i) =>
            t === 'sep' ? (
              <span key={`s${i}`} className="sep" />
            ) : (
              <button
                key={t.icon}
                title={t.title}
                aria-label={t.title}
                disabled={(t.action === 'archive' || t.action === 'refresh') && !picked}
                onClick={() => runMgrAction(t.action)}
              >
                <img src={mgrUrl(t.icon)} alt="" />
              </button>
            ),
          )}
        </div>

        {/* project file tree */}
        <div className="ze-panel left" style={{ width: panelWidth }}>
          <div className="ze-panel-header">Project Files</div>
          <div className="ze-panel-body">
            {picked ? (
              <>
                {/* project root (.kicad_pro), bold like KiCad's tree root */}
                <div className="ze-tree-item root active">
                  <span className="twisty expandable open" />
                  <TreeIcon name="project_kicad" />
                  <span>{displayName || projName || 'Project'}</span>
                </div>
                {/* project directory contents, flat and KiCad-sorted */}
                {dirRoot?.children.map((c) => renderDir(c, 1))}
              </>
            ) : (
              <>
                <div
                  className="ze-tree-item"
                  style={{ fontWeight: 600 }}
                  onClick={() => void openProjectPicker()}
                  title="Open a KiCad project (the folder holding the .kicad_pro and its sheets)"
                >
                  📂 Open KiCad Project…
                </div>
                <div
                  className="ze-tree-item"
                  onClick={() => filesInputRef.current?.click()}
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

        {/* draggable sash between the tree and the launchers (KiCad's wxAUI pane) */}
        <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />

        {/* launcher tiles (fixed) with the Recent Projects list scrolling below */}
        <div className="ze-launchers">
          <div className="ze-tiles">
            {TILES.map((t) => {
              const enabled = t.enabled || t.id === 'pcb';
              const launch = t.id === 'pcb' ? launchPcb : (): void => launchSchematic();
              return (
                <button
                  key={t.id}
                  className="ze-launcher"
                  disabled={!enabled}
                  title={t.desc}
                  onClick={enabled ? launch : undefined}
                >
                  <span className="ico">{tileIcon(t.id)}</span>
                  <span className="txt">
                    <span className="name">{t.name}</span>
                    <span className="desc">{t.desc}</span>
                  </span>
                  {!enabled && <span className="soon">coming soon</span>}
                </button>
              );
            })}
          </div>

          {saved.length > 0 && (
            <div className="ze-recent">
              <div className="ze-recent-head">Recent Projects</div>
              <div className="ze-recent-list">
                {saved.map((p) => (
                  <div
                    key={p.id}
                    className="ze-recent-item"
                    onClick={() => void openStored(p.id)}
                    title={`Reopen ${p.name} — saved in this browser`}
                  >
                    <TreeIcon name="project_kicad" />
                    <span className="ze-recent-name">{p.name}</span>
                    <span className="ze-recent-meta">
                      {p.fileCount} file{p.fileCount === 1 ? '' : 's'} · {fmtBytes(p.bytes)} · {fmtWhen(p.updatedAt)}
                    </span>
                    <button
                      className="ze-recent-del"
                      title="Remove from this browser"
                      onClick={(e) => void removeStored(p.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ze-statusbar">
        <span className="cell grow">
          {picked ? `Project: ${proFile?.name ?? projName ?? '—'}` : 'No project loaded'}
        </span>
      </div>

      {newName !== null && (
        <div className="ze-modal-backdrop" onMouseDown={() => setNewName(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              New Project
              <span className="x" title="Cancel" onClick={() => setNewName(null)}>✕</span>
            </div>
            <div className="ze-label-dialog-body">
              <div className="row">
                <span>Name</span>
                <input
                  className="ze-search"
                  autoFocus
                  placeholder="untitled"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createNewProject();
                    else if (e.key === 'Escape') setNewName(null);
                  }}
                />
              </div>
              <div style={{ opacity: 0.6, fontSize: 12, paddingLeft: 66 }}>
                Creates {sanitizeProjectName(newName) || 'untitled'}.kicad_pro, .kicad_sch and .kicad_pcb.
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setNewName(null)}>Cancel</button>
              <button
                className="ze-btn primary"
                disabled={!sanitizeProjectName(newName)}
                onClick={() => void createNewProject()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KiCad's "Load Schematic" progress dialog, web-style: a blocking overlay
          with a spinner so the tree isn't interactable-but-janky mid-load. */}
      {loading && (
        <div className="ze-modal-backdrop ze-loading-backdrop">
          <div className="ze-loading-card">
            <span className="ze-spinner" />
            <span>{loading}</span>
          </div>
        </div>
      )}
    </div>
  );
}
