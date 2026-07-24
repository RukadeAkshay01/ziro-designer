/**
 * Schematic Setup persistence: read/write of SCHEMATIC_SETTINGS / ERC_SETTINGS /
 * NET_SETTINGS / text_variables through the project's .kicad_pro
 * (designer/src/editors/schematic/project_settings.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  findProjectPro,
  readSchematicSetup,
  readSchematicSetupText,
  writeSchematicSetupText,
} from '@ziroeda/designer/src/editors/schematic/project_settings.js';
import {
  blankNetClass,
  defaultSchematicSetup,
  type SchematicSetup,
} from '@ziroeda/designer/src/editors/schematic/schematic_settings.js';
import { projectJson } from '@ziroeda/designer/src/home/new_project.js';

const TEMPLATE = projectJson('proj', '00000000-0000-0000-0000-000000000000');

/** A setup with every persisted field off-default. */
function customSetup(): SchematicSetup {
  const s = defaultSchematicSetup();
  s.formatting = {
    ...s.formatting,
    defaultTextSizeMils: 60,
    overbarOffsetRatio: 1.4,
    labelOffsetRatio: 20,
    labelSizeRatio: 25,
    defaultLineWidthMils: 8,
    pinSymbolSizeMils: 30,
    junctionDotChoice: 4,
    hopOverChoice: 2,
    connectionGridMils: 25,
    intersheetRefsShow: true,
    intersheetRefsOwnPage: false,
    intersheetRefsAbbreviated: true,
    intersheetRefsPrefix: '<',
    intersheetRefsSuffix: '>',
    dashLengthRatio: 10,
    gapLengthRatio: 4,
    opoVPrecision: 4,
    opoVRange: 'mV',
    opoIPrecision: 5,
    opoIRange: 'uA',
  };
  s.annotation = {
    symbolUnitNotation: 4, // '.1' -> separator 46, first id 49
    sortOrder: 'y',
    numbering: 'sheetX100',
    firstFreeAfter: 100,
    allowReuse: false,
  };
  s.fieldTemplates = [
    { name: 'MPN', visible: true, url: false },
    { name: 'Datasheet2', visible: false, url: true },
  ];
  s.erc.severities.pin_not_connected = 'ignore';
  s.erc.severities.label_not_connected = 'warning';
  s.erc.severities.label_single_pin = 'error';
  s.erc.pinMap = s.erc.pinMap.map((row) => [...row]);
  s.erc.pinMap[0]![1] = 2;
  s.ercExclusions = ['sig-a', 'sig-b'];
  s.netClasses = {
    classes: [
      {
        name: 'Default',
        clearance: '0.2',
        trackWidth: '',
        viaSize: '',
        viaHole: '',
        uviaSize: '',
        uviaHole: '',
        dpWidth: '',
        dpGap: '',
        tuningProfile: '',
        pcbColor: '',
        wireThickness: '',
        busThickness: '',
        color: '',
        lineStyle: 'Solid',
      },
      {
        name: 'Power',
        clearance: '0.3',
        trackWidth: '0.5',
        viaSize: '0.8',
        viaHole: '0.4',
        uviaSize: '',
        uviaHole: '',
        dpWidth: '',
        dpGap: '',
        tuningProfile: 'fast',
        pcbColor: '#112233',
        wireThickness: '12',
        busThickness: '18',
        color: '#ff0000',
        lineStyle: 'Dashed',
      },
    ],
    assignments: [{ pattern: '/power/*', netClass: 'Power' }],
  };
  s.netChains = {
    chains: [{ name: 'CHAIN1', members: ['N1', 'N2'], chainClass: 'CC1', netClass: '', color: '' }],
    classes: [{ name: 'CC1', members: 1 }],
    classByChain: { CHAIN1: 'CC1' },
  };
  s.usedDesignators = 'R1-3,U1';
  s.busAliases = [
    { name: 'DATA', members: ['D0', 'D1', 'D2'] },
    { name: 'CTRL', members: ['CLK', 'EN'] },
  ];
  s.textVars = [
    { name: 'PROJ', value: 'Ziro' },
    { name: 'REV', value: 'B' },
  ];
  return s;
}

describe('schematic setup .kicad_pro persistence', () => {
  it('reads defaults from an empty project and the new-project template', () => {
    expect(readSchematicSetup([])).toEqual(defaultSchematicSetup());
    const fromTemplate = readSchematicSetupText(TEMPLATE);
    // A stored classes list wins verbatim: the template's Default carries only
    // clearance 0.2, so every other dimension reads as unset — like KiCad's
    // NETCLASS(name, false) reader. Factory defaults only apply when the file
    // has no net_settings.classes at all.
    const want = defaultSchematicSetup();
    want.netClasses.classes[0] = { ...blankNetClass('Default'), clearance: '0.2' };
    expect(fromTemplate).toEqual(want);
  });

  it('round-trips every persisted field', () => {
    const s = customSetup();
    const text = writeSchematicSetupText(TEMPLATE, s);
    expect(text).not.toBeNull();
    const back = readSchematicSetupText(text!);

    // Not persisted in .kicad_pro (documented): embedded files (.kicad_sch
    // data), the net-chain member lists, and the internal pin_to_pin_error
    // severity.
    const strip = (x: SchematicSetup): SchematicSetup => ({
      ...x,
      embeddedFiles: { files: [], embedFonts: false },
      netChains: { ...x.netChains, chains: [] },
      erc: {
        ...x.erc,
        severities: { ...x.erc.severities, pin_to_pin_error: 'error' },
      },
    });
    expect(strip(back)).toEqual(strip(s));
  });

  it('reads a KiCad-authored .kicad_pro (key names, units, formats)', () => {
    const kicad = JSON.stringify({
      erc: {
        erc_exclusions: [['excl-sig', 'a comment'], 'bare-sig'],
        pin_map: Array.from({ length: 12 }, (_, i) =>
          Array.from({ length: 12 }, (_, k) => (i === 0 && k === 0 ? 1 : 0)),
        ),
        rule_severities: {
          label_dangling: 'ignore',
          isolated_pin_label: 'error',
          pin_to_pin: 'error',
          footprint_link_issues: 'warning', // rule our engine lacks
        },
      },
      net_settings: {
        classes: [
          {
            name: 'Default',
            priority: 2147483647,
            clearance: 0.2,
            wire_width: 6,
            bus_width: 12,
            line_style: 0,
            schematic_color: 'rgba(0, 0, 0, 0.000)',
            pcb_color: 'rgba(0, 0, 0, 0.000)',
            tuning_profile: '',
          },
          {
            name: 'B',
            priority: 1,
            schematic_color: 'rgb(255, 0, 0)',
            pcb_color: 'rgba(0, 0, 0, 0.000)',
            tuning_profile: '',
          },
          {
            name: 'A',
            priority: 0,
            schematic_color: 'rgba(0, 0, 0, 0.000)',
            pcb_color: 'rgba(0, 0, 0, 0.000)',
            tuning_profile: '',
          },
        ],
        netclass_patterns: [{ netclass: 'A', pattern: 'VCC*' }],
        net_chain_classes: { C1: 'CCA', C2: 'CCA', C3: 'CCB' },
      },
      schematic: {
        annotate_start_num: 200,
        annotation: { method: 2, sort_order: 1 },
        reuse_designators: false,
        subpart_id_separator: 95,
        subpart_first_id: 49,
        connection_grid_size: 25.0,
        drawing: {
          default_line_thickness: 10.0,
          default_text_size: 40.0,
          text_offset_ratio: 0.3,
          label_size_ratio: 0.25,
          overbar_offset_ratio: 1.4,
          pin_symbol_size: 0.0,
          junction_size_choice: 5,
          hop_over_size_choice: 1,
          intersheets_ref_show: true,
          intersheets_ref_own_page: false,
          intersheets_ref_short: true,
          intersheets_ref_prefix: '(',
          intersheets_ref_suffix: ')',
          dashed_lines_dash_length_ratio: 8.0,
          dashed_lines_gap_length_ratio: 2.0,
          operating_point_overlay_v_precision: 4,
          operating_point_overlay_v_range: '~V',
          operating_point_overlay_i_precision: 6,
          operating_point_overlay_i_range: 'mA',
          field_names: [{ name: 'MPN', url: false, visible: true }],
        },
        bom_presets: [
          {
            name: 'grouped',
            sort_field: 'Reference',
            sort_asc: true,
            filter_string: '',
            group_symbols: true,
            exclude_dnp: false,
            fields_ordered: [
              { name: 'Reference', label: 'Reference', show: true, group_by: false },
              { name: 'Value', label: 'Value', show: true, group_by: true },
            ],
          },
        ],
        bom_fmt_presets: [
          {
            name: 'MyCSV',
            field_delimiter: ',',
            string_delimiter: '"',
            ref_delimiter: ',',
            ref_range_delimiter: '-',
            keep_tabs: false,
            keep_line_breaks: false,
          },
        ],
      },
      text_variables: { PROJ: 'Ziro' },
    });

    const s = readSchematicSetupText(kicad);
    expect(s.formatting.defaultLineWidthMils).toBe(10);
    expect(s.formatting.defaultTextSizeMils).toBe(40);
    expect(s.formatting.labelOffsetRatio).toBeCloseTo(30); // 0.3 -> percent
    expect(s.formatting.labelSizeRatio).toBeCloseTo(25);
    expect(s.formatting.overbarOffsetRatio).toBeCloseTo(1.4);
    expect(s.formatting.pinSymbolSizeMils).toBe(0);
    expect(s.formatting.junctionDotChoice).toBe(5);
    expect(s.formatting.hopOverChoice).toBe(1);
    expect(s.formatting.connectionGridMils).toBe(25);
    expect(s.formatting.intersheetRefsPrefix).toBe('(');
    expect(s.formatting.opoVRange).toBe('Auto'); // '~V' sentinel
    expect(s.formatting.opoIRange).toBe('mA');
    expect(s.annotation).toEqual({
      symbolUnitNotation: 6, // '_1'
      sortOrder: 'y',
      numbering: 'sheetX1000',
      firstFreeAfter: 200,
      allowReuse: false,
    });
    expect(s.fieldTemplates).toEqual([{ name: 'MPN', visible: true, url: false }]);
    // Full preset bodies parse (bom_settings.cpp from_json semantics:
    // include_excluded_from_bom defaults false when absent).
    expect(s.bomPresets.presets).toEqual([
      {
        name: 'grouped',
        sortField: 'Reference',
        sortAsc: true,
        filterString: '',
        groupSymbols: true,
        excludeDnp: false,
        includeExcludedFromBom: false,
        fieldsOrdered: [
          { name: 'Reference', label: 'Reference', show: true, groupBy: false },
          { name: 'Value', label: 'Value', show: true, groupBy: true },
        ],
      },
    ]);
    expect(s.bomPresets.fmtPresets).toEqual([
      {
        name: 'MyCSV',
        fieldDelimiter: ',',
        stringDelimiter: '"',
        refDelimiter: ',',
        refRangeDelimiter: '-',
        keepTabs: false,
        keepLineBreaks: false,
      },
    ]);
    expect(s.erc.severities.label_not_connected).toBe('ignore'); // label_dangling
    expect(s.erc.severities.label_single_pin).toBe('error'); // isolated_pin_label
    expect(s.erc.severities.pin_to_pin_warning).toBe('error'); // pin_to_pin
    expect(s.erc.pinMap[0]![0]).toBe(1);
    expect(s.ercExclusions).toEqual(['excl-sig', 'bare-sig']);
    // Default pinned first, then A (priority 0) before B (priority 1).
    expect(s.netClasses.classes.map((c) => c.name)).toEqual(['Default', 'A', 'B']);
    expect(s.netClasses.classes[0]).toMatchObject({
      clearance: '0.2',
      wireThickness: '6',
      busThickness: '12',
      lineStyle: 'Solid',
      color: '',
    });
    expect(s.netClasses.classes[2]!.color).toBe('#ff0000');
    expect(s.netClasses.assignments).toEqual([{ pattern: 'VCC*', netClass: 'A' }]);
    expect(s.netChains.classes).toEqual([
      { name: 'CCA', members: 2 },
      { name: 'CCB', members: 1 },
    ]);
    expect(s.textVars).toEqual([{ name: 'PROJ', value: 'Ziro' }]);

    // Unknown severity keys survive an unchanged OK.
    const rewritten = writeSchematicSetupText(kicad, s)!;
    const j = JSON.parse(rewritten) as {
      erc: { rule_severities: Record<string, string>; erc_exclusions: [string, string][] };
    };
    expect(j.erc.rule_severities.footprint_link_issues).toBe('warning');
    // Exclusion comments are preserved for surviving signatures.
    expect(j.erc.erc_exclusions).toEqual([
      ['excl-sig', 'a comment'],
      ['bare-sig', ''],
    ]);
  });

  it('preserves keys the dialog does not own', () => {
    const pro = JSON.parse(TEMPLATE) as Record<string, unknown>;
    (pro.schematic as Record<string, unknown>).page_layout_descr_file = 'frame.kicad_wks';
    (pro.net_settings as Record<string, unknown>).netclass_assignments = { '/n1': 'Power' };
    (pro.net_settings as Record<string, unknown>).net_colors = { '/n1': 'rgb(1, 2, 3)' };
    (
      (pro.net_settings as Record<string, unknown>).classes as Record<string, unknown>[]
    )[0]!.diff_pair_via_gap = 0.25;
    const text = JSON.stringify(pro, null, 2);

    const s = readSchematicSetupText(text);
    const out = JSON.parse(writeSchematicSetupText(text, s)!) as Record<string, unknown>;
    expect(out.board).toEqual(pro.board);
    expect(out.boards).toEqual(pro.boards);
    expect(out.cvpcb).toEqual(pro.cvpcb);
    expect(out.libraries).toEqual(pro.libraries);
    expect(out.meta).toEqual(pro.meta);
    expect(out.pcbnew).toEqual(pro.pcbnew);
    expect(out.sheets).toEqual(pro.sheets);
    expect((out.schematic as Record<string, unknown>).page_layout_descr_file).toBe(
      'frame.kicad_wks',
    );
    expect((out.schematic as Record<string, unknown>).legacy_lib_dir).toBe('');
    expect((out.net_settings as Record<string, unknown>).netclass_assignments).toEqual({
      '/n1': 'Power',
    });
    expect((out.net_settings as Record<string, unknown>).net_colors).toEqual({
      '/n1': 'rgb(1, 2, 3)',
    });
    // Unowned per-class key survives on the surviving Default class.
    const outClasses = (out.net_settings as Record<string, unknown>).classes as Record<
      string,
      unknown
    >[];
    expect(outClasses[0]!.diff_pair_via_gap).toBe(0.25);
    // Unknown per-preset keys survive an unchanged OK via the old-object
    // merge (an entry lacking required keys is dropped, like upstream's
    // from_json — so the fixture is complete).
    const withPresets = JSON.parse(TEMPLATE) as Record<string, unknown>;
    (withPresets.schematic as Record<string, unknown>).bom_presets = [
      {
        name: 'grouped',
        sort_field: 'Reference',
        sort_asc: true,
        filter_string: '',
        group_symbols: true,
        exclude_dnp: false,
        fields_ordered: [{ name: 'Value', label: 'Value', show: true, group_by: true }],
        extra: 1,
      },
    ];
    const t2 = JSON.stringify(withPresets, null, 2);
    const out2 = JSON.parse(writeSchematicSetupText(t2, readSchematicSetupText(t2))!) as Record<
      string,
      unknown
    >;
    const outPresets = (out2.schematic as Record<string, unknown>).bom_presets as Record<
      string,
      unknown
    >[];
    expect(outPresets[0]!.extra).toBe(1);
    expect(outPresets[0]!.name).toBe('grouped');
    expect(outPresets[0]!.include_excluded_from_bom).toBe(false);
  });

  it('handles corrupt or missing files and malformed values', () => {
    expect(writeSchematicSetupText('not json', defaultSchematicSetup())).toBeNull();
    expect(readSchematicSetupText('not json')).toEqual(defaultSchematicSetup());
    // Wrong-sized pin_map is ignored, like KiCad's loader.
    const bad = JSON.stringify({ erc: { pin_map: [[0, 1]] } });
    expect(readSchematicSetupText(bad).erc.pinMap).toEqual(defaultSchematicSetup().erc.pinMap);
  });

  it('pins the active .kicad_pro by base name when a folder holds several', () => {
    const a = { name: 'one/a.kicad_pro', text: TEMPLATE };
    const b = { name: 'one/b.kicad_pro', text: writeSchematicSetupText(TEMPLATE, customSetup())! };
    expect(findProjectPro([a, b], 'b')).toBe(b);
    expect(findProjectPro([a, b])).toBe(a);
    expect(readSchematicSetup([a, b], 'b').formatting.defaultTextSizeMils).toBe(60);
  });
});
