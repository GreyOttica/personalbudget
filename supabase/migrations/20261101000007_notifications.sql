-- Fase 5: notifiche push, controllo automatico ogni 15 minuti, backup settimanale,
-- proposte di budget dalla chat.

-- Configurazione interna, letta solo dal server con la secret key (nessuna policy: RLS chiude tutto il resto).
create table public.app_config (
  id             boolean primary key default true check (id),
  cron_secret    text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  app_url        text,          -- indirizzo dell'app, salvato dall'app stessa
  vapid_public   text,          -- chiavi per le notifiche push, generate dall'app al primo uso
  vapid_private  text,
  last_tick_at   timestamptz,
  updated_at     timestamptz not null default now()
);
insert into public.app_config default values;
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- Quali notifiche ricevere (una riga sola).
create table public.notification_settings (
  id              boolean primary key default true check (id),
  budget_alerts   boolean not null default true,   -- 80% e 100% del budget
  projections     boolean not null default true,   -- "al ritmo attuale sforerai"
  reminder        boolean not null default true,   -- 21:00 se oggi non hai registrato nulla
  daily_analysis  boolean not null default true,   -- 21:30
  weekly_report   boolean not null default true,   -- lunedì 8:00
  monthly_report  boolean not null default true,   -- il 1° alle 8:00
  backup          boolean not null default true,   -- domenica notte
  updated_at      timestamptz not null default now()
);
insert into public.notification_settings default values;

-- Dispositivi abilitati alle notifiche.
create table public.push_subscriptions (
  endpoint     text primary key,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz
);

-- Notifiche e job già fatti: la chiave evita doppioni (es. "warning:<categoria>:2026-11").
create table public.notification_log (
  key         text primary key,
  kind        text not null,
  title       text,
  body        text,
  sent        int not null default 0,
  created_at  timestamptz not null default now()
);
create index notification_log_created_idx on public.notification_log (created_at desc);

-- Proposte di budget fatte dall'assistente; si applicano con un tasto.
create table public.budget_proposals (
  id          uuid primary key default gen_random_uuid(),
  request     text,
  items       jsonb not null,   -- [{category_id, name, emoji, from_cents, to_cents}]
  summary     jsonb not null,   -- totali e risparmio calcolati dal codice
  created_at  timestamptz not null default now(),
  applied_at  timestamptz
);

alter table public.chat_messages add column proposal_id uuid references public.budget_proposals (id) on delete set null;

alter table public.notification_settings enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.notification_log      enable row level security;
alter table public.budget_proposals      enable row level security;

create policy notification_settings_owner on public.notification_settings
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy push_subscriptions_owner on public.push_subscriptions
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy notification_log_owner on public.notification_log
  for select to authenticated using ((select public.is_owner()));
create policy budget_proposals_owner on public.budget_proposals
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

revoke all on public.notification_settings, public.push_subscriptions, public.notification_log, public.budget_proposals from anon;

-- Backup settimanali: cartella privata nello Storage di Supabase.
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;

-- Controllo automatico ogni 15 minuti: Supabase chiama l'app, che decide cosa fare in base all'ora di Roma
-- (avvisi budget, promemoria 21:00, analisi 21:30, report lunedì e 1° del mese, backup).
-- Non parte finché l'app non ha salvato il suo indirizzo (succede aprendo Impostazioni).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'budget-tick';
select cron.schedule(
  'budget-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := c.app_url || '/api/cron/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  from public.app_config c
  where c.app_url is not null
  $$
);
