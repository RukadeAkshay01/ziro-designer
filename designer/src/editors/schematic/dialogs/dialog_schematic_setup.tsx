/**
 * Schematic Setup dialog. Counterpart: `eeschema/dialogs/dialog_schematic_setup.cpp`
 * (DIALOG_SCHEMATIC_SETUP) — a tree of setup pages grouped under General,
 * Electrical Rules, Project and Schematic Data. The pages we model are
 * selectable; upstream pages whose engine data we do not store yet are shown
 * greyed, exactly where KiCad puts them, so the surface matches.
 *
 * The dialog edits a working copy of the project-scoped SCHEMATIC settings and
 * commits it on OK.
 */

import { useState, type JSX } from 'react';
import { defaultErcSettings, type ErcSettings } from '@ziroeda/eeschema';
import { PanelSetupSeverities } from './panels/panel_setup_severities.js';
import { PanelSetupPinmap } from './panels/panel_setup_pinmap.js';
import { PanelTextVariables, type TextVar } from './panels/panel_text_variables.js';
import { PanelTemplateFieldnames, type FieldTemplate } from './panels/panel_template_fieldnames.js';

/** Project-scoped schematic settings edited by the dialog (SCHEMATIC_SETTINGS subset). */
export interface SchematicSetup {
  erc: ErcSettings;
  textVars: TextVar[];
  fieldTemplates: FieldTemplate[];
}

export function defaultSchematicSetup(): SchematicSetup {
  return { erc: defaultErcSettings(), textVars: [], fieldTemplates: [] };
}

type PageId =
  | 'formatting'
  | 'annotation'
  | 'fieldTemplates'
  | 'bomPresets'
  | 'severities'
  | 'pinmap'
  | 'netclasses'
  | 'buses'
  | 'textVars'
  | 'embedded';

interface PageNode {
  id?: PageId;
  label: string;
  /** Section header (bold, non-selectable) when true. */
  section?: boolean;
  /** Not implemented yet — greyed, in its upstream position. */
  disabled?: boolean;
  depth: number;
}

// The upstream page tree (DIALOG_SCHEMATIC_SETUP::DIALOG_SCHEMATIC_SETUP).
const PAGES: PageNode[] = [
  { label: 'General', section: true, depth: 0 },
  { id: 'formatting', label: 'Formatting', disabled: true, depth: 1 },
  { id: 'annotation', label: 'Annotation Options', disabled: true, depth: 1 },
  { id: 'fieldTemplates', label: 'Field Name Templates', depth: 1 },
  { id: 'bomPresets', label: 'BOM Presets', disabled: true, depth: 1 },
  { label: 'Electrical Rules', section: true, depth: 0 },
  { id: 'severities', label: 'Violation Severity', depth: 1 },
  { id: 'pinmap', label: 'Pin Conflicts Map', depth: 1 },
  { label: 'Project', section: true, depth: 0 },
  { id: 'netclasses', label: 'Net Classes', disabled: true, depth: 1 },
  { id: 'buses', label: 'Bus Alias Definitions', disabled: true, depth: 1 },
  { id: 'textVars', label: 'Text Variables', depth: 1 },
  { label: 'Schematic Data', section: true, depth: 0 },
  { id: 'embedded', label: 'Embedded Files', disabled: true, depth: 1 },
];

interface Props {
  value: SchematicSetup;
  onOk: (next: SchematicSetup) => void;
  onCancel: () => void;
}

export function DialogSchematicSetup({ value, onOk, onCancel }: Props): JSX.Element {
  // A working copy: edits apply on OK, discard on Cancel (KiCad's TransferData).
  const [s, setS] = useState<SchematicSetup>(() => ({
    erc: { severities: { ...value.erc.severities }, pinMap: value.erc.pinMap.map((r) => [...r]) },
    textVars: value.textVars.map((v) => ({ ...v })),
    fieldTemplates: value.fieldTemplates.map((t) => ({ ...t })),
  }));
  const [page, setPage] = useState<PageId>('severities');

  const setErc = (erc: ErcSettings): void => setS((cur) => ({ ...cur, erc }));

  const panel = ((): JSX.Element => {
    switch (page) {
      case 'severities':
        return <PanelSetupSeverities settings={s.erc} onChange={setErc} />;
      case 'pinmap':
        return <PanelSetupPinmap settings={s.erc} onChange={setErc} />;
      case 'textVars':
        return (
          <PanelTextVariables
            vars={s.textVars}
            onChange={(textVars) => setS((cur) => ({ ...cur, textVars }))}
          />
        );
      case 'fieldTemplates':
        return (
          <PanelTemplateFieldnames
            templates={s.fieldTemplates}
            onChange={(fieldTemplates) => setS((cur) => ({ ...cur, fieldTemplates }))}
          />
        );
      default:
        return (
          <div style={{ padding: 16, color: 'var(--ze-muted, #888)', fontSize: 12 }}>
            This setup page is not implemented yet.
          </div>
        );
    }
  })();

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{
          width: 720,
          maxWidth: '96vw',
          height: 540,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Schematic Setup
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            style={{
              width: 210,
              flex: '0 0 auto',
              borderRight: '1px solid var(--ze-border, #ccc)',
              overflowY: 'auto',
              padding: '6px 0',
            }}
          >
            {PAGES.map((p, i) =>
              p.section ? (
                <div key={i} style={{ fontWeight: 700, fontSize: 12, padding: '6px 10px 2px' }}>
                  {p.label}
                </div>
              ) : (
                <div
                  key={i}
                  className={`ze-tree-item ${p.id === page ? 'active' : ''}`}
                  style={{
                    paddingLeft: 10 + p.depth * 14,
                    fontSize: 12,
                    opacity: p.disabled ? 0.45 : 1,
                    cursor: p.disabled ? 'default' : 'pointer',
                  }}
                  onClick={() => !p.disabled && p.id && setPage(p.id)}
                  title={p.disabled ? 'Not implemented yet' : p.label}
                >
                  {p.label}
                </div>
              ),
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', minWidth: 0 }}>
            {panel}
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk(s)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
