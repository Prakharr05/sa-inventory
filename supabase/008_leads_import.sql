-- 008: bulk import for leads (with undo), like the inventory bulk add.
-- Run once in the Supabase SQL editor, after 007.

-- One batches table for both kinds of import; existing batches are property imports.
alter table import_batches add column kind text not null default 'properties'
  check (kind in ('properties', 'leads'));

alter table leads add column batch_id uuid references import_batches(id) on delete set null;
create index leads_batch_idx on leads (batch_id);

-- p_rows: jsonb array of { name, phone, wants, property_types[], sectors[], size_min, size_max (sq yd),
-- budget_min, budget_max (rupees), status, follow_up_on, source, referred_by, notes }. All-or-nothing.
create or replace function import_leads_admin(p_rows jsonb, p_file_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
  r jsonb;
begin
  perform require_admin();
  insert into import_batches (file_name, row_count, kind)
  values (p_file_name, jsonb_array_length(p_rows), 'leads')
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into leads (
      name, phone, wants, property_types, sectors, size_min, size_max, budget_min, budget_max,
      status, follow_up_on, source, referred_by, notes, batch_id
    ) values (
      r->>'name',
      nullif(r->>'phone', ''),
      coalesce(nullif(r->>'wants', ''), 'sale')::listing_type,
      coalesce((select array_agg(x::property_type) from jsonb_array_elements_text(coalesce(r->'property_types', '[]')) x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'sectors', '[]')) x), '{}'),
      (r->>'size_min')::numeric,
      (r->>'size_max')::numeric,
      (r->>'budget_min')::bigint,
      (r->>'budget_max')::bigint,
      coalesce(nullif(r->>'status', ''), 'new')::lead_status,
      nullif(r->>'follow_up_on', '')::date,
      nullif(r->>'source', ''),
      nullif(r->>'referred_by', ''),
      nullif(r->>'notes', ''),
      v_batch
    );
  end loop;
  return v_batch;
end $$;

create or replace function undo_leads_import_admin(p_batch uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_admin();
  delete from leads where batch_id = p_batch;
  get diagnostics n = row_count;
  delete from import_batches where id = p_batch and kind = 'leads';
  return n;
end $$;

revoke execute on function import_leads_admin(jsonb, text) from public, anon;
revoke execute on function undo_leads_import_admin(uuid) from public, anon;
grant execute on function import_leads_admin(jsonb, text) to authenticated;
grant execute on function undo_leads_import_admin(uuid) to authenticated;
