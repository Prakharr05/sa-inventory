# Sharma Associates — Inventory (bulk import)

Next.js + Supabase. Page: `/inventory/import`.

## Setup
1. Supabase → SQL editor → run `supabase/schema.sql`.
2. Supabase → Authentication → **disable sign-ups**, then invite staff users (email + password).
3. `cp .env.local.example .env.local` and fill in the URL + anon key.
4. `npm install && npm run dev` → http://localhost:3000

## How it works
- Type in the grid, paste a block from Excel/Sheets (with or without a header row), or upload CSV/XLSX (`public/inventory_template.csv`).
- Each row is validated live: red cells = errors (hover for reason), ⚠ = warnings / possible duplicates.
- Accepted shorthand: price `1.10 cr`, `90 L`, `@110`, `@90`, `45k`, `1.2 psyd`; sector `21`, `Sec 21`, `S21`; size `200 gaj`; type `bf`, `kothi`, `house`…
- Import runs as one transaction (`import_properties` RPC) and creates a batch; **Undo** removes the whole batch.
- Owner phone numbers are deduplicated into `contacts`. The website should read only from the `public_listings` view.

## Tests
`npm test`
