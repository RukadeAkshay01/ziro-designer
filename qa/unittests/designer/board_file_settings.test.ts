/**
 * Board Setup persistence — the `.kicad_pcb` side: general thickness, the
 * layers table, (setup …) incl. stackup / mask & paste / tenting / dash
 * ratios, and embedded fonts/files
 * (designer/src/editors/pcb/board_file_settings.ts).
 */
import { describe, it, expect } from 'vitest';
import { parse, head, isList, type SList } from '@ziroeda/sexpr';
import { childNamed, childrenNamed } from '@ziroeda/sexpr/src/query.js';
import {
  applyBoardFileSetup,
  writeBoardFileSetup,
} from '@ziroeda/designer/src/editors/pcb/board_file_settings.js';
import { defaultBoardSetup } from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import { EMPTY_PCB } from '@ziroeda/designer/src/home/new_project.js';

/** A KiCad-authored 4-layer board with a full setup block. */
const KICAD_PCB = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (4 "In1.Cu" power "GND_PLANE")
    (6 "In2.Cu" mixed)
    (2 "B.Cu" signal)
    (13 "F.Paste" user)
    (15 "B.Paste" user)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (25 "Edge.Cuts" user)
    (31 "F.CrtYd" user "F.Courtyard")
    (29 "B.CrtYd" user "B.Courtyard")
  )
  (setup
    (stackup
      (layer "F.SilkS" (type "Top Silk Screen") (color "White") (thickness 0.01))
      (layer "F.Paste" (type "Top Solder Paste"))
      (layer "F.Mask" (type "Top Solder Mask") (color "Green") (thickness 0.01) (material "Epoxy") (epsilon_r 3.3) (loss_tangent 0))
      (layer "F.Cu" (type "copper") (thickness 0.035))
      (layer "dielectric 1" (type "prepreg") (thickness 0.2 locked) (material "FR4") (epsilon_r 4.4) (loss_tangent 0.02))
      (layer "In1.Cu" (type "copper") (thickness 0.0175))
      (layer "dielectric 2" (type "core") (thickness 1.065) (material "FR4") (epsilon_r 4.5) (loss_tangent 0.02) (spec_frequency 10000000) (dielectric_model djordjevic_sarkar))
      (layer "In2.Cu" (type "copper") (thickness 0.0175))
      (layer "dielectric 3" (type "prepreg") (thickness 0.2) (material "FR4") (epsilon_r 4.4) (loss_tangent 0.02))
      (layer "B.Cu" (type "copper") (thickness 0.035))
      (layer "B.Mask" (type "Bottom Solder Mask") (color "Green") (thickness 0.01))
      (layer "B.Paste" (type "Bottom Solder Paste"))
      (layer "B.SilkS" (type "Bottom Silk Screen") (color "White") (thickness 0.01))
      (copper_finish "ENIG")
      (dielectric_constraints yes)
      (edge_connector bevelled)
      (edge_plating yes)
    )
    (pad_to_mask_clearance 0.05)
    (solder_mask_min_width 0.1)
    (pad_to_paste_clearance -0.05)
    (pad_to_paste_clearance_ratio -0.1)
    (allow_soldermask_bridges_in_footprints yes)
    (tenting (front yes) (back no))
    (covering (front no) (back no))
    (capping no)
    (aux_axis_origin 10 20)
    (pcbplotparams
      (layerselection 0x00000000_00000000_55555555_5755f5ff)
      (dashed_line_dash_ratio 12.000000)
      (dashed_line_gap_ratio 3.000000)
      (plotframeref no)
    )
  )
  (net 0 "")
  (segment (start 0 0) (end 1 1) (width 0.25) (layer "F.Cu") (net 0))
  (embedded_fonts no)
  (embedded_files
    (file (name "logo.png") (type other) (checksum "abc"))
    (file (name "note.pdf") (type datasheet) (checksum "def"))
  )
)
`;

describe('board_file_settings (.kicad_pcb)', () => {
  it('hydrates layers, stackup, mask/paste, ratios and embedded files', () => {
    const s = defaultBoardSetup();
    expect(applyBoardFileSetup(KICAD_PCB, s)).toBe(true);

    // Layers: 4 copper rows in stack order with types + user names.
    const copper = s.layers.layers.filter((l) => l.kind === 'copper');
    expect(copper.map((l) => l.id)).toEqual(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
    expect(copper[1]!.copperType).toBe('power');
    expect(copper[1]!.name).toBe('GND_PLANE');
    expect(copper[2]!.copperType).toBe('mixed');
    expect(s.physicalStackup.copperCount).toBe(4);
    // Absent tech layers are disabled, present ones enabled.
    expect(s.layers.layers.find((l) => l.id === 'F.Adhes')!.enabled).toBe(false);
    expect(s.layers.layers.find((l) => l.id === 'F.SilkS')!.enabled).toBe(true);
    expect(s.layers.layers.find((l) => l.id === 'Dwgs.User')!.enabled).toBe(false);

    // Stackup.
    expect(s.physicalStackup.layers).toHaveLength(13);
    // Non-dielectric rows keep their own thickness/material/color.
    expect(s.physicalStackup.layers[0]).toMatchObject({
      name: 'F.Silkscreen',
      type: 'Top Silk Screen',
      thicknessMM: 0.01,
      color: 'White',
    });
    expect(s.physicalStackup.impedanceControlled).toBe(true);
    const diel1 = s.physicalStackup.layers[4]!;
    expect(diel1.name).toBe('Dielectric 1');
    expect(diel1.type).toBe('Prepreg');
    expect(diel1.locked).toBe(true);
    expect(diel1.thicknessMM).toBe(0.2);
    const diel2 = s.physicalStackup.layers[6]!;
    expect(diel2.type).toBe('Core');
    expect(diel2.specFreq).toBe('10000000');
    expect(diel2.dielectricModel).toBe('Wideband');
    expect(s.boardFinish.copperFinish).toBe('ENIG');
    expect(s.boardFinish.edgeCardConnectors).toBe('Yes, bevelled');
    expect(s.boardFinish.platedBoardEdge).toBe(true);

    // Mask/paste + tenting.
    expect(s.maskPaste.maskExpansionMM).toBe(0.05);
    expect(s.maskPaste.maskMinWebMM).toBe(0.1);
    expect(s.maskPaste.pasteClearanceMM).toBe(-0.05);
    expect(s.maskPaste.pasteRelativePct).toBeCloseTo(-10);
    expect(s.maskPaste.allowBridged).toBe(true);
    expect(s.maskPaste.tentFront).toBe(true);
    expect(s.maskPaste.tentBack).toBe(false);

    // Formatting ratios come from pcbplotparams.
    expect(s.formatting.dashLengthRatio).toBe(12);
    expect(s.formatting.gapLengthRatio).toBe(3);

    // Embedded files.
    expect(s.embeddedFiles.embedFonts).toBe(false);
    expect(s.embeddedFiles.files.map((f) => f.name)).toEqual(['logo.png', 'note.pdf']);
  });

  it('round-trips: apply then write reproduces the owned sections', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(KICAD_PCB, s);
    const written = writeBoardFileSetup(KICAD_PCB, s)!;
    const s2 = defaultBoardSetup();
    expect(applyBoardFileSetup(written, s2)).toBe(true);
    expect(s2.layers).toEqual(s.layers);
    expect(s2.physicalStackup).toEqual(s.physicalStackup);
    expect(s2.boardFinish).toEqual(s.boardFinish);
    expect(s2.maskPaste).toEqual(s.maskPaste);
    expect(s2.embeddedFiles).toEqual(s.embeddedFiles);
    expect(s2.formatting.dashLengthRatio).toBe(s.formatting.dashLengthRatio);

    // Board items and opaque setup children survive.
    const root = parse(written);
    expect(childrenNamed(root, 'segment')).toHaveLength(1);
    const setup = childNamed(root, 'setup')!;
    expect(childNamed(setup, 'aux_axis_origin')).toBeDefined();
    expect(childNamed(setup, 'covering')).toBeDefined();
    const plot = childNamed(setup, 'pcbplotparams')!;
    expect(childNamed(plot, 'layerselection')).toBeDefined();
    expect(childNamed(plot, 'plotframeref')).toBeDefined();
  });

  it('patches edits: mask values, tenting, layer rename, dash ratio, thickness', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(KICAD_PCB, s);
    s.maskPaste.maskMinWebMM = 0; // -> token omitted
    s.maskPaste.tentBack = true;
    s.maskPaste.pasteClearanceMM = 0; // -> token omitted
    s.formatting.dashLengthRatio = 5;
    const silk = s.layers.layers.find((l) => l.id === 'F.SilkS')!;
    silk.name = 'TopSilk';
    const written = writeBoardFileSetup(KICAD_PCB, s)!;
    const root = parse(written);
    const setup = childNamed(root, 'setup')!;
    expect(childNamed(setup, 'solder_mask_min_width')).toBeUndefined();
    expect(childNamed(setup, 'pad_to_paste_clearance')).toBeUndefined();
    // ratio still non-zero -> present
    expect(childNamed(setup, 'pad_to_paste_clearance_ratio')).toBeDefined();
    const tenting = childNamed(setup, 'tenting')!;
    expect(childNamed(tenting, 'back')!.items[1]).toEqual({ kind: 'atom', value: 'yes' });
    const plot = childNamed(setup, 'pcbplotparams')!;
    expect(childNamed(plot, 'dashed_line_dash_ratio')!.items[1]).toEqual({
      kind: 'atom',
      value: '5',
    });
    // Renamed silk layer gets a user-name token.
    const layers = childNamed(root, 'layers')!;
    const silkEntry = layers.items.find(
      (n): n is SList =>
        isList(n) && n.items[1]?.kind === 'string' && n.items[1].value === 'F.SilkS',
    )!;
    expect(silkEntry.items[3]).toEqual({ kind: 'string', value: 'TopSilk' });
    // general thickness = stackup sum.
    const general = childNamed(root, 'general')!;
    const th = childNamed(general, 'thickness')!.items[1]!;
    const sum = s.physicalStackup.layers.reduce((a, l) => a + (l.thicknessMM || 0), 0);
    expect(Number((th as { value: string }).value)).toBeCloseTo(sum, 6);
    expect(childNamed(general, 'legacy_teardrops')).toBeDefined();
  });

  it('drops a removed embedded file and keeps the other', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(KICAD_PCB, s);
    s.embeddedFiles.files = s.embeddedFiles.files.filter((f) => f.name !== 'logo.png');
    s.embeddedFiles.embedFonts = true;
    const written = writeBoardFileSetup(KICAD_PCB, s)!;
    const root = parse(written);
    const embedded = childNamed(root, 'embedded_files')!;
    const names = childrenNamed(embedded, 'file').map(
      (f) => (childNamed(f, 'name')!.items[1] as { value: string }).value,
    );
    expect(names).toEqual(['note.pdf']);
    expect(childNamed(root, 'embedded_fonts')!.items[1]).toEqual({ kind: 'atom', value: 'yes' });
  });

  it('handles the fresh-board template (no setup block)', () => {
    const s = defaultBoardSetup();
    expect(applyBoardFileSetup(EMPTY_PCB, s)).toBe(true);
    expect(s.physicalStackup.copperCount).toBe(2);
    expect(s.physicalStackup.layers.filter((l) => l.type === 'Copper')).toHaveLength(2);
    // The generated default stack carries real thicknesses into the file.
    expect(s.physicalStackup.layers[0]!.thicknessMM).toBe(0.01);
    const written = writeBoardFileSetup(EMPTY_PCB, s)!;
    expect(written).toMatch(/\(layer "F\.SilkS"[\s\S]{0,120}\(thickness 0\.01\)/);
    const root = parse(written);
    // A setup block now exists with the dialog-owned tokens.
    const setup = childNamed(root, 'setup')!;
    expect(childNamed(setup, 'stackup')).toBeDefined();
    expect(childNamed(setup, 'pad_to_mask_clearance')).toBeDefined();
    expect(head(root)).toBe('kicad_pcb');
    // net declaration untouched.
    expect(childrenNamed(root, 'net')).toHaveLength(1);
  });

  it('round-trips dielectric sublayers (addsublayer groups)', () => {
    const withSubs = KICAD_PCB.replace(
      '(layer "dielectric 1" (type "prepreg") (thickness 0.2 locked) (material "FR4") (epsilon_r 4.4) (loss_tangent 0.02))',
      '(layer "dielectric 1" (type "prepreg") (thickness 0.2 locked) (material "FR4") (epsilon_r 4.4) (loss_tangent 0.02)' +
        ' addsublayer (thickness 0.13) (material "Polyimide") (epsilon_r 3.2) (loss_tangent 0.004)' +
        ' addsublayer (thickness 0.07 locked) (material "PTFE") (epsilon_r 2.1) (loss_tangent 0.0002))',
    );
    const s = defaultBoardSetup();
    expect(applyBoardFileSetup(withSubs, s)).toBe(true);
    const diel1 = s.physicalStackup.layers[4]!;
    // Main sublayer keeps its own values...
    expect(diel1.thicknessMM).toBe(0.2);
    expect(diel1.locked).toBe(true);
    expect(diel1.material).toBe('FR4');
    // ...and the two addsublayer groups land as sublayers.
    expect(diel1.sublayers).toEqual([
      { material: 'Polyimide', thicknessMM: 0.13, epsilonR: 3.2, lossTan: 0.004 },
      { material: 'PTFE', thicknessMM: 0.07, epsilonR: 2.1, lossTan: 0.0002, locked: true },
    ]);

    // Write -> read reproduces the sublayers byte-compatibly.
    const written = writeBoardFileSetup(withSubs, s)!;
    expect(written).toContain('addsublayer');
    const s2 = defaultBoardSetup();
    applyBoardFileSetup(written, s2);
    expect(s2.physicalStackup.layers[4]).toEqual(diel1);
  });

  it('returns null/false on malformed input', () => {
    const s = defaultBoardSetup();
    expect(applyBoardFileSetup('(not a board)', s)).toBe(false);
    expect(writeBoardFileSetup('garbage((', s)).toBeNull();
  });
});
