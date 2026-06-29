import type { JSX } from 'react';
import './ui/shell.css';

/**
 * KiCad project-manager-style home page (the launcher window KiCad opens with).
 * Tile titles and descriptions are taken verbatim from KiCad's
 * KICAD_MANAGER_ACTIONS / panel_kicad_launcher. Only the Schematic Editor is wired
 * up so far; the rest are shown as forthcoming.
 */

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

const tileIcon = (id: string): JSX.Element => {
  const common = { width: 34, height: 34, viewBox: '0 0 32 32', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'schematic': return <svg {...common}><rect x="11" y="9" width="10" height="14" /><path d="M5 12h6 M5 20h6 M21 16h6" /></svg>;
    case 'symbols': return <svg {...common}><rect x="6" y="7" width="20" height="18" /><path d="M11 16h4 M18 12v8" /></svg>;
    case 'pcb': return <svg {...common}><rect x="6" y="6" width="20" height="20" rx="1" /><circle cx="11" cy="11" r="1.5" /><circle cx="21" cy="21" r="1.5" /><path d="M11 11h6v6 M17 17h4" /></svg>;
    case 'footprints': return <svg {...common}><rect x="8" y="8" width="16" height="16" /><path d="M12 8v16 M20 8v16" /></svg>;
    case 'gerber': return <svg {...common}><path d="M16 5l11 6v10l-11 6L5 21V11z" /><path d="M16 16l11-5 M16 16v11 M16 16L5 11" /></svg>;
    case 'image': return <svg {...common}><rect x="6" y="7" width="20" height="18" /><circle cx="12" cy="13" r="2" /><path d="M6 22l6-5 5 4 5-6 4 5" /></svg>;
    case 'calculator': return <svg {...common}><rect x="8" y="5" width="16" height="22" rx="1" /><path d="M11 9h10 M11 14h2 M15 14h2 M19 14h2 M11 18h2 M15 18h2 M19 18h2 M11 22h2 M15 22h2 M19 22h2" /></svg>;
    case 'drawingsheet': return <svg {...common}><rect x="6" y="5" width="20" height="22" /><path d="M9 8h14 M9 23h8 M17 19h6 M17 23h6 M17 19v8" /></svg>;
    case 'pcm': return <svg {...common}><path d="M16 4l11 6v12l-11 6-11-6V10z" /><path d="M16 16l11-6 M16 16v12 M16 16L5 10" /></svg>;
    default: return <svg {...common}><rect x="7" y="7" width="18" height="18" /></svg>;
  }
};

export function HomePage({ projectName, onOpenSchematic }: { projectName: string; onOpenSchematic: () => void }): JSX.Element {
  return (
    <div className="ze-app">
      <div className="ze-menubar">
        {['File', 'View', 'Tools', 'Preferences', 'Help'].map((m) => (
          <div key={m} className="ze-menu">{m}</div>
        ))}
      </div>

      <div className="ze-home-body">
        <div className="ze-panel left" style={{ width: 280 }}>
          <div className="ze-panel-header">Project</div>
          <div className="ze-panel-body">
            <div className="ze-tree-item active">📁 {projectName}</div>
            <div className="ze-tree-item" style={{ paddingLeft: 22 }}>📄 {projectName}.kicad_pro</div>
            <div className="ze-tree-item" style={{ paddingLeft: 22 }} onClick={onOpenSchematic}>
              📐 {projectName}.kicad_sch
            </div>
          </div>
        </div>

        <div className="ze-launchers">
          <h2 className="ze-project-title">{projectName}</h2>
          {TILES.map((t) => (
            <button
              key={t.id}
              className="ze-launcher"
              disabled={!t.enabled}
              title={t.desc}
              onClick={t.enabled ? onOpenSchematic : undefined}
            >
              <span className="ico">{tileIcon(t.id)}</span>
              <span className="txt">
                <span className="name">{t.name}</span>
                <span className="desc">{t.desc}</span>
              </span>
              {!t.enabled && <span className="soon">coming soon</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="ze-statusbar">
        <span className="cell grow">ZiroEDA — open-source EDA in your browser · click Schematic Editor to begin</span>
      </div>
    </div>
  );
}
