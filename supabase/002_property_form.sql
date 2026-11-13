-- 002: single-property save (add + edit) and photo storage.
-- Run once in the Supabase SQL editor, after schema.sql.

-- ---------- Add or update one property (owner upserted by phone) ----------
create or replace function save_property(p jsonb)
returns uuid
language plpgsql
security invoker
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
    price_inr, status, source, exclusive, owner_id, notes, photos, is_public, last_verified_at
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
    now()
  )
  on conflict (id) do update set
    property_type = excluded.property_type, listing_type = excluded.listing_type,
    sector = excluded.sector, size_sqyd = excluded.size_sqyd, floor = excluded.floor,
    facing = excluded.facing, park_facing = excluded.park_facing, price_inr = excluded.price_inr,
    status = excluded.status, source = excluded.source, exclusive = excluded.exclusive,
    owner_id = coalesce(excluded.owner_id, t.owner_id), notes = excluded.notes,
    photos = excluded.photos, is_public = excluded.is_public, last_verified_at = now();

  return v_id;
end $$;

-- ---------- Photo storage ----------
-- Public bucket: the website can show listing photos by URL (paths contain random IDs).
-- Only logged-in staff can upload, replace or delete.
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;

create policy "staff read photos"   on storage.objects for select to authenticated using (bucket_id = 'property-photos');
create policy "staff upload photos" on storage.objects for insert to authenticated with check (bucket_id = 'property-photos');
create policy "staff update photos" on storage.objects for update to authenticated using (bucket_id = 'property-photos');
create policy "staff delete photos" on storage.objects for delete to authenticated using (bucket_id = 'property-photos');
