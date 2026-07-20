import { describe, expect, it } from 'vitest';
import {
  parseGerber,
  parseExcellon,
  readGerberOrDrill,
  isExcellonFile,
  parseJobFile,
  GBR_BASIC_SHAPE,
  APERTURE_T,
  IU_PER_MM,
} from '@ziroeda/gerbview';

const nearlyMM = (iu: number): number => iu / IU_PER_MM;

describe('RS-274X Gerber parser', () => {
  it('parses a simple flash + trace in mm', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.5*%',
      '%ADD11R,1X0.5*%',
      'D10*',
      'X0Y0D03*',
      'X5000000Y0D03*',
      'D11*',
      'G01*',
      'X0Y0D02*',
      'X10000000Y0D01*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'top.gbr');
    expect(img.unit).toBe('mm');
    // two flashes + one segment
    const flashes = img.items.filter((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE);
    const rects = img.items.filter((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_RECT);
    const segs = img.items.filter((it) => it.shape === GBR_BASIC_SHAPE.GBR_SEGMENT);
    expect(flashes).toHaveLength(2);
    expect(rects).toHaveLength(0); // second flash uses D11 rect after D11 select
    expect(segs).toHaveLength(1);
    // first flash at (0,0)
    expect(flashes[0]!.start.x).toBe(0);
    // second flash at x=5mm
    expect(nearlyMM(flashes[1]!.start.x)).toBeCloseTo(5, 5);
    // trace width 1mm
    expect(nearlyMM(segs[0]!.width)).toBeCloseTo(1, 5);
  });

  it('handles a filled region (G36/G37)', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      'G36*',
      'X0Y0D02*',
      'X0Y5000000D01*',
      'X5000000Y5000000D01*',
      'X5000000Y0D01*',
      'X0Y0D01*',
      'G37*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'poly.gbr');
    const polys = img.items.filter((it) => it.shape === GBR_BASIC_SHAPE.GBR_POLYGON);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.polyPoints.length).toBeGreaterThanOrEqual(4);
  });

  it('resolves an aperture macro into shapes', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%AMDONUT*',
      '1,1,$1,0,0*',
      '1,0,$2,0,0*%',
      '%ADD20DONUT,2X1*%',
      'D20*',
      'X0Y0D03*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'macro.gbr');
    const flash = img.items.find((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_MACRO);
    expect(flash).toBeTruthy();
    const shapes = flash!.resolveFlashShapes();
    // outer on-circle radius 1mm, inner off-circle radius 0.5mm
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.exposure).toBe(true);
    expect(shapes[1]!.exposure).toBe(false);
  });

  it('applies step and repeat', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.5*%',
      'D10*',
      '%SRX2Y1I10.0J0*%',
      'X0Y0D03*',
      '%SR*%',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'sr.gbr');
    const flashes = img.items.filter((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE);
    expect(flashes).toHaveLength(2);
    expect(nearlyMM(flashes[1]!.start.x)).toBeCloseTo(10, 5);
  });
});

describe('Excellon drill parser', () => {
  it('parses tool table and hits', () => {
    const d = [
      'M48',
      'METRIC,TZ',
      'T1C0.800',
      'T2C1.000',
      '%',
      'G90',
      'G05',
      'T1',
      'X10000Y10000',
      'X20000Y10000',
      'T2',
      'X30000Y30000',
      'M30',
    ].join('\n');
    expect(isExcellonFile(d, 'drill.drl')).toBe(true);
    const img = parseExcellon(d, 'drill.drl');
    const holes = img.items.filter((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE);
    expect(holes).toHaveLength(3);
  });
});

describe('file-type detection', () => {
  it('routes gerber vs drill', () => {
    const gerber = '%FSLAX46Y46*%\n%MOMM*%\nM02*';
    expect(isExcellonFile(gerber, 'x.gbr')).toBe(false);
    const img = readGerberOrDrill(gerber, 'x.gbr');
    expect(img.unit).toBe('mm');
    // Source text is retained for reload.
    expect(img.rawText).toBe(gerber);
  });
});

describe('aperture shapes', () => {
  const withAperture = (adBody: string, flashLine = 'X0Y0D03*'): ReturnType<typeof parseGerber> =>
    parseGerber(
      ['%FSLAX46Y46*%', '%MOMM*%', `%ADD10${adBody}*%`, 'D10*', flashLine, 'M02*'].join('\n'),
      't.gbr',
    );

  it('rectangle flash resolves to a filled polygon with a size', () => {
    const img = withAperture('R,2X1');
    const flash = img.items.find((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_RECT)!;
    expect(flash.dcode!.shape).toBe(APERTURE_T.APT_RECT);
    const shapes = flash.resolveFlashShapes();
    expect(shapes[0]!.kind).toBe('polygon');
  });

  it('obround flash resolves to a capsule', () => {
    const img = withAperture('O,2X1');
    const flash = img.items.find((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_OVAL)!;
    const shapes = flash.resolveFlashShapes();
    expect(shapes[0]!.kind).toBe('segment');
  });

  it('polygon aperture resolves to N vertices', () => {
    const img = withAperture('P,2X6X0');
    const flash = img.items.find((it) => it.shape === GBR_BASIC_SHAPE.GBR_SPOT_POLY)!;
    const shapes = flash.resolveFlashShapes();
    expect(shapes[0]!.kind).toBe('polygon');
    if (shapes[0]!.kind === 'polygon') expect(shapes[0]!.points).toHaveLength(6);
  });

  it('circle with a round hole clears the centre', () => {
    const img = withAperture('C,1X0.4');
    const flash = img.items[0]!;
    const shapes = flash.resolveFlashShapes();
    expect(shapes).toHaveLength(2);
    expect(shapes[1]!.exposure).toBe(false); // the hole
  });
});

describe('polarity, arcs and negative images', () => {
  it('records clear polarity (LPC) on items', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,1*%',
      'D10*',
      '%LPC*%',
      'X0Y0D03*',
      '%LPD*%',
      'X2000000Y0D03*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 't.gbr');
    expect(img.items[0]!.layerPolarity).toBe(false);
    expect(img.items[1]!.layerPolarity).toBe(true);
  });

  it('flags a negative image (IP NEG)', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%IPNEG*%',
      '%ADD10C,1*%',
      'D10*',
      'X0Y0D03*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 't.gbr');
    expect(img.imageNegative).toBe(true);
  });

  it('parses a CCW arc and records direction', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.2*%',
      'D10*',
      'G03*',
      'X0Y0D02*',
      'X2000000Y0I1000000J0D01*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 't.gbr');
    const arc = img.items.find((it) => it.shape === GBR_BASIC_SHAPE.GBR_ARC)!;
    expect(arc).toBeTruthy();
    expect(arc.arcCcw).toBe(true);
  });
});

describe('X2 attributes and job files', () => {
  it('captures net metadata on items', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,1*%',
      '%TO.N,GND*%',
      'D10*',
      'X0Y0D03*',
      '%TD*%',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 't.gbr');
    expect(img.items[0]!.netMetadata.netName).toBe('GND');
  });

  it('parses a gbrjob file', () => {
    const job = JSON.stringify({
      FilesAttributes: [
        { Path: 'board-F_Cu.gbr', FileFunction: 'Copper,L1,Top', FilePolarity: 'Positive' },
      ],
    });
    const entries = parseJobFile(job);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fileFunction).toContain('Copper');
  });
});
