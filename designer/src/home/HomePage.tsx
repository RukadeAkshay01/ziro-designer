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
import {
  EMPTY_PCB,
  copyProjectFiles,
  newProjectFiles,
  sanitizeProjectName,
} from './new_project.js';
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
} from './project_tree.js';

export type { PickedHomeFile } from './files.js';
import { archiveEntries, zipArchive, expandArchive } from './project_archiver.js';
import { AboutDialog } from './dialogs/dialog_about.js';
import { TextViewerDialog } from './dialogs/dialog_text_viewer.js';
import { buildManagerMenus } from './menubar.js';
import { PreferencesDialog } from '../prefs/PreferencesDialog.js';
import { TemplateDialog } from './dialogs/dialog_template_selector.js';
import { ProjectTreePane, TreeIcon, mgrUrl } from './project_tree_pane.js';
import {
  filesFromFileList,
  walkDirectoryHandle,
  walkDroppedEntries,
  type DirHandle,
  type DropEntry,
  type IngestFile,
} from './project_picker.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

// KiCad's own dark-theme icons (GPL), vendored under assets/.
const TILE_ICONS = import.meta.glob('../assets/launcher/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const tileUrl = (id: string): string | undefined => TILE_ICONS[`../assets/launcher/${id}.svg`];

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
type MgrAction = 'open' | 'new' | 'archive' | 'unarchive' | 'refresh';
const MGR_TOOLS: ({ icon: string; title: string; action: MgrAction } | 'sep')[] = [
  { icon: 'new_project', title: 'New Project\u2026', action: 'new' },
  { icon: 'open_project', title: 'Open Project\u2026', action: 'open' },
  'sep',
  { icon: 'zip', title: 'Archive Project\u2026', action: 'archive' },
  { icon: 'unzip', title: 'Unarchive Project\u2026', action: 'unarchive' },
  'sep',
  { icon: 'refresh', title: 'Refresh', action: 'refresh' },
];

// Upstream v10: File > New Project opens the template selector itself, with a
// built-in blank "Default" template first in the list.
const DEFAULT_TEMPLATE: TemplateMeta = {
  id: '\0default',
  title: 'Default',
  description: 'An empty project: a project file, a root schematic and a board.',
} as TemplateMeta;

const tileIcon = (id: string): JSX.Element => {
  const url = tileUrl(id);
  return url ? <img src={url} alt="" /> : <span style={{ width: 44, height: 44 }} />;
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
  // Chrome dialogs: About, read-only text viewer, Preferences.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [textView, setTextView] = useState<PickedHomeFile | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // New Project / New from Template (upstream v10: one template selector).
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
  const ingest = async (files: IngestFile[], persist = true): Promise<void> => {
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
  const openNewProjectDialog = (): void => {
    setTplSel(DEFAULT_TEMPLATE);
    setTplName('');
    setTplOpen(true);
  };

  // Upstream v10 NewProject flow: the template selector creates the project —
  // the built-in "Default" template scaffolds the three blank project files,
  // real templates copy their contents (renamed, like CreateProject).
  const createFromTpl = async (): Promise<void> => {
    const name = sanitizeProjectName(tplName);
    if (!name || !tplSel) return;
    setTplOpen(false);
    setExpanded(new Set());
    const files =
      tplSel.id === DEFAULT_TEMPLATE.id
        ? newProjectFiles(name)
        : await createFromTemplate(tplSel, name);
    if (files.length === 0) return;
    await ingest(files.map((f) => ({ name: f.name, bytesOf: async () => f.bytes! })));
  };

  // File > Save As: copy the whole project under a new name and persist it.
  const saveAsProject = async (): Promise<void> => {
    if (!picked) return;
    const name = sanitizeProjectName(window.prompt('Save project as:', `${projName}-copy`) ?? '');
    if (!name) return;
    const anyPath = (proFile?.name ?? picked[0]?.name ?? '').replace(/\\/g, '/');
    const firstSeg = anyPath.includes('/') ? `${anyPath.split('/')[0]}/` : '';
    const strip =
      firstSeg && picked.every((f) => f.name.replace(/\\/g, '/').startsWith(firstSeg))
        ? firstSeg
        : '';
    const files = copyProjectFiles(picked, strip, projName, name);
    await ingest(
      files.map((f) => ({ name: f.name, bytesOf: async () => f.bytes ?? enc.encode(f.text) })),
    );
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
    await ingest(filesFromFileList(list));
  };

  // Open Project: KiCad opens the .kicad_pro and pulls in the whole project.
  // A browser cannot read a file's siblings, so the closest equivalent is the
  // directory picker (File System Access API), which grants the project folder
  // in one gesture. Chrome refuses that picker for "system" locations — the
  // Downloads folder, the profile root, Desktop — so anything but a plain user
  // cancel falls back to the classic webkitdirectory input, which has no such
  // blocklist. Multi-file selection and folder drag-and-drop cover the rest.
  const openProjectPicker = async (): Promise<void> => {
    const w = window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> };
    if (w.showDirectoryPicker) {
      try {
        await ingest(await walkDirectoryHandle(await w.showDirectoryPicker()));
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
    const entries = [...e.dataTransfer.items]
      .map((i) => i.webkitGetAsEntry() as unknown as DropEntry | null)
      .filter((x): x is DropEntry => !!x);
    await ingest(await walkDroppedEntries(entries));
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
        openNewProjectDialog();
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

  // The tree-selected file, when it is a text document our viewer can show.
  const TEXT_FILE_RE = /\.(txt|md|rpt|net|cir|csv|log|pos|gbrjob|kicad_dru)$/i;
  const selectedTextFile = useMemo<PickedHomeFile | null>(() => {
    if (!picked || !selected) return null;
    const f = picked.find((x) => x.name.replace(/\\/g, '/').endsWith(selected));
    return f && (TEXT_FILE_RE.test(f.name) || /(^|\/)(fp|sym)-lib-table$/.test(f.name)) ? f : null;
  }, [picked, selected]);

  const toggleDir = (path: string): void =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  // Menu bar transcribed from the upstream manager (see home/menubar.ts).
  const clearRecent = async (): Promise<void> => {
    if (
      !window.confirm(
        'Remove all projects saved in this browser? Cloud copies are kept for signed-in accounts.',
      )
    )
      return;
    for (const pr of saved) await deleteProject(pr.id);
    refreshSaved();
  };

  const menus: Menu[] = buildManagerMenus({
    newProject: openNewProjectDialog,
    openProject: () => void openProjectPicker(),
    selectProjectFiles: () => filesInputRef.current?.click(),
    openRecent: (id) => void openStored(id),
    clearRecent: () => void clearRecent(),
    closeProject: () => setPicked(null),
    saveAs: () => void saveAsProject(),
    archiveProject: () => void archiveProject(),
    unarchiveProject: () => zipInputRef.current?.click(),
    refresh: refreshSaved,
    openTextViewer: () => setTextView(selectedTextFile),
    editSchematic: () => launchSchematic(),
    editSymbols: () => onOpenSymbolEditor?.(picked ?? undefined),
    editPcb: launchPcb,
    editFootprints: () => onOpenFootprintEditor?.(picked ?? undefined),
    openPreferences: () => setPrefsOpen(true),
    showAbout: () => setAboutOpen(true),
    hasProject: !!picked,
    hasTextFileSelected: !!selectedTextFile,
    recent: saved,
  });

  // Manager hotkeys, matching the upstream defaults (Ctrl+N/O/E/L/P/F). F5 is
  // left to the browser (reload) rather than hijacked for tree refresh.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      const run = (fn: () => void): void => {
        e.preventDefault();
        fn();
      };
      if (k === 'n') run(openNewProjectDialog);
      else if (k === 'o') run(() => void openProjectPicker());
      else if (k === 'e') run(() => launchSchematic());
      else if (k === 'l') run(() => onOpenSymbolEditor?.(picked ?? undefined));
      else if (k === 'p' && picked) run(launchPcb);
      else if (k === 'f') run(() => onOpenFootprintEditor?.(picked ?? undefined));
      else if (k === ',') run(() => setPrefsOpen(true));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
            <b>{picked && projName ? projName : 'No project'}</b>&nbsp;—&nbsp;Ziro Designer
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

        <ProjectTreePane
          picked={picked}
          dirRoot={dirRoot}
          rootLabel={rootLabel}
          projLower={projLower}
          width={panelWidth}
          expanded={expanded}
          onToggleDir={toggleDir}
          selected={selected}
          onSelect={setSelected}
          rootOpen={rootOpen}
          onToggleRoot={() => setRootOpen((o) => !o)}
          onOpenPcbFile={onOpenPcb ? (f) => onOpenPcb(f, picked ?? undefined) : undefined}
          onOpenSchematic={launchSchematic}
          onOpenSymbolFile={
            onOpenSymbolEditor ? (f) => onOpenSymbolEditor(picked ?? undefined, f.name) : undefined
          }
          onOpenFootprintFile={
            onOpenFootprintEditor
              ? (f) => onOpenFootprintEditor(picked ?? undefined, f.name)
              : undefined
          }
          onOpenProjectPicker={() => void openProjectPicker()}
          onSelectFiles={() => filesInputRef.current?.click()}
        />

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
        <span className="cell">
          {storageAvailable()
            ? session
              ? 'Saved in browser · cloud sync on'
              : 'Saved in browser'
            : 'In-memory only (storage unavailable)'}
        </span>
      </div>

      {tplOpen && (
        <TemplateDialog
          templates={[DEFAULT_TEMPLATE, ...templates]}
          selected={tplSel}
          name={tplName}
          onSelect={setTplSel}
          onName={setTplName}
          onCancel={() => setTplOpen(false)}
          onCreate={() => void createFromTpl()}
        />
      )}

      {/* KiCad's "Load Schematic" progress dialog, web-style. */}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {textView && (
        <TextViewerDialog
          name={textView.name}
          text={textView.text}
          onClose={() => setTextView(null)}
        />
      )}
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      <LoadingOverlay label={loading} />
    </div>
  );
}
