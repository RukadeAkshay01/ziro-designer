/**
 * The bundled default repository.
 *
 * KiCad ships a well-known default repository URL; the equivalent here is a
 * repository compiled into the app so the Plugin and Content Manager has real,
 * installable content out of the box (and works with no network). Third-party
 * repositories can still be added by URL — see `pcmStore.addRepository`.
 *
 * The colour themes are complete `Theme` objects (built by overriding the KiCad
 * default palette). The library packages carry small, real `.kicad_sym`
 * libraries, read by the same parser as any other symbol library.
 */

import { KICAD_DEFAULT, type Theme } from '../editors/schematic/theme.js';
import type { Contact, LibraryPayload, PackageVersion, Repository, RepoPackage } from './types.js';

// ---- colour themes -----------------------------------------------------------
// Each theme overrides the KiCad-default palette so every Theme key stays
// populated; only the colours that define the look are listed here.

const NORD: Theme = {
  ...KICAD_DEFAULT,
  background: 'rgb(46, 52, 64)',
  grid: 'rgb(76, 86, 106)',
  wire: 'rgb(163, 190, 140)',
  bus: 'rgb(180, 142, 173)',
  busJunction: 'rgb(180, 142, 173)',
  junction: 'rgb(163, 190, 140)',
  symbolOutline: 'rgb(136, 192, 208)',
  symbolFill: 'rgb(59, 66, 82)',
  pin: 'rgb(136, 192, 208)',
  pinName: 'rgb(143, 188, 187)',
  pinNumber: 'rgb(235, 203, 139)',
  reference: 'rgb(143, 188, 187)',
  value: 'rgb(216, 222, 233)',
  fields: 'rgb(180, 142, 173)',
  label: 'rgb(236, 239, 244)',
  globalLabel: 'rgb(191, 97, 106)',
  hierLabel: 'rgb(208, 135, 112)',
  noteLine: 'rgb(129, 161, 193)',
  noText: 'rgb(129, 161, 193)',
  noConnect: 'rgb(180, 142, 173)',
  sheetBorder: 'rgb(136, 192, 208)',
  sheetName: 'rgb(143, 188, 187)',
  sheetFile: 'rgb(208, 135, 112)',
  pageFrame: 'rgb(136, 192, 208)',
  cursor: 'rgb(236, 239, 244)',
};

const SOLARIZED_DARK: Theme = {
  ...KICAD_DEFAULT,
  background: 'rgb(0, 43, 54)',
  grid: 'rgb(88, 110, 117)',
  wire: 'rgb(133, 153, 0)',
  bus: 'rgb(38, 139, 210)',
  busJunction: 'rgb(38, 139, 210)',
  junction: 'rgb(133, 153, 0)',
  symbolOutline: 'rgb(203, 75, 22)',
  symbolFill: 'rgb(7, 54, 66)',
  pin: 'rgb(203, 75, 22)',
  pinName: 'rgb(42, 161, 152)',
  pinNumber: 'rgb(181, 137, 0)',
  reference: 'rgb(42, 161, 152)',
  value: 'rgb(147, 161, 161)',
  fields: 'rgb(211, 54, 130)',
  label: 'rgb(238, 232, 213)',
  globalLabel: 'rgb(220, 50, 47)',
  hierLabel: 'rgb(181, 137, 0)',
  noteLine: 'rgb(38, 139, 210)',
  noText: 'rgb(38, 139, 210)',
  noConnect: 'rgb(38, 139, 210)',
  sheetBorder: 'rgb(203, 75, 22)',
  sheetName: 'rgb(42, 161, 152)',
  sheetFile: 'rgb(181, 137, 0)',
  pageFrame: 'rgb(203, 75, 22)',
  cursor: 'rgb(238, 232, 213)',
};

const SOLARIZED_LIGHT: Theme = {
  ...KICAD_DEFAULT,
  background: 'rgb(253, 246, 227)',
  grid: 'rgb(147, 161, 161)',
  wire: 'rgb(133, 153, 0)',
  bus: 'rgb(38, 139, 210)',
  busJunction: 'rgb(38, 139, 210)',
  junction: 'rgb(133, 153, 0)',
  symbolOutline: 'rgb(203, 75, 22)',
  symbolFill: 'rgb(238, 232, 213)',
  pin: 'rgb(203, 75, 22)',
  pinName: 'rgb(42, 161, 152)',
  pinNumber: 'rgb(181, 137, 0)',
  reference: 'rgb(42, 161, 152)',
  value: 'rgb(88, 110, 117)',
  fields: 'rgb(211, 54, 130)',
  label: 'rgb(7, 54, 66)',
  globalLabel: 'rgb(220, 50, 47)',
  hierLabel: 'rgb(181, 137, 0)',
  noteLine: 'rgb(38, 139, 210)',
  noText: 'rgb(38, 139, 210)',
  noConnect: 'rgb(38, 139, 210)',
  sheetBorder: 'rgb(203, 75, 22)',
  sheetName: 'rgb(42, 161, 152)',
  sheetFile: 'rgb(181, 137, 0)',
  pageFrame: 'rgb(203, 75, 22)',
  cursor: 'rgb(7, 54, 66)',
};

const HIGH_CONTRAST: Theme = {
  ...KICAD_DEFAULT,
  background: 'rgb(0, 0, 0)',
  grid: 'rgb(80, 80, 80)',
  wire: 'rgb(0, 255, 0)',
  bus: 'rgb(0, 180, 255)',
  busJunction: 'rgb(0, 180, 255)',
  junction: 'rgb(0, 255, 0)',
  symbolOutline: 'rgb(255, 255, 255)',
  symbolFill: 'rgba(255, 255, 255, 0)',
  pin: 'rgb(255, 255, 255)',
  pinName: 'rgb(0, 255, 255)',
  pinNumber: 'rgb(255, 255, 0)',
  reference: 'rgb(0, 255, 255)',
  value: 'rgb(255, 255, 255)',
  fields: 'rgb(255, 0, 255)',
  label: 'rgb(255, 255, 255)',
  globalLabel: 'rgb(255, 80, 80)',
  hierLabel: 'rgb(255, 200, 0)',
  noteLine: 'rgb(0, 180, 255)',
  noText: 'rgb(0, 180, 255)',
  noConnect: 'rgb(0, 180, 255)',
  sheetBorder: 'rgb(255, 255, 255)',
  sheetName: 'rgb(0, 255, 255)',
  sheetFile: 'rgb(255, 200, 0)',
  pageFrame: 'rgb(255, 255, 255)',
  cursor: 'rgb(255, 255, 255)',
};

// Build a dark schematic theme from a small palette (keeps every Theme key
// populated by spreading the KiCad default first).
function darkTheme(p: {
  bg: string;
  fill: string;
  dim: string;
  fg: string;
  green: string;
  blue: string;
  red: string;
  cyan: string;
  yellow: string;
  purple: string;
}): Theme {
  return {
    ...KICAD_DEFAULT,
    background: p.bg,
    grid: p.dim,
    wire: p.green,
    bus: p.blue,
    busJunction: p.blue,
    junction: p.green,
    symbolOutline: p.red,
    symbolFill: p.fill,
    pin: p.cyan,
    pinName: p.cyan,
    pinNumber: p.yellow,
    reference: p.cyan,
    value: p.fg,
    fields: p.purple,
    label: p.fg,
    globalLabel: p.red,
    hierLabel: p.yellow,
    noteLine: p.blue,
    noText: p.blue,
    noConnect: p.purple,
    sheetBorder: p.red,
    sheetName: p.cyan,
    sheetFile: p.yellow,
    pageFrame: p.red,
    cursor: p.fg,
  };
}

const DRACULA = darkTheme({
  bg: 'rgb(40, 42, 54)',
  fill: 'rgb(48, 50, 66)',
  dim: 'rgb(98, 114, 164)',
  fg: 'rgb(248, 248, 242)',
  green: 'rgb(80, 250, 123)',
  blue: 'rgb(139, 233, 253)',
  red: 'rgb(255, 85, 85)',
  cyan: 'rgb(139, 233, 253)',
  yellow: 'rgb(241, 250, 140)',
  purple: 'rgb(189, 147, 249)',
});

const GRUVBOX_DARK = darkTheme({
  bg: 'rgb(40, 40, 40)',
  fill: 'rgb(50, 48, 47)',
  dim: 'rgb(146, 131, 116)',
  fg: 'rgb(235, 219, 178)',
  green: 'rgb(152, 151, 26)',
  blue: 'rgb(69, 133, 136)',
  red: 'rgb(204, 36, 29)',
  cyan: 'rgb(104, 157, 106)',
  yellow: 'rgb(215, 153, 33)',
  purple: 'rgb(177, 98, 134)',
});

const MONOKAI = darkTheme({
  bg: 'rgb(39, 40, 34)',
  fill: 'rgb(49, 50, 44)',
  dim: 'rgb(117, 113, 94)',
  fg: 'rgb(248, 248, 242)',
  green: 'rgb(166, 226, 46)',
  blue: 'rgb(102, 217, 239)',
  red: 'rgb(249, 38, 114)',
  cyan: 'rgb(102, 217, 239)',
  yellow: 'rgb(230, 219, 116)',
  purple: 'rgb(174, 129, 255)',
});

const ONE_DARK = darkTheme({
  bg: 'rgb(40, 44, 52)',
  fill: 'rgb(50, 54, 62)',
  dim: 'rgb(92, 99, 112)',
  fg: 'rgb(171, 178, 191)',
  green: 'rgb(152, 195, 121)',
  blue: 'rgb(97, 175, 239)',
  red: 'rgb(224, 108, 117)',
  cyan: 'rgb(86, 182, 194)',
  yellow: 'rgb(229, 192, 123)',
  purple: 'rgb(198, 120, 221)',
});

const TOKYO_NIGHT = darkTheme({
  bg: 'rgb(26, 27, 38)',
  fill: 'rgb(36, 40, 59)',
  dim: 'rgb(86, 95, 137)',
  fg: 'rgb(169, 177, 214)',
  green: 'rgb(158, 206, 106)',
  blue: 'rgb(122, 162, 247)',
  red: 'rgb(247, 118, 142)',
  cyan: 'rgb(125, 207, 255)',
  yellow: 'rgb(224, 175, 104)',
  purple: 'rgb(187, 154, 247)',
});

const CATPPUCCIN_MOCHA = darkTheme({
  bg: 'rgb(30, 30, 46)',
  fill: 'rgb(40, 40, 58)',
  dim: 'rgb(108, 112, 134)',
  fg: 'rgb(205, 214, 244)',
  green: 'rgb(166, 227, 161)',
  blue: 'rgb(137, 180, 250)',
  red: 'rgb(243, 139, 168)',
  cyan: 'rgb(148, 226, 213)',
  yellow: 'rgb(249, 226, 175)',
  purple: 'rgb(203, 166, 247)',
});

// ---- symbol libraries --------------------------------------------------------
// Small, real `.kicad_sym` libraries (KiCad 10 format), read by readSymbolLib.

const LIB_PASSIVES = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "R"
		(pin_numbers (hide yes))
		(pin_names (offset 0))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "R" (at 2.032 0 90)
			(show_name no) (effects (font (size 1.27 1.27))))
		(property "Value" "R" (at 0 0 90)
			(show_name no) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at -1.778 0 90)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Resistor" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "R_0_1"
			(rectangle (start -1.016 -2.54) (end 1.016 2.54)
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "R_1_1"
			(pin passive line (at 0 3.81 270) (length 1.27)
				(name "" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 0 -3.81 90) (length 1.27)
				(name "" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "C"
		(pin_numbers (hide yes))
		(pin_names (offset 0.254))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "C" (at 0.635 2.54 0)
			(effects (font (size 1.27 1.27)) (justify left)))
		(property "Value" "C" (at 0.635 -2.54 0)
			(effects (font (size 1.27 1.27)) (justify left)))
		(property "Footprint" "" (at 0.9652 -3.81 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Unpolarized capacitor" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "C_0_1"
			(polyline (pts (xy -2.032 -0.762) (xy 2.032 -0.762))
				(stroke (width 0.508) (type default)) (fill (type none)))
			(polyline (pts (xy -2.032 0.762) (xy 2.032 0.762))
				(stroke (width 0.508) (type default)) (fill (type none))))
		(symbol "C_1_1"
			(pin passive line (at 0 3.81 270) (length 2.794)
				(name "~" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 0 -3.81 90) (length 2.794)
				(name "~" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "L"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "L" (at -1.27 0 90)
			(effects (font (size 1.27 1.27))))
		(property "Value" "L" (at 1.905 0 90)
			(effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Inductor" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "L_0_1"
			(arc (start 0 -2.54) (mid 0.6323 -1.905) (end 0 -1.27)
				(stroke (width 0) (type default)) (fill (type none)))
			(arc (start 0 -1.27) (mid 0.6323 -0.635) (end 0 0)
				(stroke (width 0) (type default)) (fill (type none)))
			(arc (start 0 0) (mid 0.6323 0.635) (end 0 1.27)
				(stroke (width 0) (type default)) (fill (type none)))
			(arc (start 0 1.27) (mid 0.6323 1.905) (end 0 2.54)
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "L_1_1"
			(pin passive line (at 0 3.81 270) (length 1.27)
				(name "1" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 0 -3.81 90) (length 1.27)
				(name "2" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_LED = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "LED"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0)
			(effects (font (size 1.27 1.27))))
		(property "Value" "LED" (at 0 -2.54 0)
			(effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Light emitting diode" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "LED_0_1"
			(polyline (pts (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 0) (xy 1.27 0))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 1.27 -1.27) (xy 1.27 1.27) (xy -1.27 0) (xy 1.27 -1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "LED_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_DIODE = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "D"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "D" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Diode" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "D_0_1"
			(polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "D_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "D_Zener"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "D_Zener" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Zener diode" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "D_Zener_0_1"
			(polyline (pts (xy 0.762 0.762) (xy 1.27 1.27) (xy 1.27 -1.27) (xy 1.778 -0.762))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "D_Zener_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "D_Schottky"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "D_Schottky" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Schottky diode" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "D_Schottky_0_1"
			(polyline (pts (xy 1.905 0.762) (xy 1.905 1.143) (xy 1.27 1.143) (xy 1.27 -1.143) (xy 0.635 -1.143) (xy 0.635 -0.762))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "D_Schottky_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_CONNECTOR = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "Conn_01x02"
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "J" (at 1.27 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "Conn_01x02" (at 1.27 -5.08 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Generic connector, single row, 01x02" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Conn_01x02_1_1"
			(rectangle (start -1.27 -1.27) (end 0 1.27)
				(stroke (width 0.1524) (type default)) (fill (type none)))
			(pin passive line (at -5.08 0 0) (length 3.81)
				(name "Pin_1" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at -5.08 -2.54 0) (length 3.81)
				(name "Pin_2" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "Conn_01x03"
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "J" (at 1.27 5.08 0) (effects (font (size 1.27 1.27))))
		(property "Value" "Conn_01x03" (at 1.27 -5.08 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Generic connector, single row, 01x03" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Conn_01x03_1_1"
			(rectangle (start -1.27 -3.81) (end 0 3.81)
				(stroke (width 0.1524) (type default)) (fill (type none)))
			(pin passive line (at -5.08 2.54 0) (length 3.81)
				(name "Pin_1" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at -5.08 0 0) (length 3.81)
				(name "Pin_2" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27)))))
			(pin passive line (at -5.08 -2.54 0) (length 3.81)
				(name "Pin_3" (effects (font (size 1.27 1.27))))
				(number "3" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_TRANSISTOR = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "Q_NPN_BCE"
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "Q" (at 5.08 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Value" "Q_NPN_BCE" (at 5.08 -1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Footprint" "" (at 5.08 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "NPN transistor, base/collector/emitter" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Q_NPN_BCE_0_1"
			(polyline (pts (xy 0.635 0.635) (xy 2.54 2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 -0.635) (xy 2.54 -2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 1.905) (xy 0.635 -1.905))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy 1.7018 -1.27) (xy 2.54 -2.54) (xy 1.27 -1.8542) (xy 1.7018 -1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(circle (center 1.27 0) (radius 2.8194)
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "Q_NPN_BCE_1_1"
			(pin input line (at -5.08 0 0) (length 5.715)
				(name "B" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 5.08 270) (length 2.54)
				(name "C" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 -5.08 90) (length 2.54)
				(name "E" (effects (font (size 1.27 1.27))))
				(number "3" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "Q_PNP_BCE"
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "Q" (at 5.08 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Value" "Q_PNP_BCE" (at 5.08 -1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Footprint" "" (at 5.08 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "PNP transistor, base/collector/emitter" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Q_PNP_BCE_0_1"
			(polyline (pts (xy 0.635 0.635) (xy 2.54 2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 -0.635) (xy 2.54 -2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 1.905) (xy 0.635 -1.905))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy 1.4732 -1.8542) (xy 0.635 -0.635) (xy 1.905 -1.2446) (xy 1.4732 -1.8542))
				(stroke (width 0) (type default)) (fill (type none)))
			(circle (center 1.27 0) (radius 2.8194)
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "Q_PNP_BCE_1_1"
			(pin input line (at -5.08 0 0) (length 5.715)
				(name "B" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 5.08 270) (length 2.54)
				(name "C" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 -5.08 90) (length 2.54)
				(name "E" (effects (font (size 1.27 1.27))))
				(number "3" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_POWER = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "GND"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -6.35 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "GND" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol GND (ground)" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "GND_0_1"
			(polyline (pts (xy 0 0) (xy 0 -1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 -1.27) (xy 1.27 -1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy -0.762 -1.905) (xy 0.762 -1.905))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy -0.254 -2.54) (xy 0.254 -2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "GND_1_1"
			(pin power_in line (at 0 0 270) (length 0)
				(name "GND" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "VCC"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "VCC" (at 0 3.81 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol VCC" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "VCC_0_1"
			(polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0 0) (xy 0 2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "VCC_1_1"
			(pin power_in line (at 0 0 90) (length 0)
				(name "VCC" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "+5V"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "+5V" (at 0 3.556 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol +5V" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "+5V_0_1"
			(polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0 0) (xy 0 2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "+5V_1_1"
			(pin power_in line (at 0 0 90) (length 0)
				(name "+5V" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "+3V3"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "+3V3" (at 0 3.556 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol +3.3V" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "+3V3_0_1"
			(polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0 0) (xy 0 2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "+3V3_1_1"
			(pin power_in line (at 0 0 90) (length 0)
				(name "+3V3" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

// ---- the repository ----------------------------------------------------------

const ZIRO: Contact = { name: 'ZiroEDA', contact: { web: 'https://github.com/ziroeda' } };

/** One stable version, compatible from KiCad 7 onward (matches our file format). */
const v1 = (): PackageVersion[] => [{ version: '1.0.0', status: 'stable', kicadVersion: '7.0' }];

function themePkg(
  id: string,
  name: string,
  description: string,
  theme: Theme,
  tags: string[],
): RepoPackage {
  return {
    id,
    kind: 'colortheme',
    name,
    description,
    author: ZIRO,
    license: 'MIT',
    category: 'Colour Theme',
    tags,
    versions: v1(),
    theme,
  };
}

function libPkg(
  id: string,
  name: string,
  description: string,
  libraries: LibraryPayload[],
  tags: string[],
): RepoPackage {
  return {
    id,
    kind: 'library',
    name,
    description,
    descriptionFull: `Symbol library "${libraries.map((l) => l.name).join(', ')}" for the Symbol Editor.`,
    author: ZIRO,
    license: 'CC-BY-SA-4.0',
    category: 'Symbols',
    tags,
    versions: v1(),
    libraries,
  };
}

const PACKAGES: RepoPackage[] = [
  themePkg(
    'com.ziroeda.theme.nord',
    'Nord',
    'The Nord arctic, north-bluish colour palette — a calm dark theme.',
    NORD,
    ['dark', 'blue', 'nord'],
  ),
  themePkg(
    'com.ziroeda.theme.solarized-dark',
    'Solarized Dark',
    "Ethan Schoonover's Solarized palette, dark background.",
    SOLARIZED_DARK,
    ['dark', 'solarized'],
  ),
  themePkg(
    'com.ziroeda.theme.solarized-light',
    'Solarized Light',
    "Ethan Schoonover's Solarized palette, light background.",
    SOLARIZED_LIGHT,
    ['light', 'solarized'],
  ),
  themePkg(
    'com.ziroeda.theme.high-contrast',
    'High Contrast',
    'A pure-black, high-saturation theme for maximum legibility.',
    HIGH_CONTRAST,
    ['dark', 'accessibility', 'contrast'],
  ),
  themePkg('com.ziroeda.theme.dracula', 'Dracula', 'The popular Dracula dark palette.', DRACULA, [
    'dark',
    'dracula',
  ]),
  themePkg(
    'com.ziroeda.theme.gruvbox-dark',
    'Gruvbox Dark',
    'Retro-groove warm dark palette.',
    GRUVBOX_DARK,
    ['dark', 'gruvbox', 'warm'],
  ),
  themePkg('com.ziroeda.theme.monokai', 'Monokai', 'The classic Monokai editor palette.', MONOKAI, [
    'dark',
    'monokai',
  ]),
  themePkg('com.ziroeda.theme.one-dark', 'One Dark', "Atom's One Dark palette.", ONE_DARK, [
    'dark',
    'atom',
  ]),
  themePkg(
    'com.ziroeda.theme.tokyo-night',
    'Tokyo Night',
    'A clean, dark blue Tokyo Night palette.',
    TOKYO_NIGHT,
    ['dark', 'blue', 'tokyo'],
  ),
  themePkg(
    'com.ziroeda.theme.catppuccin-mocha',
    'Catppuccin Mocha',
    'The soothing Catppuccin Mocha pastel palette.',
    CATPPUCCIN_MOCHA,
    ['dark', 'pastel', 'catppuccin'],
  ),
  libPkg(
    'com.ziroeda.lib.passives',
    'Basic Passives',
    'A starter symbol library: resistor, capacitor and inductor.',
    [{ name: 'ZiroEDA_Passives', text: LIB_PASSIVES }],
    ['resistor', 'capacitor', 'inductor', 'passive'],
  ),
  libPkg(
    'com.ziroeda.lib.led',
    'LED',
    'A single-symbol library with a light-emitting diode.',
    [{ name: 'ZiroEDA_LED', text: LIB_LED }],
    ['led', 'diode', 'light'],
  ),
  libPkg(
    'com.ziroeda.lib.diode',
    'Diodes',
    'Diode, Zener and Schottky symbols.',
    [{ name: 'ZiroEDA_Diode', text: LIB_DIODE }],
    ['diode', 'zener', 'schottky'],
  ),
  libPkg(
    'com.ziroeda.lib.connector',
    'Connectors',
    'Generic single-row connectors (2- and 3-pin).',
    [{ name: 'ZiroEDA_Connector', text: LIB_CONNECTOR }],
    ['connector', 'header', 'pins'],
  ),
  libPkg(
    'com.ziroeda.lib.transistor',
    'Transistors',
    'Bipolar transistors: NPN and PNP (BCE).',
    [{ name: 'ZiroEDA_Transistor', text: LIB_TRANSISTOR }],
    ['transistor', 'npn', 'pnp', 'bjt'],
  ),
  libPkg(
    'com.ziroeda.lib.power',
    'Power Symbols',
    'Power and ground symbols: GND, VCC, +5V, +3V3.',
    [{ name: 'ZiroEDA_Power', text: LIB_POWER }],
    ['power', 'ground', 'gnd', 'vcc'],
  ),
];

export const DEFAULT_REPOSITORY: Repository = {
  url: '',
  name: 'ZiroEDA Default Repository',
  schemaVersion: 1,
  maintainer: ZIRO,
  packages: PACKAGES,
};
