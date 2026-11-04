-- Previsioni statistiche: obiettivo di risparmio mensile e notifiche positive.

-- Preferenze dell'utente (una riga sola).
create table public.preferences (
  id                    boolean primary key default true check (id),
  savings_target_cents  bigint check (savings_target_cents is null or savings_target_cents >= 0), -- null = "come di solito"
  updated_at            timestamptz not null default now()
);
insert into public.preferences default values;

alter table public.preferences enable row level security;
create policy preferences_owner on public.preferences
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.preferences from anon;

-- "Stai andando bene", serie di giorni sotto la quota.
alter table public.notification_settings add column positive boolean not null default true;
