/**
 * 3D model path resolution (counterpart common/filename_resolver.cpp):
 * KiCad's ResolvePath order adapted for the web — the project's own files
 * play the project directory, the hosted library plays ${KICAD*_3DMODEL_DIR}.
 */
import { describe, it, expect } from 'vitest';
import { resolvePath } from '@ziroeda/designer/src/editors/pcb/filename_resolver.js';

const LIB = 'https://models.example';

describe('resolvePath', () => {
  it('resolves ${KICAD*_3DMODEL_DIR} and legacy ${KISYS3DMOD} to the hosted library', () => {
    for (const v of ['KICAD6_3DMODEL_DIR', 'KICAD9_3DMODEL_DIR', 'KISYS3DMOD']) {
      const r = resolvePath(`\${${v}}/Package_DIP.3dshapes/DIP-8_W7.62mm.wrl`, { libBase: LIB });
      expect(r).toEqual({
        kind: 'url',
        url: `${LIB}/Package_DIP.3dshapes/DIP-8_W7.62mm.wrl`,
      });
    }
  });

  it('swaps the extension for hosted assets when libExt is set', () => {
    const r = resolvePath('${KICAD9_3DMODEL_DIR}/Package_DIP.3dshapes/DIP-8_W7.62mm.step', {
      libBase: LIB,
      libExt: 'glb',
    });
    expect(r).toEqual({ kind: 'url', url: `${LIB}/Package_DIP.3dshapes/DIP-8_W7.62mm.glb` });
  });

  it('percent-encodes URL segments (library names contain spaces)', () => {
    const r = resolvePath('${KICAD9_3DMODEL_DIR}/Connector_M.2.3dshapes/M.2 M Key socket.step', {
      libBase: LIB,
      libExt: 'glb',
    });
    expect(r.kind).toBe('url');
    if (r.kind === 'url') expect(r.url).toContain('M.2%20M%20Key%20socket.glb');
  });

  it('${KIPRJMOD} resolves only against project files and fails hard on a miss', () => {
    const projectFiles = ['prj.3dshapes/Jack.wrl', 'board.kicad_pcb'];
    expect(
      resolvePath('${KIPRJMOD}/prj.3dshapes/Jack.wrl', { libBase: LIB, projectFiles }),
    ).toEqual({ kind: 'project', name: 'prj.3dshapes/Jack.wrl' });
    // Upstream: an unresolved ${KIPRJMOD} path never falls back to the library.
    expect(resolvePath('${KIPRJMOD}/missing.wrl', { libBase: LIB, projectFiles })).toEqual({
      kind: 'unresolved',
    });
  });

  it('bare relative paths try the project first (project overrides library), then the library', () => {
    const projectFiles = ['prj.3dshapes/Jack.wrl'];
    // In the project → project file (the coldfire demo's bare "prj.3dshapes/…" form).
    expect(resolvePath('prj.3dshapes/Jack.wrl', { libBase: LIB, projectFiles })).toEqual({
      kind: 'project',
      name: 'prj.3dshapes/Jack.wrl',
    });
    // Not in the project → legacy ${KICADn_3DMODEL_DIR}-relative lookup.
    expect(resolvePath('Resistor_SMD.3dshapes/R_0402_1005Metric.wrl', { libBase: LIB })).toEqual({
      kind: 'url',
      url: `${LIB}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl`,
    });
  });

  it('unknown ${VARS} fail hard like upstream (no library fallback)', () => {
    expect(resolvePath('${MY_MODELS}/foo.wrl', { libBase: LIB })).toEqual({ kind: 'unresolved' });
  });

  it('absolute paths match project files by basename, else rescue via .3dshapes/', () => {
    const projectFiles = ['models/Jack.wrl'];
    expect(resolvePath('C:\\work\\proj\\models\\Jack.wrl', { libBase: LIB, projectFiles })).toEqual(
      { kind: 'project', name: 'models/Jack.wrl' },
    );
    expect(
      resolvePath('/usr/share/kicad/3dmodels/Package_DIP.3dshapes/DIP-8_W7.62mm.wrl', {
        libBase: LIB,
        libExt: 'glb',
      }),
    ).toEqual({ kind: 'url', url: `${LIB}/Package_DIP.3dshapes/DIP-8_W7.62mm.glb` });
  });

  it('embedded-file URIs and :alias: shortcuts are unresolved (not supported yet)', () => {
    expect(resolvePath('kicad-embed://model.step', { libBase: LIB })).toEqual({
      kind: 'unresolved',
    });
    expect(resolvePath(':myalias:sub/model.wrl', { libBase: LIB })).toEqual({
      kind: 'unresolved',
    });
  });
});
