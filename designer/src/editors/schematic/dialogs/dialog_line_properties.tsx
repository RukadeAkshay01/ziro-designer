/**
 * Wire/bus/line and junction properties. Counterparts:
 * `eeschema/dialogs/dialog_wire_bus_properties.cpp` (DIALOG_WIRE_BUS_PROPERTIES —
 * line width and style) and `dialog_junction_props.cpp` (DIALOG_JUNCTION_PROPS —
 * junction diameter). Widths/diameters are entered in millimetres; 0 = "use the
 * netclass/schematic default".
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';

/** KiCad line styles (`(stroke (type ..))`), in the dialog's dropdown order. */
const LINE_STYLES = ['default', 'solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'] as const;

interface WireProps {
  kind: 'wire';
  widthIU: number;
  style: string;
  onOk: (widthIU: number, style: string) => void;
  onCancel: () => void;
}
interface JunctionProps {
  kind: 'junction';
  diameterIU: number;
  onOk: (diameterIU: number) => void;
  onCancel: () => void;
}

export function DialogLineProperties(props: WireProps | JunctionProps): JSX.Element {
  const mm = (iu: number): string => (iu === 0 ? '0' : String(iuToMM(iu)));
  const [width, setWidth] = useState(props.kind === 'wire' ? mm(props.widthIU) : '0');
  const [style, setStyle] = useState(props.kind === 'wire' ? props.style : 'default');
  const [diameter, setDiameter] = useState(props.kind === 'junction' ? mm(props.diameterIU) : '0');

  const submit = (): void => {
    if (props.kind === 'wire') props.onOk(mmToIU(Number(width) || 0), style);
    else props.onOk(mmToIU(Number(diameter) || 0));
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={props.onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {props.kind === 'wire' ? 'Wire & Bus Properties' : 'Junction Properties'}
          <span className="x" title="Cancel" onClick={props.onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {props.kind === 'wire' ? (
            <>
              <label className="row">
                <span>Width (mm)</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') submit();
                  }}
                />
              </label>
              <label className="row">
                <span>Style</span>
                <select
                  className="ze-select"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  {LINE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label className="row">
              <span>Diameter (mm)</span>
              <input
                className="ze-search"
                autoFocus
                value={diameter}
                onChange={(e) => setDiameter(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') submit();
                }}
              />
            </label>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
