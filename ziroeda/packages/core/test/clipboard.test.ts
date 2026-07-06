/**
 * Box selection (SCH_SELECTION_TOOL::SelectMultiple) and copy/paste
 * (SCH_EDITOR_CONTROL::doCopy / Paste) ports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '../src/sexpr/index.js';
import { readSchematic, writeSchematic } from '../src/model/index.js';
import { mmToIU } from '../src/units.js';
import { boxSelect } from '../src/edit/boxselect.js';
import { copySelectionText, parsePastedText, translatePayload, pasteItems } from '../src/edit/clipboard.js';
import { refId } from '../src/edit/hittest.js';
import { symbolBodyBBox } from '../src/edit/bbox.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/nfc-antenna.kicad_sch', import.meta.url)),
  'utf8',
);

const sch = () => readSchematic(parse(fixture));

describe('boxSelect (SelectMultiple port)', () => {
  it('left-to-right selects only fully-contained items', () => {
    const doc = sch();
    const sym = doc.symbols[0]!;
    const body = symbolBodyBBox(sym, new Map(doc.libSymbols.map((l) => [l.libId, l])).get(sym.libId));
    const pad = mmToIU(1);

    // A window that covers the whole body selects the symbol...
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const all = boxSelect(doc, libById,
      { x: body.minX - pad, y: body.minY - pad }, { x: body.maxX + pad, y: body.maxY + pad });
    expect(all.has(refId('symbol', sym.uuid, 0))).toBe(true);

    // ...but one that only covers half of it does not (contained mode).
    const half = boxSelect(doc, libById,
      { x: body.minX - pad, y: body.minY - pad },
      { x: (body.minX + body.maxX) / 2, y: body.maxY + pad });
    expect(half.has(refId('symbol', sym.uuid, 0))).toBe(false);
  });

  it('right-to-left is greedy: touching the body is enough', () => {
    const doc = sch();
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const sym = doc.symbols[0]!;
    const body = symbolBodyBBox(sym, libById.get(sym.libId));
    const pad = mmToIU(1);
    // Same half-covering box, but dragged right-to-left (origin.x > end.x).
    const ids = boxSelect(doc, libById,
      { x: (body.minX + body.maxX) / 2, y: body.minY - pad },
      { x: body.minX - pad, y: body.maxY + pad });
    expect(ids.has(refId('symbol', sym.uuid, 0))).toBe(true);
  });

  it('contained mode requires both wire endpoints inside; greedy needs a crossing', () => {
    // A synthetic horizontal wire from (10,10) to (30,10) mm.
    const src = `(kicad_sch (version 20230121) (generator eeschema) (lib_symbols)
      (wire (pts (xy 10 10) (xy 30 10)) (uuid "w-1")))`;
    const doc = readSchematic(parse(src));
    const libById = new Map<string, never>();
    const minY = mmToIU(9), maxY = mmToIU(11);
    const left = mmToIU(9), midX = mmToIU(20);

    // Window over only half the wire: not selected.
    const win = boxSelect(doc, libById, { x: left, y: minY }, { x: midX, y: maxY });
    expect(win.has('w-1')).toBe(false);
    // Same box dragged right-to-left: crossing selects the whole wire.
    const greedy = boxSelect(doc, libById, { x: midX, y: minY }, { x: left, y: maxY });
    expect(greedy.has('w-1')).toBe(true);
    // A window over the whole wire selects it.
    const all = boxSelect(doc, libById, { x: left, y: minY }, { x: mmToIU(31), y: maxY });
    expect(all.has('w-1')).toBe(true);
  });
});

describe('copy/paste (doCopy / Paste port)', () => {
  it('copies KiCad clipboard format: lib_symbols + bare items', () => {
    const doc = sch();
    const id = refId('symbol', doc.symbols[0]!.uuid, 0);
    const text = copySelectionText(doc, new Set([id]));
    expect(text.startsWith('(lib_symbols')).toBe(true);
    expect(text).toContain('(symbol');
    expect(text).toContain('(lib_id "Connector_Generic:Conn_01x02")');
    // No kicad_sch wrapper — this is what desktop KiCad puts on the clipboard.
    expect(text.startsWith('(kicad_sch')).toBe(false);
  });

  it('pastes with fresh uuids and a re-annotated duplicate reference', () => {
    const doc = sch();
    const sym = doc.symbols[0]!;
    const text = copySelectionText(doc, new Set([refId('symbol', sym.uuid, 0)]));
    const payload = parsePastedText(text, doc)!;
    expect(payload).not.toBeNull();
    expect(payload.batch.symbols.length).toBe(1);

    const pasted = payload.batch.symbols[0]!;
    expect(pasted.uuid).toBeDefined();
    expect(pasted.uuid).not.toBe(sym.uuid);

    // J1 already exists -> the pasted copy gets the first free J number.
    const ref = pasted.fields.find((f) => f.key === 'Reference')!;
    expect(ref.value).not.toBe('J1');
    expect(ref.value).toMatch(/^J\d+$/);

    // Committing the paste adds the symbol; undo removes it exactly.
    const moved = translatePayload(payload, { x: mmToIU(10), y: 0 });
    const cmd = pasteItems(moved);
    const next = cmd.apply(doc);
    expect(next.symbols.length).toBe(doc.symbols.length + 1);
    const text2 = serialize(writeSchematic(next));
    expect(text2).toContain(`"${ref.value}"`);

    const undone = cmd.invert(doc).apply(next);
    expect(serialize(writeSchematic(undone))).toBe(serialize(writeSchematic(doc)));
  });

  it('round-trips through desktop-KiCad-style clipboard text including wires', () => {
    const doc = sch();
    const ids = new Set<string>();
    doc.lines.forEach((l, i) => { if (l.kind === 'wire') ids.add(refId('line', l.uuid, i)); });
    const text = copySelectionText(doc, ids);
    const payload = parsePastedText(text, doc)!;
    expect(payload.batch.lines.length).toBe([...ids].length);
    // Every pasted wire has a fresh uuid distinct from every original.
    const originals = new Set(doc.lines.map((l) => l.uuid));
    for (const l of payload.batch.lines) expect(originals.has(l.uuid)).toBe(false);
  });

  it('pastes non-schematic text as a text item (KiCad IO_ERROR fallback)', () => {
    const doc = sch();
    const payload = parsePastedText('hello world', doc)!;
    expect(payload.batch.labels.length).toBe(1);
    expect(payload.batch.labels[0]!.kind).toBe('text');
    expect(payload.batch.labels[0]!.text).toBe('hello world');
  });

  it('does not duplicate lib_symbols the sheet already has', () => {
    const doc = sch();
    const text = copySelectionText(doc, new Set([refId('symbol', doc.symbols[0]!.uuid, 0)]));
    const payload = parsePastedText(text, doc)!;
    expect(payload.libs.length).toBe(0); // Conn_01x02 already embedded
    const next = pasteItems(payload).apply(doc);
    expect(next.libSymbols.length).toBe(doc.libSymbols.length);
  });
});
