import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { HomePage } from './home/HomePage.js';
import { SchematicEditor, type PickedFile } from './editors/schematic/SchematicEditor.js';
import { PcbEditor } from './editors/pcb/PcbEditor.js';
import { SymbolEditor } from './editors/symbol/SymbolEditor.js';
import { FootprintEditor } from './editors/footprint/FootprintEditor.js';
import { CalculatorTools } from './editors/calculator/CalculatorTools.js';
import { DrawingSheetEditor } from './editors/drawingsheet/DrawingSheetEditor.js';
import { ImageConverter } from './editors/image/ImageConverter.js';
import { GerberViewer } from './editors/gerbview/GerberViewer.js';
import {
  storageAvailable,
  listProjects,
  loadProject,
  updateProjectFiles,
} from './home/projectStore.js';
import { saveSession, loadSession } from './home/session.js';
import './ui/shell.css';

const dec = new TextDecoder();
const enc = new TextEncoder();

const projectNameOf = (files: PickedFile[]): string => {
  const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
  const src =
    pro?.name ??
    files.find((f) => /\.kicad_sch$/i.test(f.name))?.name ??
    files[0]?.name ??
    'Project';
  return pcbBasename(src).replace(/\.(kicad_pro|kicad_sch|kicad_pcb)$/i, '');
};

const pcbBasename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

// A project's basename (no extension), e.g. "proj/proj.kicad_pro" → "proj".
const projBaseOf = (proName: string): string => pcbBasename(proName).replace(/\.kicad_pro$/i, '');

// Does `fileName` belong to the project whose basename is `base`? KiCad's per-
// project files share the exact basename (proj.kicad_sch / proj.kicad_pcb), so
// the file basename starts with "base." — this keeps "proj" and "proj_v2" apart.
const inProject = (fileName: string, base: string): boolean =>
  pcbBasename(fileName).toLowerCase().startsWith(`${base.toLowerCase()}.`);

// The project's folder prefix (e.g. "proj/"), taken from the .kicad_pro's own
// directory, or '' when it sits at the root. New files added to the project
// carry this prefix so they land in the project folder like the other files.
const projectDirPrefix = (files: PickedFile[]): string => {
  const pro = files.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
  return pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
};

/**
 * Top-level app: KiCad's project manager, then the schematic, symbol and PCB
 * editors. Like KiCad, the editors share one open project and stay resident —
 * you cross-navigate between them (eeschema's "Open PCB" / "Symbol Editor",
 * pcbnew's "Open Schematic", the symbol editor's "Add symbol to schematic")
 * without reloading or losing state. Each is kept mounted once used and toggled
 * with CSS so heavy documents are parsed only once.
 */
export function App(): JSX.Element {
  const [view, setView] = useState<
    | 'home'
    | 'schematic'
    | 'pcb'
    | 'symbols'
    | 'footprints'
    | 'calculator'
    | 'drawingsheet'
    | 'image'
    | 'gerber'
  >('home');
  const [projectFiles, setProjectFiles] = useState<PickedFile[] | null>(null);
  // `.kicad_wks` saved into the open project this session (Drawing Sheet Editor
  // → Save to Project). Kept separate from projectFiles so adding one doesn't
  // reload/reset the mounted editors; offered as schematic Page Settings choices.
  const [sessionSheets, setSessionSheets] = useState<PickedFile[]>([]);
  const [startFile, setStartFile] = useState<string | null>(null);
  // The active project's .kicad_pro (full name) when a folder holds more than
  // one project (KiCad's active project). null → the first .kicad_pro. Double-
  // clicking another .kicad_pro switches it, re-scoping every editor's root.
  const [activePro, setActivePro] = useState<string | null>(null);
  // A board opened directly (no schematic project around it).
  const [standalonePcb, setStandalonePcb] = useState<PickedFile | null>(null);
  const [schMounted, setSchMounted] = useState(false);
  const [pcbMounted, setPcbMounted] = useState(false);
  const [symMounted, setSymMounted] = useState(false);
  const [fpMounted, setFpMounted] = useState(false);
  const [calcMounted, setCalcMounted] = useState(false);
  const [dsMounted, setDsMounted] = useState(false);
  const [imgMounted, setImgMounted] = useState(false);
  const [gbMounted, setGbMounted] = useState(false);
  // "Add symbol to schematic": the symbol editor hands eeschema a symbol to place.
  const [placeRequest, setPlaceRequest] = useState<{ lib: LibSymbol; nonce: number } | null>(null);
  // The file the project manager double-clicked into the footprint / symbol
  // editor (KiCad's MAIL_FP_EDIT / MAIL_LIB_EDIT). Re-sent with a fresh nonce
  // each activation so a resident editor re-opens on the newly-picked file.
  const [fpRequest, setFpRequest] = useState<{ file: string | null; nonce: number } | null>(null);
  const [symRequest, setSymRequest] = useState<{ file: string | null; nonce: number } | null>(null);
  // A .kicad_wks the project manager double-clicked into the Drawing Sheet
  // Editor: its name + content, re-sent with a fresh nonce so a resident editor
  // re-opens on the newly-picked file.
  const [dsRequest, setDsRequest] = useState<{
    name: string;
    text: string;
    nonce: number;
  } | null>(null);
  // Editors stay mounted (display toggled by CSS) but their global hotkey
  // handlers must only act for the visible frame — a keystroke in eeschema
  // must not drive the hidden board editor. Handlers read this stamp.
  useEffect(() => {
    document.body.dataset.activeView = view;
  }, [view]);

  // Restore the last view on reload: reopen the most-recently-opened project
  // (top of Recent) into the saved view, so a refresh doesn't lose your work.
  // On reload, reopen the most-recently-opened project (top of Recent) — into
  // the home file manager and, if that's where you were, the editor view too.
  const [restoring, setRestoring] = useState(() => !!loadSession());
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      try {
        const s = loadSession();
        if (!s || !storageAvailable()) return;
        const list = await listProjects();
        const loaded = list[0] ? await loadProject(list[0].id) : null;
        if (!loaded) return;
        setProjectFiles(loaded.files.map((f) => ({ name: f.name, text: dec.decode(f.bytes) })));
        setStartFile(s.startFile ?? null);
        if (s.view === 'schematic') setSchMounted(true);
        else if (s.view === 'pcb') setPcbMounted(true);
        else if (s.view === 'symbols') setSymMounted(true);
        else if (s.view === 'footprints') setFpMounted(true);
        else if (s.view === 'calculator') setCalcMounted(true);
        else if (s.view === 'drawingsheet') setDsMounted(true);
        else if (s.view === 'image') setImgMounted(true);
        else if (s.view === 'gerber') setGbMounted(true);
        setView(s.view);
      } catch {
        /* fall back to home */
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // Remember the current view (+ open sheet) so a reload can restore it.
  useEffect(() => {
    if (restoring) return;
    saveSession({ view, startFile });
  }, [view, startFile, restoring]);

  // Autosave: the schematic editor hands us its updated sheets (by basename).
  // Debounce-write just those files back to IndexedDB (preserving the rest), so
  // a reload restores your edits — without touching projectFiles (that would
  // remount/reset the live editor). Names come from the open project.
  const projectFilesRef = useRef(projectFiles);
  projectFilesRef.current = projectFiles;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Pending autosave (file name → bytes), coalesced until the timer fires or a
  // flush forces it out.
  const pendingWrite = useRef<Map<string, Uint8Array>>(new Map());
  const writePending = useCallback(() => {
    const cur = projectFilesRef.current;
    if (!cur || pendingWrite.current.size === 0 || !storageAvailable()) return;
    const files = [...pendingWrite.current].map(([name, bytes]) => ({ name, bytes }));
    pendingWrite.current = new Map();
    void (async () => {
      try {
        const rec = (await listProjects()).find((p) => p.name === projectNameOf(cur));
        if (rec) await updateProjectFiles(rec.id, files);
      } catch {
        /* storage disabled */
      }
    })();
  }, []);
  const onProjectChange = useCallback(
    (changed: PickedFile[]) => {
      const cur = projectFilesRef.current;
      if (!cur || !storageAvailable()) return;
      const fullByBase = new Map(cur.map((f) => [pcbBasename(f.name), f.name]));
      let queued = false;
      for (const f of changed) {
        const full = fullByBase.get(pcbBasename(f.name));
        if (!full) continue;
        pendingWrite.current.set(full, enc.encode(f.text));
        queued = true;
      }
      if (!queued) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(writePending, 1200);
    },
    [writePending],
  );
  // Flush any pending autosave now — on leaving an editor and before reopening,
  // so a quick "edit → home → reopen" never reads a stale project.
  const schFlush = useRef<(() => void) | null>(null);
  const registerSchFlush = useCallback((fn: (() => void) | null) => {
    schFlush.current = fn;
  }, []);
  // Edits mirrored into the in-memory project so the home tree (and a reopen
  // from it) reflect them — autosave only writes IndexedDB, which a tree reopen
  // does not re-read. Cleared when a project is (re)opened.
  const liveEdits = useRef<Map<string, string>>(new Map());
  const flushSaves = useCallback(() => {
    schFlush.current?.(); // push the editor's latest serialized sheets into the queue
    clearTimeout(saveTimer.current);
    for (const [name, bytes] of pendingWrite.current)
      liveEdits.current.set(name, dec.decode(bytes));
    writePending();
  }, [writePending]);
  useEffect(() => {
    liveEdits.current.clear();
  }, [projectFiles]);

  // Persist project files to IndexedDB/cloud immediately (no autosave debounce),
  // used for discrete actions — drawing-sheet reference changes and Save to
  // Project — so a "go back and reopen" reads them straight back.
  const persistFilesNow = useCallback((files: PickedFile[]) => {
    const cur = projectFilesRef.current;
    if (!cur || files.length === 0 || !storageAvailable()) return;
    void (async () => {
      try {
        const rec = (await listProjects()).find((p) => p.name === projectNameOf(cur));
        if (rec)
          await updateProjectFiles(
            rec.id,
            files.map((f) => ({ name: f.name, bytes: enc.encode(f.text) })),
          );
      } catch {
        /* storage disabled */
      }
    })();
  }, []);

  // Drawing Sheet Editor → Save (Save As): write the .kicad_wks into the open
  // project and offer it as a schematic drawing-sheet choice + in the file tree.
  // Place it under the project's folder (the shared path prefix) so it sits
  // alongside the .kicad_sch/.kicad_pcb rather than spawning a stray root entry.
  const onSaveToProject = useCallback(
    (fileName: string, text: string) => {
      const cur = projectFilesRef.current;
      if (!cur) return;
      const name = fileName.includes('/') ? fileName : projectDirPrefix(cur) + fileName;
      setSessionSheets((prev) => [...prev.filter((f) => f.name !== name), { name, text }]);
      persistFilesNow([{ name, text }]);
    },
    [persistFilesNow],
  );

  // The active project's .kicad_pro (full name), validated against the open
  // files; defaults to the first .kicad_pro. `activeBase` scopes every editor.
  const activeProName = useMemo(() => {
    if (!projectFiles) return null;
    const pros = projectFiles.filter((f) => /\.kicad_pro$/i.test(f.name)).map((f) => f.name);
    return (activePro && pros.includes(activePro) ? activePro : pros[0]) ?? null;
  }, [projectFiles, activePro]);
  const activeBase = activeProName ? projBaseOf(activeProName) : '';

  const pcbFile = useMemo<PickedFile | null>(() => {
    if (standalonePcb) return standalonePcb;
    if (!projectFiles) return null;
    const boards = projectFiles.filter((f) => /\.kicad_pcb$/i.test(f.name));
    // The active project's board, else any board (single-project projects).
    return boards.find((f) => activeBase && inProject(f.name, activeBase)) ?? boards[0] ?? null;
  }, [projectFiles, standalonePcb, activeBase]);
  const hasSchematic = useMemo(
    () => !!projectFiles?.some((f) => /\.kicad_sch$/i.test(f.name)),
    [projectFiles],
  );
  // The folder's identity (first .kicad_pro) — stable across in-folder project
  // switches, so it keys the "new project opened" reset without self-firing.
  const folderName = useMemo(
    () =>
      projectFiles
        ? projectNameOf(projectFiles)
        : standalonePcb
          ? pcbBasename(standalonePcb.name).replace(/\.kicad_pcb$/i, '')
          : '',
    [projectFiles, standalonePcb],
  );
  // KiCad shows "<project> — <Editor>" in the window title; we put it in the
  // menu bar. With several projects in a folder, it names the active one.
  const projectName = activeBase || folderName;

  // A different project folder drops any drawing sheets saved into the previous
  // one, and resets the active project to its default (first .kicad_pro).
  useEffect(() => {
    setSessionSheets([]);
    setActivePro(null);
  }, [folderName]);

  // Switch the active project (double-clicking another .kicad_pro in the tree).
  // Like KiCad's PROJECT_TREE_ITEM::Activate → LoadProject: it only makes that
  // project active and re-roots the manager tree; it does NOT launch an editor.
  // Setting activePro re-scopes every editor's root for the next time one opens.
  const switchProject = useCallback((proFullName: string) => {
    setActivePro(proFullName);
  }, []);

  const goHome = useCallback(() => {
    flushSaves(); // persist pending edits before the tree/reopen can read them
    setView('home');
  }, [flushSaves]);
  const showPcb = useCallback(() => {
    setPcbMounted(true);
    setView('pcb');
  }, []);
  const showSchematic = useCallback(() => {
    setSchMounted(true);
    setView('schematic');
  }, []);
  const showSymbolEditor = useCallback(() => {
    setSymMounted(true);
    setView('symbols');
  }, []);
  const showFootprintEditor = useCallback(() => {
    setFpMounted(true);
    setView('footprints');
  }, []);
  const showCalculator = useCallback(() => {
    setCalcMounted(true);
    setView('calculator');
  }, []);

  // The symbol editor's SCH_ACTIONS::addSymbolToSchematic: switch to eeschema
  // with the symbol attached to the cursor for placement.
  const addSymbolToSchematic = useCallback((lib: LibSymbol) => {
    setSchMounted(true);
    setView('schematic');
    setPlaceRequest((prev) => ({ lib, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  if (restoring) {
    return (
      <div
        className="ze-app"
        style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div className="ze-loading-card">
          <span className="ze-spinner" />
          <span>Restoring your project…</span>
        </div>
      </div>
    );
  }

  if (view === 'home') {
    // Keep the open project visible in the manager tree on return from an editor,
    // including any .kicad_wks saved into it this session (not yet in projectFiles).
    // Overlay flushed edits (liveEdits) so a reopen from the tree sees them, and
    // append any .kicad_wks saved into the project this session.
    const edited = projectFiles
      ? projectFiles.map((f) =>
          liveEdits.current.has(f.name)
            ? { name: f.name, text: liveEdits.current.get(f.name)! }
            : f,
        )
      : null;
    const base = edited ?? (standalonePcb ? [standalonePcb] : null);
    const openFiles =
      base && sessionSheets.length
        ? [...base, ...sessionSheets.filter((s) => !base.some((f) => f.name === s.name))]
        : base;
    return (
      <HomePage
        initialFiles={openFiles}
        activePro={activeProName ?? undefined}
        onSwitchProject={switchProject}
        onOpenSchematic={() => {
          setProjectFiles(null);
          setStandalonePcb(null);
          setStartFile(null);
          setSchMounted(true);
          setView('schematic');
        }}
        onOpenProject={(files, start) => {
          setProjectFiles(files);
          setStandalonePcb(null);
          setStartFile(start ?? null);
          setSchMounted(true);
          setView('schematic');
        }}
        onOpenPcb={(file, files) => {
          if (files) {
            setProjectFiles(files);
            setStandalonePcb(null);
          } else {
            setStandalonePcb(file);
            setProjectFiles(null);
          }
          setPcbMounted(true);
          setView('pcb');
        }}
        onOpenSymbolEditor={(files, startFile) => {
          if (files) {
            setProjectFiles(files);
            setStandalonePcb(null);
          }
          setSymMounted(true);
          setView('symbols');
          setSymRequest((prev) => ({ file: startFile ?? null, nonce: (prev?.nonce ?? 0) + 1 }));
        }}
        onOpenFootprintEditor={(files, startFile) => {
          if (files) {
            setProjectFiles(files);
            setStandalonePcb(null);
          }
          setFpMounted(true);
          setView('footprints');
          setFpRequest((prev) => ({ file: startFile ?? null, nonce: (prev?.nonce ?? 0) + 1 }));
        }}
        onOpenCalculator={() => {
          setCalcMounted(true);
          setView('calculator');
        }}
        onOpenDrawingSheetEditor={(file) => {
          setDsMounted(true);
          setView('drawingsheet');
          if (file)
            setDsRequest((prev) => ({
              name: file.name,
              text: file.text,
              nonce: (prev?.nonce ?? 0) + 1,
            }));
        }}
        onOpenImageConverter={() => {
          setImgMounted(true);
          setView('image');
        }}
        onOpenGerberViewer={() => {
          setGbMounted(true);
          setView('gerber');
        }}
      />
    );
  }

  return (
    <>
      {schMounted && (
        <div style={{ display: view === 'schematic' ? 'contents' : 'none' }}>
          <SchematicEditor
            onExitToHome={goHome}
            onShowPcb={pcbFile ? showPcb : undefined}
            onShowSymbolEditor={showSymbolEditor}
            onShowFootprintEditor={showFootprintEditor}
            onShowCalculator={showCalculator}
            initialProject={projectFiles}
            initialFile={startFile}
            rootPro={activeBase || undefined}
            placeRequest={placeRequest}
            onProjectChange={onProjectChange}
            onPersistFiles={persistFilesNow}
            registerAutosaveFlush={registerSchFlush}
            extraSheetFiles={sessionSheets}
            projectName={projectName}
          />
        </div>
      )}
      {pcbMounted && pcbFile && (
        <div style={{ display: view === 'pcb' ? 'contents' : 'none' }}>
          <PcbEditor
            fileName={pcbBasename(pcbFile.name)}
            text={pcbFile.text}
            onExit={goHome}
            onShowSchematic={hasSchematic ? showSchematic : undefined}
            onShowFootprintEditor={showFootprintEditor}
            onBoardChange={(text: string) => onProjectChange([{ name: pcbFile.name, text }])}
            onSaveBoard={(text: string) => {
              const name = pcbFile.name;
              setProjectFiles((prev) =>
                prev ? prev.map((f) => (f.name === name ? { ...f, text } : f)) : prev,
              );
              persistFilesNow([{ name, text }]);
            }}
            projectName={projectName}
            projectFiles={projectFiles ?? undefined}
            rootPro={activeBase || undefined}
            onPersistFiles={persistFilesNow}
          />
        </div>
      )}
      {symMounted && (
        <div style={{ display: view === 'symbols' ? 'contents' : 'none' }}>
          <SymbolEditor
            onExitToHome={goHome}
            initialProject={projectFiles}
            onAddSymbolToSchematic={addSymbolToSchematic}
            projectName={projectName}
            openRequest={symRequest}
          />
        </div>
      )}
      {fpMounted && (
        <div style={{ display: view === 'footprints' ? 'contents' : 'none' }}>
          <FootprintEditor
            onExitToHome={goHome}
            initialProject={projectFiles}
            openRequest={fpRequest}
          />
        </div>
      )}
      {calcMounted && (
        <div style={{ display: view === 'calculator' ? 'contents' : 'none' }}>
          <CalculatorTools onExitToHome={goHome} />
        </div>
      )}
      {dsMounted && (
        <div style={{ display: view === 'drawingsheet' ? 'contents' : 'none' }}>
          <DrawingSheetEditor
            onExitToHome={goHome}
            projectName={projectName}
            onSaveToProject={projectFiles ? onSaveToProject : undefined}
            openRequest={dsRequest}
          />
        </div>
      )}
      {imgMounted && (
        <div style={{ display: view === 'image' ? 'contents' : 'none' }}>
          <ImageConverter onExitToHome={goHome} />
        </div>
      )}
      {gbMounted && (
        <div style={{ display: view === 'gerber' ? 'contents' : 'none' }}>
          <GerberViewer onExitToHome={goHome} projectName={projectName} />
        </div>
      )}
    </>
  );
}
