-- Chiusura del mese e budget per viaggi ed eventi (tag).

-- Mesi chiusi con la schermata guidata (saldo controllato, budget del mese nuovo confermati).
create table public.month_closures (
  month                text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_at            timestamptz not null default now(),
  balance_diff_cents   bigint          -- saldo reale − saldo dell'app al momento della chiusura (null se non controllato)
);

-- Budget per un tag (per esempio "Giappone 2026": 1.500 €), con data di fine facoltativa.
create table public.tag_budgets (
  tag           text primary key check (btrim(tag) <> ''),
  amount_cents  bigint not null check (amount_cents > 0),
  ends_on       date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.month_closures enable row level security;
alter table public.tag_budgets    enable row level security;

create policy month_closures_owner on public.month_closures
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy tag_budgets_owner on public.tag_budgets
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

revoke all on public.month_closures, public.tag_budgets from anon;
