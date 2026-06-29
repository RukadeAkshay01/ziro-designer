/**
 * @ziroeda/core — framework-agnostic foundations for ZiroEDA.
 *
 * Two layers, both grounded in KiCad's own implementation:
 *   - `sexpr`  : lossless S-expression parser/serializer for KiCad-format files.
 *   - `model`  : a typed schematic document model built as a view over that AST.
 */
export * as sexpr from './sexpr/index.js';
export { parse, serialize } from './sexpr/index.js';

export * as model from './model/index.js';
export { readSchematic } from './model/index.js';

export { SCH_IU_PER_MM, mmToIU, iuToMM } from './units.js';
