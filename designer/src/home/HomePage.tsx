import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { MenuBar, type Menu } from '../ui/MenuBar.js';
import {
  storageAvailable,
  listProjects,
  saveProject,
  loadProject,
  deleteProject,
  touchOpened,
  type ProjectMeta,
} from './projectStore.js';
import { useAuth } from '../auth/AuthProvider.js';
import { syncAllProjects, pushProject, deleteCloudProject } from '../cloud/sync.js';
import { LoadingOverlay, nextPaint } from '../ui/LoadingOverlay.js';
import { loadTemplates, createFromTemplate, type TemplateMeta } from './templates.js';
import '../ui/shell.css';
import type { PickedHomeFile } from './files.js';
import { EMPTY_PCB, newProjectFiles, sanitizeProjectName } from './newProject.js';
import {
  buildDirTree,
  treeIconFor,
  isHiddenFile,
  inArchiveAllowList,
  isRootFileName,
  basename,
  fmtBytes,
  fmtWhen,
  type DirNode,
} from './projectTree.js';

export type { PickedHomeFile } from './files.js';
import { archiveEntries, zipArchive, expandArchive } from './archive.js';
import { NewProjectDialog } from './components/NewProjectDialog.js';
import { TemplateDialog } from './components/TemplateDialog.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

// KiCad's own dark-theme icons (GPL), vendored under assets/.
const TILE_ICONS = import.meta.glob('../assets/launcher/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const MGR_ICONS = import.meta.glob('../assets/manager/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
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
  {
    id: 'symbols',
    name: 'Symbol Editor',
    desc: 'Edit global and/or project schematic symbol libraries',
    enabled: true,
  },
  { id: 'pcb', name: 'PCB Editor', desc: 'Edit the project PCB design' },
  {
    id: 'footprints',
    name: 'Footprint Editor',
    desc: 'Edit global and/or project PCB footprint libraries',
    enabled: true,
  },
  { id: 'gerber', name: 'Gerber Viewer', desc: 'Preview Gerber files' },
  {
    id: 'image',
    name: 'Image Converter',
    desc: 'Convert bitmap images to schematic symbols or PCB footprints',
  },
  {
    id: 'calculator',
    name: 'Calculator Tools',
    desc: 'Show tools for calculating resistance, current capacity, etc.',
  },
  {
    id: 'drawingsheet',
    name: 'Drawing Sheet Editor',
    desc: 'Edit drawing sheet borders and title blocks for use in schematics and PCB designs',
  },
  {
    id: 'pcm',
    name: 'Plugin and Content Manager',
    desc: 'Manage downloadable packages from KiCad and 3rd party repositories',
  },
];

// KiCad project-manager left toolbar (toolbars_kicad_manager.cpp). "Browse
// Project Files" is dropped: a browser can't open the OS file manager, and the
// left panel already is the project tree.
type MgrAction = 'open' | 'new' | 'template' | 'archive' | 'unarchive' | 'refresh';
const MGR_TOOLS: ({ icon: string; title: string; action: MgrAction } | 'sep')[] = [
  { icon: 'new_project_from_template', title: 'New Project from Template…', action: 'template' },
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

/**
 * KiCad-style project manager: open a project folder, see its files in the
 * tree, then launch the Schematic Editor on it — the same workflow as the
 * desktop app's project window. Until a project is opened, the bundled demo
 * project is shown.
 */
export function HomePage({
  onOpenSchematic,
  onOpenProject,
  onOpenPcb,
  onOpenSymbolEditor,
  onOpenFootprintEditor,
  initialFiles,
}: {
  onOpenSchematic: () => void;
  onOpenProject?: (files: PickedHomeFile[], startFile?: string) => void;
  onOpenPcb?: (file: PickedHomeFile, files?: PickedHomeFile[]) => void;
  /** Launch the Symbol Editor (with the open project's libraries, if any).
   *  `startFile` is a `.kicad_sym` to open straight away (KiCad's MAIL_LIB_EDIT). */
  onOpenSymbolEditor?: (files?: PickedHomeFile[], startFile?: string) => void;
  /** Launch the Footprint Editor (with the open project's `.pretty` libraries, if any).
   *  `startFile` is a `.kicad_mod` to open straight away (KiCad's MAIL_FP_EDIT). */
  onOpenFootprintEditor?: (files?: PickedHomeFile[], startFile?: string) => void;
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
  // Selected tree row (single click). Double click opens — like KiCad's tree.
  const [selected, setSelected] = useState<string | null>(null);
  // Whether the project root node is expanded (its twisty collapses the tree).
  const [rootOpen, setRootOpen] = useState(true);
  // New Project dialog (KiCad's File > New Project name prompt).
  const [newName, setNewName] = useState<string | null>(null);
  // New Project from Template (KiCad's DIALOG_TEMPLATE_SELECTOR).
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplSel, setTplSel] = useState<TemplateMeta | null>(null);
  const [tplName, setTplName] = useState('');
  useEffect(() => {
    void loadTemplates().then(setTemplates);
  }, []);
  // Project-tree pane width (px), draggable like KiCad's wxAUI sash.
  const [panelWidth, setPanelWidth] = useState(290);
  // Non-null while opening/saving a project — drives KiCad's "Load Schematic"
  // style progress overlay so the UI doesn't look frozen mid-load.
  const [loading, setLoading] = useState<string | null>(null);
  const refreshSaved = (): void => {
    if (storageAvailable()) void listProjects().then(setSaved);
  };
  useEffect(refreshSaved, []);

  // Sign-in (or session restore): pull the user's cloud projects into the local
  // store and push any local-only ones up, then refresh the list.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || !storageAvailable()) return;
    let cancelled = false;
    void syncAllProjects(userId)
      .then(() => {
        if (!cancelled) refreshSaved();
      })
      .catch((e) => console.warn('Cloud sync failed:', e));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Derive a project name from the .kicad_pro (else the root .kicad_sch, else folder).
  const projectNameOf = (files: PickedHomeFile[]): string => {
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const src =
      pro?.name ??
      files.find((f) => /\.kicad_sch$/i.test(f.name))?.name ??
      files[0]?.name ??
      'Project';
    return basename(src).replace(/\.(kicad_pro|kicad_sch|kicad_pcb)$/i, '');
  };

  // Read the contents of *every* picked file — not just the KiCad documents —
  // so the whole project (footprint/symbol libs, net/report/text files, etc.)
  // survives a save, archive, and reopen instead of collapsing to sch+pcb. The
  // storage layer gzips text ~10x, so keeping the libs is cheap. The project is
  // persisted to IndexedDB so it survives a reload with no login.
  const ingest = async (
    files: { name: string; bytesOf: () => Promise<Uint8Array> }[],
    persist = true,
  ): Promise<void> => {
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
            const pid = await saveProject(
              name,
              withBytes.map((f) => ({ name: f.name, bytes: f.bytes! })),
              existing?.id,
            );
            refreshSaved();
            // Mirror to the cloud when signed in (best-effort, non-blocking).
            if (userId)
              void pushProject(userId, pid).catch((e) => console.warn('Cloud push failed:', e));
          }
        } catch {
          /* storage disabled (private mode) — the app still works */
        }
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
        const pid = await saveProject(
          name,
          files.map((f) => ({ name: f.name, bytes: f.bytes! })),
          existing?.id,
        );
        refreshSaved();
        if (userId)
          void pushProject(userId, pid).catch((e) => console.warn('Cloud push failed:', e));
      } catch {
        /* storage disabled (private mode) — the app still works */
      }
    }
  };

  // File > New Project from Template: copy the chosen template's files (renamed
  // to the project name, like KiCad's CreateProject) and ingest them.
  const createFromTpl = async (): Promise<void> => {
    const name = sanitizeProjectName(tplName);
    if (!name || !tplSel) return;
    setTplOpen(false);
    setExpanded(new Set());
    const files = await createFromTemplate(tplSel, name);
    if (files.length === 0) return;
    await ingest(files.map((f) => ({ name: f.name, bytesOf: async () => f.bytes! })));
  };

  // Reopen a project straight from IndexedDB — no folder picker needed.
  const openStored = async (id: string): Promise<void> => {
    setLoading('Opening project…');
    await nextPaint();
    try {
      const loaded = await loadProject(id);
      if (loaded)
        setPicked(
          loaded.files.map((f) => ({ name: f.name, text: dec.decode(f.bytes), bytes: f.bytes })),
        );
      await touchOpened(id); // resurface in Recent (ordered by last opened)
      refreshSaved();
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
    await ingest(
      [...list].map((f) => ({
        name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        bytesOf: async () => new Uint8Array(await f.arrayBuffer()),
      })),
    );
  };

  // Open Project: KiCad opens the .kicad_pro and pulls in the whole project.
  // A browser cannot read a file's siblings, so the closest equivalent is the
  // directory picker (File System Access API), which grants the project folder
  // in one gesture. Chrome refuses that picker for "system" locations — the
  // Downloads folder, the profile root, Desktop — so anything but a plain user
  // cancel falls back to the classic webkitdirectory input, which has no such
  // blocklist. Multi-file selection and folder drag-and-drop cover the rest.
  const openProjectPicker = async (): Promise<void> => {
    interface DirHandle {
      values: () => AsyncIterable<FsEntry>;
    }
    interface FsEntry {
      kind: string;
      name: string;
      getFile: () => Promise<File>;
      values: () => AsyncIterable<FsEntry>;
    }
    const w = window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> };
    if (w.showDirectoryPicker) {
      try {
        const dir = await w.showDirectoryPicker();
        const files: { name: string; bytesOf: () => Promise<Uint8Array> }[] = [];
        // Recurse so footprint/3D-model subfolders (CM5IO.pretty, 3d_lib …)
        // populate the directory tree, not just the top level.
        const walkHandle = async (
          handle: DirHandle,
          prefix: string,
          depth: number,
        ): Promise<void> => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file')
              files.push({
                name: prefix + entry.name,
                bytesOf: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer()),
              });
            else if (entry.kind === 'directory' && depth < 6)
              await walkHandle(entry, `${prefix}${entry.name}/`, depth + 1);
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
    interface Entry {
      isFile: boolean;
      isDirectory: boolean;
      name: string;
      file: (ok: (f: File) => void, err: (e: unknown) => void) => void;
      createReader: () => { readEntries: (ok: (b: Entry[]) => void, err: () => void) => void };
    }
    const readAll = (dir: Entry): Promise<Entry[]> =>
      new Promise((res) => {
        const reader = dir.createReader();
        const all: Entry[] = [];
        const next = (): void =>
          reader.readEntries(
            (batch) => {
              if (batch.length === 0) res(all);
              else {
                all.push(...batch);
                next();
              }
            },
            () => res(all),
          );
        next();
      });
    const files: { name: string; bytesOf: () => Promise<Uint8Array> }[] = [];
    // Keep the relative path (prefix) so the directory tree reconstructs folders.
    const walk = async (entry: Entry, prefix: string, depth: number): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => entry.file(res, rej)).catch(() => null);
        if (file)
          files.push({
            name: prefix + file.name,
            bytesOf: async () => new Uint8Array(await file.arrayBuffer()),
          });
      } else if (entry.isDirectory && depth < 6) {
        for (const child of await readAll(entry))
          await walk(child, `${prefix}${entry.name}/`, depth + 1);
      }
    };
    const entries = [...e.dataTransfer.items]
      .map((i) => i.webkitGetAsEntry() as unknown as Entry | null)
      .filter((x): x is Entry => !!x);
    for (const en of entries) await walk(en, '', 0);
    await ingest(files);
  };

  // Archive Project: KiCad zips the whole project folder byte-exact under a
  // folder named for the project (see archive.ts). Here: collect, zip, download.
  const archiveProject = async (): Promise<void> => {
    if (!picked) return;
    const name = projectNameOf(picked);
    const entries = archiveEntries(picked, name);
    if (!entries) return;
    setLoading('Archiving project\u2026');
    await nextPaint(); // paint the overlay before zipSync blocks the main thread
    try {
      const blob = new Blob([zipArchive(entries)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(null);
    }
  };

  // Unarchive Project: read a .zip, expand it in memory, and feed its files
  // through the same ingest path as a folder open (so it lands in the tree and
  // persists). Entries are raw bytes — byte-exact, like KiCad's Unarchive.
  // Unarchive Project: expand a .zip in memory and feed its files through the
  // same ingest path as a folder open (so it lands in the tree and persists).
  const onUnarchive = async (list: FileList | null): Promise<void> => {
    const file = list?.[0];
    if (!file) return;
    const expanded = expandArchive(new Uint8Array(await file.arrayBuffer()));
    if (!expanded) return; /* not a valid zip */
    await ingest(expanded.map(({ name, data }) => ({ name, bytesOf: async () => data })));
  };

  const runMgrAction = (action: MgrAction): void => {
    switch (action) {
      case 'open':
        void openProjectPicker();
        break;
      case 'new':
        setNewName('');
        break;
      case 'template':
        setTplSel(templates[0] ?? null);
        setTplName('');
        setTplOpen(true);
        break;
      case 'archive':
        void archiveProject();
        break;
      case 'unarchive':
        zipInputRef.current?.click();
        break;
      case 'refresh':
        refreshSaved();
        break;
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

  const proFile = useMemo(
    () => picked?.find((f) => /\.kicad_pro$/i.test(f.name)) ?? null,
    [picked],
  );

  // The project name drives KiCad's root-file detection (which schematic shows,
  // and the sort weight). Falls back to the root .kicad_sch / first file.
  const projName = useMemo(() => (picked ? projectNameOf(picked) : ''), [picked]);
  const projLower = projName.toLowerCase();
  // KiCad's tree root shows the full .kicad_pro filename (m_root = fn.GetFullName()).
  const rootLabel = proFile
    ? basename(proFile.name)
    : projName
      ? `${projName}.kicad_pro`
      : 'Project';

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
    const firstSeg = anyPath.includes('/') ? `${anyPath.split('/')[0]}/` : '';
    const strip =
      firstSeg && picked.every((f) => f.name.replace(/\\/g, '/').startsWith(firstSeg))
        ? firstSeg
        : '';
    return buildDirTree(picked, strip, projLower);
  }, [picked, proFile, projLower]);

  const toggleDir = (path: string): void =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

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
    const isSym = /\.kicad_sym$/i.test(node.name);
    const isMod = /\.kicad_mod$/i.test(node.name);
    // KiCad's PROJECT_TREE_ITEM::Activate: each document type routes to the
    // editor it belongs to (a `.kicad_mod` to the Footprint Editor, a
    // `.kicad_sym` to the Symbol Editor, a board to pcbnew, a sheet to eeschema).
    const openFn =
      isPcb && onOpenPcb && node.file
        ? () => onOpenPcb(node.file!, picked ?? undefined)
        : isSch
          ? () => launchSchematic(basename(node.name))
          : isSym && onOpenSymbolEditor && node.file
            ? () => onOpenSymbolEditor(picked ?? undefined, node.file!.name)
            : isMod && onOpenFootprintEditor && node.file
              ? () => onOpenFootprintEditor(picked ?? undefined, node.file!.name)
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
        onClick={() => setSelected(node.path)}
        onDoubleClick={openFn}
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
        {
          label: 'New Project from Template…',
          action: () => {
            setTplSel(templates[0] ?? null);
            setTplName('');
            setTplOpen(true);
          },
          disabled: templates.length === 0,
        },
        {
          label: 'Open Project…',
          icon: 'open',
          action: () => void openProjectPicker(),
          shortcut: 'Ctrl+O',
        },
        { label: 'Select Project Files…', action: () => filesInputRef.current?.click() },
        { sep: true },
        { label: 'Archive Project…', action: () => void archiveProject(), disabled: !picked },
        { label: 'Unarchive Project…', action: () => zipInputRef.current?.click() },
        { sep: true },
        { label: 'Close Project', action: () => setPicked(null), disabled: !picked },
      ],
    },
    { label: 'View', items: [{ label: 'Refresh', action: () => {} }] },
    {
      label: 'Tools',
      items: [
        { label: 'Edit Schematic', action: () => launchSchematic(), shortcut: 'Ctrl+E' },
        {
          label: 'Edit Schematic Symbols',
          action: () => onOpenSymbolEditor?.(picked ?? undefined),
          shortcut: 'Ctrl+L',
        },
      ],
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
        onChange={(e) => {
          void onPicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept=".kicad_pro,.kicad_sch,.kicad_pcb,.kicad_dru,.kicad_prl,.kicad_wks,.kicad_sym,.md,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onPicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onUnarchive(e.target.files);
          e.target.value = '';
        }}
      />

      <MenuBar
        menus={menus}
        title={
          <>
            <b>{picked && projName ? projName : 'No project'}</b>&nbsp;—&nbsp;ZiroEDA
          </>
        }
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
                {/* project root (.kicad_pro): bold, selectable, and its twisty
                    collapses the whole tree — like KiCad's tree root. */}
                <div
                  className={`ze-tree-item root${selected === '\0root' ? ' active' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected('\0root')}
                >
                  <span
                    className={`twisty expandable${rootOpen ? ' open' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRootOpen((o) => !o);
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
              const hasSch = !!picked?.some((f) => /\.kicad_sch$/i.test(f.name));
              const hasPcb = !!picked?.some((f) => /\.kicad_pcb$/i.test(f.name));
              // Schematic/PCB edit a project, so they need one open (like KiCad's
              // project manager). Symbol Editor is a library editor — standalone.
              const needsProject = t.id === 'schematic' || t.id === 'pcb';
              const implemented = t.id === 'schematic' || t.id === 'pcb' || !!t.enabled;
              const enabled =
                implemented && (!needsProject || (t.id === 'schematic' ? hasSch : hasPcb));
              const launch =
                t.id === 'pcb'
                  ? launchPcb
                  : t.id === 'symbols'
                    ? (): void => onOpenSymbolEditor?.(picked ?? undefined)
                    : t.id === 'footprints'
                      ? (): void => onOpenFootprintEditor?.(picked ?? undefined)
                      : (): void => launchSchematic();
              return (
                <button
                  key={t.id}
                  className="ze-launcher"
                  disabled={!enabled}
                  title={
                    !implemented ? t.desc : enabled ? t.desc : 'Open or create a project first'
                  }
                  onClick={enabled ? launch : undefined}
                >
                  <span className="ico">{tileIcon(t.id)}</span>
                  <span className="txt">
                    <span className="name">{t.name}</span>
                    <span className="desc">{t.desc}</span>
                  </span>
                  {!implemented && <span className="soon">coming soon</span>}
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
                    <TreeIcon name="project" />
                    <span className="ze-recent-name">{p.name}</span>
                    <span className="ze-recent-meta">
                      {p.fileCount} file{p.fileCount === 1 ? '' : 's'} · {fmtBytes(p.bytes)} ·{' '}
                      {fmtWhen(p.updatedAt)}
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
        <NewProjectDialog
          name={newName}
          onChange={setNewName}
          onCancel={() => setNewName(null)}
          onCreate={() => void createNewProject()}
        />
      )}

      {tplOpen && (
        <TemplateDialog
          templates={templates}
          selected={tplSel}
          name={tplName}
          onSelect={setTplSel}
          onName={setTplName}
          onCancel={() => setTplOpen(false)}
          onCreate={() => void createFromTpl()}
        />
      )}

      {/* KiCad's "Load Schematic" progress dialog, web-style. */}
      <LoadingOverlay label={loading} />
    </div>
  );
}
