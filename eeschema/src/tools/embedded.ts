/**
 * Embedded-files summary. Counterpart: `common/embedded_files.cpp`
 * (EMBEDDED_FILES) — the `.kicad_sch` `(embedded_files (file (name ..)
 * (type ..) (data ..) (checksum ..)))` section plus the `(embedded_fonts
 * yes|no)` flag.
 *
 * The data blobs are zstd-compressed base64 that the app cannot decode yet;
 * they survive losslessly through the schematic AST, and this helper lists
 * names/types for the Schematic Setup > Embedded Files page. References use
 * KiCad's `kicad-embed://` URI scheme.
 */

import { isList, head } from '@ziroeda/sexpr/src/index.js';
import { arg, childNamed } from '@ziroeda/sexpr/src/query.js';
import type { Schematic } from '../types.js';

export interface EmbeddedFileInfo {
  name: string;
  /** `kicad-embed://<name>` — how other fields reference the file. */
  reference: string;
  /** The `(type ..)` token: font | model | worksheet | datasheet | other. */
  type?: string;
}

/** List the schematic's embedded files and the embed-fonts flag from its
 *  lossless source AST. */
export function listEmbeddedFiles(sch: Schematic): {
  files: EmbeddedFileInfo[];
  embedFonts: boolean;
} {
  const files: EmbeddedFileInfo[] = [];
  let embedFonts = false;
  for (const node of sch.source.items) {
    if (!isList(node)) continue;
    const kind = head(node);
    if (kind === 'embedded_fonts') {
      embedFonts = arg(node, 0) === 'yes';
    } else if (kind === 'embedded_files') {
      for (const f of node.items) {
        if (!isList(f) || head(f) !== 'file') continue;
        const nameNode = childNamed(f, 'name');
        const name = nameNode ? (arg(nameNode, 0) ?? '') : '';
        if (!name) continue;
        const typeNode = childNamed(f, 'type');
        const info: EmbeddedFileInfo = { name, reference: `kicad-embed://${name}` };
        const type = typeNode ? arg(typeNode, 0) : undefined;
        if (type !== undefined) info.type = type;
        files.push(info);
      }
    }
  }
  return { files, embedFonts };
}
