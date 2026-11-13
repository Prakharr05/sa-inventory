-- 003: admin / staff roles.
-- Admin: sees and edits everything. Staff: adds listings, sees/edits only their own,
-- no contacts list, no bulk import, no delete, cannot publish to the website.
-- Run once in the Supabase SQL editor, after 002.
-- Everyone who ALREADY has an account becomes admin; accounts created later are staff.

-- ---------- Profiles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz default now()
);
insert into profiles (id, role) select id, 'admin' from auth.users;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role) values (new.id, 'staff') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles enable row level security;
create policy read_own_or_admin on profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy admin_write on profiles for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- Ownership on properties ----------
alter table properties add column created_by uuid references auth.users(id) default auth.uid();

-- Staff can't publish, can't change ownership.
create or replace function guard_property() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.is_public := false;
    new.created_by := auth.uid();
  else
    new.is_public := old.is_public;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger properties_guard before insert or update on properties
  for each row execute function guard_property();

-- ---------- Replace the "any logged-in user" policies ----------
drop policy staff_all on properties;
drop policy staff_all on contacts;
drop policy staff_all on import_batches;
drop policy staff_all on sectors;

create policy p_select on properties for select to authenticated using (is_admin() or created_by = auth.uid());
create policy p_insert on properties for insert to authenticated with check (is_admin() or created_by = auth.uid());
create policy p_update on properties for update to authenticated
  using (is_admin() or created_by = auth.uid()) with check (is_admin() or created_by = auth.uid());
create policy p_delete on properties for delete to authenticated using (is_admin());

-- Staff see only the owners of their own listings.
create policy c_select on contacts for select to authenticated using (
  is_admin() or exists (select 1 from properties p where p.owner_id = contacts.id and p.created_by = auth.uid()));
create policy c_admin on contacts for all to authenticated using (is_admin()) with check (is_admin());

create policy b_admin on import_batches for all to authenticated using (is_admin()) with check (is_admin());

create policy s_read on sectors for select to authenticated using (true);
create policy s_admin on sectors for all to authenticated using (is_admin()) with check (is_admin());

-- ---------- save_property: runs with elevated rights so staff can link an existing
-- owner phone without being able to read the contacts table. Ownership checked here. ----------
alter function save_property(jsonb) security definer;
alter function save_property(jsonb) set search_path = public;

create or replace function save_property_guarded(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_id is not null and not is_admin() and exists (
      select 1 from properties where id = v_id and created_by is distinct from auth.uid()) then
    raise exception 'You can only edit your own listings';
  end if;
  return save_property(p);
end $$;

-- Duplicate check that reveals only yes/no, not the other listing.
create or replace function similar_property_exists(
  p_sector text, p_type property_type, p_listing listing_type, p_size numeric, p_price bigint
) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from properties
    where sector = p_sector and property_type = p_type and listing_type = p_listing
      and size_sqyd = p_size and status <> 'sold'
      and abs(price_inr - p_price) <= 0.05 * greatest(price_inr, p_price));
$$;

-- Bulk import / undo are admin-only.
create or replace function require_admin() returns void language plpgsql as $$
begin if not is_admin() then raise exception 'Admins only'; end if; end $$;

create or replace function import_properties_admin(p_rows jsonb, p_file_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin perform require_admin(); return import_properties(p_rows, p_file_name); end $$;

create or replace function undo_import_admin(p_batch uuid)
returns int language plpgsql security definer set search_path = public as $$
begin perform require_admin(); return undo_import(p_batch); end $$;

-- ---------- Who can call what ----------
revoke execute on function save_property(jsonb) from public, anon, authenticated;
revoke execute on function import_properties(jsonb, text) from public, anon, authenticated;
revoke execute on function undo_import(uuid) from public, anon, authenticated;
revoke execute on function save_property_guarded(jsonb) from public, anon;
revoke execute on function similar_property_exists(text, property_type, listing_type, numeric, bigint) from public, anon;
revoke execute on function import_properties_admin(jsonb, text) from public, anon;
revoke execute on function undo_import_admin(uuid) from public, anon;
grant execute on function save_property_guarded(jsonb) to authenticated;
grant execute on function similar_property_exists(text, property_type, listing_type, numeric, bigint) to authenticated;
grant execute on function import_properties_admin(jsonb, text) to authenticated;
grant execute on function undo_import_admin(uuid) to authenticated;

-- ---------- Photos: staff can delete only photos they uploaded ----------
drop policy if exists "staff delete photos" on storage.objects;
drop policy if exists "staff update photos" on storage.objects;
create policy "delete own photos or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and (owner_id = auth.uid()::text or is_admin()));
create policy "update own photos or admin" on storage.objects for update to authenticated
  using (bucket_id = 'property-photos' and (owner_id = auth.uid()::text or is_admin()));

-- To promote someone later:
--   update profiles set role = 'admin' where id = (select id from auth.users where email = 'name@example.com');
