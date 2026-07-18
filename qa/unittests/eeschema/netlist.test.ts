/**
 * Netlist export (NETLIST_EXPORTER_XML version "E" and NETLIST_EXPORTER_ORCADPCB2):
 * two output pins wired together must land on one net with both nodes, and the
 * component/footprint sections must reflect the placed symbols.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { netlistKicadXml, netlistOrcadPcb2 } from '@ziroeda/eeschema/src/exporters/netlist.js';

// A 2-pin resistor-like part and a wire joining R1 pin 2 to R2 pin 1.
const LIB = `(symbol "Device:R" (pin_names (offset 0))
  (property "Reference" "R" (at 0 0 0))
  (property "Value" "R" (at 0 0 0))
  (property "Footprint" "" (at 0 0 0))
  (symbol "R_1_1"
    (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))
    (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))`;

const place = (ref: string, x: number, y: number, uuid: string): string =>
  `(symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1)
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "1k" (at ${x} ${y} 0))
    (property "Footprint" "Resistor_SMD:R_0603" (at ${x} ${y} 0))
    (uuid "${uuid}"))`;

// After the library +Y-up→down inversion, R1's pin 2 connection point sits at
// y=103.81 and R2's pin 1 at y=106.19. A wire whose endpoints land exactly on
// those pins joins them onto one net (a pin only connects at a wire endpoint).
const doc = readSchematic(
  parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB})
    ${place('R1', 100, 100, 'r1')} ${place('R2', 100, 110, 'r2')}
    (wire (pts (xy 100 103.81) (xy 100 106.19)) (uuid "w1")))`),
);
const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

describe('netlistKicadXml', () => {
  const xml = netlistKicadXml(doc, libById, { source: 'test.kicad_sch' });

  it('emits the export root, components, and both refs', () => {
    expect(xml).toContain('<export version="E">');
    expect(xml).toContain('<comp ref="R1">');
    expect(xml).toContain('<comp ref="R2">');
    expect(xml).toContain('<footprint>Resistor_SMD:R_0603</footprint>');
  });

  it('joins the two wired pins onto one net with both nodes', () => {
    // Find the <net ...> block that carries R1's pin 2.
    const netMatch = [...xml.matchAll(/<net [^>]*>[\s\S]*?<\/net>/g)].find(
      (m) => m[0].includes('ref="R1"') && m[0].includes('pin="2"'),
    );
    expect(netMatch).toBeDefined();
    expect(netMatch![0]).toContain('ref="R2"');
    expect(netMatch![0]).toContain('pin="1"');
  });

  it('lists the lib part with its pins', () => {
    expect(xml).toContain('<libpart lib="Device" part="R">');
    expect(xml).toMatch(/<pin num="1"/);
    expect(xml).toMatch(/<pin num="2"/);
  });
});

describe('netlistOrcadPcb2', () => {
  const net = netlistOrcadPcb2(doc, libById, { source: 'test.kicad_sch' });

  it('writes each symbol with its footprint, ref and value', () => {
    expect(net.startsWith('( { Eeschema netlist created')).toBe(true);
    expect(net).toContain('Resistor_SMD:R_0603  R1 1k');
    expect(net).toContain('Resistor_SMD:R_0603  R2 1k');
    expect(net.trimEnd().endsWith('*')).toBe(true);
  });
});
