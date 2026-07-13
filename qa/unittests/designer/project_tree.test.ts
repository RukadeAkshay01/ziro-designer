/**
 * Launcher project-tree logic: directory reconstruction, KiCad-compatible
 * ordering (dirs first, root files first, case-insensitive), the archive
 * allow-list, and hidden-file filtering.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDirTree,
  inArchiveAllowList,
  isHiddenFile,
  isRootFileName,
  fmtBytes,
} from '@ziroeda/designer/src/home/project_tree.js';
import type { PickedHomeFile } from '@ziroeda/designer/src/home/files.js';

const f = (name: string): PickedHomeFile => ({ name, text: '' });

describe('buildDirTree', () => {
  it('reconstructs nested folders and strips the picked-folder prefix', () => {
    const root = buildDirTree(
      [f('proj/proj.kicad_sch'), f('proj/lib/CM5IO.pretty/pad.kicad_mod')],
      'proj/',
      'proj',
    );
    expect(root.children.map((c) => c.name)).toEqual(['lib', 'proj.kicad_sch']);
    const lib = root.children[0]!;
    expect(lib.isDir).toBe(true);
    expect(lib.children[0]!.name).toBe('CM5IO.pretty');
    expect(lib.children[0]!.children[0]!.file).toBeDefined();
  });

  it('orders directories first, then root files, then case-insensitive names', () => {
    const root = buildDirTree(
      [f('zeta.txt'), f('proj-cache.lib'), f('proj.kicad_sch'), f('Alpha.txt'), f('sub/x.txt')],
      '',
      'proj',
    );
    expect(root.children.map((c) => c.name)).toEqual([
      'sub', // directory first
      'proj-cache.lib', // root files (project-name prefix) before others
      'proj.kicad_sch',
      'Alpha.txt', // then case-insensitive alphabetical
      'zeta.txt',
    ]);
  });

  it('normalises backslash paths', () => {
    const root = buildDirTree([f('proj\\sub\\a.txt')], 'proj/', 'proj');
    expect(root.children[0]!.name).toBe('sub');
  });
});

describe('archive allow-list', () => {
  it('accepts design files, gerbers, and library tables', () => {
    expect(inArchiveAllowList('board.kicad_pcb')).toBe(true);
    expect(inArchiveAllowList('out/top.gbr')).toBe(true);
    expect(inArchiveAllowList('out/copper.gtl')).toBe(true);
    expect(inArchiveAllowList('fp-lib-table')).toBe(true);
  });

  it('rejects unrelated files', () => {
    expect(inArchiveAllowList('node_modules/x.tgz')).toBe(false);
    expect(inArchiveAllowList('README')).toBe(false);
  });
});

describe('hidden files and root names', () => {
  it('hides config/lock/backup and dotfiles like the desktop project tree', () => {
    expect(isHiddenFile('.git')).toBe(true);
    expect(isHiddenFile('proj.kicad_pro')).toBe(true);
    expect(isHiddenFile('proj.lck')).toBe(true);
    expect(isHiddenFile('proj-backups')).toBe(true);
    expect(isHiddenFile('proj.kicad_sch')).toBe(false);
  });

  it('detects root files by project-name basename', () => {
    expect(isRootFileName('proj.kicad_sch', 'proj')).toBe(true);
    expect(isRootFileName('proj-rescue.lib', 'proj')).toBe(true);
    expect(isRootFileName('other.kicad_sch', 'proj')).toBe(false);
    expect(isRootFileName('anything', '')).toBe(false);
  });
});

describe('fmtBytes', () => {
  it('formats B / KB / MB', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
