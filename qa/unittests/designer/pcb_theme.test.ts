/**
 * PCB color themes (designer/src/editors/pcb/pcbTheme.ts): the two built-in
 * COLOR_SETTINGS palettes from common/settings/builtin_color_themes.h and the
 * synthetic black-and-white print palette.
 */
import { describe, it, expect } from 'vitest';
import {
  PCB_BW_PRINT_THEME,
  PCB_LAYER_COLORS,
  PCB_THEMES,
  themeByFilename,
} from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

describe('pcb color themes', () => {
  it('registers the two KiCad built-ins under their COLOR_SETTINGS filenames', () => {
    expect(PCB_THEMES.map((t) => t.filename)).toEqual(['_builtin_default', '_builtin_classic']);
    expect(PCB_THEMES.map((t) => t.name)).toEqual(['KiCad Default', 'KiCad Classic']);
    expect(themeByFilename('_builtin_classic').name).toBe('KiCad Classic');
    // Unknown filename falls back to the default theme.
    expect(themeByFilename('no_such_theme').filename).toBe('_builtin_default');
  });

  it('default theme is the existing s_defaultTheme palette', () => {
    const dflt = themeByFilename('_builtin_default');
    expect(dflt.layerColors).toBe(PCB_LAYER_COLORS);
    expect(dflt.background).toBe('rgb(0,16,35)');
  });

  it('classic theme matches s_classicTheme (legacy colorRefs are B,G,R)', () => {
    const classic = themeByFilename('_builtin_classic');
    expect(classic.background).toBe('rgb(0,0,0)'); // LAYER_PCB_BACKGROUND = BLACK
    expect(classic.layerColors['F.Cu']).toBe('rgb(132,0,0)'); // RED
    expect(classic.layerColors['B.Cu']).toBe('rgb(0,132,0)'); // GREEN
    expect(classic.layerColors['In1.Cu']).toBe('rgb(194,194,0)'); // YELLOW
    expect(classic.layerColors['In2.Cu']).toBe('rgb(194,0,194)'); // LIGHTMAGENTA
    expect(classic.layerColors['In30.Cu']).toBe('rgb(0,0,132)'); // BLUE
    expect(classic.layerColors['F.SilkS']).toBe('rgb(0,132,132)'); // CYAN
    expect(classic.layerColors['B.Mask']).toBe('rgb(132,132,0)'); // BROWN
    expect(classic.layerColors['Edge.Cuts']).toBe('rgb(194,194,0)'); // YELLOW
    expect(classic.layerColors['B.Paste']).toBe('rgb(0,194,194)'); // LIGHTCYAN
    expect(classic.layerColors['User.1']).toBe('rgb(0,0,132)'); // BLUE
    expect(classic.special.drawingSheet).toBe('rgb(72,0,0)'); // DARKRED
    expect(classic.special.viaHoleWall).toBe('rgb(255,255,255)'); // WHITE
    // Every layer the default theme names is covered by the classic theme.
    for (const name of Object.keys(PCB_LAYER_COLORS))
      expect(classic.layerColors[name], name).toBeDefined();
  });

  it('black-and-white print palette is all black on white', () => {
    expect(PCB_BW_PRINT_THEME.background).toBe('rgb(255,255,255)');
    const colors = new Set(Object.values(PCB_BW_PRINT_THEME.layerColors));
    expect([...colors]).toEqual(['rgb(0,0,0)']);
    // Hole interiors read as paper; walls print black.
    expect(PCB_BW_PRINT_THEME.special.viaHole).toBe('rgb(255,255,255)');
    expect(PCB_BW_PRINT_THEME.special.viaHoleWall).toBe('rgb(0,0,0)');
  });
});
