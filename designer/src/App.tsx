import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { HomePage } from './home/HomePage.js';
import { SchematicEditor, type PickedFile } from './editors/schematic/SchematicEditor.js';
import { PcbEditor } from './editors/pcb/PcbEditor.js';
import { SymbolEditor } from './editors/symbol/SymbolEditor.js';
import { FootprintEditor } from './editors/footprint/FootprintEditor.js';
import { CalculatorTools } from './editors/calculator/CalculatorTools.js';
import { DrawingSheetEditor } from './editors/drawingsheet/DrawingSheetEditor.js';
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
    'home' | 'schematic' | 'pcb' | 'symbols' | 'footprints' | 'calculator' | 'drawingsheet'
  >('home');
  const [projectFiles, setProjectFiles] = useState<PickedFile[] | null>(null);
  const [startFile, setStartFile] = useState<string | null>(null);
  // A board opened directly (no schematic project around it).
  const [standalonePcb, setStandalonePcb] = useState<PickedFile | null>(null);
  const [schMounted, setSchMounted] = useState(false);
  const [pcbMounted, setPcbMounted] = useState(false);
  const [symMounted, setSymMounted] = useState(false);
  const [fpMounted, setFpMounted] = useState(false);
  const [calcMounted, setCalcMounted] = useState(false);
  const [dsMounted, setDsMounted] = useState(false);
  // "Add symbol to schematic": the symbol editor hands eeschema a symbol to place.
  const [placeRequest, setPlaceRequest] = useState<{ lib: LibSymbol; nonce: number } | null>(null);
  // The file the project manager double-clicked into the footprint / symbol
  // editor (KiCad's MAIL_FP_EDIT / MAIL_LIB_EDIT). Re-sent with a fresh nonce
  // each activation so a resident editor re-opens on the newly-picked file.
  const [fpRequest, setFpRequest] = useState<{ file: string | null; nonce: number } | null>(null);
  const [symRequest, setSymRequest] = useState<{ file: string | null; nonce: number } | null>(null);
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
  const onProjectChange = useCallback((changed: PickedFile[]) => {
    const cur = projectFilesRef.current;
    if (!cur || !storageAvailable()) return;
    const fullByBase = new Map(cur.map((f) => [pcbBasename(f.name), f.name]));
    const fullChanged = changed
      .filter((f) => fullByBase.has(pcbBasename(f.name)))
      .map((f) => ({ name: fullByBase.get(pcbBasename(f.name))!, bytes: enc.encode(f.text) }));
    if (fullChanged.length === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const rec = (await listProjects()).find((p) => p.name === projectNameOf(cur));
          if (rec) await updateProjectFiles(rec.id, fullChanged);
        } catch {
          /* storage disabled */
        }
      })();
    }, 1200);
  }, []);

  const pcbFile = useMemo<PickedFile | null>(
    () => standalonePcb ?? projectFiles?.find((f) => /\.kicad_pcb$/i.test(f.name)) ?? null,
    [projectFiles, standalonePcb],
  );
  const hasSchematic = useMemo(
    () => !!projectFiles?.some((f) => /\.kicad_sch$/i.test(f.name)),
    [projectFiles],
  );
  // KiCad shows "<project> — <Editor>" in the window title; we put it in the menu bar.
  const projectName = useMemo(
    () =>
      projectFiles
        ? projectNameOf(projectFiles)
        : standalonePcb
          ? pcbBasename(standalonePcb.name).replace(/\.kicad_pcb$/i, '')
          : '',
    [projectFiles, standalonePcb],
  );

  const goHome = useCallback(() => setView('home'), []);
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
    // Keep the open project visible in the manager tree on return from an editor.
    const openFiles = projectFiles ?? (standalonePcb ? [standalonePcb] : null);
    return (
      <HomePage
        initialFiles={openFiles}
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
        onOpenDrawingSheetEditor={() => {
          setDsMounted(true);
          setView('drawingsheet');
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
            initialProject={projectFiles}
            initialFile={startFile}
            placeRequest={placeRequest}
            onProjectChange={onProjectChange}
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
            projectName={projectName}
            projectFiles={projectFiles ?? undefined}
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
          <DrawingSheetEditor onExitToHome={goHome} projectName={projectName} />
        </div>
      )}
    </>
  );
}
