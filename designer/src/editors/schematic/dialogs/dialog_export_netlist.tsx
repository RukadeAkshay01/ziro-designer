/**
 * Export Netlist dialog. Counterpart: `eeschema/dialogs/dialog_export_netlist.cpp`
 * (DIALOG_EXPORT_NETLIST) — a notebook with one page per exporter. We ship the
 * two built-in formats KiCad generates natively (KiCad generic XML and
 * OrcadPCB2); each page has an Export Netlist button that downloads the file.
 * (Custom command-line generators are a desktop-only feature and omitted.)
 */

import { useState, type JSX } from 'react';
import {
  generateNetlist,
  type NetlistFormat,
  type Schematic,
  type LibSymbol,
} from '@ziroeda/eeschema';

interface Props {
  doc: Schematic;
  libById: Map<string, LibSymbol>;
  /** Suggested output base name (sheet/project name, no extension). */
  baseName: string;
  onClose: () => void;
}

const TABS: { id: NetlistFormat; label: string; ext: string; note: string }[] = [
  {
    id: 'kicadxml',
    label: 'KiCad',
    ext: 'xml',
    note: 'The KiCad generic XML netlist (used by BOM tools and importers).',
  },
  {
    id: 'orcadpcb2',
    label: 'OrcadPCB2',
    ext: 'net',
    note: 'The classic OrcadPCB2 text netlist.',
  },
];

export function DialogExportNetlist({ doc, libById, baseName, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<NetlistFormat>('kicadxml');
  const active = TABS.find((t) => t.id === tab)!;

  const doExport = (): void => {
    const text = generateNetlist(tab, doc, libById, { source: `${baseName}.kicad_sch` });
    const mime = tab === 'kicadxml' ? 'application/xml' : 'text/plain';
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${active.ext}`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 440, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Export Netlist
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-erc-tabs" style={{ padding: '6px 10px 0' }}>
          {TABS.map((t) => (
            <div
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div className="ze-modal-body" style={{ display: 'block', padding: '14px' }}>
          <p className="ze-muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
            {active.note}
          </p>
          <div style={{ fontSize: 12 }}>
            Output file:{' '}
            <code>
              {baseName}.{active.ext}
            </code>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={doExport}>
            Export Netlist
          </button>
        </div>
      </div>
    </div>
  );
}
