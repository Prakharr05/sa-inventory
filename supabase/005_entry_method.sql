-- 005: record how each property was added (manual form vs bulk import).
-- Run once in the Supabase SQL editor, after 004.

alter table properties add column entry_method text not null default 'manual'
  check (entry_method in ('manual', 'bulk', 'whatsapp'));

-- Existing rows that came from a bulk import batch
update properties set entry_method = 'bulk' where batch_id is not null;

-- Set automatically; can't be changed later (editing a bulk row by hand keeps its origin).
create or replace function set_entry_method() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.entry_method := case when new.batch_id is not null then 'bulk'
                             when new.entry_method = 'whatsapp' then 'whatsapp'
                             else 'manual' end;
  else
    new.entry_method := old.entry_method;
  end if;
  return new;
end $$;
create trigger properties_entry_method before insert or update on properties
  for each row execute function set_entry_method();

create index properties_entry_idx on properties (entry_method);
