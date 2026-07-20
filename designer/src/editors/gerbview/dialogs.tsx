/**
 * Gerber Viewer dialogs: the DCode list (GerbView's "List DCodes" —
 * `gerbview/dialogs/dialog_select_one_pcb_layer` sibling `DIALOG_PRINT`… no; this
 * mirrors `gerbview/dialogs/panel_gerbview_display_options` list + the DCODE
 * table shown by GERBVIEW_FRAME::SortLayers/updateDCodeSelectBox) and the item
 * inspector shown when a graphic item is picked (GERBER_DRAW_ITEM::GetMsgPanelInfo).
 */

import type { JSX } from 'react';
import {
  APERTURE_T,
  type D_CODE,
  type GERBER_DRAW_ITEM,
  type GERBER_FILE_IMAGE,
  IU_PER_MM,
} from '@ziroeda/gerbview';

const shapeName: Record<APERTURE_T, string> = {
  [APERTURE_T.APT_CIRCLE]: 'Round',
  [APERTURE_T.APT_RECT]: 'Rect',
  [APERTURE_T.APT_OVAL]: 'Oval',
  [APERTURE_T.APT_POLYGON]: 'Polygon',
  [APERTURE_T.APT_MACRO]: 'Macro',
};

function fmtSize(d: D_CODE, unit: 'mm' | 'in' | 'mils'): string {
  const toU = (v: number): string => {
    const iu = v * d.iuScale;
    const mm = iu / IU_PER_MM;
    if (unit === 'mm') return `${mm.toFixed(3)}`;
    if (unit === 'in') return `${(mm / 25.4).toFixed(4)}`;
    return `${((mm / 25.4) * 1000).toFixed(2)}`;
  };
  if (d.shape === APERTURE_T.APT_CIRCLE || d.shape === APERTURE_T.APT_POLYGON)
    return `⌀ ${toU(d.size.x)}`;
  return `${toU(d.size.x)} × ${toU(d.size.y)}`;
}

/** DCode list dialog — the apertures of the active image, with a "used" flag. */
export function DCodeListDialog({
  image,
  unit,
  onClose,
}: {
  image: GERBER_FILE_IMAGE | null;
  unit: 'mm' | 'in' | 'mils';
  onClose: () => void;
}): JSX.Element {
  const used = image?.usedDcodes() ?? new Set<number>();
  const codes = image
    ? [...image.apertures.values()]
        .filter((d) => d.defined)
        .sort((a, b) => a.num_Dcode - b.num_Dcode)
    : [];
  const unitLabel = unit === 'mm' ? 'mm' : unit === 'in' ? 'in' : 'mils';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 460, maxHeight: '80vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          List DCodes
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: '8px 12px', overflow: 'auto' }}>
          {codes.length === 0 ? (
            <div style={{ color: 'var(--muted, #888)', padding: 8 }}>
              No apertures on the active layer.
            </div>
          ) : (
            <table className="ze-gbr-dcode-table">
              <thead>
                <tr>
                  <th>D Code</th>
                  <th>Type</th>
                  <th>Size ({unitLabel})</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((d) => (
                  <tr key={d.num_Dcode}>
                    <td>D{d.num_Dcode}</td>
                    <td>{shapeName[d.shape]}</td>
                    <td>{fmtSize(d, unit)}</td>
                    <td>{used.has(d.num_Dcode) ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Item inspector — the message-panel info for a picked graphic item. */
export function ItemInfoPanel({
  item,
  unit,
}: {
  item: GERBER_DRAW_ITEM | null;
  unit: 'mm' | 'in' | 'mils';
}): JSX.Element | null {
  if (!item) return null;
  const toU = (iu: number): string => {
    const mm = iu / IU_PER_MM;
    if (unit === 'mm') return `${mm.toFixed(3)} mm`;
    if (unit === 'in') return `${(mm / 25.4).toFixed(4)} in`;
    return `${((mm / 25.4) * 1000).toFixed(2)} mils`;
  };
  const meta = item.netMetadata;
  const rows: [string, string][] = [['Type', item.describe()]];
  if (item.dcodeNum) rows.push(['DCode', `D${item.dcodeNum}`]);
  if (item.width) rows.push(['Width', toU(item.width)]);
  rows.push(['Position', `${toU(item.start.x)}, ${toU(item.start.y)}`]);
  rows.push(['Polarity', item.layerPolarity ? 'Dark' : 'Clear']);
  if (meta.netName) rows.push(['Net', meta.netName]);
  if (meta.componentRef) rows.push(['Component', meta.componentRef]);
  if (meta.padName) rows.push(['Pad', meta.padName]);

  return (
    <div className="ze-gbr-iteminfo">
      {rows.map(([k, v]) => (
        <span key={k} className="ze-gbr-info-cell">
          <b>{k}:</b> {v}
        </span>
      ))}
    </div>
  );
}
