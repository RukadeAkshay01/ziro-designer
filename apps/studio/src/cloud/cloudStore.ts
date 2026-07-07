/**
 * Supabase-backed project store — the cloud half of Ziro Designer's
 * persistence. Mirrors the IndexedDB API in ../home/projectStore, operating on
 * the same `SyncableProject` shape (gzipped files, base64-encoded).
 *
 * All rows are scoped to the signed-in user by Row Level Security (see
 * supabase/projects.sql); the client just passes user_id on writes.
 */

import { supabase } from '../auth/supabaseClient.js';
import type { SyncableProject } from '../home/projectStore.js';

interface Row {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  files: { name: string; gzB64: string }[];
}

function rowToProject(r: Row): SyncableProject {
  return {
    id: r.id,
    name: r.name,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    files: r.files ?? [],
  };
}

/** id + updatedAt for every cloud project of the signed-in user. */
export async function cloudListMeta(): Promise<{ id: string; updatedAt: number }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('projects').select('id, updated_at');
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, updatedAt: new Date(r.updated_at).getTime() }));
}

/** Fetch a single cloud project (with file bodies), or null if absent. */
export async function cloudGet(id: string): Promise<SyncableProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToProject(data as Row) : null;
}

/** Insert or update a project for the given user. */
export async function cloudUpsert(userId: string, p: SyncableProject): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('projects').upsert({
    id: p.id,
    user_id: userId,
    name: p.name,
    created_at: new Date(p.createdAt).toISOString(),
    updated_at: new Date(p.updatedAt).toISOString(),
    files: p.files,
  });
  if (error) throw error;
}

export async function cloudDelete(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
