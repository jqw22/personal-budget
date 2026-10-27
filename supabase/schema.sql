-- Personal Budget: run this once in your Supabase project's SQL editor.
--
-- The budget is kept as the same parts the app saves to Nostr relays: one row
-- for categories, rules and settings, and one or more rows per month of
-- transactions. Row level security means each signed-in user can only read and
-- change their own rows.

create table if not exists public.budget_chunks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Which part this is, e.g. "personal-budget:settings" or "personal-budget:tx:2026-09:000".
  d text not null,
  -- The part as JSON text.
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, d)
);

alter table public.budget_chunks enable row level security;

drop policy if exists "Own rows only" on public.budget_chunks;
create policy "Own rows only" on public.budget_chunks
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Every change gets a fresh time, so other devices can fetch only what's new.
create or replace function public.budget_chunks_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists budget_chunks_touch on public.budget_chunks;
create trigger budget_chunks_touch
  before insert or update on public.budget_chunks
  for each row execute function public.budget_chunks_touch();

create index if not exists budget_chunks_updated on public.budget_chunks (user_id, updated_at);
