-- Forma 3D: jednorazowa konfiguracja bazy danych.
-- Uruchom cały plik w Supabase: SQL Editor -> New query -> Run.

create table if not exists public.forma_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"sales": [], "products": [], "expenses": [], "channels": []}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.forma_state enable row level security;

revoke all on table public.forma_state from anon;
grant select, insert, update on table public.forma_state to authenticated;

drop policy if exists "Users can read their own Forma state" on public.forma_state;
create policy "Users can read their own Forma state"
  on public.forma_state for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own Forma state" on public.forma_state;
create policy "Users can create their own Forma state"
  on public.forma_state for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own Forma state" on public.forma_state;
create policy "Users can update their own Forma state"
  on public.forma_state for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
