-- Sharma Associates inventory schema
-- Run in Supabase SQL editor (once). Safe to read top-to-bottom.

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type property_type as enum ('plot','builder_floor','kothi','flat','shop','office','land','other');
create type listing_type  as enum ('sale','rent');
create type property_status as enum ('available','token','sold','withdrawn');
create type facing_dir as enum ('north','south','east','west','north_east','north_west','south_east','south_west');
create type source_type as enum ('direct_owner','co_broker','builder');

-- ---------- Sectors (canonical names; keeps "Sec 21" / "S21" consistent) ----------
create table sectors (
  name text primary key
);
insert into sectors (name)
select 'Sector ' || g from generate_series(1, 89) g;
insert into sectors (name) values
  ('Greater Faridabad'), ('NIT'), ('Old Faridabad'), ('Ballabgarh'),
  ('Greenfield Colony'), ('Surajkund'), ('Neharpar'), ('Other');

-- ---------- Contacts (owners / co-brokers) — never public ----------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text unique,               -- normalized 10-digit
  role text default 'owner',       -- owner | co_broker | builder
  notes text,
  created_at timestamptz default now()
);

-- ---------- Import batches (for undo) ----------
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  row_count int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);

-- ---------- Properties ----------
create table properties (
  id uuid primary key default gen_random_uuid(),
  property_type property_type not null,
  listing_type listing_type not null default 'sale',
  sector text not null references sectors(name) on update cascade,
  size_sqyd numeric(10,2) not null check (size_sqyd > 0),
  floor text,                      -- 'GF', 'FF', 'SF', 'TF', 'Full'...
  facing facing_dir,
  park_facing boolean default false,
  price_inr bigint not null check (price_inr > 0),   -- sale: total; rent: per month
  status property_status not null default 'available',
  source source_type default 'direct_owner',
  exclusive boolean default false,
  owner_id uuid references contacts(id) on delete set null,
  notes text,
  photos text[] default '{}',      -- storage paths
  is_public boolean default false,
  last_verified_at timestamptz default now(),
  batch_id uuid references import_batches(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index properties_match_idx on properties (sector, property_type, listing_type, status);
create index properties_batch_idx on properties (batch_id);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger properties_touch before update on properties
  for each row execute function touch_updated_at();

-- ---------- RLS: logged-in staff only ----------
-- IMPORTANT: disable public sign-ups in Supabase Auth settings; invite staff manually.
alter table sectors enable row level security;
alter table contacts enable row level security;
alter table import_batches enable row level security;
alter table properties enable row level security;

create policy staff_all on sectors        for all to authenticated using (true) with check (true);
create policy staff_all on contacts       for all to authenticated using (true) with check (true);
create policy staff_all on import_batches for all to authenticated using (true) with check (true);
create policy staff_all on properties     for all to authenticated using (true) with check (true);

-- ---------- Public listings for the website (no owner data, no notes) ----------
create view public_listings as
  select id, property_type, listing_type, sector, size_sqyd, floor, facing,
         park_facing, price_inr, photos, updated_at
  from properties
  where is_public and status = 'available';
grant select on public_listings to anon;

-- ---------- Bulk import: one transaction, all-or-nothing ----------
-- rows: jsonb array of objects with the property columns + owner_name, owner_phone
create or replace function import_properties(p_rows jsonb, p_file_name text default null)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_batch uuid;
  r jsonb;
  v_owner uuid;
begin
  insert into import_batches (file_name, row_count)
  values (p_file_name, jsonb_array_length(p_rows))
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_owner := null;
    if coalesce(r->>'owner_phone','') <> '' then
      insert into contacts (name, phone, role)
      values (nullif(r->>'owner_name',''), r->>'owner_phone',
              case when r->>'source' = 'co_broker' then 'co_broker' else 'owner' end)
      on conflict (phone) do update
        set name = coalesce(contacts.name, excluded.name)
      returning id into v_owner;
    end if;

    insert into properties (
      property_type, listing_type, sector, size_sqyd, floor, facing, park_facing,
      price_inr, status, source, exclusive, owner_id, notes, batch_id
    ) values (
      (r->>'property_type')::property_type,
      coalesce(nullif(r->>'listing_type',''),'sale')::listing_type,
      r->>'sector',
      (r->>'size_sqyd')::numeric,
      nullif(r->>'floor',''),
      nullif(r->>'facing','')::facing_dir,
      coalesce((r->>'park_facing')::boolean, false),
      (r->>'price_inr')::bigint,
      coalesce(nullif(r->>'status',''),'available')::property_status,
      coalesce(nullif(r->>'source',''),'direct_owner')::source_type,
      coalesce((r->>'exclusive')::boolean, false),
      v_owner,
      nullif(r->>'notes',''),
      v_batch
    );
  end loop;

  return v_batch;
end $$;

-- Undo a batch: removes its properties (contacts are kept — they may be reused)
create or replace function undo_import(p_batch uuid)
returns int
language plpgsql
security invoker
as $$
declare n int;
begin
  delete from properties where batch_id = p_batch;
  get diagnostics n = row_count;
  delete from import_batches where id = p_batch;
  return n;
end $$;
