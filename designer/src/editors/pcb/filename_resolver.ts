/**
 * Resolve a footprint's 3D-model path (KiCad `(model …)`) to something we can
 * fetch. Counterpart: `common/filename_resolver.cpp` (FILENAME_RESOLVER::
 * ResolvePath), ported for the web: "file exists on disk" becomes membership in
 * the uploaded project's file list, and the installed 3D library
 * (${KICAD*_3DMODEL_DIR}) becomes a hosted URL under `libBase`.
 *
 * Upstream resolution order, kept here:
 *   1. normalise separators, expand env-var substitutions;
 *   2. `kicad-embed://` URIs → embedded files (not modelled yet → unresolved);
 *   3. the name as specified, if it exists (for us: an exact project file);
 *   4. a `${VAR}` that failed to expand fails hard — no library fallback;
 *   5. bare/relative paths try the project directory FIRST (so a project can
 *      override a library model), then ${KICADn_3DMODEL_DIR};
 *   6. `:alias:` shortcuts (user aliases not supported yet → unresolved).
 *
 * Web-specific additions, marked below: matching project files by basename
 * (absolute paths from someone else's disk can never exist in a browser), and
 * rescuing absolute paths that point into a standard library install by their
 * `<Lib>.3dshapes/` suffix.
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
// Both ${VAR} and $(VAR) forms, as upstream accepts either.
const LIB_ENV = /^[$][{(](?:KICAD\d*_3DMODEL_DIR|KISYS3DMOD)[})][/\\]?/;
const PRJ_ENV = /^[$][{(]KIPRJMOD[})][/\\]?/;
const ANY_ENV = /^[$][{(][^})]*[})]/;

const swapExt = (rel: string, ext?: string): string =>
  ext ? rel.replace(/\.(wrl|wrz|step|stp|stpz|x3d|iges|igs)$/i, `.${ext}`) : rel;

/** Join base URL + relative path, percent-encoding each path segment (library
 *  models legitimately contain spaces, e.g. "M.2 M Key socket"). */
const joinUrl = (base: string, rel: string): string =>
  `${base.replace(/\/+$/, '')}/${rel
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

const norm = (s: string): string => s.replace(/\\/g, '/').replace(/^\.\//, '');

// A project reference matches a file by full relative path or — web-specific —
// by basename (KiCad checks wxFileName::FileExists on the user's disk; an
// uploaded project has no disk, so a path recorded on another machine can only
// be matched by its final component).
function findInProject(rel: string, files: string[] | undefined): ResolvedModel {
  if (!files || files.length === 0) return { kind: 'unresolved' };
  const target = norm(rel);
  const base = target.split('/').pop()!;
  const hit =
    files.find((f) => norm(f) === target) ?? files.find((f) => norm(f).split('/').pop() === base);
  return hit ? { kind: 'project', name: hit } : { kind: 'unresolved' };
}

/** Resolve a `(model …)` path to a hosted URL or a project file
 *  (FILENAME_RESOLVER::ResolvePath). */
export function resolvePath(path: string, opts: ResolveOpts): ResolvedModel {
  const p = path.replace(/\\/g, '/').trim();
  if (!p) return { kind: 'unresolved' };

  // Embedded-file URIs (kicad-embed://…): the document model does not carry
  // embedded files yet, so these cannot resolve.
  if (p.startsWith('kicad-embed://')) return { kind: 'unresolved' };

  // ${KIPRJMOD}: strictly the project directory. Upstream expands the var and
  // requires the file to exist — a miss fails hard, it never falls back to the
  // library.
  if (PRJ_ENV.test(p)) return findInProject(p.replace(PRJ_ENV, ''), opts.projectFiles);

  // ${KICAD*_3DMODEL_DIR} / ${KISYS3DMOD}: the installed library → hosted URL.
  if (LIB_ENV.test(p)) {
    return {
      kind: 'url',
      url: joinUrl(opts.libBase, swapExt(p.replace(LIB_ENV, ''), opts.libExt)),
    };
  }

  // Any other ${VAR}/$(VAR) cannot expand here (no environment, and user path
  // aliases are not supported yet) — upstream fails hard in this case too.
  if (ANY_ENV.test(p)) return { kind: 'unresolved' };

  // Legacy `:alias:rest` shortcuts: user aliases are not supported yet.
  if (p.startsWith(':')) return { kind: 'unresolved' };

  // No env var: a bare/relative or absolute path. The project directory is
  // checked BEFORE the library so a project-local file can override a library
  // model (upstream checks m_paths.front() = ${KIPRJMOD} first for exactly
  // this reason).
  const inPrj = findInProject(p, opts.projectFiles);
  if (inPrj.kind === 'project') return inPrj;

  // Then the partial path relative to ${KICADn_3DMODEL_DIR} (legacy behavior;
  // upstream tries this for any remaining relative path). Absolute paths get
  // the web-specific `.3dshapes/` rescue: a path into some machine's library
  // install resolves to the same model in our hosted library.
  if (!p.startsWith('/') && !/^[A-Za-z]:\//.test(p)) {
    return { kind: 'url', url: joinUrl(opts.libBase, swapExt(p, opts.libExt)) };
  }
  if (/\.3dshapes\//i.test(p)) {
    return {
      kind: 'url',
      url: joinUrl(opts.libBase, swapExt(p.replace(/^.*?([^/]+\.3dshapes\/)/i, '$1'), opts.libExt)),
    };
  }
  return { kind: 'unresolved' };
}
