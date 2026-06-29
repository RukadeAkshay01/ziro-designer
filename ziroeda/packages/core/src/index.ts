/**
 * @ziroeda/core — framework-agnostic foundations for ZiroEDA.
 *
 * Currently exposes the lossless S-expression layer used to read and write
 * KiCad-format files. The typed document model and geometry helpers land here as
 * subsequent slices.
 */
export * as sexpr from './sexpr/index.js';
export { parse, serialize } from './sexpr/index.js';
