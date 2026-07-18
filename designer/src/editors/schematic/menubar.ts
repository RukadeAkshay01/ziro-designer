/**
 * Schematic editor menu bar. Counterpart: `eeschema/menubar.cpp`
 * (SCH_EDIT_FRAME::doReCreateMenuBar), transcribed exactly: same menus, same
 * item order, same separators and submenus, with labels and default hotkeys
 * taken from the action definitions (`common/tool/actions.cpp`,
 * `eeschema/tools/sch_actions.cpp`).
 *
 * Items whose feature is not implemented yet are `disabled` (shown but
 * greyed, so the surface always matches upstream). Upstream items that only
 * exist under the standalone/project-manager split (Kiface().IsSingle()) keep
 * the project-manager variant, since our editors always live in one app.
 *
 * Each enabled item routes to one of three handlers:
 *   - `tool(id)`   selects a placement/drawing tool (RIGHT_TOOLBAR ids);
 *   - `action(id)` runs a one-shot command (save/undo/zoom…);
 *   - `toggle(id)` flips a CHECK setting (View toggles).
 */

import type { Menu, MenuItem } from '../../ui/MenuBar.js';

export interface MenuHandlers {
  tool: (id: string) => void;
  action: (id: string) => void;
  toggle: (id: string) => void;
}

/** Check state for ACTION_MENU::CHECK items, keyed by toggle id. */
export type MenuChecks = Readonly<Record<string, boolean>>;

/** KiCad's eeschema default single-key tool hotkeys (sch_actions.cpp
 *  DefaultHotkey): A, P, W, B, Z, Q, J, L, H, S, T, I. */
export const TOOL_HOTKEYS: Readonly<Record<string, string>> = {
  a: 'placeSymbol',
  p: 'placePower',
  w: 'drawWire',
  b: 'drawBus',
  z: 'busEntry',
  q: 'noConnect',
  j: 'junction',
  l: 'placeLabel',
  h: 'placeHierLabel',
  s: 'drawSheet',
  t: 'placeText',
  i: 'lines',
};

const SEP: MenuItem = { sep: true };

export function buildMenus(h: MenuHandlers, checks: MenuChecks = {}): Menu[] {
  const tool = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label,
    icon,
    shortcut,
    action: () => h.tool(id),
  });
  const act = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label,
    icon,
    shortcut,
    action: () => h.action(id),
  });
  const chk = (label: string, id: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    checked: !!checks[id],
    action: () => h.toggle(id),
  });
  /** Not implemented yet — greyed out, exactly where upstream puts it. */
  const stub = (label: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    disabled: true,
  });
  const stubChk = (label: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    disabled: true,
  });

  return [
    // File: the project-manager variant (Kiface().IsSingle() == false) — New/
    // Open/Open Recent belong to the launcher, and the menu starts at Save.
    {
      label: 'File',
      items: [
        act('Save', 'save', 'save', 'Ctrl+S'),
        stub('Save Current Sheet Copy As...'),
        stub('Revert'),
        SEP,
        {
          label: 'Import',
          items: [
            stub('Non-KiCad Schematic...'),
            stub('Footprint Assignments...'),
            stub('Graphics...', 'Ctrl+Shift+F'),
          ],
        },
        {
          label: 'Export',
          items: [
            stub('Drawing to Clipboard'),
            act('Netlist...', 'netlist', 'exportNetlist'),
            stub('Symbols...'),
          ],
        },
        SEP,
        act('Schematic Setup...', 'setup', 'schematicSetup'),
        SEP,
        act('Page Settings...', 'page', 'pageSettings'),
        act('Print...', 'print', 'print', 'Ctrl+P'),
        act('Plot...', 'plot', 'plot'),
        SEP,
        // AddQuitOrClose: under the project manager the frame closes back to it.
        act('Close', 'close', 'close', 'Ctrl+W'),
      ],
    },
    {
      label: 'Edit',
      items: [
        act('Undo', 'undo', 'undo', 'Ctrl+Z'),
        act('Redo', 'redo', 'redo', 'Ctrl+Shift+Z'),
        SEP,
        act('Cut', 'cut', 'cut', 'Ctrl+X'),
        act('Copy', 'copy', 'copy', 'Ctrl+C'),
        act('Copy as Text', 'copy', 'copyAsText', 'Ctrl+Shift+C'),
        act('Paste', 'paste', 'paste', 'Ctrl+V'),
        act('Paste Special...', 'paste', 'pasteSpecial', 'Ctrl+Shift+V'),
        act('Delete', 'delete', 'delete', 'Del'),
        SEP,
        act('Select All', 'selectAll', 'selectAll', 'Ctrl+A'),
        act('Unselect All', 'unselectAll', 'unselectAll', 'Ctrl+Shift+A'),
        SEP,
        act('Find', 'find', 'find', 'Ctrl+F'),
        act('Find and Replace', 'replace', 'findReplace', 'Ctrl+Alt+F'),
        SEP,
        tool('Interactive Delete Tool', 'delete', 'delete'),
        stub('Edit Text & Graphics Properties...'),
        stub('Change Symbols...'),
        act('Edit Sheet Page Number...', 'editPageNumber', 'editPageNumber'),
        {
          label: 'Attributes',
          items: [
            stubChk('Exclude from Simulation'),
            stubChk('Exclude from Bill of Materials'),
            stubChk('Exclude from Board'),
            stubChk('Exclude from Position Files'),
            stubChk('Do not Populate'),
          ],
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Panels',
          items: [
            chk('Properties', 'showProperties'),
            stubChk('Search', 'Ctrl+G'),
            chk('Hierarchy Navigator', 'showHierarchy', 'Ctrl+H'),
            stubChk('Design Blocks'),
            stubChk('Remote Symbols'),
          ],
        },
        SEP,
        act('Symbol Library Browser', 'symbolBrowser', 'symbolBrowser'),
        SEP,
        act('Zoom In', 'zoomIn', 'zoomIn'),
        act('Zoom Out', 'zoomOut', 'zoomOut'),
        act('Zoom to Fit', 'zoomFit', 'zoomFit', 'Ctrl+0'),
        act('Zoom to All Objects', 'zoomFitObjects', 'zoomFitObjects', 'Ctrl+Home'),
        act('Zoom to Selected Objects', 'zoomFitSelection', 'zoomFitSelection'),
        act('Zoom to Selection Area', 'zoomTool', 'zoomTool', 'Ctrl+F5'),
        act('Refresh', 'zoomRedraw', 'zoomRedraw', 'Ctrl+R'),
        SEP,
        act('Navigate Back', 'navBack', 'navBack', 'Alt+Left'),
        act('Navigate Up', 'navUp', 'navUp', 'Alt+Up'),
        act('Navigate Forward', 'navFwd', 'navFwd', 'Alt+Right'),
        act('Previous Sheet', 'navPrev', 'navPrev', 'PgUp'),
        act('Next Sheet', 'navNext', 'navNext', 'PgDn'),
        SEP,
        chk('Show Hidden Pins', 'toggleHiddenPins'),
        chk('Show Hidden Fields', 'toggleHiddenFields'),
        stubChk('Show Directive Labels'),
        stubChk('Show ERC Errors'),
        stubChk('Show ERC Warnings'),
        stubChk('Show ERC Exclusions'),
        stubChk('Mark items excluded from simulation'),
        stubChk('Show OP Voltages'),
        stubChk('Show OP Currents'),
        stubChk('Show Pin Alternate Icons'),
      ],
    },
    {
      label: 'Place',
      items: [
        tool('Place Symbols', 'symbol', 'placeSymbol', 'A'),
        tool('Place Power Symbols', 'power', 'placePower', 'P'),
        tool('Draw Wires', 'wire', 'drawWire', 'W'),
        tool('Draw Buses', 'bus', 'drawBus', 'B'),
        tool('Place Wire to Bus Entries', 'busEntry', 'busEntry', 'Z'),
        tool('Place No Connect Flags', 'noConnect', 'noConnect', 'Q'),
        tool('Place Junctions', 'junction', 'junction', 'J'),
        tool('Place Net Labels', 'labelLocal', 'placeLabel', 'L'),
        tool('Place Global Labels', 'labelGlobal', 'placeGlobalLabel', 'Ctrl+L'),
        stub('Place Directive Labels'),
        stub('Draw Rule Areas'),
        SEP,
        tool('Place Hierarchical Labels', 'labelHier', 'placeHierLabel', 'H'),
        tool('Draw Hierarchical Sheets', 'sheet', 'drawSheet', 'S'),
        tool('Place Pins from Sheet', 'sheetPin', 'sheetPin'),
        stub('Sync All Sheet Pins...'),
        stub('Import Sheet...'),
        SEP,
        tool('Draw Text', 'text', 'placeText', 'T'),
        tool('Draw Text Boxes', 'textBox', 'textBox'),
        tool('Draw Tables', 'table', 'table'),
        tool('Draw Rectangles', 'rectangle', 'rectangle'),
        tool('Draw Circles', 'circle', 'circle'),
        stub('Draw Ellipses'),
        stub('Draw Elliptical Arcs'),
        tool('Draw Arcs', 'arc', 'arc'),
        tool('Draw Bezier Curve', 'bezier', 'bezier'),
        tool('Draw Lines', 'lines', 'lines', 'I'),
        tool('Place Images', 'image', 'image'),
      ],
    },
    {
      label: 'Inspect',
      items: [
        stub('Show Bus Syntax Help'),
        SEP,
        act('Electrical Rules Checker', 'erc', 'erc'),
        stub('Previous Marker'),
        stub('Next Marker'),
        stub('Exclude Marker'),
        SEP,
        stub('Compare Symbol with Library'),
        SEP,
        stub('Simulator'),
      ],
    },
    {
      label: 'Tools',
      items: [
        stub('Update PCB from Schematic...', 'F8'),
        act('Switch to PCB Editor', 'pcb', 'showPcbNew'),
        act('Calculator Tools', 'calculator', 'showCalculator'),
        SEP,
        act('Symbol Editor', 'symbolEditor', 'symbolEditor'),
        stub('Update Symbols from Library...'),
        SEP,
        stub('Rescue Symbols...'),
        stub('Remap Legacy Library Symbols...'),
        SEP,
        act('Bulk Edit Symbol Fields...', 'fields', 'editSymbolFields'),
        stub('Bulk Edit Symbol Library Links...'),
        SEP,
        act('Annotate Schematic...', 'annotate', 'annotate'),
        stub('Increment Annotations From...'),
        SEP,
        act('Assign Footprints...', 'assignFp', 'assignFootprints'),
        act('Generate Bill of Materials...', 'bom', 'bom'),
        stub('Generate Legacy Bill of Materials...'),
        SEP,
        stub('Update Schematic from PCB...'),
        SEP,
        {
          label: 'Variants',
          items: [
            stub('Add Design Variant...'),
            stub('Remove Design Variant...'),
            stub('Edit Variant Description...'),
            stub('Rename Design Variant...'),
            stub('Copy Design Variant...'),
          ],
        },
      ],
    },
    {
      label: 'Preferences',
      items: [
        stub('Configure Paths...'),
        stub('Manage Symbol Libraries...'),
        stub('Manage Design Block Libraries...'),
        act('Preferences...', 'preferences', 'openPreferences', 'Ctrl+,'),
      ],
    },
    { label: 'Help', items: [{ label: 'About ZiroEDA', disabled: true }] },
  ];
}
