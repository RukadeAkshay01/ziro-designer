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

  // Output Messages report panel (upstream WX_HTML_REPORT_PANEL).
  type MsgLevel = 'error' | 'warning' | 'action' | 'info';
  const [messages, setMessages] = useState<{ level: MsgLevel; text: string }[]>([]);
  const [show, setShow] = useState<Record<MsgLevel, boolean>>({
    error: true,
    warning: true,
    action: true,
    info: true,
  });
  const report = (level: MsgLevel, text: string): void =>
    setMessages((m) => [...m, { level, text }]);
  const errorCount = messages.filter((m) => m.level === 'error').length;
  const warnCount = messages.filter((m) => m.level === 'warning').length;
  const allOn = show.error && show.warning && show.action && show.info;
  const MSG_COLOR: Record<MsgLevel, string> = {
    error: 'rgb(230, 9, 13)',
    warning: 'rgb(209, 146, 0)',
    action: 'var(--chrome-fg)',
    info: 'var(--ze-muted, #9a9ca0)',
  };
  const saveLog = (): void => {
    const text = messages.map((m) => `[${m.level}] ${m.text}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'plot-messages.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
    if (made.length === 0) {
      report('warning', 'No layers selected — nothing to plot.');
      return;
    }
    if (jobFile) files[`${base}-job.gbrjob`] = strToU8(plotGerberJob(board, made));
    for (const m of made) report('action', `Plotted ${m.name}`);
    if (jobFile) report('action', `Created Gerber job file ${base}-job.gbrjob`);
    report('info', `Plotted ${made.length} Gerber file(s) to ${base}-gerbers.zip`);
    download(`${base}-gerbers.zip`, zipSync(files));
  };

  const drill = (): void => {
    download(`${base}.drl`, plotExcellonDrill(board, { creationDate: new Date().toISOString() }));
    report('action', `Created Excellon drill file ${base}.drl`);
  };

  const box: React.CSSProperties = {
    border: '1px solid var(--chrome-border)',
    borderRadius: 4,
    padding: '6px 10px 8px',
    margin: '0 0 10px',
  };
  const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
  const lab: React.CSSProperties = { fontSize: 12 };
  const check = (disabled?: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '5px 0',
    fontSize: 12.5,
    opacity: disabled ? 0.5 : 1,
  });
  const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '5px 0',
    fontSize: 12.5,
  };
  const NA = 'Not applicable to Gerber (KiCad disables these too)';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 760, maxWidth: '96vw', height: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Plot
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'block', padding: '10px 14px', maxHeight: '80vh', overflow: 'auto' }}
        >
          {/* Plot format + Design variant + Output directory (upstream top row). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={lab}>Plot format:</span>
            <select className="ze-select" value="gerber" onChange={() => {}}>
              <option value="gerber">Gerber</option>
              <option disabled>Postscript</option>
              <option disabled>SVG</option>
              <option disabled>DXF</option>
              <option disabled>PDF</option>
              <option disabled>PNG</option>
            </select>
            <span style={{ ...lab, marginLeft: 8 }}>Design variant:</span>
            <select
              className="ze-select"
              disabled
              value="default"
              title="Design variants are not supported in the browser yet"
            >
              <option value="default">Default</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={lab}>Output directory:</span>
            <input
              className="ze-search"
              style={{ flex: 1 }}
              disabled
              placeholder="Browser downloads folder"
              title="Plots download through the browser; the target folder is your download setting."
            />
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {/* Include Layers */}
            <fieldset
              style={{ ...box, flex: '0 0 200px', display: 'flex', flexDirection: 'column' }}
            >
              <legend style={legend}>Include Layers</legend>
              <div className="ze-grid-pane" style={{ height: 320, padding: '4px 6px' }}>
                {layerNames.map((l) => (
                  <label key={l} style={{ ...check(), margin: '3px 0' }}>
                    <input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Options */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* General Options: two columns, like DIALOG_PLOT. */}
              <fieldset style={box}>
                <legend style={legend}>General Options</legend>
                <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={check(true)} title="Sheet plotting applies to SVG/PDF (staged)">
                      <input type="checkbox" disabled /> Plot drawing sheet
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Subtract soldermask from silkscreen
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Remove silkscreen from areas without
                      soldermask
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Indicate DNP on fabrication layers
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Sketch pads on fabrication layers
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Include pad numbers
                    </label>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...fieldRow, opacity: 0.5 }} title={NA}>
                      <span>Drill marks:</span>
                      <select className="ze-select" style={{ flex: 1 }} disabled>
                        <option>None</option>
                        <option>Small</option>
                        <option>Actual size</option>
                      </select>
                    </div>
                    <div style={{ ...fieldRow, opacity: 0.5 }} title={NA}>
                      <span>Scaling:</span>
                      <select className="ze-select" style={{ flex: 1 }} disabled>
                        <option>Auto</option>
                        <option>1:1</option>
                        <option>3:2</option>
                        <option>2:1</option>
                        <option>3:1</option>
                      </select>
                    </div>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Use drill/place file origin
                    </label>
                    <label style={check(true)} title={NA}>
                      <input type="checkbox" disabled /> Mirrored plot
                    </label>
                    <label style={check(true)} title={NA}>
                      <input type="checkbox" disabled /> Negative plot
                    </label>
                    <label style={check()} title="Zone fills are always current in this editor">
                      <input type="checkbox" checked={zoneNote} readOnly /> Check zone fills before
                      plotting
                    </label>
                  </div>
                </div>
              </fieldset>

              {/* Gerber Options: two columns. */}
              <fieldset style={box}>
                <legend style={legend}>Gerber Options</legend>
                <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={check()}>
                      <input
                        type="checkbox"
                        checked={protel}
                        onChange={(e) => setProtel(e.target.checked)}
                      />
                      Use Protel filename extensions
                    </label>
                    <label style={check()}>
                      <input
                        type="checkbox"
                        checked={jobFile}
                        onChange={(e) => setJobFile(e.target.checked)}
                      />
                      Generate Gerber job file
                    </label>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={fieldRow}>
                      <span>Coordinate format:</span>
                      <select
                        className="ze-select"
                        style={{ flex: 1 }}
                        value={coordDigits}
                        onChange={(e) => setCoordDigits(Number(e.target.value) as 5 | 6)}
                      >
                        <option value={5}>4.5, unit mm</option>
                        <option value={6}>4.6, unit mm</option>
                      </select>
                    </div>
                    <label style={check(true)}>
                      <input type="checkbox" checked disabled /> Use extended X2 format
                      (recommended)
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Include netlist attributes
                    </label>
                    <label style={check(true)} title="Staged">
                      <input type="checkbox" disabled /> Disable aperture macros (not recommended)
                    </label>
                  </div>
                </div>
              </fieldset>
            </div>
          </div>

          {/* Output Messages (upstream WX_HTML_REPORT_PANEL). */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12.5, marginBottom: 4 }}>Output Messages</div>
            <div
              style={{
                border: '1px solid var(--chrome-border)',
                borderRadius: 3,
                minHeight: 90,
                maxHeight: 150,
                overflow: 'auto',
                padding: '4px 8px',
                fontSize: 12,
                fontFamily: 'var(--mono, monospace)',
                background: 'var(--chrome-bg2)',
              }}
            >
              {messages.filter((m) => show[m.level]).length === 0 ? (
                <span style={{ color: 'var(--ze-muted, #888)' }}>—</span>
              ) : (
                messages
                  .filter((m) => show[m.level])
                  .map((m, i) => (
                    <div key={i} style={{ color: MSG_COLOR[m.level] }}>
                      {m.text}
                    </div>
                  ))
              )}
            </div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6, fontSize: 12 }}
            >
              <span>Show:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) =>
                    setShow({
                      error: e.target.checked,
                      warning: e.target.checked,
                      action: e.target.checked,
                      info: e.target.checked,
                    })
                  }
                />
                All
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={show.error}
                  onChange={(e) => setShow((s) => ({ ...s, error: e.target.checked }))}
                />
                Errors <span className="ze-count-badge">{errorCount}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={show.warning}
                  onChange={(e) => setShow((s) => ({ ...s, warning: e.target.checked }))}
                />
                Warnings <span className="ze-count-badge">{warnCount}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={show.action}
                  onChange={(e) => setShow((s) => ({ ...s, action: e.target.checked }))}
                />
                Actions
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={show.info}
                  onChange={(e) => setShow((s) => ({ ...s, info: e.target.checked }))}
                />
                Infos
              </label>
              <span style={{ flex: 1 }} />
              <button className="ze-btn sm" disabled={messages.length === 0} onClick={saveLog}>
                Save…
              </button>
            </div>
          </div>
        </div>

        {/* DIALOG_PLOT std-button row (GTK): Generate Drill Files (Apply),
            Close (Cancel), Plot (OK); Run DRC… on the far left. */}
        <div className="ze-modal-footer">
          <button className="ze-btn" disabled style={{ marginRight: 'auto', opacity: 0.5 }}>
            Run DRC...
          </button>
          <button className="ze-btn" onClick={drill}>
            Generate Drill Files...
          </button>
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={plot}>
            Plot
          </button>
        </div>
      </div>
    </div>
  );
}
