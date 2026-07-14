/**
 * Footprint 3D model references: parsing `(model …)` into footprint.models,
 * the first step toward rendering component bodies in the 3D viewer.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (footprint "Test:Cap"
    (layer "F.Cu")
    (at 100 50 90)
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask"))
    (model "\${KICAD6_3DMODEL_DIR}/Capacitor_THT.3dshapes/CP_Axial.wrl"
      (offset (xyz 0 0 0.5))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 90))))
  (footprint "Test:NoModel"
    (layer "B.Cu")
    (at 120 60 0)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "B.Cu")))
)`;

describe('footprint 3D models', () => {
  it('parses (model …) path, offset, scale, rotate', () => {
    const b = readBoard(parse(BOARD));
    expect(b.footprints.length).toBe(2);
    const m = b.footprints[0]!.models;
    expect(m.length).toBe(1);
    expect(m[0]!.path).toContain('CP_Axial.wrl');
    expect(m[0]!.path).toContain('${KICAD6_3DMODEL_DIR}');
    expect(m[0]!.offset).toEqual({ x: 0, y: 0, z: 0.5 });
    expect(m[0]!.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(m[0]!.rotate).toEqual({ x: 0, y: 0, z: 90 });
    expect(m[0]!.hide).toBe(false);
  });

  it('footprints without a model get an empty array', () => {
    const b = readBoard(parse(BOARD));
    expect(b.footprints[1]!.models).toEqual([]);
  });

  // PCB_IO_KICAD_SEXPR_PARSER::parse3DModel: the legacy `(at (xyz …))` offset
  // variant is in inches — upstream multiplies by 25.4 into mm.
  it('converts legacy (at (xyz …)) offsets from inches to mm', () => {
    const b = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal))
        (footprint "Test:Legacy" (layer "F.Cu") (at 0 0)
          (model "x.wrl" (at (xyz 0.1 0 -0.05)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))))`),
    );
    const m = b.footprints[0]!.models[0]!;
    expect(m.offset.x).toBeCloseTo(2.54);
    expect(m.offset.y).toBeCloseTo(0);
    expect(m.offset.z).toBeCloseTo(-1.27);
  });

  it('parses (opacity …) like FP_3DMODEL::m_Opacity', () => {
    const b = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal))
        (footprint "Test:Ghost" (layer "F.Cu") (at 0 0)
          (model "x.wrl" (opacity 0.4) (offset (xyz 0 0 0))))
        (footprint "Test:Solid" (layer "F.Cu") (at 5 0)
          (model "y.wrl" (offset (xyz 0 0 0)))))`),
    );
    expect(b.footprints[0]!.models[0]!.opacity).toBeCloseTo(0.4);
    expect(b.footprints[1]!.models[0]!.opacity).toBeUndefined();
  });
});
