/**
 * Offline-first project store (IndexedDB), the local half of ZiroEDA's
 * EasyEDA-style cloud persistence. Projects opened or created in the app are
 * saved here so they survive reloads with no login and no backend; a cloud
 * sync layer (Supabase) can later mirror these records.
 *
 * KiCad projects are s-expression TEXT, which compresses ~10x, so each file is
 * gzipped (CompressionStream) before storage — the 80 MB Jetson board lands at
 * ~8 MB. gzip is transparent: reads detect the magic bytes and fall back to raw
 * text on browsers without CompressionStream.
 */

export interface StoredFile {
  name: string;
  text: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  bytes: number; // compressed size on disk
}

interface StoredRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
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

async function gzip(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  if (!hasCompression) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<string> {
  // gzip magic 0x1f 0x8b; anything else is stored raw (older browsers).
  const isGz = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (!isGz || typeof DecompressionStream === 'undefined') return new TextDecoder().decode(data);
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// ----- public API ------------------------------------------------------------

/** Whether IndexedDB is usable in this context (private mode can block it). */
export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Create/replace a project record. Returns the id (generated when omitted). */
export async function saveProject(name: string, files: StoredFile[], id?: string): Promise<string> {
  const now = Date.now();
  const pid = id ?? (crypto.randomUUID?.() ?? `p${now}-${Math.random().toString(36).slice(2)}`);
  const gzFiles = await Promise.all(files.map(async (f) => ({ name: f.name, gz: await gzip(f.text) })));
  // Preserve createdAt when updating an existing record.
  let createdAt = now;
  if (id) {
    const existing = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (existing) createdAt = existing.createdAt;
  }
  const record: StoredRecord = { id: pid, name, createdAt, updatedAt: now, files: gzFiles };
  await tx('readwrite', (s) => s.put(record));
  return pid;
}

/** All saved projects, newest first, without decompressing file bodies. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  return all
    .map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      fileCount: r.files.length,
      bytes: r.files.reduce((n, f) => n + f.gz.byteLength, 0),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load a project's files (decompressed), or null if it no longer exists. */
export async function loadProject(id: string): Promise<{ meta: ProjectMeta; files: StoredFile[] } | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  const files = await Promise.all(r.files.map(async (f) => ({ name: f.name, text: await gunzip(f.gz) })));
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
