-- 007: price optional + extra sectors (90–170).
-- Run once in the Supabase SQL editor, after 006.

-- ---------- Price optional ----------
alter table properties alter column price_inr drop not null;   -- the "> 0" check still applies when set

-- Matching: a property with no price still matches on everything else.
create or replace function lead_fits(l leads, p properties) returns boolean
language sql immutable as $$
  select p.status = 'available'
    and p.listing_type = l.wants
    and (cardinality(l.property_types) = 0 or p.property_type = any (l.property_types))
    and (cardinality(l.sectors) = 0 or p.sector = any (l.sectors))
    and (l.size_min is null or p.size_sqyd >= l.size_min)
    and (l.size_max is null or p.size_sqyd <= l.size_max)
    and (p.price_inr is null or l.budget_min is null or p.price_inr >= l.budget_min * 0.9)
    and (p.price_inr is null or l.budget_max is null or p.price_inr <= l.budget_max * 1.1);
$$;

-- Duplicate check: price missing on either side counts as a price match (same as the app).
create or replace function similar_property_exists(
  p_sector text, p_type property_type, p_listing listing_type, p_size numeric, p_price bigint
) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from properties
    where sector = p_sector and property_type = p_type and listing_type = p_listing
      and size_sqyd = p_size and status <> 'sold'
      and (p_price is null or price_inr is null
           or abs(price_inr - p_price) <= 0.05 * greatest(price_inr, p_price)));
$$;

-- ---------- Extra sectors ----------
insert into sectors (name)
select 'Sector ' || g from generate_series(90, 170) g
on conflict (name) do nothing;
