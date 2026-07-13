/**
 * Archive / Unarchive project logic: KiCad zips the whole project folder,
 * reading each file as a raw byte stream (PROJECT_ARCHIVER::Archive). We do
 * the same — byte-exact entries, re-nested under a folder named for the
 * project (so an archive unzips the way KiCad expects). Pure functions; the
 * download/upload plumbing stays in the launcher component.
 */

import { unzipSync, zipSync } from 'fflate';
import type { PickedHomeFile } from './files.js';
import { inArchiveAllowList } from './projectTree.js';

/** Path relative to the project's own folder ("proj/proj.kicad_sch" ->
 * "proj.kicad_sch", "proj/sub/a.kicad_sch" -> "sub/a.kicad_sch"). */
export const relPath = (name: string): string => {
  const p = name.replace(/\\/g, '/');
  return p.includes('/') ? p.slice(p.indexOf('/') + 1) : p;
};

/**
 * Collect the zip entries for Archive Project: only allow-listed file types
 * (gerbers/backups/images and other stray files are skipped, matching KiCad's
 * archiver), each as raw bytes under `<name>/…`. Returns null when nothing
 * qualifies.
 */
export function archiveEntries(
  files: readonly PickedHomeFile[],
  name: string,
): Record<string, Uint8Array> | null {
  const withBytes = files.filter(
    (f) => f.bytes && f.bytes.length > 0 && inArchiveAllowList(f.name),
  );
  if (withBytes.length === 0) return null;
  const entries: Record<string, Uint8Array> = {};
  for (const f of withBytes) entries[`${name}/${relPath(f.name)}`] = f.bytes!;
  return entries;
}

/** Zip the collected entries (blocking — paint any progress UI first). */
export const zipArchive = (entries: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> =>
  zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>;

/**
 * Expand an uploaded .zip into named byte entries, skipping directory
 * entries and empty files. Returns null when the bytes aren't a valid zip.
 */
export function expandArchive(bytes: Uint8Array): { name: string; data: Uint8Array }[] | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  return Object.entries(entries)
    .filter(([name, data]) => !name.endsWith('/') && data.length > 0)
    .map(([name, data]) => ({ name, data }));
}
