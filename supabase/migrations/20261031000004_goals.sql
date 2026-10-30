-- Obiettivi di risparmio (per esempio "Viaggio dicembre: 800 €").
-- saved_cents è la cifra già messa da parte, aggiornata dall'app.

create table public.goals (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (btrim(name) <> ''),
  emoji        text not null default '🎯',
  target_cents bigint not null check (target_cents > 0),
  saved_cents  bigint not null default 0 check (saved_cents >= 0),
  target_date  date,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger goals_touch_updated_at
  before update on public.goals
  for each row execute function public.touch_updated_at();

alter table public.goals enable row level security;

create policy goals_owner on public.goals
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

revoke all on public.goals from anon;
