-- Schema base: proprietario, conti, categorie, movimenti, budget.
-- App mono-utente: ogni tabella ha RLS e le policy ammettono solo il proprietario
-- registrato in app_owner. La service role (usata solo da script e job lato server)
-- bypassa RLS come da comportamento standard di Supabase.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Proprietario
-- ---------------------------------------------------------------------------
create table public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id   uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_owner where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, service_role;

-- updated_at automatico, ma rispettando un valore impostato esplicitamente dal
-- client (serve alla sincronizzazione offline "vince la modifica più recente").
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Anagrafiche
-- ---------------------------------------------------------------------------
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (btrim(name) <> ''),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create type public.category_kind as enum ('expense', 'income', 'investment');

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (btrim(name) <> ''),
  emoji      text not null,
  kind       public.category_kind not null default 'expense',
  is_fixed   boolean not null default false,   -- importo ricorrente, non proiettato linearmente (Affitto, Abbonamenti, Investimenti)
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subcategories (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (category_id, name),
  unique (id, category_id)   -- target della FK composta in transactions
);

-- ---------------------------------------------------------------------------
-- Movimenti
-- ---------------------------------------------------------------------------
create type public.txn_type as enum ('expense', 'income', 'investment', 'opening_balance');

create table public.transactions (
  id             uuid primary key default gen_random_uuid(),  -- generato dal client per l'offline
  occurred_on    date not null,
  type           public.txn_type not null,
  amount_cents   bigint not null check (amount_cents >= 0),
  category_id    uuid not null references public.categories (id),
  subcategory_id uuid,
  account_id     uuid references public.accounts (id),
  note           text,
  tag            text,
  source         text not null default 'app' check (source in ('app', 'import')),
  import_key     text unique,          -- "Informazioni cronologiche" del Google Form
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,          -- eliminazione "soft" per la sincronizzazione
  foreign key (subcategory_id, category_id)
    references public.subcategories (id, category_id)
);

create index transactions_occurred_on_idx on public.transactions (occurred_on) where deleted_at is null;
create index transactions_category_idx on public.transactions (category_id, occurred_on) where deleted_at is null;
create index transactions_tag_idx on public.transactions (tag) where tag is not null and deleted_at is null;
create index transactions_updated_at_idx on public.transactions (updated_at);

create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Budget mensili per categoria: un importo vale dal mese valid_from in poi,
-- finché non viene sostituito da un record con valid_from successivo.
-- ---------------------------------------------------------------------------
create table public.budgets (
  category_id  uuid not null references public.categories (id) on delete cascade,
  valid_from   date not null check (valid_from = date_trunc('month', valid_from)::date),
  amount_cents bigint not null check (amount_cents >= 0),
  created_at   timestamptz not null default now(),
  primary key (category_id, valid_from)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.app_owner     enable row level security;
alter table public.accounts      enable row level security;
alter table public.categories    enable row level security;
alter table public.subcategories enable row level security;
alter table public.transactions  enable row level security;
alter table public.budgets       enable row level security;

create policy app_owner_select on public.app_owner
  for select to authenticated using (user_id = (select auth.uid()));

create policy accounts_owner on public.accounts
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy categories_owner on public.categories
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy subcategories_owner on public.subcategories
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy transactions_owner on public.transactions
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy budgets_owner on public.budgets
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- Il ruolo anon non deve vedere nulla.
revoke all on all tables in schema public from anon;
