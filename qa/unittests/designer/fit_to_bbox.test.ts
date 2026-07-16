/**
 * Zoom to Selected Objects viewport math (fitToBBox): the box (plus padding)
 * is centred and scaled to fit the canvas.
 */
import { describe, it, expect } from 'vitest';
import { fitToBBox } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';

describe('fitToBBox', () => {
  it('centres the box in the canvas', () => {
    const vp = fitToBBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 800, 600);
    // Box centre (50,50) maps to the canvas centre (400,300).
    expect(vp.offsetX + 50 * vp.scale).toBeCloseTo(400);
    expect(vp.offsetY + 50 * vp.scale).toBeCloseTo(300);
  });

  it('scales to the tighter axis so the whole box (plus padding) is visible', () => {
    const wide = fitToBBox({ minX: 0, minY: 0, maxX: 1000, maxY: 10 }, 800, 600);
    const tall = fitToBBox({ minX: 0, minY: 0, maxX: 10, maxY: 1000 }, 800, 600);
    // A wide box is width-limited; a tall box is height-limited — both positive.
    expect(wide.scale).toBeGreaterThan(0);
    expect(tall.scale).toBeGreaterThan(0);
    // The padded 1000-unit span must fit within the 800 px axis.
    expect(1000 * wide.scale).toBeLessThanOrEqual(800);
  });
});
