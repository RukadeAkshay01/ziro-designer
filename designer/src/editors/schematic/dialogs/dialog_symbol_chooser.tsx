/**
 * The Choose Symbol dialog wrapper: title with the lazy-load item count, the
 * chooser panel, and the button row with the "Place repeated copies" /
 * "Place all units" checkboxes ahead of the standard OK/Cancel buttons.
 * Mirrors kicad/eeschema/dialogs/dialog_symbol_chooser.cpp
 * (DIALOG_SYMBOL_CHOOSER).
 */
import { useCallback, useRef, useState } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import {
  PanelSymbolChooser,
  type PanelSymbolChooserHandle,
  type PickedSymbol,
} from '../widgets/panel_symbol_chooser.js';

export type { PickedSymbol } from '../widgets/panel_symbol_chooser.js';

/** What the dialog hands back on OK (PICKED_SYMBOL + the checkbox states). */
export interface SymbolChooserResult {
  symbol: LibSymbol;
  /** Selected unit; 0 when the symbol itself was picked (default to 1). */
  unit: number;
  /** Field edits, currently just a footprint override: [name, value]. */
  fields: [string, string][];
  /** "Place repeated copies" — keep the symbol selected for subsequent clicks. */
  keepSymbol: boolean;
  /** "Place all units" — sequentially place all units of the symbol. */
  placeAllUnits: boolean;
}

export interface DialogSymbolChooserProps {
  /** Restrict to power symbols (SYMBOL_LIBRARY_FILTER::FilterPowerSymbols). */
  powerFilter?: boolean;
  /** "Show footprint previews in Symbol Chooser" (Preferences > Editing Options). */
  showFootprints?: boolean;
  historyList?: readonly PickedSymbol[];
  alreadyPlaced?: readonly PickedSymbol[];
  getPlacedLibSymbol?: (libId: string) => LibSymbol | undefined;
  /** wxID_OK — null when OK was pressed with nothing selected (invalid LIB_ID). */
  onOk: (result: SymbolChooserResult | null) => void;
  /** wxID_CANCEL. */
  onCancel: () => void;
}

export function DialogSymbolChooser({
  powerFilter = false,
  showFootprints = true,
  historyList = [],
  alreadyPlaced = [],
  getPlacedLibSymbol,
  onOk,
  onCancel,
}: DialogSymbolChooserProps): JSX.Element {
  const panelRef = useRef<PanelSymbolChooserHandle>(null);
  const [itemCount, setItemCount] = useState(0);
  const [keepSymbol, setKeepSymbol] = useState(false);
  const [placeAllUnits, setPlaceAllUnits] = useState(true);

  const originalTitle = powerFilter ? 'Choose Power Symbol' : 'Choose Symbol';
  const title = itemCount > 0 ? `${originalTitle} (${itemCount} items loaded)` : originalTitle;

  const accept = useCallback(() => {
    const selected = panelRef.current?.getSelected() ?? null;
    onOk(
      selected && {
        symbol: selected.symbol,
        unit: selected.unit,
        fields: selected.fields,
        keepSymbol,
        placeAllUnits,
      },
    );
  }, [onOk, keepSymbol, placeAllUnits]);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-symbol-chooser"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div className="ze-modal-header">
          {title}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body">
          <PanelSymbolChooser
            ref={panelRef}
            powerFilter={powerFilter}
            showFootprints={showFootprints}
            historyList={historyList}
            alreadyPlaced={alreadyPlaced}
            getPlacedLibSymbol={getPlacedLibSymbol}
            onAccept={accept}
            onEscape={onCancel}
            onItemCountChanged={setItemCount}
          />
        </div>
        <div className="ze-modal-footer ze-chooser-footer">
          <label className="ze-check" title="Keep the symbol selected for subsequent clicks.">
            <input
              type="checkbox"
              checked={keepSymbol}
              onChange={(e) => setKeepSymbol(e.target.checked)}
            />
            Place repeated copies
          </label>
          <label className="ze-check" title="Sequentially place all units of the symbol.">
            <input
              type="checkbox"
              checked={placeAllUnits}
              onChange={(e) => setPlaceAllUnits(e.target.checked)}
            />
            Place all units
          </label>
          <span className="ze-chooser-footer-spacer" />
          <button className="ze-btn primary" onClick={accept}>
            OK
          </button>
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
