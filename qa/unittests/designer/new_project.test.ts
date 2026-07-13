/**
 * File > New Project scaffolding: the generated files must be valid by our
 * own engines — a fresh project that fails to parse would be dead on arrival.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { readBoard } from '@ziroeda/pcbnew';
import {
  copyProjectFiles,
  newProjectFiles,
  sanitizeProjectName,
} from '@ziroeda/designer/src/home/new_project.js';

describe('newProjectFiles', () => {
  const files = newProjectFiles('MyBoard');

  it('creates the three project files under the project folder', () => {
    expect(files.map((f) => f.name)).toEqual([
      'MyBoard/MyBoard.kicad_pro',
      'MyBoard/MyBoard.kicad_sch',
      'MyBoard/MyBoard.kicad_pcb',
    ]);
    for (const f of files) expect(f.bytes).toBeDefined();
  });

  it('generates a schematic our own reader accepts', () => {
    const sch = readSchematic(parse(files[1]!.text));
    expect(sch.symbols).toHaveLength(0);
    expect(sch.paper).toBe('A4');
  });

  it('generates a board our own reader accepts, with the default 2-layer stack', () => {
    const board = readBoard(parse(files[2]!.text));
    expect(board.layers.some((l) => l.name === 'F.Cu')).toBe(true);
    expect(board.layers.some((l) => l.name === 'B.Cu')).toBe(true);
  });

  it('ties the project file to the root schematic uuid', () => {
    const pro = JSON.parse(files[0]!.text) as {
      meta: { filename: string };
      sheets: [string, string][];
    };
    expect(pro.meta.filename).toBe('MyBoard.kicad_pro');
    expect(files[1]!.text).toContain(`(uuid "${pro.sheets[0]![0]}")`);
  });
});

describe('sanitizeProjectName', () => {
  it('strips filesystem-invalid characters and trims', () => {
    expect(sanitizeProjectName(' my/pro:ject*? ')).toBe('myproject');
    expect(sanitizeProjectName('a<b>c|d"e\\f')).toBe('abcdef');
  });
});

describe('copyProjectFiles (Save As)', () => {
  it('renames the project folder and name-matching stems, keeps the rest', () => {
    const src = newProjectFiles('Old');
    const extra = { name: 'Old/notes.txt', text: 'n' };
    const out = copyProjectFiles([...src, extra], 'Old/', 'Old', 'New');
    expect(out.map((f) => f.name)).toEqual([
      'New/New.kicad_pro',
      'New/New.kicad_sch',
      'New/New.kicad_pcb',
      'New/notes.txt',
    ]);
  });
});
