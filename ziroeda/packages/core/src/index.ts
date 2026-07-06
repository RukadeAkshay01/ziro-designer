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
export * from './model/index.js';
export { sheetName, sheetFile, buildSheetTree, findRootFile, type SheetTreeNode } from './model/project.js';

import { writeSchematic as _writeSchematic } from './model/index.js';
import { serialize as _serialize } from './sexpr/index.js';
import type { Schematic as _Schematic } from './model/index.js';

/** Serialize an edited schematic back to `.kicad_sch` text. */
export function serializeSchematic(sch: _Schematic): string {
  return _serialize(_writeSchematic(sch));
}

export * as geom from './geom/index.js';
export {
  type Transform,
  type Orientation,
  IDENTITY,
  rotationTransform,
  composeMirror,
  composeTransform,
  symbolTransform,
  applyTransform,
  localToWorld,
  orientationFromTransform,
  rotateOrientation,
  mirrorOrientation,
  type TextMeasurer,
  type Box,
  DEFAULT_TEXT_SIZE,
  ITALIC_TILT,
  letterSubReference,
  fieldShownText,
  fieldTextBox,
  fieldBoundingBox,
  fieldDrawRotation,
  isHorizJustifyFlipped,
  isVertJustifyFlipped,
  effectiveHorizJustify,
  effectiveVertJustify,
  storedForEffectiveHoriz,
  storedForEffectiveVert,
  justifyTokens,
  storedHJustify,
  storedVJustify,
} from './geom/index.js';

export * as edit from './edit/index.js';
export {
  type ItemRef,
  type BBox,
  type EditCommand,
  type MoveSpec,
  type ItemsBatch,
  History,
  hitTest,
  refId,
  symbolBodyBBox,
  symbolPinPositions,
  planMove,
  moveItems,
  moveWithConnections,
  orthoMove,
  addItems,
  deleteByIds,
  needsJunction,
  placeSymbol,
  makeWire,
  makeBus,
  makeJunction,
  makeNoConnect,
  makeLabel,
  makeSymbol,
  transformItems,
  collectAnchors,
  selectionAnchors,
  nearestAnchor,
  mergeColinearWires,
  withCleanup,
  type TransformOp,
  editSymbolProperties,
  isMandatoryField,
  MANDATORY_FIELDS,
  type SymbolEdit,
  type EditedField,
  boxSelect,
  copySelectionText,
  parsePastedText,
  translatePayload,
  pasteItems,
  type PastePayload,
} from './edit/index.js';

export * as connectivity from './connectivity/index.js';
export {
  computeNetlist, danglingPinPositions, allPinPositions, enumeratePins, runErc,
  type Net, type Netlist, type PinNode, type ErcViolation, type ErcCode, type ErcSeverity,
} from './connectivity/index.js';

export { SCH_IU_PER_MM, mmToIU, iuToMM } from './units.js';

// --- PCB (board) -------------------------------------------------------------
export * from './pcb/types.js';
export { readBoard, rotatePcb, tessellateArc, arcCenter } from './pcb/read-board.js';
