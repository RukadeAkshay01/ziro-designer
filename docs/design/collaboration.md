# Real-time collaboration — design & working documentation

> Design doc for roadmap item 6 (*Collaboration — multiplayer*). Nothing here is
> built yet; this is the plan plus reference frontend/backend implementations.

Goal: a Canva-style "who's doing what" experience — live cursors, presence,
selection highlights, soft edit locks, and (later) true concurrent co-editing.

## 1. Two separate problems

Canva's feel is really two features with very different costs. Keep them apart.

| | **Awareness** (who's here / doing what) | **Co-editing** (concurrent doc changes) |
|---|---|---|
| Data | Ephemeral: cursors, selections | Durable: the `.kicad_*` content |
| On conflict | Doesn't matter | Must not lose work (locks / CRDT) |
| Saved to file? | Never | Yes, round-trip-critical |
| Effort | Days | Weeks–months |

**~80% of the "wow" is the awareness layer, and it never touches the saved
file — so it carries zero correctness risk. Ship it first.** Treat true
co-editing as a separate, later project.

## 2. Why the codebase fits this

- **Supabase is already a dependency** and auth is wired (`AuthProvider.tsx`,
  `useAuth()`). Supabase **Realtime** gives Presence + Broadcast with no new
  backend.
- **Edits are already serializable commands** — `EditCommand { apply, invert }`
  in `eeschema/src/tools/command.ts`. That command is the unit we broadcast.
- **Items have stable ids** (`refId`) and coords are **integer internal units** —
  both serialize cleanly for "who selected what" and cursor sync.

Two constraints from `PHILOSOPHY.md`: collaboration state stays in sidecar
storage, never in `.kicad_*` files; and saved files must round-trip into desktop
KiCad byte-for-byte (this is what makes Layer 3 hard). Note the current
`sync.ts` is **whole-blob last-write-wins** — fine for device sync, but it will
clobber a concurrent co-editor.

## 3. Options at a glance

| Option | Presence | Co-edit model | New infra | Best when |
|---|---|---|---|---|
| **Supabase Realtime** (recommended) | ✅ built-in | Command broadcast, or Yjs over broadcast | None | Reuse existing stack |
| **Liveblocks** | ✅ | Managed CRDT / Yjs | Managed SaaS | Fastest to polished multiplayer |
| **Yjs + Hocuspocus** | ✅ | Yjs CRDT | A Node WS server | CRDT with full control |
| **PartyKit / Cloudflare DO** | ✅ | You write the server | CF Workers | Edge latency, custom rules |
| **y-webrtc (P2P)** | ✅ | Yjs, peer-to-peer | Signaling only | Small rooms, minimal cost |
| **Ably / Pusher** | ✅ | Build yourself | Managed SaaS | Presence-only alt to Supabase |
| **ElectricSQL / PowerSync** | partial | Local-first Postgres sync | Sync service | Whole-app offline-first |
| **Automerge** | ✅ | CRDT (richer history) | depends | Branch/history-heavy needs |

**Recommendation:** Supabase Realtime for Layers 1–2 (no new infra). For Layer 3,
choose between **Yjs over Supabase Broadcast** (no infra, you own persistence)
and **Liveblocks** (fastest, managed) once you commit to concurrent editing.

## 4. Layer 1 — Presence & awareness (the Canva feel)

One channel per open project. Two message kinds:

- **Presence** (synced per user, low-frequency): identity + `selection` + `file`
  + an `editing` flag. Cursor position uses **world coordinates**, since each
  peer has a different pan/zoom.
- **Broadcast** (high-frequency, not persisted): cursor moves, throttled.

### Backend — authorize private channels

No schema needed for Presence/Broadcast, but gate the channel to members via RLS
on `realtime.messages` (references `project_members` from §6):

```sql
alter table realtime.messages enable row level security;

create policy "members_use_channel" on realtime.messages
  for select to authenticated using (
    exists (select 1 from public.project_members m
      where m.project_id = split_part(realtime.messages.topic, ':', 2)::uuid
        and m.user_id = auth.uid()));

create policy "members_broadcast" on realtime.messages
  for insert to authenticated with check (
    exists (select 1 from public.project_members m
      where m.project_id = split_part(realtime.messages.topic, ':', 2)::uuid
        and m.user_id = auth.uid()));
```

Client authorizes with `supabase.realtime.setAuth()` after sign-in / token refresh.

### Frontend — the collaboration hook

`designer/src/collab/useCollab.ts`:

```ts
export interface Peer {
  userId: string; name: string; color: string;
  file: string; selection: readonly string[];
  cursor: { x: number; y: number } | null; editing: string | null;
}

export function useCollab(projectId: string | null) {
  const { session } = useAuth();
  const [peers, setPeers] = useState<Peer[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const selfRef = useRef<Peer | null>(null);

  useEffect(() => {
    const user = session?.user;
    if (!supabase || !projectId || !user) return;
    void supabase.realtime.setAuth();

    const self: Peer = {
      userId: user.id, name: (user.email ?? 'anon').split('@')[0]!,
      color: colorFor(user.id), file: '', selection: [], cursor: null, editing: null,
    };
    selfRef.current = self;

    const channel = supabase.channel(`project:${projectId}`, {
      config: { private: true, presence: { key: user.id }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    const recompute = () => {
      const state = channel.presenceState<Peer>();
      setPeers(Object.keys(state)
        .filter((k) => k !== user.id)
        .map((k) => state[k]![0]!)
        .filter(Boolean));
    };

    channel
      .on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .on('broadcast', { event: 'cursor' }, ({ payload }) =>
        setPeers((prev) => prev.map((p) =>
          p.userId === payload.userId ? { ...p, cursor: payload.cursor } : p)))
      .subscribe((status) => { if (status === 'SUBSCRIBED') void channel.track(self); });

    return () => { void channel.untrack(); void supabase.removeChannel(channel); };
  }, [projectId, session?.user?.id]);

  const update = useCallback((patch: Partial<Peer>) => {
    const ch = channelRef.current, self = selfRef.current;
    if (!ch || !self) return;
    selfRef.current = { ...self, ...patch };
    void ch.track(selfRef.current);
  }, []);

  const sendCursor = useCallback((cursor: { x: number; y: number } | null) => {
    const ch = channelRef.current, self = selfRef.current;
    if (ch && self) void ch.send({ type: 'broadcast', event: 'cursor',
      payload: { userId: self.userId, cursor } });
  }, []);

  return { peers, update, sendCursor };
}
```

### Frontend — wire into the editor & render

`SchematicEditor` already holds `doc`, `selection`, `currentFile`; `SchematicCanvas`
already computes world coords via `toWorld(e.clientX, e.clientY)`.

```ts
const { peers, update, sendCursor } = useCollab(projectId);

// selection/file → presence (low frequency)
useEffect(() => { update({ selection: [...selection], file: currentFile }); },
  [selection, currentFile, update]);

// cursor → broadcast (throttle to ~25 Hz); forward toWorld() via an onCursorMove prop
const lastSent = useRef(0);
const onCursorMove = useCallback((world: Vec2) => {
  const now = performance.now();
  if (now - lastSent.current < 40) return;
  lastSent.current = now; sendCursor(world);
}, [sendCursor]);
```

Overlay: transform each peer's world cursor to the local viewport (inverse of
`toWorld`, `viewport = { offsetX, offsetY, scale }`) and draw a cursor + name
tag; tint items in each peer's `selection` in that peer's color (reuse the
painter's existing selection outline). An avatar stack is just `peers` + self
rendered in the toolbar.

```ts
const worldToScreen = (w: Vec2, vp: Viewport, dpr: number) => ({
  x: (w.x * vp.scale + vp.offsetX) / dpr,
  y: (w.y * vp.scale + vp.offsetY) / dpr,
});
```

**Throughput:** keep cursors on broadcast (never in presence); ~25 Hz is fine
for small teams; `broadcast: { self: false }` avoids echo.

## 5. Layer 2 — Soft edit locks

Cheap conflict avoidance. On grab, set `editing: <refId>` in presence; peers show
a busy badge and refuse to start editing that item.

```ts
const canEdit = (refId: string, peers: Peer[]) => !peers.some((p) => p.editing === refId);
// on grab: if (!canEdit(hit.refId, peers)) return; else update({ editing: hit.refId });
// on drop/escape: update({ editing: null });
```

Advisory, not a hard mutex, but for EDA work (people rarely fight over the same
net) it removes almost all conflicts and makes whole-file last-write-wins safe in
practice.

## 6. Layer 3 — Concurrent co-editing

Two people on the same sheet at once. Two designs.

**Option A — Command broadcast + ordering (lightest).** Serialize each
`EditCommand` as data (a registry rebuilds `apply`/`invert` on receipt),
broadcast it, and apply remotely in a **server-assigned order**, rebasing
un-acked local commands. Get ordering from a tiny Edge Function sequencer, or an
append-only `doc_updates` table (§6) ordered by `bigserial` — which also gives
durable history + late-joiner replay. Caveats: index-based commands
(`replaceLine(index, …)`) aren't concurrency-safe — migrate them to `refId`
addressing first; add/delete/field-replace are fine. Pairs well with soft locks.

**Option B — CRDT (most robust).** Model the doc as **Yjs** types (`Y.Map` of
items by uuid), transport updates over Supabase Broadcast or a Hocuspocus server,
persist the Yjs blob. The CRDT is the *live* representation only: on save you
must serialize back through the lossless S-expression model, preserving each
untouched item's original AST node (the round-trip promise). That bridge is the
bulk of the work and must join the round-trip corpus in `qa/`.

**Recommendation:** start with Option A + soft locks; move to Yjs only if usage
proves same-item concurrent editing is genuinely needed.

## 7. Backend — sharing & membership

Extend the existing per-user `projects` table:

```sql
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id)     on delete cascade,
  role       text not null default 'editor' check (role in ('owner','editor','viewer')),
  primary key (project_id, user_id)
);
alter table public.project_members enable row level security;
-- members read their projects' rows; only owners insert/update/delete members.

-- Broaden projects RLS from owner-only to membership-aware:
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_member" on public.projects for select to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.project_members m
    where m.project_id = projects.id and m.user_id = auth.uid()));
-- UPDATE: same, but require role in ('owner','editor').

-- Backfill current owners so existing RLS keeps working:
insert into public.project_members (project_id, user_id, role)
select id, user_id, 'owner' from public.projects on conflict do nothing;
```

Apply the same membership check to the Storage policies in `storage.sql` (object
path is `<userId>/<projectId>/…`). Layer 3 Option A adds an append-only log:

```sql
create table if not exists public.doc_updates (
  seq bigserial primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  file text not null, author uuid not null references auth.users (id),
  wire jsonb not null, created_at timestamptz not null default now()
);
```

Invite flow: owner enters an email → insert a `project_members` row (or a pending
invite keyed by email, materialized on first sign-in).

## 8. Non-functional notes

- **Security:** RLS on `realtime.messages` is what actually gates a channel —
  never trust the client's `projectId`. Treat presence payloads (`name`,
  `selection`) as untrusted on render.
- **Format compat:** presence, locks, cursors, and `doc_updates` are all
  sidecar/ephemeral; saved files always go through the lossless serializer.
- **Offline:** `authEnabled` is already `false` without Supabase env vars —
  collaboration must no-op cleanly (single-player, as today).
- **Undo is per-user:** filter the undo stack by author (Option A) or use
  `Y.UndoManager` scoped to the local origin (Yjs).
- **Testing:** add multi-client convergence tests to `qa/`; for Option B, the
  Yjs↔model round-trip joins the existing corpus.

## 9. Phased rollout

1. **Presence (schematic editor)** — `project_members` + channel RLS, `useCollab`,
   cursors + name tags + selection tint, avatar stack. The Canva feel; no file
   changes. **Recommended first PR.**
2. **Presence everywhere + soft locks** — extend to PCB/symbol/footprint editors.
3. **Sharing UI** — invite-by-email, roles, "shared with me" in the launcher.
4. **Co-editing (Option A)** — id-address remaining commands, `doc_updates` +
   ordering, command replay, per-user undo.
5. **CRDT (optional)** — only if needed; budget the Yjs↔model round-trip bridge.
