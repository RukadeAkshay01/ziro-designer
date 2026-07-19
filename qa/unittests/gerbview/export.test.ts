import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { parseGerber } from '@ziroeda/gerbview';
import { exportLayersToPcb } from '@ziroeda/designer/src/editors/gerbview/exportToPcbnew.js';

describe('export to Pcbnew', () => {
  it('produces a board file the pcbnew reader can parse', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Copper,L1,Top*%',
      '%ADD10C,0.5*%',
      '%ADD11R,1X0.6*%',
      'D10*',
      'X0Y0D03*',
      'D11*',
      'X2000000Y0D03*',
      'D10*',
      'G01*',
      'X0Y0D02*',
      'X5000000Y0D01*',
      'G03*',
      'X8000000Y0I1500000J0D01*',
      'G36*',
      'X10000000Y0D02*',
      'X12000000Y0D01*',
      'X12000000Y2000000D01*',
      'X10000000Y2000000D01*',
      'G37*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'top.gbr');
    const text = exportLayersToPcb([{ image: img, name: 'top' }]);
    // The exported board parses and yields graphic items on F.Cu.
    const board = readBoard(parse(text));
    expect(board.layers.some((l) => l.name === 'F.Cu')).toBe(true);
    expect(board.shapes.length).toBeGreaterThan(0);
    expect(board.shapes.some((s) => s.layer === 'F.Cu')).toBe(true);
  });
});
