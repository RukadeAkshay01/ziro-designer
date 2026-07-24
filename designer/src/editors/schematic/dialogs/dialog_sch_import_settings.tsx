/**
 * Import Settings from Another Project. Counterpart:
 * `eeschema/dialogs/dialog_sch_import_settings_base.cpp`
 * (DIALOG_SCH_IMPORT_SETTINGS) — a project-file picker over the "Import:"
 * checkbox list, in upstream's exact order and default states (everything
 * pre-checked except Annotation preferences). OK hands back the picked
 * `.kicad_pro` text plus the chosen options; the Setup dialog then copies the
 * selected slices into its working state (onAuxiliaryAction).
 */

import { useRef, useState, type JSX } from 'react';

export interface SchImportOptions {
  formatting: boolean;
  annotation: boolean;
  fieldNameTemplates: boolean;
  bomPresets: boolean;
  bomFmtPresets: boolean;
  severities: boolean;
  pinMap: boolean;
  netClasses: boolean;
  busAliases: boolean;
  textVars: boolean;
}

/** dialog_sch_import_settings.cpp defaults: all true except annotation. */
export const defaultSchImportOptions = (): SchImportOptions => ({
  formatting: true,
  annotation: false,
  fieldNameTemplates: true,
  bomPresets: true,
  bomFmtPresets: true,
  severities: true,
  pinMap: true,
  netClasses: true,
  busAliases: true,
  textVars: true,
});

/** The checkbox rows, in the base dialog's order with its exact labels. */
const ROWS: { key: keyof SchImportOptions; label: string }[] = [
  { key: 'formatting', label: 'Formatting preferences' },
  { key: 'annotation', label: 'Annotation preferences' },
  { key: 'fieldNameTemplates', label: 'Field name templates' },
  { key: 'bomPresets', label: 'BOM presets' },
  { key: 'bomFmtPresets', label: 'BOM format presets' },
  { key: 'severities', label: 'Violation severities' },
  { key: 'pinMap', label: 'Pin conflict map' },
  { key: 'netClasses', label: 'Net classes' },
  { key: 'busAliases', label: 'Bus alias definitions' },
  { key: 'textVars', label: 'Text variables' },
];

interface Props {
  onImport: (proText: string, opts: SchImportOptions) => void;
  onCancel: () => void;
}

export function DialogSchImportSettings({ onImport, onCancel }: Props): JSX.Element {
  const [opts, setOpts] = useState<SchImportOptions>(defaultSchImportOptions);
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined): void => {
    if (!f) return;
    setFileName(f.name);
    void f.text().then(setFileText);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Import Settings from a Project
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>Import from:</span>
            <input
              className="ze-search"
              style={{ flex: 1 }}
              readOnly
              placeholder="Choose a .kicad_pro file…"
              value={fileName}
              onClick={() => fileInput.current?.click()}
            />
            <button type="button" className="ze-btn" onClick={() => fileInput.current?.click()}>
              Browse…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".kicad_pro"
              style={{ display: 'none' }}
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>Import:</div>
          {ROWS.map((r) => (
            <label
              key={r.key}
              style={{ display: 'block', margin: '3px 0 3px 10px', fontSize: 12.5 }}
            >
              <input
                type="checkbox"
                checked={opts[r.key]}
                onChange={(e) => setOpts((o) => ({ ...o, [r.key]: e.target.checked }))}
              />{' '}
              {r.label}
            </label>
          ))}
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="ze-btn primary"
            disabled={fileText === null}
            onClick={() => fileText !== null && onImport(fileText, opts)}
          >
            Import Settings
          </button>
        </div>
      </div>
    </div>
  );
}
