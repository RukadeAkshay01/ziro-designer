/**
 * Pin Conflicts Map panel. Counterpart: `eeschema/dialogs/panel_setup_pinmap.cpp`
 * (PANEL_SETUP_PINMAP::reBuildMatrixPanel) — the pin-type-vs-pin-type conflict
 * matrix, drawn as KiCad's lower-triangular staircase: pin-type names right-
 * aligned down the left; each column's name set HORIZONTALLY up-and-right of its
 * diagonal cell (into the empty upper triangle) with a vertical `|` callout; and
 * a grid of green-square / amber-triangle / red-circle buttons. Clicking a cell
 * cycles OK -> Warning -> Error and mirrors it (the matrix is symmetric). NC
 * ("Unconnected") is excluded, as in KiCad (PINMAP_TYPE_COUNT = types - 1).
 * Feeds runErc's TestPinToPin.
 */

import type { JSX } from 'react';
import { PIN_TYPES, type ErcSettings, type PinError } from '@ziroeda/eeschema';

interface Props {
  settings: ErcSettings;
  onChange: (next: ErcSettings) => void;
}

// Row/column labels, matching KiCad's CommentERC_H (NC excluded).
const PIN_LABELS = [
  'Input Pin',
  'Output Pin',
  'Bidirectional Pin',
  'Tri-State Pin',
  'Passive Pin',
  'Free Pin',
  'Unspecified Pin',
  'Power Input Pin',
  'Power Output Pin',
  'Open Collector',
  'Open Emitter',
];

// Matrix geometry (mirrors reBuildMatrixPanel's bitmap+padding steps).
const LABEL_W = 104; // row-label column
const CELL = 22;
const STEPX = CELL + 8;
const STEPY = CELL + 6;
const LINE_H = 15;
const TOP = 42; // headroom for the highest column label

/** The OK / Warning / Error mark for a cell (erc_green / ercwarn / ercerr). */
function Mark({ state }: { state: number }): JSX.Element {
  if (state === 1) {
    return (
      <span
        style={{
          width: 0,
          height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderBottom: '12px solid rgb(209, 146, 0)',
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: 14,
        height: 14,
        background: state === 2 ? 'rgb(230, 9, 13)' : 'rgb(34, 157, 42)',
        borderRadius: state === 2 ? '50%' : 2,
      }}
    />
  );
}

export function PanelSetupPinmap({ settings, onChange }: Props): JSX.Element {
  const n = PIN_TYPES.length - 1; // exclude NC

  const cycle = (r: number, c: number): void => {
    const pinMap = settings.pinMap.map((row) => [...row]);
    const next = (((pinMap[r]![c]! as number) + 1) % 3) as PinError;
    pinMap[r]![c] = next;
    pinMap[c]![r] = next; // symmetric, like KiCad
    onChange({ ...settings, pinMap });
  };

  const title = ['No error or warning', 'Generate warning', 'Generate error'];
  const width = LABEL_W + n * STEPX + 140;
  const height = TOP + n * STEPY + CELL + 6;

  return (
    <div style={{ padding: '2px 2px' }}>
      <div style={{ fontSize: 12.5, marginBottom: 6 }}>Pin Conflicts Map</div>
      <div style={{ overflow: 'auto' }}>
        <div style={{ position: 'relative', width, height, fontSize: 11 }}>
          {Array.from({ length: n }, (_, r) => {
            const top = TOP + r * STEPY;
            const cx = LABEL_W + r * STEPX + CELL / 2;
            return (
              <div key={r}>
                {/* Row label (right-aligned into the left column). */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    width: LABEL_W - 6,
                    top: top + (CELL - LINE_H) / 2,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {PIN_LABELS[r]}
                </div>

                {/* Column label + callout, horizontal, above the diagonal cell. */}
                <div
                  style={{
                    position: 'absolute',
                    left: cx + 4,
                    top: top - 2 * LINE_H,
                    whiteSpace: 'nowrap',
                    color: 'var(--chrome-fg)',
                  }}
                >
                  {PIN_LABELS[r]}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: cx,
                    top: top - LINE_H - 2,
                    width: 1,
                    height: LINE_H + 2,
                    background: 'var(--chrome-border)',
                  }}
                />

                {/* Cells 0..r (lower triangle). */}
                {Array.from({ length: r + 1 }, (_, c) => {
                  const v = settings.pinMap[r]![c]! as number;
                  return (
                    <button
                      key={c}
                      onClick={() => cycle(r, c)}
                      title={`${PIN_LABELS[r]} / ${PIN_LABELS[c]}: ${title[v]}`}
                      style={{
                        position: 'absolute',
                        left: LABEL_W + c * STEPX,
                        top,
                        width: CELL,
                        height: CELL,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        background: 'transparent',
                        border: '1px solid var(--chrome-border)',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      <Mark state={v} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
