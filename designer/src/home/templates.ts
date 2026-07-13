/**
 * Project templates — KiCad's "New Project from Template" (project_template.cpp,
 * kicad_manager_control.cpp). A template is a folder with a .kicad_pro/sch/pcb,
 * footprint libs, and meta/info.html (title + description) + meta/icon.png. We
 * bundle KiCad's standard templates under /templates and describe them in
 * /templates/index.json (built by scripts). Creating a project copies the files
 * and renames those named after the template to the new project name — exactly
 * like PROJECT_TEMPLATE::CreateProject — except drawing sheets and libraries,
 * which stay put so their references don't break.
 */
import type { PickedHomeFile } from './HomePage.js';

export interface TemplateMeta {
  id: string;
  base: string; // the template's .kicad_pro basename (what gets renamed)
  title: string;
  description: string;
  icon: string | null;
  files: string[]; // project files, relative to the template folder
}

const dec = new TextDecoder();

/** Load the bundled template manifest (empty on failure — feature just hides). */
export async function loadTemplates(): Promise<TemplateMeta[]> {
  try {
    const res = await fetch('/templates/index.json');
    if (!res.ok) return [];
    const j = (await res.json()) as { templates: TemplateMeta[] };
    return j.templates ?? [];
  } catch {
    return [];
  }
}

// KiCad's CreateProject rename: swap the template basename for the project name
// in file/dir names, but leave drawing sheets, legacy sym libs and .pretty
// footprint-lib directories untouched (renaming them breaks the lib tables).
function renameRel(rel: string, base: string, projectName: string): string {
  const parts = rel.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1]!;
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const inPretty = parts.some((p) => /\.pretty$/i.test(p));
  const keep =
    inPretty ||
    ext === 'kicad_wks' ||
    ext === 'lib' ||
    ext === 'dcm' ||
    fileName === 'fp-lib-table' ||
    fileName === 'sym-lib-table';
  const newName = keep ? fileName : fileName.split(base).join(projectName);
  const dirs = parts
    .slice(0, -1)
    .map((seg) =>
      seg === base
        ? projectName
        : seg.startsWith(`${base}-`)
          ? projectName + seg.slice(base.length)
          : seg,
    );
  return [...dirs, newName].join('/');
}

const encodeRel = (rel: string): string => rel.split('/').map(encodeURIComponent).join('/');

/**
 * Build a new project's files from a template: fetch each file, rename it, and
 * nest everything under a folder named for the project (mirrors KiCad's copy).
 * Contents are copied verbatim, like KiCad — only names change.
 */
export async function createFromTemplate(
  t: TemplateMeta,
  projectName: string,
): Promise<PickedHomeFile[]> {
  const out: PickedHomeFile[] = [];
  for (const rel of t.files) {
    const res = await fetch(`/templates/${encodeURIComponent(t.id)}/${encodeRel(rel)}`);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const renamed = renameRel(rel, t.base, projectName);
    out.push({ name: `${projectName}/${renamed}`, text: dec.decode(bytes), bytes });
  }
  return out;
}
