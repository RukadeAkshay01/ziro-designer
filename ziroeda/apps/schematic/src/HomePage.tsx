import { useMemo, useRef, useState, type JSX } from 'react';
import { parse, readSchematic, buildSheetTree, findRootFile, type Schematic, type SheetTreeNode } from '@ziroeda/core';
import { MenuBar, type Menu } from './ui/MenuBar.js';
import './ui/shell.css';

/** A file picked from disk for a project open. */
export interface PickedHomeFile { name: string; text: string }

// KiCad's own dark-theme icons (GPL), vendored under assets/.
const TILE_ICONS = import.meta.glob('./assets/launcher/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const MGR_ICONS = import.meta.glob('./assets/manager/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const tileUrl = (id: string): string | undefined => TILE_ICONS[`./assets/launcher/${id}.svg`];
const mgrUrl = (name: string): string | undefined => MGR_ICONS[`./assets/manager/${name}.svg`];

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

const treeIconFor = (file: string): string =>
  /\.kicad_pro$/i.test(file) ? 'project_kicad'
  : /\.kicad_sch$/i.test(file) ? 'icon_eeschema_24'
  : /\.kicad_sym$/i.test(file) ? 'library'
  : /\.kicad_pcb$/i.test(file) ? 'icon_pcbnew_24'
  : 'directory_browser';

/**
 * KiCad-style project manager: open a project folder, see its files in the
 * tree, then launch the Schematic Editor on it — the same workflow as the
 * desktop app's project window. Until a project is opened, the bundled demo
 * project is shown.
 */
export function HomePage({ onOpenSchematic, onOpenProject, onOpenPcb }: {
  onOpenSchematic: () => void;
  onOpenProject?: (files: PickedHomeFile[], startFile?: string) => void;
  onOpenPcb?: (file: PickedHomeFile) => void;
}): JSX.Element {
  const dirInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  // The picked project's files (shown in the tree until the editor is launched).
  const [picked, setPicked] = useState<PickedHomeFile[] | null>(null);

  // Read every picked file; all files show in the tree (like KiCad's project
  // window), but only .kicad_sch/.kicad_pro contents are read.
  const ingest = async (files: { name: string; textOf: () => Promise<string> }[]): Promise<void> => {
    const out: PickedHomeFile[] = [];
    for (const f of files) {
      const base = f.name.split('/').pop()!;
      if (base.startsWith('.')) continue;
      out.push({
        name: f.name,
        text: /\.(kicad_sch|kicad_pro|kicad_pcb)$/i.test(base) ? await f.textOf() : '',
      });
    }
    if (out.length > 0) setPicked(out);
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
    const w = window as unknown as { showDirectoryPicker?: () => Promise<AsyncIterable<[string, { kind: string; getFile?: () => Promise<File> }]> & { values: () => AsyncIterable<{ kind: string; name: string; getFile: () => Promise<File> }> }> };
    if (w.showDirectoryPicker) {
      try {
        const dir = await w.showDirectoryPicker();
        const files: { name: string; textOf: () => Promise<string> }[] = [];
        for await (const entry of dir.values()) {
          if (entry.kind !== 'file') continue;
          files.push({ name: entry.name, textOf: async () => (await entry.getFile()).text() });
        }
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
    const walk = async (entry: Entry, depth: number): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => entry.file(res, rej)).catch(() => null);
        if (file) files.push({ name: file.name, textOf: () => file.text() });
      } else if (entry.isDirectory && depth < 3) {
        for (const child of await readAll(entry)) await walk(child, depth + 1);
      }
    };
    const entries = [...e.dataTransfer.items]
      .map((i) => i.webkitGetAsEntry() as unknown as Entry | null)
      .filter((x): x is Entry => !!x);
    for (const en of entries) await walk(en, 0);
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

  // Files other than the schematics (they nest under the root instead).
  const otherFiles = useMemo(() => {
    if (!picked) return [];
    return picked
      .filter((f) => !/\.(kicad_sch|kicad_pro)$/i.test(basename(f.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [picked]);

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
  const launchPcb = (): void => {
    if (pcbFile && onOpenPcb) onOpenPcb(pcbFile);
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
                {/* remaining project files (pcb, dru, readme, …) */}
                {otherFiles.map((f) => {
                  const isPcb = /\.kicad_pcb$/i.test(f.name);
                  return (
                    <div
                      key={f.name}
                      className="ze-tree-item"
                      style={{ paddingLeft: 24, cursor: isPcb ? 'pointer' : 'default' }}
                      title={isPcb ? 'Open in the PCB Editor' : f.name}
                      onClick={isPcb && onOpenPcb ? () => onOpenPcb(f) : undefined}
                    >
                      <TreeIcon name={treeIconFor(f.name)} />
                      <span>{basename(f.name)}</span>
                    </div>
                  );
                })}
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

        {/* launcher tiles */}
        <div className="ze-launchers">
          {TILES.map((t) => {
            const enabled = t.enabled || (t.id === 'pcb' && !!pcbFile);
            const launch = t.id === 'pcb' ? launchPcb : (): void => launchSchematic();
            return (
              <button
                key={t.id}
                className="ze-launcher"
                disabled={!enabled}
                title={t.id === 'pcb' && !pcbFile ? 'Open a project containing a .kicad_pcb first' : t.desc}
                onClick={enabled ? launch : undefined}
              >
                <span className="ico">{tileIcon(t.id)}</span>
                <span className="txt">
                  <span className="name">{t.name}</span>
                  <span className="desc">{t.desc}</span>
                </span>
                {!enabled && <span className="soon">{t.id === 'pcb' ? 'open a project' : 'coming soon'}</span>}
              </button>
            );
          })}
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
