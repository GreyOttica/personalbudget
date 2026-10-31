-- Correzioni dalla revisione del codice:
-- la coda offline non si blocca più se un movimento usa una sottocategoria creata sul telefono
-- da un altro movimento della stessa coda (o unita a una esistente con lo stesso nome).

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

  -- Prima i movimenti che creano una sottocategoria nuova: gli altri della stessa coda possono usarla.
  -- (Una sola operazione per movimento nella coda, quindi riordinare non cambia il risultato.)
  for v_op in
    select e.value from jsonb_array_elements(p_ops) with ordinality as e(value, n)
    order by (nullif(btrim(e.value->'txn'->>'subcategory_name'), '') is null), e.n
  loop
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
      -- Sottocategoria creata sul telefono e già unita a una esistente con lo stesso nome: uso l'id vero.
      if v_sub_id is not null and v_subs ? v_sub_id::text then
        v_sub_id := (v_subs->>v_sub_id::text)::uuid;
      end if;
      if nullif(btrim(v_txn->>'subcategory_name'), '') is not null then
        insert into public.subcategories as s (id, category_id, name)
        values (coalesce(v_sub_id, gen_random_uuid()), (v_txn->>'category_id')::uuid, btrim(v_txn->>'subcategory_name'))
        on conflict (category_id, name) do update set is_active = true
        returning s.id into v_sub_id;
        v_subs := v_subs || jsonb_build_object(coalesce(v_txn->>'subcategory_id', ''), v_sub_id);
      end if;

      -- Sottocategoria sconosciuta (creata offline e unita altrove in una sincronizzazione precedente):
      -- meglio salvare il movimento senza sottocategoria che bloccare per sempre la coda.
      if v_sub_id is not null and not exists (
        select 1 from public.subcategories s where s.id = v_sub_id and s.category_id = (v_txn->>'category_id')::uuid
      ) then
        v_sub_id := null;
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
