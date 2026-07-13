/**
 * Offline-first project store (IndexedDB), the local half of ZiroEDA's
 * EasyEDA-style cloud persistence. Projects opened or created in the app are
 * saved here so they survive reloads with no login and no backend; a cloud
 * sync layer (Supabase) can later mirror these records.
 *
 * Files are stored as raw BYTES, mirroring KiCad's PROJECT_ARCHIVER, which
 * reads/writes every project file as a byte stream (project_archiver.cpp) so
 * binary files — 3D models (.step/.wrl), PDFs, images — round-trip exactly, not
 * just s-expression text. KiCad text compresses ~10x, so each file is gzipped
 * (CompressionStream) before storage — the 80 MB Jetson board lands at ~8 MB.
 * gzip is transparent: reads detect the magic bytes and fall back to the raw
 * bytes on browsers without CompressionStream. A UTF-8 text file's raw bytes
 * are its encoding, so records written by the older text-based store stay valid.
 */

export interface StoredFile {
  name: string;
  bytes: Uint8Array;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Last time the project was opened (drives Recent Projects order). */
  lastOpenedAt?: number;
  fileCount: number;
  bytes: number; // compressed size on disk
}

interface StoredRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  files: { name: string; gz: Uint8Array }[];
}

const DB_NAME = 'ziroeda';
const STORE = 'projects';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ----- gzip helpers ----------------------------------------------------------

const hasCompression = typeof CompressionStream !== 'undefined';

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasCompression) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  // gzip magic 0x1f 0x8b; anything else is stored raw (older browsers).
  const isGz = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (!isGz || typeof DecompressionStream === 'undefined') return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ----- public API ------------------------------------------------------------

/** Whether IndexedDB is usable in this context (private mode can block it). */
export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Create/replace a project record. Returns the id (generated when omitted). */
export async function saveProject(name: string, files: StoredFile[], id?: string): Promise<string> {
  const now = Date.now();
  const pid = id ?? crypto.randomUUID?.() ?? `p${now}-${Math.random().toString(36).slice(2)}`;
  const gzFiles = await Promise.all(
    files.map(async (f) => ({ name: f.name, gz: await gzip(f.bytes) })),
  );
  // Preserve createdAt when updating an existing record.
  let createdAt = now;
  if (id) {
    const existing = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (existing) createdAt = existing.createdAt;
  }
  const record: StoredRecord = {
    id: pid,
    name,
    createdAt,
    updatedAt: now,
    lastOpenedAt: now,
    files: gzFiles,
  };
  await tx('readwrite', (s) => s.put(record));
  return pid;
}

/** All saved projects, newest first, without decompressing file bodies. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  return (
    all
      .map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        lastOpenedAt: r.lastOpenedAt,
        fileCount: r.files.length,
        bytes: r.files.reduce((n, f) => n + f.gz.byteLength, 0),
      }))
      // Recent = last opened (falls back to last saved for older records).
      .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))
  );
}

/** Autosave: replace only the given files in a project (by name), re-gzipping
 *  just those and leaving every other file (pcb, models, binaries) untouched. */
export async function updateProjectFiles(id: string, changed: StoredFile[]): Promise<void> {
  if (changed.length === 0) return;
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return;
  const byName = new Map(r.files.map((f) => [f.name, f]));
  for (const f of changed) byName.set(f.name, { name: f.name, gz: await gzip(f.bytes) });
  r.files = [...byName.values()];
  r.updatedAt = Date.now();
  await tx('readwrite', (s) => s.put(r));
}

/** Mark a project as just opened (reorders Recent without touching updatedAt,
 *  so it doesn't trigger a needless cloud sync). */
export async function touchOpened(id: string): Promise<void> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return;
  r.lastOpenedAt = Date.now();
  await tx('readwrite', (s) => s.put(r));
}

/** Load a project's files (decompressed), or null if it no longer exists. */
export async function loadProject(
  id: string,
): Promise<{ meta: ProjectMeta; files: StoredFile[] } | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  const files = await Promise.all(
    r.files.map(async (f) => ({ name: f.name, bytes: await gunzip(f.gz) })),
  );
  return {
    meta: {
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      fileCount: r.files.length,
      bytes: r.files.reduce((n, f) => n + f.gz.byteLength, 0),
    },
    files,
  };
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function renameProject(id: string, name: string): Promise<void> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return;
  r.name = name;
  r.updatedAt = Date.now();
  await tx('readwrite', (s) => s.put(r));
}

// ----- cloud-sync serialization ----------------------------------------------

/** A project record in a JSON-serializable form (gzipped file bytes as base64),
 *  shared by the IndexedDB store and the Supabase cloud store. */
export interface SyncableProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: { name: string; gzB64: string }[];
}

function bytesToB64(u8: Uint8Array): string {
  let s = '';
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/** id + updatedAt for every local project, for cheap sync diffing. */
export async function listSyncMeta(): Promise<{ id: string; updatedAt: number }[]> {
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  return all.map((r) => ({ id: r.id, updatedAt: r.updatedAt }));
}

/** Export a stored project to its serializable (base64) form, or null if gone. */
export async function exportProject(id: string): Promise<SyncableProject | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    files: r.files.map((f) => ({ name: f.name, gzB64: bytesToB64(f.gz) })),
  };
}

/** Write a project from its serializable form, preserving its timestamps. */
export async function importProject(p: SyncableProject): Promise<void> {
  const record: StoredRecord = {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    files: p.files.map((f) => ({ name: f.name, gz: b64ToBytes(f.gzB64) })),
  };
  await tx('readwrite', (s) => s.put(record));
}
