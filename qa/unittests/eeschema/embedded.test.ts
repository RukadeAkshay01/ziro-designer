/**
 * Embedded-files summary: names/types and the embed-fonts flag list from the
 * schematic's lossless AST (the zstd data blobs pass through untouched).
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { listEmbeddedFiles } from '@ziroeda/eeschema/src/tools/embedded.js';

const SCH = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "00000000-0000-0000-0000-000000000000")
  (embedded_fonts yes)
  (embedded_files
    (file (name "logo.png") (type other)
      (data |KLUv/QBYbQAAEAAA|)
      (checksum "abc123"))
    (file (name "notes.pdf") (type datasheet)
      (data |KLUv/QBYbQAAEAAB|)
      (checksum "def456"))))`;

describe('listEmbeddedFiles', () => {
  it('lists names, kicad-embed references, types and the fonts flag', () => {
    const doc = readSchematic(parse(SCH));
    const { files, embedFonts } = listEmbeddedFiles(doc);
    expect(embedFonts).toBe(true);
    expect(files).toEqual([
      { name: 'logo.png', reference: 'kicad-embed://logo.png', type: 'other' },
      { name: 'notes.pdf', reference: 'kicad-embed://notes.pdf', type: 'datasheet' },
    ]);
  });

  it('returns empty for schematics without an embedded_files section', () => {
    const doc = readSchematic(parse('(kicad_sch (version 20250114) (generator "x"))'));
    expect(listEmbeddedFiles(doc)).toEqual({ files: [], embedFonts: false });
  });

  it('preserves the section byte-for-byte through a round-trip', () => {
    const doc = readSchematic(parse(SCH));
    const out = serializeSchematic(doc);
    expect(out).toContain('embedded_files');
    expect(out).toContain('KLUv/QBYbQAAEAAA');
    expect(out).toContain('(checksum "def456")');
    expect(out).toContain('embedded_fonts');
  });
});
