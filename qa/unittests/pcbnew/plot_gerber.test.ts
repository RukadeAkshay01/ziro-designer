import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { setBoardPageSettings } from '@ziroeda/pcbnew/src/edit-board.js';
import {
  plotGerberLayer,
  plotExcellonDrill,
  gerberProtelExtension,
} from '@ziroeda/pcbnew/src/plot_gerber.js';

const BOARD = `(kicad_pcb (version 20241229) (generator x)
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "") (net 1 "GND")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "t1"))
  (via (at 20 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))
  (footprint "R" (layer "F.Cu") (uuid "f1") (at 30 10)
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask") (net 1 "GND"))
  )
  (gr_line (start 0 0) (end 50 0) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts") (uuid "e1"))
)`;

describe('Gerber X2 plot (GERBER_PLOTTER / pcbplot.cpp)', () => {
  const board = readBoard(parse(BOARD));
  it('writes the exact X2 header for F.Cu', () => {
    const out = plotGerberLayer(board, 'F.Cu');
    expect(out).toContain('%TF.FileFunction,Copper,L1,Top*%');
    expect(out).toContain('%TF.FilePolarity,Positive*%');
    expect(out).toContain('%FSLAX46Y46*%');
    expect(out).toContain('%MOMM*%');
    expect(out).toContain('%LPD*%');
    expect(out.trim().endsWith('M02*')).toBe(true);
  });
  it('strokes the track with a 4.6 mm coordinate pair (Y negated)', () => {
    const out = plotGerberLayer(board, 'F.Cu');
    // (10,10)mm -> X10000000 Y-10000000; track width 0.25 aperture.
    expect(out).toContain('C,0.250000');
    expect(out).toContain('X10000000Y-10000000D02*');
    expect(out).toContain('X20000000Y-10000000D01*');
  });
  it('flashes the via and the round pad', () => {
    const out = plotGerberLayer(board, 'F.Cu');
    expect(out).toContain('C,0.800000'); // via
    expect(out).toContain('C,1.700000'); // pad
    expect(out).toContain('X30000000Y-10000000D03*');
  });
  it('Edge.Cuts is Profile,NP and carries the outline stroke', () => {
    const out = plotGerberLayer(board, 'Edge.Cuts');
    expect(out).toContain('%TF.FileFunction,Profile,NP*%');
    expect(out).toContain('X50000000Y0D01*');
  });
  it('B.Cu names the bottom copper with the stack count; Protel extensions map', () => {
    expect(plotGerberLayer(board, 'B.Cu')).toContain('%TF.FileFunction,Copper,L2,Bot*%');
    expect(gerberProtelExtension('F.Cu')).toBe('gtl');
    expect(gerberProtelExtension('B.Mask')).toBe('gbs');
    expect(gerberProtelExtension('Cmts.User')).toBe('gbr');
  });
});

describe('Excellon drill (GENDRILL_EXCELLON_WRITER)', () => {
  const board = readBoard(parse(BOARD));
  it('writes the M48 header, metric tools and decimal coordinates', () => {
    const out = plotExcellonDrill(board);
    expect(out.startsWith('M48\n')).toBe(true);
    expect(out).toContain('FMAT,2');
    expect(out).toContain('METRIC');
    expect(out).toContain('T1C0.400'); // via drill
    expect(out).toContain('T2C1.000'); // pad drill
    expect(out).toContain('X20.0Y-10.0'); // via at (20,10)
    expect(out).toContain('X30.0Y-10.0'); // pad at (30,10)
    expect(out.trim().endsWith('M30')).toBe(true);
  });
});

describe('page settings (DIALOG_PAGES_SETTINGS persistence)', () => {
  it('upserts (paper) and (title_block) into the source and round-trips', () => {
    const board = readBoard(parse(BOARD));
    const next = setBoardPageSettings(board, {
      paper: 'A3',
      title: 'Amp',
      date: '2026-07-23',
      rev: '1.1',
      company: 'ZiroEDA',
      comments: ['first', '', 'third', '', '', '', '', '', ''],
    });
    const out = serializeBoard(next);
    expect(out).toContain('(paper "A3")');
    expect(out).toContain('(title "Amp")');
    expect(out).toContain('(comment 1 "first")');
    expect(out).toContain('(comment 3 "third")');
    const reread = readBoard(parse(out));
    expect(reread.paper).toBe('A3');
    expect(reread.titleBlock?.rev).toBe('1.1');
    expect(reread.titleBlock?.comments?.[2]).toBe('third');
  });
  it('portrait and User sizes keep their tokens', () => {
    const board = readBoard(parse(BOARD));
    const p1 = setBoardPageSettings(board, {
      paper: 'A4 portrait',
      title: '',
      date: '',
      rev: '',
      company: '',
      comments: [],
    });
    expect(serializeBoard(p1)).toContain('(paper "A4" portrait)');
    const p2 = setBoardPageSettings(board, {
      paper: 'User 200 150',
      title: '',
      date: '',
      rev: '',
      company: '',
      comments: [],
    });
    expect(serializeBoard(p2)).toContain('(paper "User" 200 150)');
  });
});
