-- 004: leads (buyer / tenant requirements) + matching.
-- Same access rule as properties: staff see only leads they created; admins see all.
-- Matching functions run with the caller's rights, so staff only ever match
-- against properties they can already see (their own).
-- Run once in the Supabase SQL editor, after 003.

create type lead_status as enum ('new', 'active', 'closed_won', 'closed_lost');

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,                                   -- normalized 10-digit
  wants listing_type not null default 'sale',   -- sale = buyer, rent = tenant
  property_types property_type[] not null default '{}',  -- empty = any
  sectors text[] not null default '{}',                  -- empty = any
  size_min numeric(10,2),
  size_max numeric(10,2),
  budget_min bigint,
  budget_max bigint,
  status lead_status not null default 'new',
  follow_up_on date,
  source text,                                  -- referral / walk-in / website / broker / other
  referred_by text,
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index leads_followup_idx on leads (follow_up_on) where status in ('new','active');
create index leads_owner_idx on leads (created_by);

create trigger leads_touch before update on leads
  for each row execute function touch_updated_at();

create or replace function guard_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then return new; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid();
  else new.created_by := old.created_by; end if;
  return new;
end $$;
create trigger leads_guard before insert or update on leads
  for each row execute function guard_lead();

alter table leads enable row level security;
create policy l_select on leads for select to authenticated using (is_admin() or created_by = auth.uid());
create policy l_insert on leads for insert to authenticated with check (is_admin() or created_by = auth.uid());
create policy l_update on leads for update to authenticated
  using (is_admin() or created_by = auth.uid()) with check (is_admin() or created_by = auth.uid());
create policy l_delete on leads for delete to authenticated using (is_admin());

-- ---------- Matching rule (one place, used both directions) ----------
-- Budget gets 10% stretch either side: a 1.2 cr buyer will look at 1.3 cr.
create or replace function lead_fits(l leads, p properties) returns boolean
language sql immutable as $$
  select p.status = 'available'
    and p.listing_type = l.wants
    and (cardinality(l.property_types) = 0 or p.property_type = any (l.property_types))
    and (cardinality(l.sectors) = 0 or p.sector = any (l.sectors))
    and (l.size_min is null or p.size_sqyd >= l.size_min)
    and (l.size_max is null or p.size_sqyd <= l.size_max)
    and (l.budget_min is null or p.price_inr >= l.budget_min * 0.9)
    and (l.budget_max is null or p.price_inr <= l.budget_max * 1.1);
$$;

-- security invoker (default): results are limited by the caller's RLS.
create or replace function matches_for_lead(p_lead uuid)
returns setof properties language sql stable as $$
  select p.* from leads l join properties p on lead_fits(l, p)
  where l.id = p_lead
  order by abs(p.price_inr - coalesce(l.budget_max, l.budget_min, p.price_inr)), p.updated_at desc;
$$;

create or replace function leads_for_property(p_property uuid)
returns setof leads language sql stable as $$
  select l.* from properties p join leads l on lead_fits(l, p)
  where p.id = p_property and l.status in ('new', 'active')
  order by l.follow_up_on nulls last, l.created_at desc;
$$;

create or replace function lead_match_counts()
returns table (lead_id uuid, n bigint) language sql stable as $$
  select l.id, count(p.id) from leads l left join properties p on lead_fits(l, p)
  where l.status in ('new', 'active')
  group by l.id;
$$;

revoke execute on function matches_for_lead(uuid) from public, anon;
revoke execute on function leads_for_property(uuid) from public, anon;
revoke execute on function lead_match_counts() from public, anon;
grant execute on function matches_for_lead(uuid) to authenticated;
grant execute on function leads_for_property(uuid) to authenticated;
grant execute on function lead_match_counts() to authenticated;
