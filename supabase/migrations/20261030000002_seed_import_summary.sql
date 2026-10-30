-- Categorie iniziali (ordine e nomi del Google Form), funzione di import
-- idempotente dello storico e vista di riepilogo mensile.

-- ---------------------------------------------------------------------------
-- Categorie
-- ---------------------------------------------------------------------------
insert into public.categories (name, emoji, kind, is_fixed, sort_order) values
  ('Stipendio',            '💼', 'income',     false,  1),
  ('Supermercato',         '🛒', 'expense',    false,  2),
  ('Cibo fuori / Bevute',  '🍸', 'expense',    false,  3),
  ('Auto',                 '🚙', 'expense',    false,  4),
  ('Sport',                '🎾', 'expense',    false,  5),
  ('Casa',                 '🏠', 'expense',    false,  6),
  ('Abbigliamento',        '👕', 'expense',    false,  7),
  ('Abbonamenti',          '🔁', 'expense',    true,   8),
  ('Divertimento',         '🎉', 'expense',    false,  9),
  ('Investimenti',         '📈', 'investment', false, 10),
  ('Regali',               '🎁', 'expense',    false, 11),
  ('Viaggi',               '✈️', 'expense',    false, 12),
  ('Cura / Benessere',     '💇', 'expense',    false, 13),
  ('Trasporto pubblico',   '🚊', 'expense',    false, 14),
  ('Salute',               '⚕️', 'expense',    false, 15),
  ('Cultura',              '🎭', 'expense',    false, 16),
  ('Altro',                '📦', 'expense',    false, 17),
  ('Tecnologia',           '💻', 'expense',    false, 18),
  ('Affitto',              '🏠', 'expense',    true,  19)
on conflict (name) do nothing;

insert into public.accounts (name) values ('ING') on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Import dello storico dal foglio "Log EntrateUscite".
--
-- p_rows: array JSON di righe {key, date, category, subcategory, pivot, amount,
--         note, from, to, tag} prodotte da scripts/import-sheet.ts.
-- La chiave di idempotenza è "Informazioni cronologiche" (timestamp del Form,
-- unico per riga e stabile tra un export e l'altro).
--
-- Regole di classificazione (dal brief):
--   nota contiene "valore iniziale"                → opening_balance (escluso da E/U)
--   "Importo per pivot E/U" > 0                    → income (anche in Altro)
--   categoria Investimenti, o Altro + nota "Investimenti"
--                                                  → investment (spostato in Investimenti)
--   tutto il resto, incluse le righe senza segno   → expense
--
-- Le righe già presenti vengono aggiornate solo se sono cambiate nel foglio e
-- non sono state eliminate nell'app. Le righe sparite dal foglio non vengono
-- cancellate: sono solo contate in "missing_in_sheet".
-- ---------------------------------------------------------------------------
create or replace function public.import_sheet_rows(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bad        jsonb;
  v_total      int;
  v_inserted   int;
  v_updated    int;
  v_missing    int;
  v_new_subs   int;
  v_new_cats   int;
  v_invest_id  uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows deve essere un array JSON';
  end if;

  drop table if exists pg_temp._import_rows;
  create temp table _import_rows on commit drop as
  select
    nullif(btrim(r->>'key'), '')                          as import_key,
    (r->>'date')::date                                    as occurred_on,
    btrim(r->>'category')                                 as category_label,
    coalesce(nullif(btrim(r->>'subcategory'), ''), 'Altro') as sub_name,
    (r->>'pivot')::numeric                                as pivot,
    round((r->>'amount')::numeric * 100)::bigint          as amount_cents,
    nullif(btrim(r->>'note'), '')                         as note,
    coalesce(nullif(btrim(r->>'from'), ''), nullif(btrim(r->>'to'), '')) as account_name,
    nullif(btrim(r->>'tag'), '')                          as tag
  from jsonb_array_elements(p_rows) r;

  select count(*) into v_total from _import_rows;

  select jsonb_agg(to_jsonb(i)) into v_bad
  from _import_rows i
  where import_key is null or occurred_on is null or amount_cents is null
     or amount_cents < 0 or category_label is null or category_label !~ '^\S+\s+\S';
  if v_bad is not null then
    raise exception 'Righe non valide: %', v_bad;
  end if;

  if (select count(distinct import_key) from _import_rows) <> v_total then
    raise exception 'Chiavi "Informazioni cronologiche" duplicate nel file';
  end if;

  -- Categorie sconosciute: create come spese ("🍕 Nome" → emoji + nome).
  with new_cats as (
    insert into public.categories (name, emoji, sort_order)
    select distinct
      substring(category_label from '^\S+\s+(.*)$'),
      substring(category_label from '^(\S+)\s'),
      100
    from _import_rows
    on conflict (name) do nothing
    returning 1
  )
  select count(*) into v_new_cats from new_cats;

  select id into v_invest_id from public.categories where kind = 'investment' order by sort_order limit 1;
  if v_invest_id is null then
    raise exception 'Manca una categoria di tipo investment';
  end if;

  alter table _import_rows add column category_id uuid, add column type public.txn_type;

  update _import_rows i
  set category_id = c.id,
      type = case
        when i.note ilike '%valore iniziale%' then 'opening_balance'
        when i.pivot > 0 then 'income'
        when c.kind = 'investment' then 'investment'
        when c.name = 'Altro' and i.note ilike '%investiment%' then 'investment'
        else 'expense'
      end::public.txn_type
  from public.categories c
  where c.name = substring(i.category_label from '^\S+\s+(.*)$');

  -- Gli investimenti registrati in Altro passano alla categoria Investimenti.
  update _import_rows set category_id = v_invest_id
  where type = 'investment' and category_id <> v_invest_id;

  with new_subs as (
    insert into public.subcategories (category_id, name)
    select distinct category_id, sub_name from _import_rows
    on conflict (category_id, name) do nothing
    returning 1
  )
  select count(*) into v_new_subs from new_subs;

  insert into public.accounts (name)
  select distinct account_name from _import_rows where account_name is not null
  on conflict (name) do nothing;

  with src as (
    select i.import_key, i.occurred_on, i.type, i.amount_cents, i.category_id,
           s.id as subcategory_id, a.id as account_id, i.note, i.tag
    from _import_rows i
    join public.subcategories s on s.category_id = i.category_id and s.name = i.sub_name
    left join public.accounts a on a.name = i.account_name
  ),
  upserted as (
    insert into public.transactions as t
      (occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, tag, source, import_key)
    select occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, tag, 'import', import_key
    from src
    on conflict (import_key) do update set
      occurred_on    = excluded.occurred_on,
      type           = excluded.type,
      amount_cents   = excluded.amount_cents,
      category_id    = excluded.category_id,
      subcategory_id = excluded.subcategory_id,
      account_id     = excluded.account_id,
      note           = excluded.note,
      tag            = excluded.tag
    where t.deleted_at is null
      and (t.occurred_on, t.type, t.amount_cents, t.category_id, t.subcategory_id, t.account_id, t.note, t.tag)
          is distinct from
          (excluded.occurred_on, excluded.type, excluded.amount_cents, excluded.category_id,
           excluded.subcategory_id, excluded.account_id, excluded.note, excluded.tag)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_inserted, v_updated
  from upserted;

  select count(*) into v_missing
  from public.transactions t
  where t.source = 'import' and t.deleted_at is null
    and not exists (select 1 from _import_rows i where i.import_key = t.import_key);

  return jsonb_build_object(
    'rows_in_file',       v_total,
    'inserted',           v_inserted,
    'updated',            v_updated,
    'unchanged',          v_total - v_inserted - v_updated,
    'new_categories',     v_new_cats,
    'new_subcategories',  v_new_subs,
    'missing_in_sheet',   v_missing
  );
end;
$$;

revoke all on function public.import_sheet_rows(jsonb) from public, anon, authenticated;
grant execute on function public.import_sheet_rows(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Riepilogo mensile. Investimenti = risparmio, separati dalle spese.
-- savings_rate       = (entrate − spese) / entrate         (investimenti contano come risparmio)
-- savings_rate_sheet = (entrate − spese − investimenti) / entrate   (come il foglio EU)
-- ---------------------------------------------------------------------------
create view public.monthly_summary
with (security_invoker = true) as
select
  date_trunc('month', t.occurred_on)::date                                         as month,
  coalesce(sum(t.amount_cents) filter (where t.type = 'income'), 0)::bigint        as income_cents,
  coalesce(sum(t.amount_cents) filter (where t.type = 'expense'), 0)::bigint       as expense_cents,
  coalesce(sum(t.amount_cents) filter (where t.type = 'expense' and c.is_fixed), 0)::bigint as fixed_expense_cents,
  coalesce(sum(t.amount_cents) filter (where t.type = 'investment'), 0)::bigint    as investment_cents,
  count(*)::int                                                                     as txn_count
from public.transactions t
join public.categories c on c.id = t.category_id
where t.deleted_at is null and t.type <> 'opening_balance'
group by 1;

create view public.monthly_summary_rates
with (security_invoker = true) as
select
  m.*,
  case when income_cents > 0
       then round((income_cents - expense_cents)::numeric / income_cents, 4) end as savings_rate,
  case when income_cents > 0
       then round((income_cents - expense_cents - investment_cents)::numeric / income_cents, 4) end as savings_rate_sheet
from public.monthly_summary m;

revoke all on public.monthly_summary, public.monthly_summary_rates from anon;
grant select on public.monthly_summary, public.monthly_summary_rates to authenticated, service_role;
