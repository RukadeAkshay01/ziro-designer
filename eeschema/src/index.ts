/** @ziroeda/eeschema — schematic engine mirroring KiCad's eeschema/. */
export * from './types.js';
export {
  readSchematic,
  readSymbolLib,
  readLibPin,
  readGraphic,
} from './sch_io/sexpr/read-schematic.js';
export { writeSchematic, buildPropertyNode } from './sch_io/sexpr/write-schematic.js';
export {
  writeSymbolLib,
  serializeSymbolLib,
  writeLibSymbolNode,
  buildLibPinNode,
  buildLibGraphicNode,
  buildLibPropertyNode,
  buildLibUnitNode,
  SYMBOL_LIB_FILE_VERSION,
  EMPTY_SOURCE,
} from './sch_io/sexpr/write-symbol-lib.js';
export * from './project.js';
export * from './fieldbox.js';
export * from './tools/index.js';
export * from './connectivity/index.js';
export * from './exporters/bom.js';

import { writeSchematic as _writeSchematic } from './sch_io/sexpr/write-schematic.js';
import { serialize as _serialize } from '@ziroeda/sexpr/src/serializer.js';
import type { Schematic as _Schematic } from './types.js';

/** Serialize an edited schematic back to `.kicad_sch` text. */
export function serializeSchematic(sch: _Schematic): string {
  return _serialize(_writeSchematic(sch));
}
