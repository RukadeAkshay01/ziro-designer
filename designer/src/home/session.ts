/**
 * Persist the last app view across reloads (localStorage), so a page refresh
 * doesn't dump you back to an empty home screen. Only the *navigation* is stored
 * here — the project's files live in IndexedDB (projectStore), and on restore we
 * reopen the most-recently-opened project (top of Recent, ordered by
 * lastOpenedAt) into the saved view.
 *
 * Note: unsaved editor edits are not preserved (that needs autosave) — restore
 * reopens the last saved project.
 */
export interface Session {
  view: 'home' | 'schematic' | 'pcb' | 'symbols' | 'footprints' | 'calculator' | 'drawingsheet';
  startFile?: string | null;
}

const KEY = 'ziro.session';

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export function loadSession(): Session | null {
  try {
    const v = localStorage.getItem(KEY);
    const s = v ? (JSON.parse(v) as Session) : null;
    return s &&
      ['home', 'schematic', 'pcb', 'symbols', 'footprints', 'calculator', 'drawingsheet'].includes(
        s.view,
      )
      ? s
      : null;
  } catch {
    return null;
  }
}
