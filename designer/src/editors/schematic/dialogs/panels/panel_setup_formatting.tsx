/**
 * Schematic Setup > Formatting. Counterpart:
 * `eeschema/dialogs/panel_setup_formatting_base.cpp` (PANEL_SETUP_FORMATTING) —
 * the SCHEMATIC_SETTINGS formatting fields in KiCad's two-column layout:
 *   left column  : Text, Symbols, Connections
 *   right column : Inter-sheet References, Dashed Lines, Operating-point Overlay
 *
 * (Symbol unit notation lives on the separate Annotation page, not here — see
 * panel_eeschema_annotation_options.tsx.)
 *
 * Field sizing mirrors upstream: value controls grow to fill the group's second
 * column (KiCad's AddGrowableCol), except the Dashed-Lines dash/gap fields
 * (fixed ~"XXX.XXX" wide, no grow) and the inter-sheet Prefix/Suffix (min 160px).
 *
 * These are project-scoped defaults (SCHEMATIC_SETTINGS): default text/line
 * sizes, junction/hop-over/connection-grid sizes, dashed-line ratios, inter-sheet
 * reference presentation, and simulator operating-point overlay precision/range.
 */

import type { JSX } from 'react';
import {
  JUNCTION_DOT_SIZES,
  HOP_OVER_SIZES,
  OPO_V_RANGES,
  OPO_I_RANGES,
  type FormattingSettings,
} from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export {
  JUNCTION_DOT_SIZES,
  HOP_OVER_SIZES,
  OPO_V_RANGES,
  OPO_I_RANGES,
  defaultFormatting,
  type FormattingSettings,
} from '../../schematic_settings.js';

interface Props {
  value: FormattingSettings;
  onChange: (next: FormattingSettings) => void;
}

const column: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};
const box: React.CSSProperties = {
  border: '1px solid var(--chrome-border)',
  borderRadius: 4,
  padding: '4px 10px 8px',
  margin: '0 0 10px',
};
const legend: React.CSSProperties = { fontSize: 11.5, padding: '0 4px', fontWeight: 600 };
/** A group body laid out as label | control | units, all rows aligned (fgSizer). */
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr max-content',
  alignItems: 'center',
  gap: '6px 8px',
  margin: '4px 0 2px',
  fontSize: 12.5,
};
const lab: React.CSSProperties = { fontSize: 12 };
const fill: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
const unit: React.CSSProperties = { fontSize: 11 };

export function PanelSetupFormatting({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof FormattingSettings>(k: K, v: FormattingSettings[K]): void =>
    onChange({ ...value, [k]: v });

  const isr = value.intersheetRefsShow;

  // A grid row: label, a growing value control, and a units cell (blank if none).
  const numRow = (
    label: string,
    key: keyof FormattingSettings,
    unitStr: string,
    tip?: string,
  ): JSX.Element => (
    <>
      <span style={lab} title={tip}>
        {label}
      </span>
      <input
        className="ze-search"
        type="number"
        style={fill}
        value={value[key] as number}
        title={tip}
        onChange={(e) => set(key, Number(e.target.value) as never)}
      />
      <span className="ze-muted" style={unit}>
        {unitStr}
      </span>
    </>
  );

  // A choice row: label then a growing select spanning the value+units columns.
  const choiceRow = (
    label: string,
    key: keyof FormattingSettings,
    choices: string[],
    byIndex: boolean,
  ): JSX.Element => (
    <>
      <span style={lab}>{label}</span>
      <select
        className="ze-select"
        style={{ ...fill, gridColumn: '2 / 4' }}
        value={byIndex ? (value[key] as number) : (value[key] as string)}
        onChange={(e) => set(key, (byIndex ? Number(e.target.value) : e.target.value) as never)}
      >
        {choices.map((c, i) => (
          <option key={c} value={byIndex ? i : c}>
            {c}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {/* Left column: Text, Symbols, Connections */}
      <div style={column}>
        <fieldset style={box}>
          <legend style={legend}>Text</legend>
          <div style={grid}>
            {numRow('Default text size:', 'defaultTextSizeMils', 'mils')}
            {numRow('Overbar offset ratio:', 'overbarOffsetRatio', '%')}
            {numRow(
              'Label offset ratio:',
              'labelOffsetRatio',
              '%',
              'Percentage of the text size to offset labels above (or below) a wire, bus, or pin',
            )}
            {numRow(
              'Global label margin ratio:',
              'labelSizeRatio',
              '%',
              'Percentage of the text size to use as space around a global label',
            )}
          </div>
        </fieldset>

        <fieldset style={box}>
          <legend style={legend}>Symbols</legend>
          <div style={grid}>
            {numRow('Default line width:', 'defaultLineWidthMils', 'mils')}
            {numRow('Pin symbol size:', 'pinSymbolSizeMils', 'mils')}
          </div>
        </fieldset>

        <fieldset style={box}>
          <legend style={legend}>Connections</legend>
          <div style={grid}>
            {choiceRow('Junction dot size:', 'junctionDotChoice', JUNCTION_DOT_SIZES, true)}
            {choiceRow('Hop-over size:', 'hopOverChoice', HOP_OVER_SIZES, true)}
            {numRow('Connection grid:', 'connectionGridMils', 'mils')}
          </div>
        </fieldset>
      </div>

      {/* Right column: Inter-sheet References, Dashed Lines, Operating-point Overlay */}
      <div style={column}>
        <fieldset style={box}>
          <legend style={legend}>Inter-sheet References</legend>
          <label style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={isr}
              onChange={(e) => set('intersheetRefsShow', e.target.checked)}
            />{' '}
            Show inter-sheet references
          </label>
          <div style={{ paddingLeft: 15 }}>
            <label style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={value.intersheetRefsOwnPage}
                disabled={!isr}
                onChange={(e) => set('intersheetRefsOwnPage', e.target.checked)}
              />{' '}
              Show own page reference
            </label>
            <label style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
              <input
                type="radio"
                name="isrfmt"
                checked={!value.intersheetRefsAbbreviated}
                disabled={!isr}
                onChange={() => set('intersheetRefsAbbreviated', false)}
              />{' '}
              Standard (1,2,3)
            </label>
            <label style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
              <input
                type="radio"
                name="isrfmt"
                checked={value.intersheetRefsAbbreviated}
                disabled={!isr}
                onChange={() => set('intersheetRefsAbbreviated', true)}
              />{' '}
              Abbreviated (1..3)
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                alignItems: 'center',
                gap: '6px 8px',
                margin: '6px 0 2px',
                fontSize: 12.5,
              }}
            >
              <span style={lab}>Prefix:</span>
              <input
                className="ze-search"
                style={{ ...fill, minWidth: 160 }}
                value={value.intersheetRefsPrefix}
                disabled={!isr}
                onChange={(e) => set('intersheetRefsPrefix', e.target.value)}
              />
              <span style={lab}>Suffix:</span>
              <input
                className="ze-search"
                style={{ ...fill, minWidth: 160 }}
                value={value.intersheetRefsSuffix}
                disabled={!isr}
                onChange={(e) => set('intersheetRefsSuffix', e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        <fieldset style={box}>
          <legend style={legend}>Dashed Lines</legend>
          {/* Dash/gap ctrls are fixed ~"XXX.XXX" wide (no grow) in KiCad. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content max-content',
              alignItems: 'center',
              gap: '6px 8px',
              margin: '4px 0 2px',
              fontSize: 12.5,
            }}
          >
            <span style={lab}>Dash length:</span>
            <input
              className="ze-search"
              type="number"
              style={{ width: 68 }}
              value={value.dashLengthRatio}
              onChange={(e) => set('dashLengthRatio', Number(e.target.value))}
            />
            <span style={lab}>Gap length:</span>
            <input
              className="ze-search"
              type="number"
              style={{ width: 68 }}
              value={value.gapLengthRatio}
              onChange={(e) => set('gapLengthRatio', Number(e.target.value))}
            />
          </div>
          <div className="ze-muted" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 6 }}>
            Dash and dot lengths are ratios of the line width.
          </div>
        </fieldset>

        <fieldset style={box}>
          <legend style={legend}>Operating-point Overlay</legend>
          <div style={grid}>
            {numRow('Significant digits (voltages):', 'opoVPrecision', '')}
            {choiceRow('Range (voltages):', 'opoVRange', OPO_V_RANGES, false)}
            {numRow('Significant digits (currents):', 'opoIPrecision', '')}
            {choiceRow('Range (currents):', 'opoIRange', OPO_I_RANGES, false)}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
