/**
 * Minimal inline SVG icons approximating KiCad's eeschema toolbar glyphs.
 *
 * These are recognisable stand-ins, not KiCad's exact bitmaps. Importing KiCad's
 * own (GPL) icon set for pixel parity is a tracked follow-up; the goal here is the
 * correct toolbar *layout* and familiar iconography.
 */
import type { JSX } from 'react';

const P = (d: string) => <path d={d} />;

const ICONS: Record<string, JSX.Element> = {
  // top — file/edit
  new: P('M4 1h6l3 3v11H4z M10 1v3h3'),
  open: P('M1 4h5l1 2h7v7H1z'),
  save: (
    <g>
      <path d="M2 2h9l3 3v9H2z" />
      <path d="M5 2v4h5V2 M5 14v-4h6v4" />
    </g>
  ),
  setup: (
    <g>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2 M8 13v2 M1 8h2 M13 8h2 M3.5 3.5l1.4 1.4 M11 11l1.5 1.5" />
    </g>
  ),
  page: P('M3 1h7l3 3v11H3z M6 6h5 M6 9h5 M6 12h3'),
  print: (
    <g>
      <path d="M4 1h8v4H4z" />
      <path d="M2 5h12v6H2z" />
      <path d="M4 9h8v6H4z" />
    </g>
  ),
  plot: P('M2 14V2 M2 14h12 M5 11l3-4 2 2 3-5'),
  paste: (
    <g>
      <path d="M5 1h6v3H5z" />
      <path d="M3 3h10v12H3z" />
    </g>
  ),
  undo: P('M6 4L2 7l4 3 M2 7h7a4 4 0 1 1 0 8H6'),
  redo: P('M10 4l4 3-4 3 M14 7H7a4 4 0 1 0 0 8h3'),
  find: (
    <g>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L15 15" />
    </g>
  ),
  replace: (
    <g>
      <circle cx="6.5" cy="6.5" r="4" />
      <path d="M9.5 9.5L14 14 M2 13l3-1-1-3" />
    </g>
  ),
  // zoom
  zoomRedraw: P('M8 2a6 6 0 1 1-6 6 M2 2v4h4'),
  zoomIn: (
    <g>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L15 15 M7 5v4 M5 7h4" />
    </g>
  ),
  zoomOut: (
    <g>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L15 15 M5 7h4" />
    </g>
  ),
  zoomFit: (
    <g>
      <path d="M2 5V2h3 M14 5V2h-3 M2 11v3h3 M14 11v3h-3" />
      <rect x="6" y="6" width="4" height="4" />
    </g>
  ),
  zoomFitObjects: (
    <g>
      <path d="M2 5V2h3 M14 5V2h-3 M2 11v3h3 M14 11v3h-3" />
      <circle cx="8" cy="8" r="2.5" />
    </g>
  ),
  zoomTool: (
    <g>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L15 15" />
    </g>
  ),
  // navigate
  navBack: P('M10 3L5 8l5 5'),
  navUp: P('M3 10l5-5 5 5'),
  navFwd: P('M6 3l5 5-5 5'),
  // transform
  rotateCCW: P('M3 8a5 5 0 1 0 5-5H4 M4 3v3'),
  rotateCW: P('M13 8a5 5 0 1 1-5-5h4 M12 3v3'),
  mirrorV: P('M8 1v14 M6 4L2 8l4 4 M10 4l4 4-4 4'),
  mirrorH: P('M1 8h14 M4 6L8 2l4 4 M4 10l4 4 4-4'),
  group: (
    <g>
      <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="2 1.5" />
      <rect x="5" y="5" width="6" height="6" />
    </g>
  ),
  ungroup: (
    <g>
      <rect x="2" y="2" width="8" height="8" />
      <rect x="7" y="7" width="7" height="7" />
    </g>
  ),
  // tools/run
  symbolEditor: (
    <g>
      <rect x="2" y="3" width="12" height="10" />
      <path d="M5 8h2 M9 6v4" />
    </g>
  ),
  symbolBrowser: (
    <g>
      <rect x="2" y="3" width="12" height="10" />
      <path d="M6 8h4" />
    </g>
  ),
  footprintEditor: (
    <g>
      <rect x="3" y="3" width="10" height="10" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="10" cy="10" r="1" />
    </g>
  ),
  annotate: P('M3 13l1-3 7-7 2 2-7 7zM10 4l2 2'),
  erc: (
    <g>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v5 M8 11v1" />
    </g>
  ),
  simulator: P('M1 8h3l2-5 3 10 2-5h3'),
  assignFp: (
    <g>
      <rect x="3" y="3" width="10" height="10" />
      <path d="M6 3v10 M10 3v10" />
    </g>
  ),
  fields: (
    <g>
      <rect x="2" y="3" width="12" height="10" />
      <path d="M2 7h12 M6 3v10" />
    </g>
  ),
  bom: P('M3 2h10v12H3z M5 5h6 M5 8h6 M5 11h4'),
  // left — view options
  grid: P('M2 2h12v12H2z M6 2v12 M10 2v12 M2 6h12 M2 10h12'),
  gridOverride: P('M2 2h12v12H2z M2 6h12 M2 10h12 M6 2v12'),
  unitIn: P('M5 3v10 M5 3h3 M5 8h2'),
  unitMils: P('M3 13V3l3 6 3-6v10'),
  unitMm: P('M2 13V4l3 5 3-5v9 M11 13V4'),
  crosshairSmall: P('M8 5v6 M5 8h6'),
  crosshairFull: P('M8 1v14 M1 8h14'),
  crosshair45: P('M3 3l10 10 M13 3L3 13'),
  hiddenPins: (
    <g>
      <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4z" />
      <circle cx="8" cy="8" r="1.5" />
    </g>
  ),
  lineFree: P('M2 12c3-8 9 4 12-6'),
  line90: P('M2 12V5h11'),
  line45: P('M2 13L8 7h6'),
  annotateAuto: P('M3 13l1-3 7-7 2 2-7 7zM2 14h5'),
  hierarchy: P('M6 2h4v3H6z M2 11h4v3H2z M10 11h4v3h-4z M8 5v3 M4 8v3h8V8'),
  properties: P('M3 3h10v10H3z M5 6h6 M5 8h6 M5 10h4'),
  // right — selection/draw
  selectRect: P('M2 2l11 4-4 1-1 4z'),
  selectLasso: (
    <g>
      <path d="M2 6a5 4 0 1 1 6 4" />
      <circle cx="7" cy="13" r="1.5" />
    </g>
  ),
  highlightNet: P('M8 1l2 5 5 .5-4 3 1 5-4-3-4 3 1-5-4-3 5-.5z'),
  symbol: (
    <g>
      <rect x="5" y="4" width="6" height="8" />
      <path d="M2 6h3 M2 10h3 M11 8h3" />
    </g>
  ),
  power: P('M8 2v6 M5 4a4 4 0 1 0 6 0'),
  wire: P('M2 11h4V5h4v6h4'),
  bus: (
    <g>
      <path d="M2 11h12" strokeWidth="2.5" />
      <path d="M6 11V6" />
    </g>
  ),
  busEntry: P('M3 13L8 8h5'),
  noConnect: P('M4 4l8 8 M12 4l-8 8'),
  junction: <circle cx="8" cy="8" r="3" fill="currentColor" />,
  labelLocal: P('M2 8l3-3h9v6H5z'),
  labelGlobal: P('M2 8l2-3h8l2 3-2 3H4z'),
  labelHier: (
    <g>
      <rect x="3" y="5" width="10" height="6" />
      <path d="M3 8H1 M13 8h2" />
    </g>
  ),
  ruleArea: <rect x="2" y="2" width="12" height="12" strokeDasharray="2 1.5" />,
  sheet: (
    <g>
      <rect x="3" y="2" width="10" height="12" />
      <path d="M3 5h10" />
    </g>
  ),
  sheetPin: (
    <g>
      <rect x="4" y="3" width="8" height="10" />
      <path d="M4 8H1" />
    </g>
  ),
  syncSheetPins: P('M4 5a5 5 0 0 1 8 0 M12 4v2h-2 M12 11a5 5 0 0 1-8 0 M4 12v-2h2'),
  text: P('M3 4h10 M8 4v9 M6 13h4'),
  textBox: (
    <g>
      <rect x="2" y="3" width="12" height="10" />
      <path d="M5 6h6 M8 6v4" />
    </g>
  ),
  table: P('M2 3h12v10H2z M2 7h12 M2 10h12 M7 3v10'),
  rectangle: <rect x="2" y="3" width="12" height="10" />,
  circle: <circle cx="8" cy="8" r="6" />,
  arc: P('M2 12a10 10 0 0 1 12-2'),
  bezier: (
    <g>
      <path d="M2 13C5 3 11 3 14 13" />
      <circle cx="2" cy="13" r="1" />
      <circle cx="14" cy="13" r="1" />
    </g>
  ),
  lines: P('M2 13l4-7 3 4 5-7'),
  image: (
    <g>
      <rect x="2" y="3" width="12" height="10" />
      <circle cx="6" cy="6" r="1" />
      <path d="M2 12l4-3 3 2 3-3 2 2" />
    </g>
  ),
  delete: P('M3 4h10 M5 4V2h6v2 M4 4l1 11h6l1-11'),
  plus: P('M8 3v10 M3 8h10'),
  arrowUp: P('M8 13V3 M4 7l4-4 4 4'),
  arrowDown: P('M8 3v10 M4 9l4 4 4-4'),
};

export function Icon({ name, size = 16 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] ?? <rect x="3" y="3" width="10" height="10" />}
    </svg>
  );
}
