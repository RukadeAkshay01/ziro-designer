/**
 * Footprint drop-down of the symbol chooser. Mirrors
 * kicad/common/widgets/footprint_select_widget.cpp
 * (FOOTPRINT_SELECT_WIDGET): the default footprint entry at the top —
 * "[Default] <fp>" or "No default footprint" — followed by the hosted-library
 * footprints matching the symbol's fp_filters (FOOTPRINT_FILTER results,
 * capped like upstream's m_max_items).
 */

export interface FootprintSelectWidgetProps {
  /** The symbol's default footprint LIB_ID text ('' = none). */
  defaultFootprint: string;
  /** Filter matches from the footprint list ("Lib:Name" ids). */
  items?: readonly string[];
  /** Currently selected footprint ('' = the default entry). */
  value: string;
  disabled?: boolean;
  /** EVT_FOOTPRINT_SELECTED — the user picked an entry. */
  onFootprintSelected: (footprint: string) => void;
}

export function FootprintSelectWidget({
  defaultFootprint,
  items = [],
  value,
  disabled = false,
  onFootprintSelected,
}: FootprintSelectWidgetProps): JSX.Element {
  const defaultLabel = defaultFootprint ? `[Default] ${defaultFootprint}` : 'No default footprint';

  return (
    <select
      className="ze-fp-select"
      disabled={disabled}
      value={value}
      onChange={(e) => onFootprintSelected(e.target.value)}
    >
      <option value="">{defaultLabel}</option>
      {items
        .filter((fp) => fp !== defaultFootprint)
        .map((fp) => (
          <option key={fp} value={fp}>
            {fp}
          </option>
        ))}
    </select>
  );
}
