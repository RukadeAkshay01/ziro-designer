/**
 * Hierarchy navigation history (counterpart eeschema/tools/
 * sch_navigate_tool.cpp): Back/Forward move a cursor over visited sheet
 * instances; a sheet change truncates the forward tail; Up pops the
 * instance path; Previous/Next follow depth-first hierarchy order.
 */
import { describe, it, expect } from 'vitest';
import {
  SchNavigateTool,
  flattenHierarchy,
  parentPath,
} from '@ziroeda/designer/src/editors/schematic/sch_navigate_tool.js';
import type { SheetTreeNode } from '@ziroeda/eeschema';

const tree: SheetTreeNode = {
  file: 'root.kicad_sch',
  name: 'Root',
  path: '/',
  children: [
    {
      file: 'power.kicad_sch',
      name: 'Power',
      path: '/a/',
      children: [{ file: 'reg.kicad_sch', name: 'Reg', path: '/a/c/', children: [] }],
    },
    { file: 'io.kicad_sch', name: 'IO', path: '/b/', children: [] },
  ],
};

describe('flattenHierarchy', () => {
  it('is depth-first — KiCad virtual page number order', () => {
    expect(flattenHierarchy(tree).map((s) => s.path)).toEqual(['/', '/a/', '/a/c/', '/b/']);
  });
});

describe('parentPath', () => {
  it('pops the last instance segment; the root has no parent', () => {
    expect(parentPath('/a/c/')).toBe('/a/');
    expect(parentPath('/a/')).toBe('/');
    expect(parentPath('/')).toBeNull();
  });
});

describe('SchNavigateTool', () => {
  it('walks back and forward over visited sheets without re-pushing', () => {
    const nav = new SchNavigateTool();
    nav.pushToHistory('/a/');
    nav.pushToHistory('/a/c/');
    expect(nav.canGoBack()).toBe(true);
    expect(nav.back()).toBe('/a/');
    expect(nav.back()).toBe('/');
    expect(nav.back()).toBeNull(); // at the beginning — upstream wxBell()s
    expect(nav.forward()).toBe('/a/');
    expect(nav.forward()).toBe('/a/c/');
    expect(nav.forward()).toBeNull();
  });

  it('a new sheet change truncates the forward tail (pushToHistory)', () => {
    const nav = new SchNavigateTool();
    nav.pushToHistory('/a/');
    nav.pushToHistory('/a/c/');
    nav.back(); // at /a/
    nav.pushToHistory('/b/'); // erases /a/c/ from the forward tail
    expect(nav.canGoForward()).toBe(false);
    expect(nav.back()).toBe('/a/');
    expect(nav.forward()).toBe('/b/');
  });

  it('skips consecutive duplicates and prunes deleted sheets (CleanHistory)', () => {
    const nav = new SchNavigateTool();
    nav.pushToHistory('/a/');
    nav.pushToHistory('/a/'); // consecutive dup is not recorded
    expect(nav.back()).toBe('/');
    nav.forward();
    nav.pushToHistory('/a/c/');
    nav.pushToHistory('/b/');
    nav.cleanHistory(new Set(['/', '/a/', '/b/'])); // /a/c/ was deleted
    expect(nav.back()).toBe('/a/');
    expect(nav.back()).toBe('/');
  });
});
