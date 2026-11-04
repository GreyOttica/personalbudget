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

-- Ripristino da backup: sostituisce i dati con quelli del file, tutto in una transazione
-- (se qualcosa va storto non cambia niente). L'app fa prima un backup dello stato attuale.
create or replace function public.restore_backup(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t jsonb := p->'tables';
  v_counts jsonb := '{}'::jsonb;
begin
  if not (select public.is_owner()) then
    raise exception 'Solo il proprietario può ripristinare un backup';
  end if;
  if p->>'app' is distinct from 'personal-budget' or jsonb_typeof(t) <> 'object' then
    raise exception 'Il file non è un backup di questa app';
  end if;
  if jsonb_typeof(t->'transactions') <> 'array' or jsonb_array_length(t->'transactions') = 0
     or jsonb_typeof(t->'categories') <> 'array' or jsonb_array_length(t->'categories') = 0 then
    raise exception 'Il backup non contiene movimenti o categorie: ripristino annullato';
  end if;

  -- Prima quello che dipende dagli altri.
  delete from public.transactions where true;
  delete from public.budgets where true;
  delete from public.balance_checkpoints where true;
  delete from public.recurring_rules where true;
  delete from public.goals where true;
  delete from public.subcategories where true;
  delete from public.categories where true;
  delete from public.accounts where true;

  insert into public.accounts select * from jsonb_populate_recordset(null::public.accounts, coalesce(t->'accounts', '[]'));
  insert into public.categories select * from jsonb_populate_recordset(null::public.categories, t->'categories');
  insert into public.subcategories select * from jsonb_populate_recordset(null::public.subcategories, coalesce(t->'subcategories', '[]'));
  insert into public.recurring_rules select * from jsonb_populate_recordset(null::public.recurring_rules, coalesce(t->'recurring_rules', '[]'));
  insert into public.transactions select * from jsonb_populate_recordset(null::public.transactions, t->'transactions');
  insert into public.budgets select * from jsonb_populate_recordset(null::public.budgets, coalesce(t->'budgets', '[]'));
  insert into public.balance_checkpoints select * from jsonb_populate_recordset(null::public.balance_checkpoints, coalesce(t->'balance_checkpoints', '[]'));
  insert into public.goals select * from jsonb_populate_recordset(null::public.goals, coalesce(t->'goals', '[]'));

  select jsonb_build_object(
    'transactions', (select count(*) from public.transactions),
    'categories', (select count(*) from public.categories),
    'budgets', (select count(*) from public.budgets),
    'recurring_rules', (select count(*) from public.recurring_rules),
    'goals', (select count(*) from public.goals)
  ) into v_counts;
  return v_counts;
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
