/**
 * Import Settings from Another Board. Counterpart:
 * `pcbnew/dialogs/dialog_import_settings.cpp` (DIALOG_IMPORT_SETTINGS) — a
 * board-file picker plus one checkbox per importable settings group, in the
 * base dialog's order. KiCad behaviors translated exactly:
 *
 *  - "Import Settings" (OK) stays disabled until at least one group is
 *    checked (UpdateImportSettingsButton).
 *  - The Select All button toggles: it reads "Select All" until everything
 *    would be selected, then "Deselect All" (m_showSelectAllOnBtn); clearing
 *    the last checkbox flips it back to "Select All".
 *  - The chosen path is remembered for the session (static m_filePath).
 *
 * The browse control is a browser file input: KiCad browses for the other
 * `.kicad_pcb` and requires its sibling `.kicad_pro` — on the web both files
 * (plus the optional `.kicad_dru`) are picked together, since there is no
 * path-based sibling lookup.
 *
 * "Zone hatched fill offsets" is not offered: the zone_defaults block it
 * imports is preserved-opaque board data this clone does not model yet.
 */
import { useRef, useState, type JSX } from 'react';

/** One checkbox per importable group (DIALOG_IMPORT_SETTINGS_BASE order). */
export interface ImportSettingsOpts {
  layers: boolean; // Board layers and physical stackup (+ board finish)
  maskAndPaste: boolean; // Solder mask/paste defaults
  textAndGraphics: boolean; // Text && graphics default properties
  formatting: boolean; // Text && graphics formatting
  constraints: boolean; // Design rule constraints
  tracksAndVias: boolean; // Predefined track && via dimensions
  zones: boolean; // Zone defaults
  teardrops: boolean; // Teardrop defaults
  tuningPatterns: boolean; // Length-tuning pattern defaults
  netclasses: boolean; // Net classes
  componentClasses: boolean; // Component classes
  tuningProfiles: boolean; // Tuning Profiles
  customRules: boolean; // Custom rules
  severities: boolean; // Violation severities
}

const GROUPS: { key: keyof ImportSettingsOpts; label: string }[] = [
  { key: 'layers', label: 'Board layers and physical stackup' },
  { key: 'maskAndPaste', label: 'Solder mask/paste defaults' },
  { key: 'textAndGraphics', label: 'Text & graphics default properties' },
  { key: 'formatting', label: 'Text & graphics formatting' },
  { key: 'constraints', label: 'Design rule constraints' },
  { key: 'tracksAndVias', label: 'Predefined track & via dimensions' },
  { key: 'zones', label: 'Zone defaults' },
  { key: 'teardrops', label: 'Teardrop defaults' },
  { key: 'tuningPatterns', label: 'Length-tuning pattern defaults' },
  { key: 'netclasses', label: 'Net classes' },
  { key: 'componentClasses', label: 'Component classes' },
  { key: 'tuningProfiles', label: 'Tuning Profiles' },
  { key: 'customRules', label: 'Custom rules' },
  { key: 'severities', label: 'Violation severities' },
];

export function emptyImportOpts(): ImportSettingsOpts {
  return Object.fromEntries(GROUPS.map((g) => [g.key, false])) as unknown as ImportSettingsOpts;
}

// Remembered for the session, like DIALOG_IMPORT_SETTINGS::m_filePath.
let g_lastFiles: { name: string; text: string }[] = [];

interface Props {
  onImport: (files: { name: string; text: string }[], opts: ImportSettingsOpts) => void;
  onClose: () => void;
}

export function DialogImportSettings({ onImport, onClose }: Props): JSX.Element {
  const [files, setFiles] = useState<{ name: string; text: string }[]>(g_lastFiles);
  const [opts, setOpts] = useState<ImportSettingsOpts>(emptyImportOpts);
  // m_showSelectAllOnBtn: what the toggle button will do next.
  const [selectAllNext, setSelectAllNext] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const anyChecked = GROUPS.some((g) => opts[g.key]);
  const allChecked = GROUPS.every((g) => opts[g.key]);

  const toggle = (key: keyof ImportSettingsOpts): void => {
    const next = { ...opts, [key]: !opts[key] };
    setOpts(next);
    // Clearing the last selection resets the button to "Select All".
    if (!GROUPS.some((g) => next[g.key])) setSelectAllNext(true);
    else if (GROUPS.every((g) => next[g.key])) setSelectAllNext(false);
  };

  const selectAll = (): void => {
    const value = selectAllNext;
    setOpts(Object.fromEntries(GROUPS.map((g) => [g.key, value])) as unknown as ImportSettingsOpts);
    setSelectAllNext(!value);
  };

  const onPick = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    const read = await Promise.all(
      [...list].map(
        async (f) => ({ name: f.name, text: await f.text() }) as { name: string; text: string },
      ),
    );
    g_lastFiles = read;
    setFiles(read);
  };

  const check: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    margin: '4px 0',
    fontSize: 12.5,
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose} style={{ zIndex: 60 }}>
      <div
        className="ze-modal"
        style={{ width: 460, maxWidth: '94vw', height: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Import Settings
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>Import from:</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
            <input
              className="ze-search"
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }}
              readOnly
              value={files.map((f) => f.name).join(', ')}
              placeholder="Select the other project's .kicad_pcb + .kicad_pro files"
            />
            <button className="ze-btn sm" onClick={() => fileInput.current?.click()}>
              Browse…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".kicad_pcb,.kicad_pro,.kicad_dru"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void onPick(e.target.files)}
            />
          </div>

          <div style={{ fontSize: 12.5, margin: '4px 0 6px' }}>Import:</div>
          {GROUPS.map((g) => (
            <label key={g.key} style={check}>
              <input type="checkbox" checked={opts[g.key]} onChange={() => toggle(g.key)} />
              {g.label}
            </label>
          ))}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" style={{ marginRight: 'auto' }} onClick={selectAll}>
            {selectAllNext && !allChecked ? 'Select All' : 'Deselect All'}
          </button>
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            disabled={!anyChecked || files.length === 0}
            onClick={() => onImport(files, opts)}
          >
            Import Settings
          </button>
        </div>
      </div>
    </div>
  );
}
