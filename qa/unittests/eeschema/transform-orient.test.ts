import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  rotateOrientation,
  mirrorOrientation,
  symbolTransform,
  orientationFromTransform,
  type Orientation,
} from '@ziroeda/common/src/transform.js';
import { transformItems } from '@ziroeda/eeschema/src/tools/transform.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';

describe('orientation algebra (KiCad SetOrientation/GetOrientation)', () => {
  it('four CCW rotations return to the original orientation', () => {
    let o: Orientation = { angle: 0 };
    for (let i = 0; i < 4; i++) o = rotateOrientation(o);
    expect(o.angle).toBe(0);
    expect(o.mirror).toBeUndefined();
  });

  it('CCW then CW is identity', () => {
    const o = rotateOrientation(rotateOrientation({ angle: 90, mirror: 'x' }), true);
    expect(o).toEqual({ angle: 90, mirror: 'x' });
  });

  it('a mirror is its own inverse', () => {
    expect(mirrorOrientation(mirrorOrientation({ angle: 0 }, 'x'), 'x')).toEqual({ angle: 0 });
    expect(mirrorOrientation(mirrorOrientation({ angle: 90 }, 'y'), 'y')).toEqual({ angle: 90 });
  });

  it('every decomposed orientation reproduces its transform', () => {
    for (const angle of [0, 90, 180, 270]) {
      for (const mirror of [undefined, 'x', 'y'] as const) {
        const t = symbolTransform(angle, mirror);
        const o = orientationFromTransform(t);
        expect(symbolTransform(o.angle, o.mirror)).toEqual(t);
      }
    }
  });

  it('mirror X equals two mirror-Y composed with a 180° rotation (D4 relation)', () => {
    // MIRROR_X == MIRROR_Y ∘ ROT_180 in KiCad's group.
    const viaX = mirrorOrientation({ angle: 0 }, 'x');
    const viaY180 = mirrorOrientation({ angle: 180 }, 'y');
    expect(symbolTransform(viaX.angle, viaX.mirror)).toEqual(
      symbolTransform(viaY180.angle, viaY180.mirror),
    );
  });
});

describe('transformItems command', () => {
  const fixture = readFileSync(
    fileURLToPath(new URL('../../data/nfc-antenna.kicad_sch', import.meta.url)),
    'utf8',
  );
  const load = () => readSchematic(parse(fixture));

  it('rotating a single symbol changes its angle but not its position', () => {
    const sch = load();
    const id = refId('symbol', sch.symbols[0]!.uuid, 0);
    const rotated = transformItems(new Set([id]), 'rotateCCW').apply(sch);
    const before = sch.symbols[0]!;
    const after = rotated.symbols[0]!;
    expect(after.at).toEqual(before.at); // single symbol rotates about itself
    const expected = rotateOrientation({ angle: before.angle, mirror: before.mirror });
    expect(after.angle).toBe(expected.angle);
    expect(after.mirror).toBe(expected.mirror);
  });

  it('round-trips through undo exactly', () => {
    const sch = load();
    const id = refId('symbol', sch.symbols[0]!.uuid, 0);
    const history = new History();
    const rotated = history.execute(sch, transformItems(new Set([id]), 'rotateCCW'));
    const undone = history.undo(rotated)!;
    expect(undone.symbols[0]!.angle).toBe(sch.symbols[0]!.angle);
    expect(undone.symbols[0]!.mirror).toBe(sch.symbols[0]!.mirror);
    expect(undone.symbols[0]!.at).toEqual(sch.symbols[0]!.at);
  });

  it('persists the new angle/mirror to the serialized file', () => {
    const sch = load();
    const id = refId('symbol', sch.symbols[0]!.uuid, 0);
    // J1 is at 180°; MirrorHorizontally (mirrorY) of it decomposes to (angle 0,
    // mirror x), exactly as KiCad's GetOrientation would — so a mirror node appears.
    const mirrored = transformItems(new Set([id]), 'mirrorY').apply(sch);
    expect(mirrored.symbols[0]!.mirror).toBe('x');
    expect(serializeSchematic(mirrored)).toMatch(/\(mirror [xy]\)/);
  });
});
