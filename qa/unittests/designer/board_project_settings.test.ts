/**
 * Board Setup persistence — the `.kicad_pro` side: read/write of
 * BOARD_DESIGN_SETTINGS / NET_SETTINGS / COMPONENT_CLASS_SETTINGS /
 * TUNING_PROFILES / text_variables
 * (designer/src/editors/pcb/project_settings.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  findProjectPro,
  readBoardSetupPro,
  readBoardSetupProText,
  writeBoardSetupProText,
} from '@ziroeda/designer/src/editors/pcb/project_settings.js';
import {
  defaultBoardSetup,
  type BoardSetupValues,
} from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import { projectJson } from '@ziroeda/designer/src/home/new_project.js';

const TEMPLATE = projectJson('proj', '00000000-0000-0000-0000-000000000000');

/** A setup with every `.kicad_pro`-persisted field off-default. */
function customSetup(): BoardSetupValues {
  const s = defaultBoardSetup();
  s.constraints = {
    minClearanceMM: 0.15,
    minTrackMM: 0.13,
    minConnectionMM: 0.09,
    minAnnularMM: 0.12,
    minViaMM: 0.45,
    minUViaMM: 0.22,
    minUViaHoleMM: 0.11,
    copperToHoleMM: 0.3,
    copperToEdgeMM: 0.4,
    minThroughHoleMM: 0.35,
    minHoleToHoleMM: 0.3,
    silkClearanceMM: 0.05,
    minTextHeightMM: 0.7,
    minTextThicknessMM: 0.09,
    maxDeviationMM: 0.01,
    allowFilletsOutside: true,
    minThermalSpokes: 3,
    includeStackupHeight: false,
  };
  s.maskPaste.maskToCopperMM = 0.07;
  s.trackWidthsMM = [0.25, 0.5];
  s.viaSizesMM = [{ diameter: 0.7, drill: 0.35 }];
  s.diffPairsMM = [{ width: 0.2, gap: 0.18, viaGap: 0.3 }];
  s.drcSeverities.clearance = 'warning';
  s.drcSeverities.silk_over_copper = 'ignore';
  s.drcSeverities.too_many_vias = 'warning';
  s.teardrops.round = {
    bestLengthPct: 40,
    maxLengthMM: 1.5,
    bestWidthPct: 90,
    maxWidthMM: 2.5,
    preferZoneConnection: false,
    trackWidthLimitPct: 85,
    allowSpanTwoSegments: false,
    curvedEdges: true,
  };
  s.tuning.diffPair = {
    minAmplitudeMM: 0.3,
    maxAmplitudeMM: 1.2,
    spacingMM: 0.8,
    cornerStyle: 'Chamfer',
    radiusPct: 60,
    singleSided: true,
  };
  s.textGraphics.rows[0] = {
    lineThickness: 0.15,
    textWidth: 1.2,
    textHeight: 1.1,
    textThickness: 0.2,
    italic: true,
    keepUpright: false,
  };
  s.textGraphics.rows[2]!.lineThickness = 0.09; // Edge Cuts, graphics-only
  s.textGraphics.dimensions = {
    units: 'Mils',
    format: '1234 (mm)',
    precision: '0.00',
    suppressTrailingZeroes: false,
    textPosition: 'Inline',
    keepTextAligned: false,
    arrowLengthMM: 2,
    extLineOffsetMM: 0.75,
  };
  s.formatting.applyFields = true;
  s.formatting.applyDimensions = true;
  s.zones = {
    name: '',
    clearanceMM: 0.6,
    minWidthMM: 0.3,
    padConnection: 'Reliefs for PTH',
    thermalGapMM: 0.6,
    thermalSpokeMM: 0.4,
    outlineDisplay: 'Fully hatched',
    outlineHatchPitchMM: 0.7,
    cornerSmoothing: 'Fillet',
    smoothingRadiusMM: 1.5,
    removeIslands: 'Below area limit',
    areaLimitMM2: 12,
    locked: false,
  };
  s.componentClasses.assignPerSheet = true;
  s.componentClasses.assignments = [
    {
      componentClass: 'HV',
      matchMode: 'any',
      conditions: [
        { type: 'Reference', value: 'R*' },
        { type: 'Reference', value: 'C*' },
        { type: 'Side', value: 'Front' },
      ],
    },
  ];
  s.tuningProfiles.profiles = [
    {
      name: 'DDR',
      type: 'Differential',
      targetImpedance: 90,
      frequency: 2,
      frequencyUnit: 'GHz',
      enableTimeDomain: true,
      modelSolderMask: false,
      globalUnitDelay: 7,
    },
  ];
  s.netClasses.classes[0] = { ...s.netClasses.classes[0]!, clearance: '0.3', trackWidth: '0.35' };
  s.netClasses.classes.push({
    name: 'Power',
    clearance: '0.4',
    trackWidth: '0.8',
    viaSize: '1.2',
    viaHole: '0.6',
    uviaSize: '',
    uviaHole: '',
    dpWidth: '',
    dpGap: '',
    tuningProfile: 'DDR',
    pcbColor: '#ff0000',
    wireThickness: '',
    busThickness: '',
    color: '',
    lineStyle: 'Solid',
  });
  s.netClasses.assignments = [{ pattern: 'VCC*', netClass: 'Power' }];
  s.textVars = [{ name: 'BOARD_REV', value: 'B2' }];
  return s;
}

describe('board project_settings (.kicad_pro)', () => {
  it('reads defaults from a fresh template project', () => {
    const s = readBoardSetupProText(TEMPLATE);
    expect(s.constraints).toEqual(defaultBoardSetup().constraints);
    expect(s.trackWidthsMM).toEqual([]);
    expect(s.viaSizesMM).toEqual([]);
  });

  it('round-trips every persisted field through the template', () => {
    const written = writeBoardSetupProText(TEMPLATE, customSetup());
    expect(written).not.toBeNull();
    const back = readBoardSetupProText(written!);
    const want = customSetup();
    expect(back.constraints).toEqual(want.constraints);
    expect(back.maskPaste.maskToCopperMM).toBe(want.maskPaste.maskToCopperMM);
    expect(back.trackWidthsMM).toEqual(want.trackWidthsMM);
    expect(back.viaSizesMM).toEqual(want.viaSizesMM);
    expect(back.diffPairsMM).toEqual(want.diffPairsMM);
    expect(back.drcSeverities).toEqual(want.drcSeverities);
    expect(back.teardrops).toEqual(want.teardrops);
    expect(back.tuning).toEqual(want.tuning);
    expect(back.textGraphics).toEqual(want.textGraphics);
    expect(back.formatting).toEqual(want.formatting);
    expect(back.zones).toEqual(want.zones);
    expect(back.componentClasses).toEqual(want.componentClasses);
    expect(back.tuningProfiles).toEqual(want.tuningProfiles);
    expect(back.netClasses).toEqual(want.netClasses);
    expect(back.textVars).toEqual(want.textVars);
  });

  it('reads a KiCad-authored design_settings block (file units)', () => {
    const pro = JSON.stringify({
      board: {
        design_settings: {
          meta: { version: 2 },
          rules: {
            min_clearance: 0.2,
            min_track_width: 0.25,
            min_via_annular_width: 0.13,
            max_error: 0.005,
            min_resolved_spokes: 4,
            use_height_for_length_calcs: false,
          },
          rule_severities: { clearance: 'ignore', hole_to_hole: 'error' },
          // Element [0] of each list is KiCad's "use netclass" sentinel.
          track_widths: [0, 0.3, 0.6],
          via_dimensions: [
            { diameter: 0, drill: 0 },
            { diameter: 0.8, drill: 0.4 },
            { diameter: 1 },
          ],
          teardrop_parameters: [
            {
              td_target_name: 'td_round_shape',
              td_maxlen: 2,
              td_length_ratio: 0.4,
              td_curve_segcount: 5,
              td_on_pad_in_zone: true,
            },
          ],
          defaults: {
            silk_line_width: 0.18,
            dimension_units: 1,
            dimension_precision: 2,
            dimensions: {
              units_format: 2,
              arrow_length: 1270000,
              extension_offset: 500000,
            },
            zones: { pad_connection: 3, border_display_style: 1, min_island_area: 8 },
          },
          zones_allow_external_fillets: true,
        },
      },
    });
    const s = readBoardSetupProText(pro);
    expect(s.constraints.minClearanceMM).toBe(0.2);
    expect(s.constraints.minTrackMM).toBe(0.25);
    expect(s.constraints.minAnnularMM).toBe(0.13);
    expect(s.constraints.minThermalSpokes).toBe(4);
    expect(s.constraints.includeStackupHeight).toBe(false);
    expect(s.constraints.allowFilletsOutside).toBe(true);
    expect(s.drcSeverities.clearance).toBe('ignore');
    // The [0] sentinels stay out of the grid model.
    expect(s.trackWidthsMM).toEqual([0.3, 0.6]);
    // Via entry missing "drill" is skipped, like upstream.
    expect(s.viaSizesMM).toEqual([{ diameter: 0.8, drill: 0.4 }]);
    expect(s.teardrops.round.maxLengthMM).toBe(2);
    expect(s.teardrops.round.bestLengthPct).toBeCloseTo(40);
    expect(s.teardrops.round.curvedEdges).toBe(true);
    expect(s.teardrops.round.preferZoneConnection).toBe(false);
    expect(s.textGraphics.rows[0]!.lineThickness).toBe(0.18);
    expect(s.textGraphics.dimensions.units).toBe('Mils');
    expect(s.textGraphics.dimensions.precision).toBe('0.00');
    expect(s.textGraphics.dimensions.format).toBe('1234 (mm)');
    // Raw nanometre integers -> mm.
    expect(s.textGraphics.dimensions.arrowLengthMM).toBeCloseTo(1.27);
    expect(s.textGraphics.dimensions.extLineOffsetMM).toBeCloseTo(0.5);
    expect(s.zones.padConnection).toBe('Reliefs for PTH');
    expect(s.zones.outlineDisplay).toBe('Fully hatched');
    expect(s.zones.areaLimitMM2).toBe(8);
  });

  it('preserves keys it does not own', () => {
    const pro = JSON.stringify({
      some_other_tool: { x: 1 },
      board: {
        design_settings: {
          meta: { version: 2 },
          drc_exclusions: [['marker|1|2', 'a comment']],
          rule_severities: { some_future_rule: 'warning' },
          defaults: { pads: { width: 1.5, height: 2, drill: 0.7 } },
          teardrop_options: [{ td_onvia: true, td_onpthpad: false }],
        },
        ipc2581: { dist: 'X' },
      },
      net_settings: {
        classes: [
          {
            name: 'Default',
            priority: 2147483647,
            diff_pair_via_gap: 0.31,
            unknown_future_key: 7,
          },
        ],
      },
      tuning_profiles: {
        tuning_profiles_impedance_geometric: [
          {
            profile_name: 'DDR',
            type: 0,
            target_impedance: 50,
            frequency: 1e9,
            model_solder_mask: true,
            enable_time_domain_tuning: false,
            via_prop_delay: 0,
            layer_entries: [{ signal_layer: 'F.Cu', width: 42 }],
            via_overrides: [{ delay: 9 }],
          },
        ],
      },
    });
    const s = readBoardSetupProText(pro);
    const written = writeBoardSetupProText(pro, s)!;
    const j = JSON.parse(written);
    expect(j.some_other_tool).toEqual({ x: 1 });
    expect(j.board.ipc2581).toEqual({ dist: 'X' });
    expect(j.board.design_settings.drc_exclusions).toEqual([['marker|1|2', 'a comment']]);
    expect(j.board.design_settings.rule_severities.some_future_rule).toBe('warning');
    expect(j.board.design_settings.rule_severities.clearance).toBe('error');
    expect(j.board.design_settings.defaults.pads).toEqual({ width: 1.5, height: 2, drill: 0.7 });
    expect(j.board.design_settings.teardrop_options).toEqual([
      { td_onvia: true, td_onpthpad: false },
    ]);
    const dflt = j.net_settings.classes.find((c: { name: string }) => c.name === 'Default');
    expect(dflt.diff_pair_via_gap).toBe(0.31);
    expect(dflt.unknown_future_key).toBe(7);
    // Tuning-profile deep fields our form does not model survive by name.
    const prof = j.tuning_profiles.tuning_profiles_impedance_geometric[0];
    expect(prof.layer_entries).toEqual([{ signal_layer: 'F.Cu', width: 42 }]);
    expect(prof.via_overrides).toEqual([{ delay: 9 }]);
    expect(j.board.design_settings.meta.version).toBe(2);
  });

  it('falls back to defaults on malformed input and finds the pinned project', () => {
    expect(readBoardSetupProText('not json')).toEqual(defaultBoardSetup());
    expect(writeBoardSetupProText('not json', defaultBoardSetup())).toBeNull();
    const files = [
      { name: 'a/other.kicad_pro', text: TEMPLATE },
      { name: 'a/mine.kicad_pro', text: writeBoardSetupProText(TEMPLATE, customSetup())! },
    ];
    expect(findProjectPro(files, 'mine')?.name).toBe('a/mine.kicad_pro');
    expect(readBoardSetupPro(files, 'mine').constraints.minTrackMM).toBe(0.13);
    expect(readBoardSetupPro([], 'mine')).toEqual(defaultBoardSetup());
  });
});
