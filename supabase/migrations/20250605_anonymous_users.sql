-- Run in Supabase SQL editor (Dashboard → SQL → New query)

create table if not exists public.anonymous_users (
  id uuid primary key,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  votes_given integer not null default 0
);

alter table public.anonymous_users enable row level security;

create policy "anon users readable"
  on public.anonymous_users for select
  using (true);

create policy "anon users upsert own row"
  on public.anonymous_users for insert
  with check (true);

create policy "anon users update own row"
  on public.anonymous_users for update
  using (true);

-- Backfill null vote identities only where you have a separate mapping; new votes use anon_id from the client.
