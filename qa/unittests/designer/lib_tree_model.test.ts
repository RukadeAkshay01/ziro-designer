/**
 * Library-tree model + adapter (counterparts common/lib_tree_model.cpp and
 * common/lib_tree_model_adapter.cpp): search scoring, best-match/alphabetic
 * sorting, group and pinned-library ordering, and unit sub-nodes.
 */
import { describe, it, expect } from 'vitest';
import { searchTerm } from '@ziroeda/common/src/eda_pattern_match.js';
import {
  LibTreeNode,
  LibTreeNodeType,
  makeItemNode,
  makeUnitNode,
} from '@ziroeda/designer/src/widgets/lib_tree_model.js';
import {
  LibTreeModelAdapter,
  SortMode,
} from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';

function addItem(lib: LibTreeNode, name: string, keywords = '', desc = ''): LibTreeNode {
  const item = makeItemNode(lib, lib.name, name);
  item.desc = desc;
  item.searchTerms = [
    searchTerm(lib.name, 4),
    searchTerm(name, 8, true),
    searchTerm(`${lib.name}:${name}`, 16, true),
    ...keywords
      .split(/\s+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(desc, 1),
  ];
  return item;
}

function buildAdapter(): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  const device = adapter.addLibrary('Device', '', false);
  addItem(device, 'R', 'res resistor', 'Resistor');
  addItem(device, 'C', 'cap capacitor', 'Unpolarized capacitor');
  addItem(device, 'R_Variable', 'resistor variable', 'Variable resistor');
  const logic = adapter.addLibrary('74xGxx', '', false);
  addItem(logic, '74LVC1GU04DRL', 'single inverter', 'Single inverter gate');
  device.assignIntrinsicRanks();
  logic.assignIntrinsicRanks();
  adapter.tree.assignIntrinsicRanks();
  return adapter;
}

describe('LibTreeModelAdapter search', () => {
  it('selects the exact name match over longer incidental matches', () => {
    const adapter = buildAdapter();
    const best = adapter.updateSearchString('R');
    expect(best?.libId).toBe('Device:R');
    expect(best?.exactMatch).toBe(true);
  });

  it('hides non-matching items (score 0) and keeps matching ones', () => {
    const adapter = buildAdapter();
    adapter.updateSearchString('resistor');
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    const byName = new Map(device.children.map((c) => [c.name, c.score]));
    expect(byName.get('R')).toBeGreaterThan(0);
    expect(byName.get('R_Variable')).toBeGreaterThan(0);
    expect(byName.get('C')).toBe(0);
  });

  it('requires every token to match (AND semantics)', () => {
    const adapter = buildAdapter();
    adapter.updateSearchString('resistor variable');
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    const r = device.children.find((c) => c.name === 'R')!;
    const rvar = device.children.find((c) => c.name === 'R_Variable')!;
    expect(r.score).toBe(0);
    expect(rvar.score).toBeGreaterThan(0);
  });

  it('sorts alphabetically when the sort mode says so', () => {
    const adapter = buildAdapter();
    adapter.setSortMode(SortMode.ALPHABETIC);
    adapter.updateSearchString('');
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    expect(device.children.map((c) => c.name)).toEqual(['C', 'R', 'R_Variable']);
  });
});

describe('LibTreeNode ordering', () => {
  it('keeps the Recently Used group on top, then pinned libraries', () => {
    const adapter = buildAdapter();
    const recent = adapter.addGroup('-- Recently Used --');
    recent.isRecentlyUsedGroup = true;
    makeItemNode(recent, 'Device', 'R');
    const pinned = adapter.addLibrary('Connector', '', true);
    addItem(pinned, 'Conn_01x02');
    adapter.tree.assignIntrinsicRanks();
    adapter.updateSearchString('');
    const names = adapter.tree.children.map((n) => n.name);
    expect(names[0]).toBe('-- Recently Used --');
    expect(names[1]).toBe('Connector');
  });

  it('keeps unit sub-nodes in unit order and inherits match state', () => {
    const parent = new LibTreeNode();
    parent.type = LibTreeNodeType.ROOT;
    const lib = new LibTreeNode();
    lib.type = LibTreeNodeType.LIBRARY;
    lib.name = 'Amplifier_Operational';
    lib.parent = parent;
    parent.children.push(lib);
    const item = addItem(lib, 'LM324', 'quad opamp', 'Quad operational amplifier');
    makeUnitNode(item, 'Unit A', 1);
    makeUnitNode(item, 'Unit B', 2);
    const adapter = new LibTreeModelAdapter();
    adapter.tree.children.push(...parent.children);
    adapter.updateSearchString('lm324');
    expect(item.children.map((u) => u.name)).toEqual(['Unit A', 'Unit B']);
    expect(item.children.every((u) => u.score > 0)).toBe(true);
  });
});
