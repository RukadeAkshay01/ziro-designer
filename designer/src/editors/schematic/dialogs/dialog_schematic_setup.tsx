/**
 * Schematic Setup dialog. Counterpart: `eeschema/dialogs/dialog_schematic_setup.cpp`
 * (DIALOG_SCHEMATIC_SETUP) — a tree of setup pages grouped under General,
 * Electrical Rules, Project and Schematic Data. The pages we model are
 * selectable; upstream pages whose engine data we do not store yet are shown
 * greyed, exactly where KiCad puts them, so the surface matches.
 *
 * The chrome (tree, sizing, Reset / Import buttons) lives in the shared
 * PagedDialog, matching KiCad's PAGED_DIALOG base class. This file supplies the
 * page tree and panel renderers. The dialog edits a working copy of the
 * project-scoped SCHEMATIC settings and commits it on OK.
 */

import { useState, type JSX } from 'react';
import { DEFAULT_PIN_MAP, DEFAULT_SEVERITIES, type ErcSettings } from '@ziroeda/eeschema';
import { PagedDialog, type PagedDialogSection } from '../../../ui/PagedDialog.js';
import {
  defaultAnnotation,
  defaultBomPresets,
  defaultBusAliases,
  defaultFormatting,
  defaultNetChains,
  defaultNetClasses,
  type SchematicSetup,
} from '../schematic_settings.js';
import { readSchematicSetupText } from '../project_settings.js';
import { DialogSchImportSettings, type SchImportOptions } from './dialog_sch_import_settings.js';
import { PanelSetupSeverities } from './panels/panel_setup_severities.js';
import { PanelSetupPinmap } from './panels/panel_setup_pinmap.js';
import { PanelTextVariables } from './panels/panel_text_variables.js';
import { PanelTemplateFieldnames } from './panels/panel_template_fieldnames.js';
import { PanelEeschemaAnnotationOptions } from './panels/panel_eeschema_annotation_options.js';
import { PanelSetupFormatting } from './panels/panel_setup_formatting.js';
import { PanelBomPresets } from './panels/panel_bom_presets.js';
import { PanelSetupBuses } from './panels/panel_setup_buses.js';
import { PanelSetupNetChains } from './panels/panel_setup_net_chains.js';
import { PanelSetupNetclasses } from './panels/panel_setup_netclasses.js';
import { PanelEmbeddedFiles } from './panels/panel_embedded_files.js';

// The dialog's data model lives in schematic_settings.ts (KiCad's
// SCHEMATIC_SETTINGS data/UI split); re-exported for existing importers.
export { defaultSchematicSetup, type SchematicSetup } from '../schematic_settings.js';

type PageId =
  | 'formatting'
  | 'annotation'
  | 'fieldTemplates'
  | 'bomPresets'
  | 'severities'
  | 'pinmap'
  | 'netclasses'
  | 'buses'
  | 'netChains'
  | 'textVars'
  | 'embedded';

interface Props {
  value: SchematicSetup;
  /** Page to open on (ShowSchematicSetupDialog's aInitialPage). */
  initialPage?: PageId;
  onOk: (next: SchematicSetup) => void;
  onCancel: () => void;
}

export function DialogSchematicSetup({ value, initialPage, onOk, onCancel }: Props): JSX.Element {
  // A working copy: edits apply on OK, discard on Cancel (KiCad's TransferData).
  const [s, setS] = useState<SchematicSetup>(() => ({
    erc: { severities: { ...value.erc.severities }, pinMap: value.erc.pinMap.map((r) => [...r]) },
    textVars: value.textVars.map((v) => ({ ...v })),
    fieldTemplates: value.fieldTemplates.map((t) => ({ ...t })),
    formatting: { ...value.formatting },
    annotation: { ...value.annotation },
    bomPresets: structuredClone(value.bomPresets),
    busAliases: structuredClone(value.busAliases),
    netChains: structuredClone(value.netChains),
    netClasses: structuredClone(value.netClasses),
    embeddedFiles: structuredClone(value.embeddedFiles),
    ercExclusions: [...value.ercExclusions],
    usedDesignators: value.usedDesignators,
  }));
  const [importOpen, setImportOpen] = useState(false);

  const setErc = (erc: ErcSettings): void => setS((cur) => ({ ...cur, erc }));

  // onAuxiliaryAction: copy the checked slices of another project's settings
  // into the working state (DIALOG_SCHEMATIC_SETUP::onAuxiliaryAction — each
  // panel's ImportSettingsFrom over the other project's loaded settings).
  const importFrom = (proText: string, o: SchImportOptions): void => {
    const other = readSchematicSetupText(proText);
    setS((cur) => ({
      ...cur,
      ...(o.formatting ? { formatting: other.formatting } : {}),
      ...(o.annotation ? { annotation: other.annotation } : {}),
      ...(o.fieldNameTemplates ? { fieldTemplates: other.fieldTemplates } : {}),
      ...(o.bomPresets || o.bomFmtPresets
        ? {
            bomPresets: {
              presets: o.bomPresets ? other.bomPresets.presets : cur.bomPresets.presets,
              fmtPresets: o.bomFmtPresets ? other.bomPresets.fmtPresets : cur.bomPresets.fmtPresets,
            },
          }
        : {}),
      ...(o.severities || o.pinMap
        ? {
            erc: {
              severities: o.severities ? other.erc.severities : cur.erc.severities,
              pinMap: o.pinMap ? other.erc.pinMap : cur.erc.pinMap,
            },
          }
        : {}),
      ...(o.netClasses ? { netClasses: other.netClasses } : {}),
      ...(o.busAliases ? { busAliases: other.busAliases } : {}),
      ...(o.textVars ? { textVars: other.textVars } : {}),
    }));
    setImportOpen(false);
  };

  // The upstream page tree (DIALOG_SCHEMATIC_SETUP::DIALOG_SCHEMATIC_SETUP).
  // Pages whose engine data we do not store yet are `disabled` — greyed in place.
  const sections: PagedDialogSection[] = [
    {
      label: 'General',
      pages: [
        {
          id: 'formatting',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, formatting: defaultFormatting() })),
          label: 'Formatting',
          render: () => (
            <PanelSetupFormatting
              value={s.formatting}
              onChange={(formatting) => setS((cur) => ({ ...cur, formatting }))}
            />
          ),
        },
        {
          id: 'annotation',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, annotation: defaultAnnotation() })),
          label: 'Annotation',
          render: () => (
            <PanelEeschemaAnnotationOptions
              value={s.annotation}
              onChange={(annotation) => setS((cur) => ({ ...cur, annotation }))}
            />
          ),
        },
        {
          id: 'fieldTemplates',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, fieldTemplates: [] })),
          label: 'Field Name Templates',
          render: () => (
            <PanelTemplateFieldnames
              templates={s.fieldTemplates}
              onChange={(fieldTemplates) => setS((cur) => ({ ...cur, fieldTemplates }))}
            />
          ),
        },
        {
          id: 'bomPresets',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, bomPresets: defaultBomPresets() })),
          label: 'BOM Presets',
          render: () => (
            <PanelBomPresets
              value={s.bomPresets}
              onChange={(bomPresets) => setS((cur) => ({ ...cur, bomPresets }))}
            />
          ),
        },
      ],
    },
    {
      label: 'Electrical Rules',
      pages: [
        {
          id: 'severities',
          resettable: true,
          onReset: () =>
            setS((cur) => ({ ...cur, erc: { ...cur.erc, severities: { ...DEFAULT_SEVERITIES } } })),
          label: 'Violation Severity',
          render: () => <PanelSetupSeverities settings={s.erc} onChange={setErc} />,
        },
        {
          id: 'pinmap',
          resettable: true,
          onReset: () =>
            setS((cur) => ({
              ...cur,
              erc: { ...cur.erc, pinMap: DEFAULT_PIN_MAP.map((r) => [...r]) },
            })),
          label: 'Pin Conflicts Map',
          render: () => <PanelSetupPinmap settings={s.erc} onChange={setErc} />,
        },
      ],
    },
    {
      label: 'Project',
      pages: [
        {
          id: 'netclasses',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, netClasses: defaultNetClasses() })),
          label: 'Net Classes',
          render: () => (
            <PanelSetupNetclasses
              value={s.netClasses}
              onChange={(netClasses) => setS((cur) => ({ ...cur, netClasses }))}
            />
          ),
        },
        {
          id: 'buses',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, busAliases: defaultBusAliases() })),
          label: 'Bus Alias Definitions',
          render: () => (
            <PanelSetupBuses
              aliases={s.busAliases}
              onChange={(busAliases) => setS((cur) => ({ ...cur, busAliases }))}
            />
          ),
        },
        {
          id: 'netChains',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, netChains: defaultNetChains() })),
          label: 'Net Chains',
          render: () => (
            <PanelSetupNetChains
              value={s.netChains}
              onChange={(netChains) => setS((cur) => ({ ...cur, netChains }))}
            />
          ),
        },
        {
          id: 'textVars',
          resettable: true,
          onReset: () => setS((cur) => ({ ...cur, textVars: [] })),
          label: 'Text Variables',
          render: () => (
            <PanelTextVariables
              vars={s.textVars}
              onChange={(textVars) => setS((cur) => ({ ...cur, textVars }))}
            />
          ),
        },
      ],
    },
    {
      label: 'Schematic Data',
      pages: [
        {
          id: 'embedded',
          label: 'Embedded Files',
          render: () => (
            <PanelEmbeddedFiles
              value={s.embeddedFiles}
              onChange={(embeddedFiles) => setS((cur) => ({ ...cur, embeddedFiles }))}
            />
          ),
        },
      ],
    },
  ];

  return (
    <>
      {importOpen && (
        <DialogSchImportSettings onImport={importFrom} onCancel={() => setImportOpen(false)} />
      )}
      <PagedDialog
        title="Schematic Setup"
        sections={sections}
        initialPage={initialPage}
        showReset
        auxiliaryAction="Import Settings from Another Project..."
        onAuxiliaryAction={() => setImportOpen(true)}
        initialSize={{ width: 920, height: 600 }}
        onOk={() => onOk(s)}
        onCancel={onCancel}
      />
    </>
  );
}
