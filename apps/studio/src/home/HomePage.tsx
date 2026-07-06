import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { parse, readSchematic, buildSheetTree, findRootFile, type Schematic, type SheetTreeNode } from '@ziroeda/core';
import { MenuBar, type Menu } from '../ui/MenuBar.js';
import { storageAvailable, listProjects, saveProject, loadProject, deleteProject, type ProjectMeta } from './projectStore.js';
import '../ui/shell.css';

/** A file picked from disk for a project open. */
export interface PickedHomeFile { name: string; text: string }

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

// KiCad project-manager left toolbar (toolbars_kicad_manager.cpp).
const MGR_TOOLS: ({ icon: string; title: string; action?: 'open' } | 'sep')[] = [
  { icon: 'new_project_from_template', title: 'New Project…' },
  { icon: 'open_project', title: 'Open Project…', action: 'open' },
  'sep',
  { icon: 'zip', title: 'Archive Project…' },
  { icon: 'unzip', title: 'Unarchive Project…' },
  'sep',
  { icon: 'refresh', title: 'Refresh' },
  'sep',
  { icon: 'directory_browser', title: 'Browse Project Files' },
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

/**
 * Reconstruct the on-disk folder hierarchy from the picked files' relative
 * paths so the tree mirrors KiCad's project window — footprint/3D libraries
 * (CM5IO.pretty, 3d_lib, *.3dshapes) stay inside collapsible folders instead
 * of flooding the list. `stripPrefix` removes the picked folder's own name.
 */
function buildDirTree(files: PickedHomeFile[], stripPrefix: string): DirNode {
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
    n.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
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
  const dirInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  // The picked project's files (shown in the tree until the editor is launched).
  const [picked, setPicked] = useState<PickedHomeFile[] | null>(initialFiles ?? null);
  // Saved projects (IndexedDB) — the offline half of cloud persistence.
  const [saved, setSaved] = useState<ProjectMeta[]>([]);
  // Expanded directory-tree folder paths (collapsed by default, like KiCad).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const refreshSaved = (): void => { if (storageAvailable()) void listProjects().then(setSaved); };
  useEffect(refreshSaved, []);

  // Derive a project name from the .kicad_pro (else the root .kicad_sch, else folder).
  const projectNameOf = (files: PickedHomeFile[]): string => {
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const src = pro?.name ?? files.find((f) => /\.kicad_sch$/i.test(f.name))?.name ?? files[0]?.name ?? 'Project';
    return basename(src).replace(/\.(kicad_pro|kicad_sch|kicad_pcb)$/i, '');
  };

  // Read every picked file; all files show in the tree (like KiCad's project
  // window), but only .kicad_sch/.kicad_pro/.kicad_pcb contents are read. The
  // project is persisted to IndexedDB so it survives a reload with no login.
  const ingest = async (files: { name: string; textOf: () => Promise<string> }[], persist = true): Promise<void> => {
    const out: PickedHomeFile[] = [];
    for (const f of files) {
      const base = f.name.split('/').pop()!;
      if (base.startsWith('.')) continue;
      out.push({
        name: f.name,
        text: /\.(kicad_sch|kicad_pro|kicad_pcb)$/i.test(base) ? await f.textOf() : '',
      });
    }
    if (out.length === 0) return;
    setPicked(out);
    if (persist && storageAvailable()) {
      try {
        // Store only the files that carry content (the ones we can reopen).
        const withText = out.filter((f) => f.text !== '');
        if (withText.length > 0) {
          const name = projectNameOf(out);
          // Reuse an existing record of the same name so reopening a folder
          // updates it rather than piling up duplicates.
          const existing = (await listProjects()).find((p) => p.name === name);
          await saveProject(name, withText, existing?.id);
          refreshSaved();
        }
      } catch { /* storage disabled (private mode) — the app still works */ }
    }
  };

  // Reopen a project straight from IndexedDB — no folder picker needed.
  const openStored = async (id: string): Promise<void> => {
    const loaded = await loadProject(id);
    if (loaded) setPicked(loaded.files.map((f) => ({ name: f.name, text: f.text })));
  };

  const removeStored = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    await deleteProject(id);
    refreshSaved();
  };

  const onPicked = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    await ingest([...list].map((f) => ({
      name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      textOf: () => f.text(),
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
        const files: { name: string; textOf: () => Promise<string> }[] = [];
        // Recurse so footprint/3D-model subfolders (CM5IO.pretty, 3d_lib …)
        // populate the directory tree, not just the top level.
        const walkHandle = async (handle: DirHandle, prefix: string, depth: number): Promise<void> => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') files.push({ name: prefix + entry.name, textOf: async () => (await entry.getFile()).text() });
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
    const files: { name: string; textOf: () => Promise<string> }[] = [];
    // Keep the relative path (prefix) so the directory tree reconstructs folders.
    const walk = async (entry: Entry, prefix: string, depth: number): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => entry.file(res, rej)).catch(() => null);
        if (file) files.push({ name: prefix + file.name, textOf: () => file.text() });
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

  const proFile = useMemo(() => picked?.find((f) => /\.kicad_pro$/i.test(f.name)) ?? null, [picked]);
  const displayName = proFile ? basename(proFile.name).replace(/\.kicad_pro$/i, '') : '';

  // Parse the schematics to build the same nested hierarchy KiCad's project
  // window shows under the root schematic (sub-sheets as children).
  const hierarchy = useMemo<{ root: string; tree: SheetTreeNode } | null>(() => {
    if (!picked) return null;
    const docs = new Map<string, Schematic>();
    for (const f of picked) {
      const base = basename(f.name);
      if (!/\.kicad_sch$/i.test(base)) continue;
      try { docs.set(base, readSchematic(parse(f.text))); } catch { /* listed but unparsed */ }
    }
    if (docs.size === 0) return null;
    const root = findRootFile(docs, proFile ? basename(proFile.name) : undefined);
    return { root, tree: buildSheetTree(docs, root) };
  }, [picked, proFile]);

  // Schematics not reachable from the root (e.g. the root sheet itself is
  // missing from the folder) — still listed so nothing silently disappears.
  const orphanSheets = useMemo(() => {
    if (!picked) return [];
    const reachable = new Set<string>();
    const walk = (n: SheetTreeNode): void => { reachable.add(n.file); n.children.forEach(walk); };
    if (hierarchy) walk(hierarchy.tree);
    return picked
      .map((f) => basename(f.name))
      .filter((b) => /\.kicad_sch$/i.test(b) && !reachable.has(b))
      .sort((a, b) => a.localeCompare(b));
  }, [picked, hierarchy]);

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

  // The nested schematic hierarchy, exactly like KiCad's project window: the
  // root schematic with its sub-sheets as children (recursively).
  const renderTreeNode = (node: SheetTreeNode, depth: number): JSX.Element => (
    <div key={`${node.file}:${depth}`}>
      <div
        className="ze-tree-item"
        style={{ paddingLeft: 8 + depth * 16, cursor: 'pointer' }}
        title="Open in the Schematic Editor"
        onClick={() => launchSchematic(node.file)}
      >
        {node.children.length > 0 && <span className="twisty">▾</span>}
        <TreeIcon name="icon_eeschema_24" />
        <span>{node.file}</span>
      </div>
      {node.children.map((c, i) => (
        <div key={`${c.file}:${i}`}>{renderTreeNode(c, depth + 1)}</div>
      ))}
    </div>
  );

  // The on-disk directory tree (folders collapsible), so footprint/3D libraries
  // don't flood the list. Schematics are shown via the hierarchy above, so they
  // (and hidden config files) are omitted here.
  const dirRoot = useMemo<DirNode | null>(() => {
    if (!picked) return null;
    const anyPath = (proFile?.name ?? picked[0]?.name ?? '').replace(/\\/g, '/');
    const firstSeg = anyPath.includes('/') ? anyPath.split('/')[0] + '/' : '';
    const strip = firstSeg && picked.every((f) => f.name.replace(/\\/g, '/').startsWith(firstSeg)) ? firstSeg : '';
    return buildDirTree(picked, strip);
  }, [picked, proFile]);

  const toggleDir = (path: string): void =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });

  const renderDir = (node: DirNode, depth: number): JSX.Element | null => {
    if (node.isDir) {
      const kids = node.children.filter((c) => c.isDir || (!/\.kicad_sch$/i.test(c.name) && !isHiddenFile(c.name)));
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
            <span className="twisty">{open ? '▾' : '▸'}</span>
            <TreeIcon name={open ? 'directory_open' : 'directory'} />
            <span>{node.name}</span>
          </div>
          {open && kids.map((c) => renderDir(c, depth + 1))}
        </div>
      );
    }
    if (/\.kicad_sch$/i.test(node.name) || isHiddenFile(node.name)) return null;
    const isPcb = /\.kicad_pcb$/i.test(node.name);
    return (
      <div
        key={node.path}
        className="ze-tree-item"
        style={{ paddingLeft: 8 + depth * 16 + 15, cursor: isPcb ? 'pointer' : 'default' }}
        title={isPcb ? 'Open in the PCB Editor' : node.path}
        onClick={isPcb && onOpenPcb && node.file ? () => onOpenPcb(node.file!, picked ?? undefined) : undefined}
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
        { label: 'Open Project…', icon: 'open', action: () => void openProjectPicker(), shortcut: 'Ctrl+O' },
        { label: 'Select Project Files…', action: () => filesInputRef.current?.click() },
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

      <MenuBar menus={menus} />

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
                onClick={t.action === 'open' ? () => void openProjectPicker() : undefined}
              >
                <img src={mgrUrl(t.icon)} alt="" />
              </button>
            ),
          )}
        </div>

        {/* project file tree */}
        <div className="ze-panel left" style={{ width: 290 }}>
          <div className="ze-panel-header">Project Files</div>
          <div className="ze-panel-body">
            {picked ? (
              <>
                {/* project root (.kicad_pro), like KiCad's tree root */}
                <div className="ze-tree-item root active">
                  <span className="twisty">▾</span>
                  <TreeIcon name="project_kicad" />
                  <span>{displayName || hierarchy?.tree.file.replace(/\.kicad_sch$/i, '') || 'Project'}</span>
                </div>
                {/* root schematic with its sub-sheets nested under it */}
                {hierarchy && renderTreeNode(hierarchy.tree, 1)}
                {orphanSheets.map((b) => (
                  <div
                    key={b}
                    className="ze-tree-item"
                    style={{ paddingLeft: 24, cursor: 'pointer' }}
                    title="Open in the Schematic Editor"
                    onClick={() => launchSchematic(b)}
                  >
                    <TreeIcon name="icon_eeschema_24" />
                    <span>{b}</span>
                  </div>
                ))}
                {/* remaining project files & folders, mirroring the directory */}
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
          {picked ? `Project: ${proFile?.name ?? hierarchy?.root ?? '—'}` : 'No project loaded'}
        </span>
      </div>
    </div>
  );
}
