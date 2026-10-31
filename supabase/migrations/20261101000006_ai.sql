-- Fase 4: analisi AI (serale, settimanale, mensile) e chat.

-- Un'analisi per tipo e periodo: rigenerarla sostituisce la precedente.
create table public.analyses (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('daily', 'weekly', 'monthly')),
  period_start       date not null,
  period_end         date not null,
  headline           text not null,
  content            jsonb not null,       -- sintesi, punti, consigli (con impatto calcolato dal codice), verifica cifre
  facts              jsonb not null,       -- i dati aggregati passati all'AI, per trasparenza
  model              text not null,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cost_usd           numeric(10, 5) not null default 0,
  created_at         timestamptz not null default now(),
  unique (kind, period_start)
);

create index analyses_created_idx on public.analyses (created_at desc);

-- Conversazione con l'assistente (una sola, si può azzerare).
create table public.chat_messages (
  id                 uuid primary key default gen_random_uuid(),
  role               text not null check (role in ('user', 'assistant')),
  content            text not null,
  tools_used         text[] not null default '{}',
  model              text,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cost_usd           numeric(10, 5) not null default 0,
  created_at         timestamptz not null default now()
);

create index chat_messages_created_idx on public.chat_messages (created_at);

alter table public.analyses enable row level security;
alter table public.chat_messages enable row level security;

create policy analyses_owner on public.analyses
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy chat_messages_owner on public.chat_messages
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

revoke all on public.analyses, public.chat_messages from anon;
