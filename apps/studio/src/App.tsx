import { useMemo, useState, useCallback } from 'react';
import type { LibSymbol } from '@ziroeda/core';
import { HomePage } from './home/HomePage.js';
import { SchematicEditor, type PickedFile } from './editors/schematic/SchematicEditor.js';
import { PcbEditor } from './editors/pcb/PcbEditor.js';
import { SymbolEditor } from './editors/symbol/SymbolEditor.js';
import './ui/shell.css';

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
  const [view, setView] = useState<'home' | 'schematic' | 'pcb' | 'symbols'>('home');
  const [projectFiles, setProjectFiles] = useState<PickedFile[] | null>(null);
  const [startFile, setStartFile] = useState<string | null>(null);
  // A board opened directly (no schematic project around it).
  const [standalonePcb, setStandalonePcb] = useState<PickedFile | null>(null);
  const [schMounted, setSchMounted] = useState(false);
  const [pcbMounted, setPcbMounted] = useState(false);
  const [symMounted, setSymMounted] = useState(false);
  // "Add symbol to schematic": the symbol editor hands eeschema a symbol to place.
  const [placeRequest, setPlaceRequest] = useState<{ lib: LibSymbol; nonce: number } | null>(null);

  const pcbFile = useMemo<PickedFile | null>(
    () => standalonePcb ?? projectFiles?.find((f) => /\.kicad_pcb$/i.test(f.name)) ?? null,
    [projectFiles, standalonePcb],
  );
  const hasSchematic = useMemo(
    () => !!projectFiles?.some((f) => /\.kicad_sch$/i.test(f.name)),
    [projectFiles],
  );

  const goHome = useCallback(() => setView('home'), []);
  const showPcb = useCallback(() => { setPcbMounted(true); setView('pcb'); }, []);
  const showSchematic = useCallback(() => { setSchMounted(true); setView('schematic'); }, []);
  const showSymbolEditor = useCallback(() => { setSymMounted(true); setView('symbols'); }, []);

  // The symbol editor's SCH_ACTIONS::addSymbolToSchematic: switch to eeschema
  // with the symbol attached to the cursor for placement.
  const addSymbolToSchematic = useCallback((lib: LibSymbol) => {
    setSchMounted(true);
    setView('schematic');
    setPlaceRequest((prev) => ({ lib, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  if (view === 'home') {
    // Keep the open project visible in the manager tree on return from an editor.
    const openFiles = projectFiles ?? (standalonePcb ? [standalonePcb] : null);
    return (
      <HomePage
        initialFiles={openFiles}
        onOpenSchematic={() => {
          setProjectFiles(null); setStandalonePcb(null); setStartFile(null);
          setSchMounted(true); setView('schematic');
        }}
        onOpenProject={(files, start) => {
          setProjectFiles(files); setStandalonePcb(null); setStartFile(start ?? null);
          setSchMounted(true); setView('schematic');
        }}
        onOpenPcb={(file, files) => {
          if (files) { setProjectFiles(files); setStandalonePcb(null); }
          else { setStandalonePcb(file); setProjectFiles(null); }
          setPcbMounted(true); setView('pcb');
        }}
        onOpenSymbolEditor={(files) => {
          if (files) { setProjectFiles(files); setStandalonePcb(null); }
          setSymMounted(true); setView('symbols');
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
          />
        </div>
      )}
      {symMounted && (
        <div style={{ display: view === 'symbols' ? 'contents' : 'none' }}>
          <SymbolEditor
            onExitToHome={goHome}
            initialProject={projectFiles}
            onAddSymbolToSchematic={addSymbolToSchematic}
          />
        </div>
      )}
    </>
  );
}
