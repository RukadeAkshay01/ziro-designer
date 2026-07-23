/**
 * ERC settings. Counterpart: `eeschema/erc/erc_settings.cpp` (ERC_SETTINGS) —
 * the per-project electrical-rules configuration edited by the Schematic Setup
 * dialog: a severity (error / warning / ignore) for every ERC rule, and the
 * pin-to-pin conflict matrix. `runErc` reads these instead of hard-coded
 * defaults, so overriding a severity or a matrix cell changes the check.
 */

/** ELECTRICAL_PINTYPE order — the ERC matrix rows/columns and the pin-map grid. */
export const PIN_TYPES = [
  'input',
  'output',
  'bidirectional',
  'tri_state',
  'passive',
  'free',
  'unspecified',
  'power_in',
  'power_out',
  'open_collector',
  'open_emitter',
  'no_connect',
] as const;

export type PinTypeToken = (typeof PIN_TYPES)[number];

/** Index of a pin-type token in the matrix (unknown -> unspecified, as KiCad's parser). */
export function typeIndex(token: string): number {
  const i = PIN_TYPES.indexOf(token as PinTypeToken);
  return i === -1 ? 6 : i;
}

/** Human names, as ElectricalPinTypeGetText produces them. */
export const TYPE_NAMES: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  bidirectional: 'Bidirectional',
  tri_state: 'Tri-state',
  passive: 'Passive',
  free: 'Free',
  unspecified: 'Unspecified',
  power_in: 'Power input',
  power_out: 'Power output',
  open_collector: 'Open collector',
  open_emitter: 'Open emitter',
  no_connect: 'Unconnected',
};

/** Short column headers for the Pin Conflicts Map grid (KiCad's abbreviations). */
export const TYPE_ABBREV: readonly string[] = [
  'I',
  'O',
  'Bi',
  '3S',
  'Pas',
  'NIC',
  'UnS',
  'PwrI',
  'PwrO',
  'OC',
  'OE',
  'NC',
];

export const OK = 0;
export const WAR = 1;
export const ERR = 2;
export type PinError = typeof OK | typeof WAR | typeof ERR;

/** ERC_SETTINGS::m_defaultPinMap — the default conflict matrix. */
export const DEFAULT_PIN_MAP: PinError[][] = [
  /*         I,   O,    Bi,   3S,   Pas,  NIC,  UnS,  PwrI, PwrO, OC,   OE,   NC */
  /* I  */ [OK, OK, OK, OK, OK, OK, WAR, OK, OK, OK, OK, ERR],
  /* O  */ [OK, ERR, OK, WAR, OK, OK, WAR, OK, ERR, ERR, ERR, ERR],
  /* Bi */ [OK, OK, OK, OK, OK, OK, WAR, OK, WAR, OK, WAR, ERR],
  /* 3S */ [OK, WAR, OK, OK, OK, OK, WAR, WAR, ERR, WAR, WAR, ERR],
  /*Pas */ [OK, OK, OK, OK, OK, OK, WAR, OK, OK, OK, OK, ERR],
  /*NIC */ [OK, OK, OK, OK, OK, OK, OK, OK, OK, OK, OK, ERR],
  /*UnS */ [WAR, WAR, WAR, WAR, WAR, OK, WAR, WAR, WAR, WAR, WAR, ERR],
  /*PwrI*/ [OK, OK, OK, WAR, OK, OK, WAR, OK, OK, OK, OK, ERR],
  /*PwrO*/ [OK, ERR, WAR, ERR, OK, OK, WAR, OK, ERR, ERR, ERR, ERR],
  /* OC */ [OK, ERR, OK, WAR, OK, OK, WAR, OK, ERR, OK, OK, ERR],
  /* OE */ [OK, ERR, WAR, WAR, OK, OK, WAR, OK, ERR, OK, OK, ERR],
  /* NC */ [ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR],
];

/** The ERC rules that carry an editable severity (ERC_ITEM types we implement). */
export type ErcCode =
  | 'pin_not_connected'
  | 'pin_not_driven'
  | 'power_pin_not_driven'
  | 'pin_to_pin_warning'
  | 'pin_to_pin_error'
  | 'no_connect_connected'
  | 'no_connect_dangling'
  | 'label_not_connected'
  | 'label_single_pin'
  | 'endpoint_off_grid';

/** A violation's reported severity (an ignored rule is not emitted at all). */
export type ErcSeverity = 'error' | 'warning';
export type ErcSeverityLevel = ErcSeverity | 'ignore';

/** Violation-Severity panel rows: rule + label, in KiCad's list order. */
export const ERC_ITEMS: { code: ErcCode; title: string }[] = [
  { code: 'pin_not_connected', title: 'Pin not connected' },
  { code: 'pin_not_driven', title: 'Input pin not driven by any Output pins' },
  { code: 'power_pin_not_driven', title: 'Input Power pin not driven by any Output Power pins' },
  { code: 'pin_to_pin_warning', title: 'Conflict problem between pins (warning)' },
  { code: 'pin_to_pin_error', title: 'Conflict problem between pins (error)' },
  { code: 'no_connect_connected', title: 'A pin with a "no connection" flag is connected' },
  { code: 'no_connect_dangling', title: 'Unconnected "no connection" flag' },
  { code: 'label_not_connected', title: 'Label not connected to anything' },
  { code: 'label_single_pin', title: 'Label connected to only one pin' },
  // Upstream lists this at the end of the Connections group (erc_settings.cpp).
  { code: 'endpoint_off_grid', title: 'Symbol pin or wire end off connection grid' },
];

/** ERC_SETTINGS default severities: error unless listed otherwise. */
export const DEFAULT_SEVERITIES: Record<ErcCode, ErcSeverityLevel> = {
  pin_not_connected: 'error',
  pin_not_driven: 'error',
  power_pin_not_driven: 'error',
  pin_to_pin_warning: 'warning',
  pin_to_pin_error: 'error',
  no_connect_connected: 'warning',
  no_connect_dangling: 'warning',
  label_not_connected: 'error',
  label_single_pin: 'warning',
  endpoint_off_grid: 'warning',
};

/** The full ERC configuration (ERC_SETTINGS). */
export interface ErcSettings {
  severities: Record<ErcCode, ErcSeverityLevel>;
  pinMap: PinError[][];
}

/** A fresh copy of the default ERC settings (deep, so edits don't share state). */
export function defaultErcSettings(): ErcSettings {
  return {
    severities: { ...DEFAULT_SEVERITIES },
    pinMap: DEFAULT_PIN_MAP.map((row) => [...row]),
  };
}
