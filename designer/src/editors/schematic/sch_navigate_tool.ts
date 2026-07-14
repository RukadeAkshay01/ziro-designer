/**
 * Hierarchy navigation. Counterpart: `eeschema/tools/sch_navigate_tool.cpp`
 * (SCH_NAVIGATE_TOOL): a linear history of visited sheet instances for
 * Back/Forward, path-pop for Up/Leave Sheet, and the depth-first hierarchy
 * order (SCH_SHEET_LIST virtual page numbers) for Previous/Next Sheet.
 */

import type { SheetTreeNode } from '@ziroeda/eeschema';

export interface SheetRef {
  path: string;
  file: string;
}

/** Depth-first flattening of the hierarchy — KiCad's Schematic().Hierarchy()
 *  order, which defines the virtual page numbers Previous/Next step through. */
export function flattenHierarchy(root: SheetTreeNode): SheetRef[] {
  const out: SheetRef[] = [];
  const walk = (n: SheetTreeNode): void => {
    out.push({ path: n.path, file: n.file });
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Parent instance path (SCH_SHEET_PATH::pop_back): "/a/b/" → "/a/"; the root
 *  has no parent (CanGoUp() is false on a top-level sheet). */
export function parentPath(path: string): string | null {
  if (path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}/` : '/';
}

/** The Back/Forward history (m_navHistory + m_navIndex). Paths only — the
 *  file for a path comes from the flattened hierarchy at use time. */
export class SchNavigateTool {
  private history: string[] = ['/'];
  private index = 0;

  /** ResetHistory(): restart at the given (current) sheet. */
  resetHistory(path: string): void {
    this.history = [path];
    this.index = 0;
  }

  /** CleanHistory(): drop entries that no longer exist in the hierarchy, and
   *  collapse consecutive duplicates that removal creates. */
  cleanHistory(valid: ReadonlySet<string>): void {
    const kept: string[] = [];
    for (const p of this.history) {
      if (!valid.has(p)) continue;
      if (kept.length > 0 && kept[kept.length - 1] === p) continue;
      kept.push(p);
    }
    this.history = kept.length ? kept : ['/'];
    this.index = this.history.length <= 1 ? 0 : this.history.length - 1;
  }

  canGoBack(): boolean {
    return this.index > 0;
  }

  canGoForward(): boolean {
    return this.index < this.history.length - 1;
  }

  /** Back(): move the cursor without re-pushing; null when at the beginning. */
  back(): string | null {
    return this.canGoBack() ? this.history[--this.index]! : null;
  }

  /** Forward(): move the cursor without re-pushing; null when at the end. */
  forward(): string | null {
    return this.canGoForward() ? this.history[++this.index]! : null;
  }

  /** pushToHistory(): a sheet change truncates any forward tail and appends
   *  (skipping a consecutive duplicate of the tail entry). */
  pushToHistory(path: string): void {
    if (this.canGoForward()) this.history.length = this.index + 1;
    if (this.history.length === 0 || this.history[this.history.length - 1] !== path)
      this.history.push(path);
    this.index = this.history.length - 1;
  }
}
