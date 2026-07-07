-- Ziro Designer — cloud project sync
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Creates a per-user `projects` table with Row Level Security so each user
-- can only read/write their own rows. Files are stored gzipped + base64 in a
-- JSONB column, mirroring the app's IndexedDB record shape.

create table if not exists public.projects (
  id          uuid primary key,                       -- shared with the local IndexedDB id
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- [{ "name": "board.kicad_pcb", "gzB64": "..." }, ...]
  files       jsonb not null default '[]'::jsonb
);

create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_updated_at_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

-- Recreate policies idempotently.
drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_insert_own" on public.projects;
drop policy if exists "projects_update_own" on public.projects;
drop policy if exists "projects_delete_own" on public.projects;

create policy "projects_select_own"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "projects_insert_own"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "projects_update_own"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "projects_delete_own"
  on public.projects for delete
  using (auth.uid() = user_id);
