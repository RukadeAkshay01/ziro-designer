/**
 * Two-way project sync between IndexedDB (local) and Supabase (cloud).
 *
 * Strategy: last-write-wins by `updatedAt`. On sign-in we reconcile the union
 * of local + cloud ids — newer copy wins, missing copies are copied across.
 * Individual saves/deletes also mirror to the cloud while online (see HomePage),
 * so this full pass is mainly for first sign-in on a new device.
 *
 * Known MVP limitation: a delete made offline can be resurrected by the other
 * side on next sync (no tombstones yet). Deletes while online propagate fine.
 */

import { authEnabled } from '../auth/supabaseClient.js';
import { exportProject, importProject, listSyncMeta } from '../home/projectStore.js';
import { cloudDelete, cloudGet, cloudListMeta, cloudUpsert } from './cloudStore.js';

/** Reconcile all local and cloud projects for the signed-in user. */
export async function syncAllProjects(userId: string): Promise<void> {
  if (!authEnabled) return;

  const [localMeta, cloudMeta] = await Promise.all([listSyncMeta(), cloudListMeta()]);
  const local = new Map(localMeta.map((m) => [m.id, m.updatedAt]));
  const cloud = new Map(cloudMeta.map((m) => [m.id, m.updatedAt]));

  const ids = new Set([...local.keys(), ...cloud.keys()]);
  const pushes: Promise<void>[] = [];
  const pulls: Promise<void>[] = [];

  for (const id of ids) {
    const lt = local.get(id);
    const ct = cloud.get(id);

    if (lt !== undefined && ct === undefined) {
      pushes.push(pushOne(userId, id));
    } else if (lt === undefined && ct !== undefined) {
      pulls.push(pullOne(id));
    } else if (lt !== undefined && ct !== undefined && lt !== ct) {
      if (lt > ct) pushes.push(pushOne(userId, id));
      else pulls.push(pullOne(id));
    }
  }

  await Promise.all([...pushes, ...pulls]);
}

async function pushOne(userId: string, id: string): Promise<void> {
  const p = await exportProject(id);
  if (p) await cloudUpsert(userId, p);
}

async function pullOne(id: string): Promise<void> {
  const p = await cloudGet(id);
  if (p) await importProject(p);
}

/** Mirror a single saved project up to the cloud (best-effort). */
export async function pushProject(userId: string, id: string): Promise<void> {
  if (!authEnabled) return;
  await pushOne(userId, id);
}

/** Mirror a delete up to the cloud (best-effort). */
export async function deleteCloudProject(id: string): Promise<void> {
  if (!authEnabled) return;
  await cloudDelete(id);
}
