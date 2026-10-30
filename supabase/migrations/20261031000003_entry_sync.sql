-- Fase 2: dati di riferimento per l'inserimento e sincronizzazione dei
-- movimenti creati, modificati o eliminati dall'app (anche offline).

-- ---------------------------------------------------------------------------
-- Dati di riferimento in una sola chiamata: categorie e sottocategorie
-- ordinate per uso negli ultimi 180 giorni, conti, tag già usati.
-- ---------------------------------------------------------------------------
create or replace function public.get_reference()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select category_id, subcategory_id
    from public.transactions
    where deleted_at is null and occurred_on > current_date - 180
  )
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'emoji', c.emoji, 'kind', c.kind, 'is_fixed', c.is_fixed,
        'uses', (select count(*) from recent r where r.category_id = c.id)
      ) order by (select count(*) from recent r where r.category_id = c.id) desc, c.sort_order, c.name)
      from public.categories c where c.is_active
    ), '[]'::jsonb),
    'subcategories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'category_id', s.category_id, 'name', s.name,
        'uses', (select count(*) from recent r where r.subcategory_id = s.id)
      ) order by (select count(*) from recent r where r.subcategory_id = s.id) desc, s.name)
      from public.subcategories s where s.is_active
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name)
      from public.accounts a where a.is_active
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(t.tag order by t.last_used desc)
      from (
        select tag, max(occurred_on) as last_used
        from public.transactions
        where tag is not null and deleted_at is null
        group by tag
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_reference() from public, anon;
grant execute on function public.get_reference() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Applica in blocco le operazioni in coda sul telefono. Idempotente: rimandare
-- la stessa operazione non crea duplicati (l'id del movimento è generato dal
-- client). In caso di conflitto vince la modifica con updated_at più recente.
--
-- p_ops: [{ "op": "upsert", "txn": {id, occurred_on, type, amount_cents,
--           category_id, subcategory_id, subcategory_name, account_id, note,
--           tag, updated_at} }
--        | { "op": "delete", "id": ..., "updated_at": ... }]
-- subcategory_name valorizzato = sottocategoria nuova creata nell'app: se ne
-- esiste già una con lo stesso nome nella categoria, viene riusata.
-- ---------------------------------------------------------------------------
create or replace function public.apply_transaction_ops(p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op      jsonb;
  v_txn     jsonb;
  v_sub_id  uuid;
  v_ts      timestamptz;
  v_applied jsonb := '[]'::jsonb;
  v_subs    jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_ops) <> 'array' then
    raise exception 'p_ops deve essere un array JSON';
  end if;

  for v_op in select * from jsonb_array_elements(p_ops) loop
    if v_op->>'op' = 'upsert' then
      v_txn := v_op->'txn';
      v_ts := (v_txn->>'updated_at')::timestamptz;

      if (v_txn->>'type') not in ('expense', 'income', 'investment') then
        raise exception 'Tipo di movimento non valido: %', v_txn->>'type';
      end if;
      if (v_txn->>'amount_cents')::bigint <= 0 then
        raise exception 'Importo non valido';
      end if;

      v_sub_id := nullif(v_txn->>'subcategory_id', '')::uuid;
      if nullif(btrim(v_txn->>'subcategory_name'), '') is not null then
        insert into public.subcategories as s (id, category_id, name)
        values (coalesce(v_sub_id, gen_random_uuid()), (v_txn->>'category_id')::uuid, btrim(v_txn->>'subcategory_name'))
        on conflict (category_id, name) do update set is_active = true
        returning s.id into v_sub_id;
        v_subs := v_subs || jsonb_build_object(coalesce(v_txn->>'subcategory_id', ''), v_sub_id);
      end if;

      insert into public.transactions as t
        (id, occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, tag, source, created_at, updated_at)
      values (
        (v_txn->>'id')::uuid,
        (v_txn->>'occurred_on')::date,
        (v_txn->>'type')::public.txn_type,
        (v_txn->>'amount_cents')::bigint,
        (v_txn->>'category_id')::uuid,
        v_sub_id,
        nullif(v_txn->>'account_id', '')::uuid,
        nullif(btrim(v_txn->>'note'), ''),
        nullif(btrim(v_txn->>'tag'), ''),
        'app',
        v_ts,
        v_ts
      )
      on conflict (id) do update set
        occurred_on    = excluded.occurred_on,
        type           = excluded.type,
        amount_cents   = excluded.amount_cents,
        category_id    = excluded.category_id,
        subcategory_id = excluded.subcategory_id,
        account_id     = excluded.account_id,
        note           = excluded.note,
        tag            = excluded.tag,
        updated_at     = excluded.updated_at
      where t.updated_at < excluded.updated_at and t.deleted_at is null;

      v_applied := v_applied || to_jsonb(v_txn->>'id');

    elsif v_op->>'op' = 'delete' then
      v_ts := (v_op->>'updated_at')::timestamptz;
      update public.transactions
      set deleted_at = v_ts, updated_at = v_ts
      where id = (v_op->>'id')::uuid and deleted_at is null and updated_at <= v_ts;
      v_applied := v_applied || to_jsonb(v_op->>'id');

    else
      raise exception 'Operazione sconosciuta: %', v_op->>'op';
    end if;
  end loop;

  return jsonb_build_object('applied', v_applied, 'subcategories', v_subs);
end;
$$;

revoke all on function public.apply_transaction_ops(jsonb) from public, anon;
grant execute on function public.apply_transaction_ops(jsonb) to authenticated, service_role;
