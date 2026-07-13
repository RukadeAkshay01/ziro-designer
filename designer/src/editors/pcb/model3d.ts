/**
 * Resolve a footprint's 3D-model path (KiCad `(model …)`) to something we can
 * fetch. KiCad paths are env-var references — the installed library
 * (${KICAD*_3DMODEL_DIR} / legacy ${KISYS3DMOD}) or project-local (${KIPRJMOD}).
 *
 * We host the standard library ourselves (pre-converted to glTF), so a library
 * reference becomes a URL under `libBase`; a project reference resolves to a
 * file that came in the uploaded project. See [[ziro-3d-components-plan]].
 */

export type ResolvedModel =
  | { kind: 'url'; url: string } // hosted library asset
  | { kind: 'project'; name: string } // a file in the uploaded project
  | { kind: 'unresolved' };

export interface ResolveOpts {
  /** Base URL of our hosted model library (no trailing slash needed). */
  libBase: string;
  /** If set, swap the model extension to this (e.g. 'glb' when we host glTF). */
  libExt?: string;
  /** Relative names of files that came with the project (for ${KIPRJMOD}). */
  projectFiles?: string[];
}

// ${KICAD6_3DMODEL_DIR}, ${KICAD9_3DMODEL_DIR}, legacy ${KISYS3DMOD}, …
const LIB_ENV = /^\$\{(?:KICAD\d*_3DMODEL_DIR|KISYS3DMOD)\}[/\\]?/;
const PRJ_ENV = /^\$\{KIPRJMOD\}[/\\]?/;

const swapExt = (rel: string, ext?: string): string =>
  ext ? rel.replace(/\.(wrl|wrz|step|stp|stpz|x3d|iges|igs)$/i, `.${ext}`) : rel;

const joinUrl = (base: string, rel: string): string =>
  `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;

// A project reference matches a file by full relative path or by basename.
function findInProject(rel: string, files: string[] | undefined): ResolvedModel {
  if (!files || files.length === 0) return { kind: 'unresolved' };
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/^\.\//, '');
  const target = norm(rel);
  const base = target.split('/').pop()!;
  const hit =
    files.find((f) => norm(f) === target) ?? files.find((f) => norm(f).split('/').pop() === base);
  return hit ? { kind: 'project', name: hit } : { kind: 'unresolved' };
}

/** Resolve a `(model …)` path to a hosted URL or a project file. */
export function resolveModel(path: string, opts: ResolveOpts): ResolvedModel {
  const p = path.replace(/\\/g, '/').trim();

  if (PRJ_ENV.test(p)) return findInProject(p.replace(PRJ_ENV, ''), opts.projectFiles);

  if (LIB_ENV.test(p)) {
    return {
      kind: 'url',
      url: joinUrl(opts.libBase, swapExt(p.replace(LIB_ENV, ''), opts.libExt)),
    };
  }

  // No env var: an absolute or bare/relative path. Prefer a project file (bundled
  // model); otherwise, if it looks like a library sub-path, host-resolve it.
  const inPrj = findInProject(p, opts.projectFiles);
  if (inPrj.kind === 'project') return inPrj;
  if (/\.3dshapes\//i.test(p))
    return {
      kind: 'url',
      url: joinUrl(opts.libBase, swapExt(p.replace(/^.*?([^/]+\.3dshapes\/)/i, '$1'), opts.libExt)),
    };
  return { kind: 'unresolved' };
}
