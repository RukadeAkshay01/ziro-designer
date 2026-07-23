/**
 * The launcher's menu bar (upstream counterpart: kicad/menubar.cpp,
 * KICAD_MANAGER_FRAME::doReCreateMenuBar, transcribed from the 10.0 branch).
 * Item order, grouping, hotkeys and wording follow upstream exactly; items
 * whose subsystem does not exist yet are present but disabled, and
 * desktop-only items are reinterpreted for the web (see the notes inline).
 */

import type { Menu, MenuItem } from '../ui/MenuBar.js';
import type { ProjectMeta } from './projectStore.js';
import type { DemoMeta } from './demos.js';

const SEP: MenuItem = { sep: true };

export interface ManagerMenuHandlers {
  newProject: () => void;
  openProject: () => void;
  selectProjectFiles: () => void; // web-only fallback for blocked folder pickers
  openRecent: (id: string) => void;
  clearRecent: () => void;
  closeProject: () => void;
  saveAs: () => void;
  archiveProject: () => void;
  unarchiveProject: () => void;
  refresh: () => void;
  openTextViewer: () => void; // reinterprets "Open Text Editor"
  editSchematic: () => void;
  editSymbols: () => void;
  editPcb: () => void;
  editFootprints: () => void;
  openImageConverter: () => void;
  openPreferences: () => void;
  openPluginManager: () => void;
  showAbout: () => void;
  openDemo: (id: string) => void;
  hasProject: boolean;
  hasTextFileSelected: boolean;
  recent: readonly ProjectMeta[];
  demos: readonly DemoMeta[];
}

/** kicad/menubar.cpp: the Import Non-KiCad Project submenu, verbatim.
 * All disabled until the corresponding importer engines exist. */
const IMPORT_SUBMENU: MenuItem[] = [
  { label: 'Altium Project…', disabled: true },
  { label: 'CADSTAR Project…', disabled: true },
  { label: 'EAGLE Project…', disabled: true },
  { label: 'EasyEDA (JLCEDA) Std Backup…', disabled: true },
  { label: 'EasyEDA (JLCEDA) Pro Project…', disabled: true },
  { label: 'PADS Project…', disabled: true },
  { label: 'gEDA / Lepton EDA Project…', disabled: true },
];

/** The bundled demos as a submenu; simulation examples group under their own
 * flyout so the list stays scannable (32 demos ship today). */
function buildDemoSubmenu(h: ManagerMenuHandlers): MenuItem[] {
  if (h.demos.length === 0) return [{ label: '(no demos bundled)', disabled: true }];
  const entry = (d: DemoMeta): MenuItem => ({ label: d.title, action: () => h.openDemo(d.id) });
  const sims = h.demos.filter((d) => d.id.startsWith('simulation/'));
  const rest = h.demos.filter((d) => !d.id.startsWith('simulation/'));
  const items: MenuItem[] = rest.map(entry);
  if (sims.length > 0) items.push({ label: 'Simulation', submenu: sims.map(entry) });
  return items;
}

export function buildManagerMenus(h: ManagerMenuHandlers): Menu[] {
  // File > Open Recent — KiCad's FILE_HISTORY menu, fed from our project store.
  const recentSub: MenuItem[] =
    h.recent.length === 0
      ? [{ label: '(no recent projects)', disabled: true }]
      : [
          ...h.recent.map((p): MenuItem => ({ label: p.name, action: () => h.openRecent(p.id) })),
          SEP,
          { label: 'Clear Recent Projects', action: () => h.clearRecent() },
        ];

  return [
    {
      label: 'File',
      items: [
        { label: 'New Project…', shortcut: 'Ctrl+N', action: h.newProject },
        // "Clone Project from Repository…" is git-gated upstream and hidden
        // when git is off — omitted until version control lands.
        // Upstream shows this only when the stock demos path exists; ours
        // lists the bundled demos as a submenu (the web take on its picker).
        {
          label: 'Open Demo Project',
          submenu: buildDemoSubmenu(h),
        },
        { label: 'Open Project…', icon: 'open', shortcut: 'Ctrl+O', action: h.openProject },
        // Web-only: fallback when the browser blocks the folder picker.
        { label: 'Select Project Files…', action: h.selectProjectFiles },
        { label: 'Open Recent', submenu: recentSub },
        SEP,
        { label: 'New Jobset File…', disabled: true }, // jobs system not yet built
        { label: 'Open Jobset File…', disabled: true },
        SEP,
        { label: 'Close Project', action: h.closeProject, disabled: !h.hasProject },
        SEP,
        // Upstream disables this when no local history exists; ours is
        // disabled until the snapshot subsystem lands (tracked issue).
        { label: 'Restore Local History…', disabled: true },
        SEP,
        { label: 'Save As…', action: h.saveAs, disabled: !h.hasProject },
        SEP,
        { label: 'Import Non-KiCad Project', submenu: IMPORT_SUBMENU },
        SEP,
        { label: 'Archive Project…', action: h.archiveProject, disabled: !h.hasProject },
        { label: 'Unarchive Project…', action: h.unarchiveProject },
        // "Quit" is not applicable in a browser tab.
      ],
    },
    {
      label: 'Edit',
      items: [
        // Upstream keeps these so cut/copy/paste work in dialog text fields.
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Panels',
          submenu: [{ label: 'Local History', disabled: true }], // tracked issue
        },
        SEP,
        { label: 'Refresh', shortcut: 'F5', action: h.refresh },
        SEP,
        // "Open Text Editor" reinterpreted: view the selected text file in-app.
        {
          label: 'Open Text Viewer',
          action: h.openTextViewer,
          disabled: !h.hasTextFileSelected,
        },
        // "Open Project Directory" (OS file manager) has no web equivalent.
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Schematic Editor', shortcut: 'Ctrl+E', action: h.editSchematic },
        { label: 'Symbol Editor', shortcut: 'Ctrl+L', action: h.editSymbols },
        { label: 'PCB Editor', shortcut: 'Ctrl+P', action: h.editPcb, disabled: !h.hasProject },
        { label: 'Footprint Editor', shortcut: 'Ctrl+F', action: h.editFootprints },
        SEP,
        { label: 'Gerber Viewer', shortcut: 'Ctrl+G', disabled: true },
        { label: 'Image Converter', shortcut: 'Ctrl+B', action: h.openImageConverter },
        { label: 'Calculator Tools', disabled: true },
        { label: 'Drawing Sheet Editor', shortcut: 'Ctrl+Y', disabled: true },
        { label: 'Plugin and Content Manager', shortcut: 'Ctrl+M', action: h.openPluginManager },
        SEP,
        { label: 'Edit Local File…', disabled: true }, // becomes the text viewer picker
      ],
    },
    {
      label: 'Preferences',
      items: [
        { label: 'Configure Paths…', disabled: true },
        { label: 'Manage Symbol Libraries…', disabled: true },
        { label: 'Manage Footprint Libraries…', disabled: true },
        { label: 'Manage Design Block Libraries…', disabled: true },
        { label: 'Preferences…', shortcut: 'Ctrl+,', action: h.openPreferences },
        SEP,
        { label: 'Set Language', submenu: [{ label: 'English', disabled: true }] },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          label: 'Documentation',
          action: () => window.open('https://github.com/RukadeAkshay01/ziro-designer', '_blank'),
        },
        {
          label: 'Report Bug',
          action: () =>
            window.open('https://github.com/RukadeAkshay01/ziro-designer/issues', '_blank'),
        },
        SEP,
        // Our compatibility promise includes funding upstream development.
        {
          label: 'Donate to KiCad',
          action: () => window.open('https://go.kicad.org/donate', '_blank'),
        },
        SEP,
        { label: 'About Ziro Designer', action: h.showAbout },
      ],
    },
  ];
}
