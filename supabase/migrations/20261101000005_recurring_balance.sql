-- Ricorrenti automatici (affitto, abbonamenti, versamenti) e saldo del conto
-- corretto a mano.

-- ---------------------------------------------------------------------------
-- Regole dei ricorrenti
-- ---------------------------------------------------------------------------
create table public.recurring_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (btrim(name) <> ''),
  type           public.txn_type not null default 'expense' check (type in ('expense', 'income', 'investment')),
  amount_cents   bigint not null check (amount_cents > 0),
  category_id    uuid not null references public.categories (id),
  subcategory_id uuid,
  account_id     uuid references public.accounts (id),
  note           text,
  day_of_month   int not null check (day_of_month between 1 and 31),
  starts_on      date not null,           -- primo addebito da creare
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (subcategory_id, category_id) references public.subcategories (id, category_id)
);

create trigger recurring_rules_touch_updated_at
  before update on public.recurring_rules
  for each row execute function public.touch_updated_at();

alter table public.recurring_rules enable row level security;
create policy recurring_rules_owner on public.recurring_rules
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.recurring_rules from anon;

-- I movimenti creati da una regola ricordano regola e mese: al massimo uno per mese.
alter table public.transactions drop constraint transactions_source_check;
alter table public.transactions add constraint transactions_source_check check (source in ('app', 'import', 'recurring'));
alter table public.transactions
  add column recurring_rule_id uuid references public.recurring_rules (id) on delete set null,
  add column recurring_month date;
create unique index transactions_recurring_once
  on public.transactions (recurring_rule_id, recurring_month)
  where recurring_rule_id is not null;

-- ---------------------------------------------------------------------------
-- Crea i movimenti dovuti fino a oggi. Idempotente: un movimento per regola e
-- per mese, anche se l'hai eliminato (resta come eliminato e non torna).
-- Il giorno 31 nei mesi corti diventa l'ultimo giorno del mese.
-- ---------------------------------------------------------------------------
create or replace function public.generate_recurring(p_today date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.transactions
    (occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, source, recurring_rule_id, recurring_month)
  select
    o.occurs_on, r.type, r.amount_cents, r.category_id, r.subcategory_id, r.account_id,
    coalesce(r.note, r.name), 'recurring', r.id, o.month
  from public.recurring_rules r
  cross join lateral (
    select
      m::date as month,
      make_date(
        extract(year from m)::int,
        extract(month from m)::int,
        least(r.day_of_month, extract(day from (m + interval '1 month - 1 day'))::int)
      ) as occurs_on
    from generate_series(date_trunc('month', r.starts_on), date_trunc('month', p_today), interval '1 month') m
  ) o
  where r.active and o.occurs_on >= r.starts_on and o.occurs_on <= p_today
  on conflict (recurring_rule_id, recurring_month) where recurring_rule_id is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.generate_recurring(date) from public, anon;
grant execute on function public.generate_recurring(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Saldo reale del conto a una data (a fine giornata): il calcolo riparte da qui.
-- ---------------------------------------------------------------------------
create table public.balance_checkpoints (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references public.accounts (id),
  as_of         date not null,
  balance_cents bigint not null,
  created_at    timestamptz not null default now()
);

alter table public.balance_checkpoints enable row level security;
create policy balance_checkpoints_owner on public.balance_checkpoints
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.balance_checkpoints from anon;
