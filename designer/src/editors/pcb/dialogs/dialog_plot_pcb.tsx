/**
 * Plot dialog for the board editor. Counterpart: DIALOG_PLOT
 * (pcbnew/dialogs/dialog_plot_base.cpp) — plot format choice (Gerber live;
 * Postscript / SVG / DXF / PDF / PNG greyed until their writers land), the
 * "Include Layers" checklist, the General Options subset our plotter honors,
 * the Gerber Options group (Protel filename extensions, fixed 4.6 mm
 * coordinate format, X2 attributes always on), and KiCad's button row:
 * Plot, Generate Drill Files..., Close.
 *
 * Plot writes one Gerber X2 file per checked layer and downloads them zipped;
 * Generate Drill Files writes the Excellon .drl.
 */
import { useState, type JSX } from 'react';
import { zipSync, strToU8 } from 'fflate';
import {
  plotGerberLayer,
  plotExcellonDrill,
  gerberProtelExtension,
  plotGerberJob,
  type Board,
} from '@ziroeda/pcbnew';

interface Props {
  board: Board;
  visibleLayers: ReadonlySet<string>;
  onClose: () => void;
}

const download = (name: string, data: Uint8Array | string): void => {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], {
    type: 'application/octet-stream',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

export function DialogPcbPlot({ board, visibleLayers, onClose }: Props): JSX.Element {
  const layerNames = board.layers.map((l) => l.name);
  // KiCad defaults to the fab set; seed with the visible layers intersection.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(layerNames.filter((l) => visibleLayers.has(l))),
  );
  const [protel, setProtel] = useState(false);
  const [jobFile, setJobFile] = useState(true);
  const [coordDigits, setCoordDigits] = useState<5 | 6>(6);
  const [zoneNote] = useState(true);
  const base = (board.fileName ?? 'board').replace(/\.kicad_pcb$/i, '');

  const toggle = (name: string): void =>
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const plot = (): void => {
    const files: Record<string, Uint8Array> = {};
    const made: { layer: string; name: string }[] = [];
    const date = new Date().toISOString();
    for (const layer of checked) {
      const ext = protel ? gerberProtelExtension(layer) : 'gbr';
      const name = `${base}-${layer.replace(/\./g, '_')}.${ext}`;
      files[name] = strToU8(plotGerberLayer(board, layer, { creationDate: date, coordDigits }));
      made.push({ layer, name });
    }
    if (made.length === 0) return;
    if (jobFile) files[`${base}-job.gbrjob`] = strToU8(plotGerberJob(board, made));
    download(`${base}-gerbers.zip`, zipSync(files));
  };

  const drill = (): void => {
    download(`${base}.drl`, plotExcellonDrill(board, { creationDate: new Date().toISOString() }));
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" style={{ width: 540 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Plot
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: 12 }}>
          <fieldset style={{ minWidth: 190 }}>
            <legend>Include Layers</legend>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {layerNames.map((l) => (
                <label key={l} style={{ display: 'block' }}>
                  <input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <div style={{ minWidth: 260 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>
              Plot format:{' '}
              <select value="gerber">
                <option value="gerber">Gerber</option>
                <option disabled>Postscript</option>
                <option disabled>SVG</option>
                <option disabled>DXF</option>
                <option disabled>PDF</option>
                <option disabled>PNG</option>
              </select>
            </label>
            <fieldset>
              <legend>General Options</legend>
              <div style={{ display: 'flex', gap: 14 }}>
                <div>
                  <label
                    style={{ display: 'block', opacity: 0.5 }}
                    title="Sheet plotting applies to SVG/PDF (staged)"
                  >
                    <input type="checkbox" disabled /> Plot drawing sheet
                  </label>
                  <label style={{ display: 'block', opacity: 0.5 }} title="Staged">
                    <input type="checkbox" disabled /> Subtract soldermask from silkscreen
                  </label>
                  <label style={{ display: 'block', opacity: 0.5 }} title="Staged">
                    <input type="checkbox" disabled /> Indicate DNP on fabrication layers
                  </label>
                  <label style={{ display: 'block', opacity: 0.5 }} title="Staged">
                    <input type="checkbox" disabled /> Sketch pads on fabrication layers
                  </label>
                </div>
                <div>
                  {/* Disabled for the Gerber format, exactly like DIALOG_PLOT. */}
                  <label
                    style={{ display: 'block', opacity: 0.5 }}
                    title="Not applicable to Gerber (KiCad disables these too)"
                  >
                    Drill marks:{' '}
                    <select disabled>
                      <option>None</option>
                    </select>
                  </label>
                  <label
                    style={{ display: 'block', opacity: 0.5 }}
                    title="Not applicable to Gerber"
                  >
                    Scaling:{' '}
                    <select disabled>
                      <option>1:1</option>
                    </select>
                  </label>
                  <label
                    style={{ display: 'block', opacity: 0.5 }}
                    title="Not applicable to Gerber"
                  >
                    <input type="checkbox" disabled /> Mirrored plot
                  </label>
                  <label
                    style={{ display: 'block', opacity: 0.5 }}
                    title="Not applicable to Gerber"
                  >
                    <input type="checkbox" disabled /> Negative plot
                  </label>
                  <label
                    style={{ display: 'block' }}
                    title="Zone fills are always current in this editor"
                  >
                    <input type="checkbox" checked={zoneNote} readOnly /> Check zone fills before
                    plotting
                  </label>
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Gerber Options</legend>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={protel}
                  onChange={(e) => setProtel(e.target.checked)}
                />{' '}
                Use Protel filename extensions
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={jobFile}
                  onChange={(e) => setJobFile(e.target.checked)}
                />{' '}
                Generate Gerber job file
              </label>
              <label style={{ display: 'block' }}>
                Coordinate format:{' '}
                <select
                  value={coordDigits}
                  onChange={(e) => setCoordDigits(Number(e.target.value) as 5 | 6)}
                >
                  <option value={5}>4.5, unit mm</option>
                  <option value={6}>4.6, unit mm</option>
                </select>
              </label>
              <label style={{ display: 'block', opacity: 0.5 }}>
                <input type="checkbox" checked disabled /> Use extended X2 format (recommended)
              </label>
            </fieldset>
            <div className="ze-muted" style={{ fontSize: 11, margin: '6px 0' }}>
              Stroked text on plotted layers is staged; verify output in the Gerber Viewer.
            </div>
          </div>
        </div>
        {/* DIALOG_PLOT's button row: Run DRC… on the left (staged), then
            Plot / Generate Drill Files… / Close. */}
        <div className="ze-modal-footer">
          <button type="button" disabled style={{ marginRight: 'auto', opacity: 0.5 }}>
            Run DRC...
          </button>
          <button type="button" className="primary" onClick={plot}>
            Plot
          </button>
          <button type="button" onClick={drill}>
            Generate Drill Files...
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
