import { useMemo, useState, useCallback } from 'react';
import { HomePage } from './home/HomePage.js';
import { SchematicEditor, type PickedFile } from './editors/schematic/SchematicEditor.js';
import { PcbEditor } from './editors/pcb/PcbEditor.js';
import './ui/shell.css';

const pcbBasename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

/**
 * Top-level app: KiCad's project manager, then the schematic and PCB editors.
 * Like KiCad, the two editors share one open project and stay resident — you
 * cross-navigate between them (eeschema's "Open PCB" / pcbnew's "Open
 * Schematic") without reloading or losing state. Both are kept mounted once
 * used and toggled with CSS so the 80 MB board is parsed only once.
 */
export function App(): JSX.Element {
  const [view, setView] = useState<'home' | 'schematic' | 'pcb'>('home');
  const [projectFiles, setProjectFiles] = useState<PickedFile[] | null>(null);
  const [startFile, setStartFile] = useState<string | null>(null);
  // A board opened directly (no schematic project around it).
  const [standalonePcb, setStandalonePcb] = useState<PickedFile | null>(null);
  const [schMounted, setSchMounted] = useState(false);
  const [pcbMounted, setPcbMounted] = useState(false);

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
            initialProject={projectFiles}
            initialFile={startFile}
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
    </>
  );
}
