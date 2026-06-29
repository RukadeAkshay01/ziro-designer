import type { JSX } from 'react';
import './ui/shell.css';

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
const MGR_TOOLS: ({ icon: string; title: string } | 'sep')[] = [
  { icon: 'new_project_from_template', title: 'New Project…' },
  { icon: 'open_project', title: 'Open Project…' },
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

export function HomePage({ projectName, onOpenSchematic }: { projectName: string; onOpenSchematic: () => void }): JSX.Element {
  return (
    <div className="ze-app">
      <div className="ze-menubar">
        {['File', 'Edit', 'View', 'Tools', 'Preferences', 'Help'].map((m) => (
          <div key={m} className="ze-menu">{m}</div>
        ))}
      </div>

      <div className="ze-home-body">
        {/* far-left vertical toolbar */}
        <div className="ze-mgrbar">
          {MGR_TOOLS.map((t, i) =>
            t === 'sep' ? (
              <span key={`s${i}`} className="sep" />
            ) : (
              <button key={t.icon} title={t.title} aria-label={t.title}>
                <img src={mgrUrl(t.icon)} alt="" />
              </button>
            ),
          )}
        </div>

        {/* project file tree */}
        <div className="ze-panel left" style={{ width: 290 }}>
          <div className="ze-panel-header">Project Files</div>
          <div className="ze-panel-body">
            <div className="ze-tree-item root active">
              <span className="twisty">▾</span>
              <TreeIcon name="project_kicad" />
              <span>{projectName}.kicad_pro</span>
            </div>
            <div className="ze-tree-item" style={{ paddingLeft: 24 }} onClick={onOpenSchematic}>
              <TreeIcon name="icon_eeschema_24" />
              <span>{projectName}.kicad_sch</span>
            </div>
            <div className="ze-tree-item" style={{ paddingLeft: 24 }}>
              <TreeIcon name="library" />
              <span>{projectName}.kicad_sym</span>
            </div>
          </div>
        </div>

        {/* launcher tiles */}
        <div className="ze-launchers">
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
        <span className="cell grow">Project: ~/projects/{projectName}/{projectName}.kicad_pro</span>
      </div>
    </div>
  );
}
