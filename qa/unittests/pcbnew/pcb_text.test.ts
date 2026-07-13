import { describe, it, expect } from 'vitest';
import { PCB_TEXT } from '@ziroeda/pcbnew/src/pcb_text.js';
import { EDA_ANGLE, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';

const mk = (): PCB_TEXT =>
  new PCB_TEXT('F.SilkS', { text: 'AB', pos: { x: 8000, y: 8000 }, size: { x: 1000, y: 1000 } });

describe('PCB_TEXT', () => {
  it('HitTest within the glyph box', () => {
    expect(mk().HitTest({ x: 8000, y: 8000 }, 0)).toBe(true);
    expect(mk().HitTest({ x: 8000, y: 9000 }, 0)).toBe(false);
  });
  it('Move / Rotate move the anchor + angle', () => {
    const t = new PCB_TEXT('F.SilkS', {
      text: 'X',
      pos: { x: 100, y: 0 },
      size: { x: 1000, y: 1000 },
    });
    t.Move({ x: 10, y: 20 });
    expect(t.GetPosition()).toEqual({ x: 110, y: 20 });
    t.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(t.GetPosition()).toEqual({ x: 20, y: -110 });
    expect(t.m_eda.GetTextAngle().AsDegrees()).toBe(90);
  });
  it('Flip left-right mirrors X, negates angle, flips layer, toggles mirrored', () => {
    const t = new PCB_TEXT('F.SilkS', {
      text: 'X',
      pos: { x: 100, y: 0 },
      angle: new EDA_ANGLE(30),
      size: { x: 1000, y: 1000 },
    });
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetPosition()).toEqual({ x: -100, y: 0 });
    expect(t.m_eda.GetTextAngle().AsDegrees()).toBe(-30);
    expect(t.GetLayer()).toBe('B.SilkS');
    expect(t.m_eda.IsMirrored()).toBe(true);
  });
});
