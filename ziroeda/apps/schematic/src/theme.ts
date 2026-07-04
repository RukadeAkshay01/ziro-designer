/**
 * Schematic colour theme.
 *
 * Approximates KiCad's classic eeschema colours so the canvas reads as familiar
 * to KiCad users. These are close-but-not-yet-exact; the precise theme values
 * live in KiCad's colour-theme JSON and are a tracked follow-up for pixel parity.
 */
export interface Theme {
  background: string;
  grid: string;
  wire: string;
  bus: string;
  junction: string;
  symbolOutline: string;
  symbolFill: string;
  pin: string;
  pinName: string;
  pinNumber: string;
  reference: string;
  value: string;
  label: string;
  globalLabel: string;
  hierLabel: string;
  netHighlight: string;
  selectionShadow: string;
  noteLine: string;
  noText: string;
  noConnect: string;
  ercError: string;
  ercWarning: string;
  sheetBorder: string;
  sheetName: string;
  sheetFile: string;
  sheetLabel: string;
  pageFrame: string;
}

export const KICAD_CLASSIC: Theme = {
  background: '#ffffff',
  grid: '#c8c8c8',
  wire: '#009600', // KiCad LAYER_WIRE rgb(0,150,0)
  bus: '#000084', // blue
  junction: '#009600',
  symbolOutline: '#840000', // dark red
  symbolFill: '#ffffc2', // pale yellow (background fill)
  pin: '#840000',
  pinName: '#008484',
  pinNumber: '#840000',
  reference: '#008484', // cyan
  value: '#008484',
  label: '#000000', // local label: black
  globalLabel: '#840000', // dark red
  hierLabel: '#840084', // magenta
  netHighlight: '#ff00ff', // KiCad LAYER_BRIGHTENED (pure magenta) net highlight
  selectionShadow: 'rgba(102, 178, 255, 0.8)', // KiCad LAYER_SELECTION_SHADOWS = COLOR4D(.4,.7,1.0,0.8)
  noteLine: '#0000c2', // KiCad LAYER_NOTES rgb(0,0,194) (graphic lines without an explicit colour)
  noText: '#0000c2', // KiCad LAYER_NOTES rgb(0,0,194)
  noConnect: '#000084', // KiCad LAYER_NOCONNECT rgb(0,0,132)
  ercError: 'rgba(230, 9, 13, 0.8)', // KiCad LAYER_ERC_ERR
  ercWarning: 'rgba(209, 146, 0, 0.8)', // KiCad LAYER_ERC_WARN
  sheetBorder: '#840000', // KiCad LAYER_SHEET rgb(132,0,0)
  sheetName: '#006464', // KiCad LAYER_SHEETNAME rgb(0,100,100)
  sheetFile: '#725600', // KiCad LAYER_SHEETFILENAME rgb(114,86,0)
  sheetLabel: '#006464', // KiCad LAYER_SHEETLABEL rgb(0,100,100)
  pageFrame: '#840000', // KiCad LAYER_SCHEMATIC_DRAWINGSHEET rgb(132,0,0)
};
