/**
 * Top menu-bar contents, transcribed from KiCad eeschema's `menubar.cpp`
 * (`SCH_EDIT_FRAME::doReCreateMenuBar`). Item order, grouping (separators) and
 * the default hotkeys mirror KiCad's Place menu so the behaviour is familiar.
 *
 * Each item routes to one of two handlers:
 *   - `tool(id)`   selects a placement/drawing tool (RIGHT_TOOLBAR ids).
 *   - `action(id)` runs a one-shot command (TOP_TOOLBAR ids: save/undo/zoom…).
 */

import type { Menu, MenuItem } from './MenuBar.js';

export interface MenuHandlers {
  tool: (id: string) => void;
  action: (id: string) => void;
}

/** KiCad's eeschema default single-key tool hotkeys (Place menu accelerators). */
export const TOOL_HOTKEYS: Readonly<Record<string, string>> = {
  a: 'placeSymbol',
  p: 'placePower',
  w: 'drawWire',
  b: 'drawBus',
  q: 'noConnect',
  j: 'junction',
  l: 'placeLabel',
  h: 'placeHierLabel',
  t: 'placeText',
  s: 'drawSheet',
};

const SEP: MenuItem = { sep: true };

export function buildMenus(h: MenuHandlers): Menu[] {
  const tool = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label, icon, shortcut, action: () => h.tool(id),
  });
  const act = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label, icon, shortcut, action: () => h.action(id),
  });

  return [
    { label: 'File', items: [
      act('New', 'new', 'new'),
      act('Open…', 'open', 'open'),
      act('Save', 'save', 'save', 'Ctrl+S'),
      SEP,
      act('Plot…', 'plot', 'plot'),
      act('Print…', 'print', 'print'),
    ] },
    { label: 'Edit', items: [
      act('Undo', 'undo', 'undo', 'Ctrl+Z'),
      act('Redo', 'redo', 'redo', 'Ctrl+Y'),
      SEP,
      act('Find…', 'find', 'find'),
      act('Find and Replace…', 'replace', 'findReplace'),
    ] },
    { label: 'View', items: [
      act('Zoom In', 'zoomIn', 'zoomIn'),
      act('Zoom Out', 'zoomOut', 'zoomOut'),
      act('Zoom to Fit Schematic', 'zoomFit', 'zoomFit'),
      act('Zoom to Fit Objects', 'zoomFitObjects', 'zoomFitObjects'),
    ] },
    { label: 'Place', items: [
      tool('Add Symbol…', 'symbol', 'placeSymbol', 'A'),
      tool('Add Power', 'power', 'placePower', 'P'),
      tool('Add No Connect Flag', 'noConnect', 'noConnect', 'Q'),
      tool('Add Wire', 'wire', 'drawWire', 'W'),
      tool('Add Bus', 'bus', 'drawBus', 'B'),
      tool('Add Wire to Bus Entry', 'busEntry', 'busEntry'),
      tool('Add Junction', 'junction', 'junction', 'J'),
      SEP,
      tool('Add Label', 'labelLocal', 'placeLabel', 'L'),
      tool('Add Global Label', 'labelGlobal', 'placeGlobalLabel'),
      tool('Add Hierarchical Label', 'labelHier', 'placeHierLabel', 'H'),
      SEP,
      tool('Add Hierarchical Sheet', 'sheet', 'drawSheet', 'S'),
      tool('Add Sheet Pin', 'sheetPin', 'sheetPin'),
      SEP,
      tool('Add Text', 'text', 'placeText', 'T'),
      tool('Add Text Box', 'textBox', 'textBox'),
      tool('Add Table', 'table', 'table'),
      SEP,
      tool('Add Rectangle', 'rectangle', 'rectangle'),
      tool('Add Circle', 'circle', 'circle'),
      tool('Add Arc', 'arc', 'arc'),
      tool('Add Lines', 'lines', 'lines'),
      SEP,
      tool('Add Image', 'image', 'image'),
    ] },
    { label: 'Inspect', items: [
      act('Electrical Rules Checker…', 'erc', 'erc'),
    ] },
    { label: 'Tools', items: [
      act('Annotate Schematic…', 'annotate', 'annotate'),
      act('Edit Symbol Fields…', 'fields', 'editSymbolFields'),
      act('Generate BOM…', 'bom', 'bom'),
    ] },
    { label: 'Preferences', items: [
      { label: 'Preferences…', disabled: true },
    ] },
    { label: 'Help', items: [
      { label: 'About ZiroEDA', disabled: true },
    ] },
  ];
}
