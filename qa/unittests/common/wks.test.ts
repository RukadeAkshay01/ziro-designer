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
    const idx = sheet.items.findIndex((i) => i.type === 'text');
    const t = sheet.items[idx] as WksText;
    const moved = translateItem(t, { x: mmToIU(5), y: mmToIU(3) }) as WksText;
    // rb corner: page +x → item x decreases; page +y → item y decreases
    expect(moved.pos.x).toBeCloseTo(t.pos.x - 5, 6);
    expect(moved.pos.y).toBeCloseTo(t.pos.y - 3, 6);
  });
});
