-- 006: NOC status on properties (yes / applied / no; empty = not sure).
-- Run once in the Supabase SQL editor, after 005.

create type noc_status as enum ('yes', 'applied', 'no');
alter table properties add column noc noc_status;

-- Website view: expose NOC (useful selling point)
create or replace view public_listings as
  select id, property_type, listing_type, sector, size_sqyd, floor, facing,
         park_facing, price_inr, photos, updated_at, noc
  from properties
  where is_public and status = 'available';

-- ---------- save_property: same as before + noc ----------
create or replace function save_property(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(nullif(p->>'id','')::uuid, gen_random_uuid());
  v_owner uuid;
begin
  if coalesce(p->>'owner_phone','') <> '' then
    insert into contacts (name, phone, role)
    values (nullif(p->>'owner_name',''), p->>'owner_phone',
            case when p->>'source' = 'co_broker' then 'co_broker' else 'owner' end)
    on conflict (phone) do update
      set name = coalesce(nullif(excluded.name,''), contacts.name)
    returning id into v_owner;
  end if;

  insert into properties as t (
    id, property_type, listing_type, sector, size_sqyd, floor, facing, park_facing,
    price_inr, status, source, exclusive, owner_id, notes, photos, is_public, last_verified_at, noc
  ) values (
    v_id,
    (p->>'property_type')::property_type,
    coalesce(nullif(p->>'listing_type',''),'sale')::listing_type,
    p->>'sector',
    (p->>'size_sqyd')::numeric,
    nullif(p->>'floor',''),
    nullif(p->>'facing','')::facing_dir,
    coalesce((p->>'park_facing')::boolean, false),
    (p->>'price_inr')::bigint,
    coalesce(nullif(p->>'status',''),'available')::property_status,
    coalesce(nullif(p->>'source',''),'direct_owner')::source_type,
    coalesce((p->>'exclusive')::boolean, false),
    v_owner,
    nullif(p->>'notes',''),
    coalesce(array(select jsonb_array_elements_text(p->'photos')), '{}'),
    coalesce((p->>'is_public')::boolean, false),
    now(),
    nullif(p->>'noc','')::noc_status
  )
  on conflict (id) do update set
    property_type = excluded.property_type, listing_type = excluded.listing_type,
    sector = excluded.sector, size_sqyd = excluded.size_sqyd, floor = excluded.floor,
    facing = excluded.facing, park_facing = excluded.park_facing, price_inr = excluded.price_inr,
    status = excluded.status, source = excluded.source, exclusive = excluded.exclusive,
    owner_id = coalesce(excluded.owner_id, t.owner_id), notes = excluded.notes,
    photos = excluded.photos, is_public = excluded.is_public, last_verified_at = now(),
    noc = excluded.noc;

  return v_id;
end $$;

-- ---------- import_properties: same as before + noc ----------
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
      price_inr, status, source, exclusive, owner_id, notes, batch_id, noc
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
      v_batch,
      nullif(r->>'noc','')::noc_status
    );
  end loop;

  return v_batch;
end $$;
