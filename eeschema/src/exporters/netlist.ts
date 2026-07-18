/**
 * Netlist export. Counterparts:
 *  - `eeschema/netlist_exporters/netlist_exporter_xml.cpp`
 *    (NETLIST_EXPORTER_XML, the KiCad generic XML netlist, `<export version="E">`);
 *  - `eeschema/netlist_exporters/netlist_exporter_orcadpcb2.cpp`
 *    (NETLIST_EXPORTER_ORCADPCB2, the classic OrcadPCB2 text netlist).
 *
 * Both build on the same connectivity the ERC checker uses (computeNetlist +
 * enumeratePins), so node identity matches. These operate on a single sheet —
 * the schematic the editor currently has open — like our ERC and BOM paths.
 */

import type { Schematic, SchSymbol, LibSymbol } from '../types.js';
import { computeNetlist, enumeratePins } from '../connectivity/nets.js';
import { refId } from '../tools/hittest.js';
import { compareRefs } from './bom.js';

const NETLIST_HEAD = 'Eeschema';

const field = (s: SchSymbol, key: string): string =>
  s.fields.find((f) => f.key === key)?.value ?? '';

/** A symbol that belongs on the board (excludes power/virtual and off-board parts). */
function boardSymbols(sch: Schematic): { sym: SchSymbol; ref: string; index: number }[] {
  const out: { sym: SchSymbol; ref: string; index: number }[] = [];
  sch.symbols.forEach((sym, index) => {
    const ref = field(sym, 'Reference');
    if (!ref || ref.startsWith('#') || !sym.onBoard) return;
    out.push({ sym, ref, index });
  });
  // Stable ordering by reference (KiCad sorts for file stability).
  return out.sort((a, b) => compareRefs(a.ref, b.ref));
}

/** libId "Lib:Part" -> { lib, part }. A bare id has an empty library. */
function splitLibId(libId: string): { lib: string; part: string } {
  const i = libId.indexOf(':');
  return i === -1 ? { lib: '', part: libId } : { lib: libId.slice(0, i), part: libId.slice(i + 1) };
}

// ----- KiCad generic XML netlist (version "E") --------------------------------

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A minimal XML element builder mirroring KiCad's XNODE tree. */
class X {
  children: X[] = [];
  text?: string;
  attrs: [string, string][] = [];
  constructor(public name: string) {}
  attr(k: string, v: string): this {
    this.attrs.push([k, v]);
    return this;
  }
  child(c: X): X {
    this.children.push(c);
    return c;
  }
  leaf(name: string, text: string): X {
    const n = new X(name);
    n.text = text;
    this.children.push(n);
    return n;
  }
  render(indent = ''): string {
    const a = this.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    if (this.children.length === 0 && this.text === undefined)
      return `${indent}<${this.name}${a}/>`;
    if (this.children.length === 0)
      return `${indent}<${this.name}${a}>${escapeText(this.text ?? '')}</${this.name}>`;
    const inner = this.children.map((c) => c.render(`${indent}  `)).join('\n');
    return `${indent}<${this.name}${a}>\n${inner}\n${indent}</${this.name}>`;
  }
}

export interface NetlistMeta {
  /** Source schematic file name (design header `source`). */
  source: string;
}

/**
 * The KiCad generic XML netlist (NETLIST_EXPORTER_XML::makeRoot, GNL_ALL): a
 * `<design>` header, `<components>`, `<libparts>`, `<libraries>`, and `<nets>`.
 */
export function netlistKicadXml(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): string {
  const root = new X('export').attr('version', 'E');

  // <design>
  const design = root.child(new X('design'));
  design.leaf('source', meta.source);
  design.leaf('date', new Date().toISOString());
  design.leaf('tool', NETLIST_HEAD);
  const sheet = design.child(
    new X('sheet').attr('number', '1').attr('name', '/').attr('tstamps', '/'),
  );
  const tb = sch.titleBlock;
  const title = sheet.child(new X('title_block'));
  title.leaf('title', tb?.title ?? '');
  title.leaf('company', tb?.company ?? '');
  title.leaf('rev', tb?.rev ?? '');
  title.leaf('date', tb?.date ?? '');
  title.leaf('source', meta.source);

  const symbols = boardSymbols(sch);

  // <components>
  const comps = root.child(new X('components'));
  for (const { sym, ref } of symbols) {
    const comp = comps.child(new X('comp').attr('ref', ref));
    comp.leaf('value', field(sym, 'Value') || '~');
    const fp = field(sym, 'Footprint');
    if (fp) comp.leaf('footprint', fp);
    const ds = field(sym, 'Datasheet');
    if (ds && ds !== '~') comp.leaf('datasheet', ds);

    // Non-standard fields become <fields><field name=..>value</field></fields>.
    const extra = sym.fields.filter(
      (f) => !['Reference', 'Value', 'Footprint', 'Datasheet'].includes(f.key),
    );
    if (extra.length) {
      const fields = comp.child(new X('fields'));
      for (const f of extra) fields.leaf('field', f.value).attr('name', f.key);
    }

    const { lib, part } = splitLibId(sym.libId);
    comp.child(new X('libsource')).attr('lib', lib).attr('part', part).attr('description', '');
    // Board/BOM/DNP attributes (KiCad's <property name="dnp"> etc.).
    if (!sym.inBom)
      comp.child(new X('property').attr('name', 'exclude_from_bom').attr('value', '1'));
    if (!sym.onBoard)
      comp.child(new X('property').attr('name', 'exclude_from_board').attr('value', '1'));
    if (sym.dnp) comp.child(new X('property').attr('name', 'dnp').attr('value', '1'));
    comp.child(new X('sheetpath')).attr('names', '/').attr('tstamps', '/');
    if (sym.uuid) comp.leaf('tstamps', sym.uuid);
  }

  // <libparts>: one per distinct lib symbol used, with its pins.
  const libparts = root.child(new X('libparts'));
  const usedLibIds = [...new Set(symbols.map((s) => s.sym.libId))];
  for (const libId of usedLibIds) {
    const lib = libById.get(libId);
    if (!lib) continue;
    const { lib: libName, part } = splitLibId(libId);
    const lp = libparts.child(new X('libpart').attr('lib', libName).attr('part', part));
    const descField = lib.properties.find((p) => p.key === 'Description');
    if (descField) lp.leaf('description', descField.value);
    const pins = lib.units.flatMap((u) => u.pins);
    if (pins.length) {
      const xpins = lp.child(new X('pins'));
      for (const pin of pins)
        xpins.child(
          new X('pin')
            .attr('num', pin.number)
            .attr('name', pin.name)
            .attr('type', pin.electricalType),
        );
    }
  }

  // <libraries>
  const libraries = root.child(new X('libraries'));
  for (const libName of [...new Set(usedLibIds.map((id) => splitLibId(id).lib))].filter(Boolean))
    libraries.child(new X('library').attr('logical', libName)).leaf('uri', '');

  // <nets>
  const netlist = computeNetlist(sch, libById);
  const pins = enumeratePins(sch, libById);
  const pinById = new Map(pins.map((p) => [p.id, p]));
  const nets = root.child(new X('nets'));
  for (const net of netlist.nets) {
    // Only nets that connect at least one pin are exported (KiCad drops
    // no-connect / single-item nets from the board netlist).
    const nodes = net.items.map((id) => pinById.get(id)).filter((p) => p !== undefined);
    if (nodes.length === 0) continue;
    const xnet = nets.child(new X('net').attr('code', String(net.code)).attr('name', net.name));
    for (const p of nodes.sort(
      (a, b) => compareRefs(a!.ref, b!.ref) || (a!.number < b!.number ? -1 : 1),
    )) {
      const node = xnet.child(new X('node').attr('ref', p!.ref).attr('pin', p!.number));
      if (p!.name && p!.name !== '~') node.attr('pinfunction', p!.name);
      node.attr('pintype', p!.electricalType);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${root.render()}\n`;
}

// ----- OrcadPCB2 text netlist -------------------------------------------------

/**
 * The OrcadPCB2 netlist (NETLIST_EXPORTER_ORCADPCB2::WriteNetlist): a footprints
 * section listing each symbol's uuid, footprint, ref, value and per-pin nets.
 */
export function netlistOrcadPcb2(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): string {
  const netlist = computeNetlist(sch, libById);
  const pins = enumeratePins(sch, libById);
  // pin id -> net name (unconnected pins get "?").
  const netNameByPin = new Map<string, string>();
  for (const net of netlist.nets) for (const id of net.items) netNameByPin.set(id, net.name);

  // Pins grouped by their parent symbol's node id (the id enumeratePins emits).
  const bySym = new Map<string, typeof pins>();
  for (const p of pins) {
    const arr = bySym.get(p.symId) ?? [];
    arr.push(p);
    bySym.set(p.symId, arr);
  }

  const out: string[] = [];
  out.push(`( { ${NETLIST_HEAD} netlist created ${new Date().toISOString()} }`);

  for (const { sym, ref, index } of boardSymbols(sch)) {
    const symId = refId('symbol', sym.uuid, index);
    let footprint = field(sym, 'Footprint').replace(/ /g, '_');
    if (!footprint) footprint = '$noname';
    const value = (field(sym, 'Value') || '~').replace(/ /g, '_');
    out.push(` ( ${sym.uuid ?? symId} ${footprint}  ${ref} ${value}`);
    for (const pin of bySym.get(symId) ?? []) {
      if (!pin.number) continue;
      const netName = (netNameByPin.get(pin.id) ?? '?').replace(/ /g, '_');
      out.push(`  ( ${pin.number.padStart(4)} ${netName} )`);
    }
    out.push(' )');
  }

  out.push(')\n*');
  return out.join('\n');
}

/** The netlist formats offered by the export dialog. */
export type NetlistFormat = 'kicadxml' | 'orcadpcb2';

export function generateNetlist(
  format: NetlistFormat,
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): string {
  return format === 'kicadxml'
    ? netlistKicadXml(sch, libById, meta)
    : netlistOrcadPcb2(sch, libById, meta);
}
