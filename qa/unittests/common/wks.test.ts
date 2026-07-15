import { describe, it, expect } from 'vitest';
import {
  parseDrawingSheet,
  serializeDrawingSheet,
  defaultDrawingSheet,
  layoutDrawingSheet,
  resolveDrawingSheetText,
  incrementLabel,
  translateItem,
  type WksSheet,
  type WksText,
  type DsTextItem,
  type DsLineItem,
} from '@ziroeda/common/src/drawing_sheet/index.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const A4 = { widthMM: 297, heightMM: 210 };

describe('drawing sheet reader/writer', () => {
  it('round-trips the default sheet semantically', () => {
    const sheet = defaultDrawingSheet();
    const text = serializeDrawingSheet(sheet);
    const back = parseDrawingSheet(text);
    expect(back.setup).toEqual(sheet.setup);
    expect(back.items.length).toBe(sheet.items.length);
    // Each item survives a parse → serialize → parse cycle unchanged.
    const text2 = serializeDrawingSheet(back);
    expect(text2).toBe(text);
  });

  it('reads a hand-written .kicad_wks', () => {
    const src = `(kicad_wks (version 20220228) (generator "pl_editor")
      (setup (textsize 1.5 1.5)(linewidth 0.15)(textlinewidth 0.15)
        (left_margin 10)(right_margin 10)(top_margin 10)(bottom_margin 10))
      (rect (name "b") (start 0 0 ltcorner) (end 0 0 rbcorner))
      (line (name "seg") (start 110 5) (end 0 5))
      (tbtext "Rev: \${REVISION}" (name "rev") (pos 100 6 rbcorner)
        (font (size 2 2)(bold yes)) (justify left) (repeat 3)(incrx 0)(incry 4)(incrlabel 1)))`;
    const sheet = parseDrawingSheet(src);
    expect(sheet.items).toHaveLength(3);
    const rect = sheet.items[0]!,
      line = sheet.items[1]!,
      text = sheet.items[2]!;
    expect(rect.type).toBe('rect');
    expect(line.type).toBe('line');
    expect((line as any).start.corner).toBe('rbcorner'); // omitted corner defaults to rbcorner
    expect(text.type).toBe('text');
    const t = text as WksText;
    expect(t.bold).toBe(true);
    expect(t.hjustify).toBe('left');
    expect(t.repeat).toBe(3);
    expect(t.incry).toBe(4);
    expect(t.fontH).toBe(2);
  });
});

describe('corner anchoring', () => {
  const sheet: WksSheet = {
    version: 20220228,
    generator: 'pl_editor',
    setup: {
      textW: 1.5,
      textH: 1.5,
      lineWidth: 0.15,
      textLineWidth: 0.15,
      leftMargin: 10,
      rightMargin: 10,
      topMargin: 10,
      bottomMargin: 10,
    },
    items: [
      {
        type: 'line',
        name: 't',
        option: 'normal',
        repeat: 1,
        incrx: 0,
        incry: 0,
        incrlabel: 1,
        comment: '',
        start: { x: 0, y: 0, corner: 'ltcorner' },
        end: { x: 0, y: 0, corner: 'rbcorner' },
        lineWidth: 0,
      },
    ],
  };

  it('resolves lt/rb corners to the margin box', () => {
    const d = (layoutDrawingSheet(sheet, A4) as DsLineItem[])[0]!;
    // lt corner (0,0) → (left, top) margin = (10,10) mm
    expect(d.a).toEqual({ x: mmToIU(10), y: mmToIU(10) });
    // rb corner (0,0) → (right, bottom) margin = (297-10, 210-10)
    expect(d.b).toEqual({ x: mmToIU(287), y: mmToIU(200) });
  });
});

describe('repeats', () => {
  it('emits repeated copies offset by the increment vector', () => {
    const sheet: WksSheet = {
      version: 20220228,
      generator: 'pl_editor',
      setup: {
        textW: 1.5,
        textH: 1.5,
        lineWidth: 0.15,
        textLineWidth: 0.15,
        leftMargin: 10,
        rightMargin: 10,
        topMargin: 10,
        bottomMargin: 10,
      },
      items: [
        {
          type: 'text',
          name: 'r',
          option: 'normal',
          repeat: 3,
          incrx: 0,
          incry: 4,
          incrlabel: 1,
          comment: '',
          text: '1',
          pos: { x: 20, y: 5, corner: 'lbcorner' },
          fontW: 1.5,
          fontH: 1.5,
          bold: false,
          italic: false,
          lineWidth: 0,
          hjustify: 'left',
          vjustify: 'center',
          rotate: 0,
          maxlen: 0,
          maxheight: 0,
        },
      ],
    };
    const draws = layoutDrawingSheet(sheet, A4) as DsTextItem[];
    expect(draws).toHaveLength(3);
    expect(draws.map((d) => d.text)).toEqual(['1', '2', '3']); // incrlabel
    // lb corner y measured up from bottom: y grows → page-y shrinks
    expect(draws[0]!.at.y).toBe(mmToIU(200 - 5));
    expect(draws[1]!.at.y).toBe(mmToIU(200 - 9));
    expect(draws[2]!.at.y).toBe(mmToIU(200 - 13));
  });
});

describe('text variables', () => {
  it('expands the standard tokens', () => {
    const ctx = {
      title: 'My Board',
      rev: 'A',
      date: '2026-07-12',
      paper: 'A4',
      company: 'Acme',
      comments: ['hello'],
      pageNumber: 2,
      sheetCount: 5,
    };
    expect(resolveDrawingSheetText('Title: ${TITLE}', ctx)).toBe('Title: My Board');
    expect(resolveDrawingSheetText('Rev: ${REVISION}', ctx)).toBe('Rev: A');
    expect(resolveDrawingSheetText('${#}/${##}', ctx)).toBe('2/5');
    expect(resolveDrawingSheetText('${COMMENT1}', ctx)).toBe('hello');
    expect(resolveDrawingSheetText('${UNKNOWN}', ctx)).toBe('${UNKNOWN}'); // left intact
  });
});

describe('page filtering', () => {
  const base = {
    name: '',
    option: 'normal' as const,
    repeat: 1,
    incrx: 0,
    incry: 0,
    incrlabel: 1,
    comment: '',
  };
  const mk = (option: 'normal' | 'page1only' | 'notonpage1'): WksSheet => ({
    version: 20220228,
    generator: 'pl_editor',
    setup: {
      textW: 1.5,
      textH: 1.5,
      lineWidth: 0.15,
      textLineWidth: 0.15,
      leftMargin: 10,
      rightMargin: 10,
      topMargin: 10,
      bottomMargin: 10,
    },
    items: [
      {
        ...base,
        option,
        type: 'line',
        start: { x: 0, y: 0, corner: 'ltcorner' },
        end: { x: 1, y: 1, corner: 'ltcorner' },
        lineWidth: 0,
      },
    ],
  });
  it('drops page1only on page 2 and notonpage1 on page 1', () => {
    expect(layoutDrawingSheet(mk('page1only'), A4, { pageNumber: 1 })).toHaveLength(1);
    expect(layoutDrawingSheet(mk('page1only'), A4, { pageNumber: 2 })).toHaveLength(0);
    expect(layoutDrawingSheet(mk('notonpage1'), A4, { pageNumber: 1 })).toHaveLength(0);
    expect(layoutDrawingSheet(mk('notonpage1'), A4, { pageNumber: 2 })).toHaveLength(1);
  });
});

describe('incrementLabel', () => {
  it('increments trailing numbers and letters', () => {
    expect(incrementLabel('1', 1)).toBe('2');
    expect(incrementLabel('Pin9', 1)).toBe('Pin10');
    expect(incrementLabel('A', 1)).toBe('B');
    expect(incrementLabel('', 1)).toBe('');
  });
});

describe('translateItem (corner-aware move)', () => {
  it('moves a right-bottom-anchored point inward for a +x/+y page delta', () => {
    const sheet = defaultDrawingSheet();
    const idx = sheet.items.findIndex((i) => i.type === 'text' && i.pos.corner === 'rbcorner');
    const t = sheet.items[idx] as WksText;
    const moved = translateItem(t, { x: mmToIU(5), y: mmToIU(3) }) as WksText;
    // rb corner: page +x → item x decreases; page +y → item y decreases
    expect(moved.pos.x).toBeCloseTo(t.pos.x - 5, 6);
    expect(moved.pos.y).toBeCloseTo(t.pos.y - 3, 6);
  });
});

describe('format details (upstream parser/writer parity)', () => {
  const HDR = `(kicad_wks (version 20231118) (generator "pl_editor") (generator_version "10.0")
    (setup (textsize 1.5 1.5)(linewidth 0.15)(textlinewidth 0.15)
      (left_margin 10)(right_margin 10)(top_margin 10)(bottom_margin 10))`;

  it('defaults justification to left/center; center token centers both axes', () => {
    const s = parseDrawingSheet(`${HDR}
      (tbtext "a" (name "") (pos 1 1))
      (tbtext "b" (name "") (pos 1 1) (justify center))
      (tbtext "c" (name "") (pos 1 1) (justify right bottom)))`);
    const [a, b, c] = s.items as WksText[];
    expect([a!.hjustify, a!.vjustify]).toEqual(['left', 'center']);
    expect([b!.hjustify, b!.vjustify]).toEqual(['center', 'center']);
    expect([c!.hjustify, c!.vjustify]).toEqual(['right', 'bottom']);
  });

  it('reads bare bold/italic atoms, face and color from (font …)', () => {
    const s = parseDrawingSheet(
      `${HDR} (tbtext "t" (name "") (pos 0 0) (font (face "Arial") (size 2 3) bold italic (color 255 0 0 0.5))))`,
    );
    const t = s.items[0] as WksText;
    expect(t.bold).toBe(true);
    expect(t.italic).toBe(true);
    expect(t.face).toBe('Arial');
    expect(t.fontW).toBe(2);
    expect(t.fontH).toBe(3);
    expect(t.color).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it('writes bare bold atoms, generator_version, and justify only when non-default', () => {
    const sheet = defaultDrawingSheet();
    const out = serializeDrawingSheet(sheet);
    expect(out).toContain('(generator_version "10.0"');
    expect(out).toContain('bold');
    expect(out).not.toContain('(bold yes)');
    // default left/center justification is never written
    expect(out).not.toContain('(justify left)');
  });

  it('round-trips bitmap data as base64 (data …) chunks and skips empty bitmaps', () => {
    const png64 = 'iVBORw0KGgoAAAANSUhEUg=='; // arbitrary base64 payload
    const sheet: WksSheet = {
      ...defaultDrawingSheet(),
      items: [
        {
          type: 'bitmap',
          name: '',
          option: 'normal',
          repeat: 1,
          incrx: 0,
          incry: 0,
          incrlabel: 1,
          comment: '',
          pos: { x: 10, y: 10, corner: 'ltcorner' },
          scale: 2,
          pngB64: png64,
          ppi: 300,
        },
        {
          type: 'bitmap',
          name: 'empty',
          option: 'normal',
          repeat: 1,
          incrx: 0,
          incry: 0,
          incrlabel: 1,
          comment: '',
          pos: { x: 0, y: 0, corner: 'rbcorner' },
          scale: 1,
          pngB64: '',
          ppi: 300,
        },
      ],
    };
    const out = serializeDrawingSheet(sheet);
    expect(out).toContain('(data "');
    const back = parseDrawingSheet(out);
    expect(back.items).toHaveLength(1); // the payload-less bitmap is not saved
    expect((back.items[0] as { pngB64: string }).pngB64).toBe(png64);
    expect((back.items[0] as { scale: number }).scale).toBe(2);
  });

  it('converts legacy hex pngdata to base64 on read', () => {
    const s = parseDrawingSheet(
      `${HDR} (bitmap (name "") (pos 0 0) (scale 1) (pngdata (data "89504E47") (data "0D0A1A0A"))))`,
    );
    const b = s.items[0] as { pngB64: string };
    expect(b.pngB64).toBe('iVBORw0KGgo='); // 89 50 4E 47 0D 0A 1A 0A
  });
});

describe('layout parity', () => {
  it('clips repeats that leave the margin box (coordinate band)', () => {
    const sheet = defaultDrawingSheet();
    const draws = layoutDrawingSheet(sheet, A4);
    // "1"-labels repeat 100× at 50 mm steps, but A4 fits only a handful.
    const texts = draws.filter((d) => d.kind === 'text' && /^\d+$/.test(d.text));
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.length).toBeLessThan(50);
  });

  it('shrinks text to maxlen proportionally, never grows it', () => {
    const sheet = defaultDrawingSheet();
    const long: WksText = {
      type: 'text',
      name: '',
      option: 'normal',
      repeat: 1,
      incrx: 0,
      incry: 0,
      incrlabel: 1,
      comment: '',
      text: 'a very very long text run',
      pos: { x: 100, y: 100, corner: 'ltcorner' },
      fontW: 2,
      fontH: 2,
      bold: false,
      italic: false,
      lineWidth: 0,
      hjustify: 'left',
      vjustify: 'center',
      rotate: 0,
      maxlen: 5,
      maxheight: 0,
    };
    const draws = layoutDrawingSheet({ ...sheet, items: [long] }, A4) as DsTextItem[];
    expect(draws[0]!.w).toBeLessThan(mmToIU(2)); // squeezed below nominal width
    expect(draws[0]!.h).toBe(mmToIU(2)); // height untouched by maxlen
    const short = { ...long, text: 'a', maxlen: 50 };
    const draws2 = layoutDrawingSheet({ ...sheet, items: [short] }, A4) as DsTextItem[];
    expect(draws2[0]!.w).toBe(mmToIU(2)); // never grows
  });

  it('expands \\n escapes and never label-increments multiline text', () => {
    expect(incrementLabel('A9', 1)).toBe('A10'); // last char only, digit → int
    const sheet = defaultDrawingSheet();
    const multi: WksText = {
      type: 'text',
      name: '',
      option: 'normal',
      repeat: 2,
      incrx: 5,
      incry: 0,
      incrlabel: 1,
      comment: '',
      text: 'two\\nlines',
      pos: { x: 100, y: 100, corner: 'ltcorner' },
      fontW: 2,
      fontH: 2,
      bold: false,
      italic: false,
      lineWidth: 0,
      hjustify: 'left',
      vjustify: 'center',
      rotate: 0,
      maxlen: 0,
      maxheight: 0,
    };
    const draws = layoutDrawingSheet({ ...sheet, items: [multi] }, A4) as DsTextItem[];
    expect(draws[0]!.text).toBe('two\nlines');
    expect(draws[1]!.text).toBe('two\nlines'); // repeat did not increment
  });

  it('uses bold pen = min(w,h)/5', () => {
    const sheet = defaultDrawingSheet();
    const bold: WksText = {
      type: 'text',
      name: '',
      option: 'normal',
      repeat: 1,
      incrx: 0,
      incry: 0,
      incrlabel: 1,
      comment: '',
      text: 'B',
      pos: { x: 50, y: 50, corner: 'ltcorner' },
      fontW: 2,
      fontH: 3,
      bold: true,
      italic: false,
      lineWidth: 0,
      hjustify: 'left',
      vjustify: 'center',
      rotate: 0,
      maxlen: 0,
      maxheight: 0,
    };
    const draws = layoutDrawingSheet({ ...sheet, items: [bold] }, A4) as DsTextItem[];
    expect(draws[0]!.thickness).toBe(mmToIU(2 / 5));
  });
});
