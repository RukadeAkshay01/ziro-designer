/**
 * Pin Conflicts Map panel. Counterpart: `eeschema/dialogs/panel_setup_pinmap.cpp`
 * (PANEL_SETUP_PINMAP) — the pin-type-vs-pin-type matrix that decides whether
 * two connected pins are OK, a warning, or an error. Clicking a cell cycles it;
 * the matrix feeds runErc's TestPinToPin. The diagonal/labels use KiCad's pin
 * type abbreviations.
 */

import type { JSX } from 'react';
import {
  TYPE_ABBREV,
  TYPE_NAMES,
  PIN_TYPES,
  type ErcSettings,
  type PinError,
} from '@ziroeda/eeschema';

interface Props {
  settings: ErcSettings;
  onChange: (next: ErcSettings) => void;
}

// Cell glyphs/colours for OK (0), Warning (1), Error (2).
const CELL: { glyph: string; color: string; title: string }[] = [
  { glyph: '', color: 'transparent', title: 'OK' },
  { glyph: '!', color: 'rgb(209, 146, 0)', title: 'Warning' },
  { glyph: '✕', color: 'rgb(230, 9, 13)', title: 'Error' },
];

export function PanelSetupPinmap({ settings, onChange }: Props): JSX.Element {
  const n = PIN_TYPES.length;

  const cycle = (r: number, c: number): void => {
    const pinMap = settings.pinMap.map((row) => [...row]);
    const next = (((pinMap[r]![c]! as number) + 1) % 3) as PinError;
    pinMap[r]![c] = next;
    // The matrix is symmetric in KiCad (a↔b is the same conflict); mirror it.
    pinMap[c]![r] = next;
    onChange({ ...settings, pinMap });
  };

  const th: React.CSSProperties = {
    fontSize: 10,
    padding: 2,
    textAlign: 'center',
    color: 'var(--ze-muted, #888)',
    whiteSpace: 'nowrap',
  };
  const cell: React.CSSProperties = {
    width: 22,
    height: 22,
    border: '1px solid var(--ze-border, #ccc)',
    textAlign: 'center',
    verticalAlign: 'middle',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 12,
    userSelect: 'none',
  };

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Pin Conflicts Map</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th} />
              {TYPE_ABBREV.map((ab, i) => (
                <th key={i} style={th} title={TYPE_NAMES[PIN_TYPES[i]!]}>
                  {ab}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, r) => (
              <tr key={r}>
                <th
                  style={{ ...th, textAlign: 'right', paddingRight: 6 }}
                  title={TYPE_NAMES[PIN_TYPES[r]!]}
                >
                  {TYPE_ABBREV[r]}
                </th>
                {Array.from({ length: n }, (_, c) => {
                  const v = settings.pinMap[r]![c]! as number;
                  const spec = CELL[v]!;
                  return (
                    <td
                      key={c}
                      style={{ ...cell, color: spec.color }}
                      title={`${TYPE_NAMES[PIN_TYPES[r]!]} ↔ ${TYPE_NAMES[PIN_TYPES[c]!]}: ${spec.title} (click to change)`}
                      onClick={() => cycle(r, c)}
                    >
                      {spec.glyph}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ze-muted, #888)', marginTop: 8 }}>
        Click a cell to cycle OK → Warning → Error.
      </div>
    </div>
  );
}
