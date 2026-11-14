"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import AuthGate, { useIsAdmin } from "@/components/AuthGate";
import { formatINR, parsePrice, parseSize, sizeUnit, unitLabel, formatSize } from "@/lib/normalize";

const TYPES = ["plot", "builder_floor", "kothi", "flat", "shop", "office", "land", "other"];
const STATUSES = ["available", "token", "sold", "withdrawn"];
const STALE_DAYS = 30;
const PAGE = 200;

type Row = {
  id: string; property_type: string; listing_type: string; sector: string; size_sqyd: number;
  floor: string | null; facing: string | null; park_facing: boolean; price_inr: number;
  status: string; source: string; exclusive: boolean; notes: string | null; is_public: boolean; entry_method: string;
  last_verified_at: string; owner: { name: string | null; phone: string | null } | null;
};

type Filters = {
  q: string; sector: string; type: string; listing: string; status: string;
  minPrice: string; maxPrice: string; minSize: string; maxSize: string; staleOnly: boolean; entry: string;
};
const EMPTY: Filters = { q: "", sector: "", type: "", listing: "", status: "available",
  minPrice: "", maxPrice: "", minSize: "", maxSize: "", staleOnly: false, entry: "" };

const label = (s: string) => s.replace(/_/g, " ");
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
// Budget fields accept "1.5 cr", "90 L", "@110" or plain rupees.
const budget = (s: string) => (s.trim() ? parsePrice(s, null, "rent").value : null);

export default function InventoryPage() {
  return <AuthGate><Inventory /></AuthGate>;
}

function Inventory() {
  const isAdmin = useIsAdmin();
  const [f, setF] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [sectors, setSectors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("sector");
    if (s) setF((x) => ({ ...x, sector: s }));
    supabase.from("sectors").select("name").then(({ data }) =>
      setSectors((data ?? []).map((d) => d.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))));
  }, []);

  const load = useCallback(async (filters: Filters) => {
    setLoading(true);
    let q = supabase.from("properties")
      .select("*, owner:contacts(name,phone)", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(0, PAGE - 1);
    if (filters.sector) q = q.eq("sector", filters.sector);
    if (filters.type) q = q.eq("property_type", filters.type);
    if (filters.listing) q = q.eq("listing_type", filters.listing);
    if (filters.status) q = q.eq("status", filters.status);
    const minP = budget(filters.minPrice), maxP = budget(filters.maxPrice);
    if (minP) q = q.gte("price_inr", minP);
    if (maxP) q = q.lte("price_inr", maxP);
    // Size filter is in sq ft when the type filter is a sq-ft type (flat), else sq yd.
    const su = sizeUnit(filters.type);
    const minS = filters.minSize ? parseSize(filters.minSize, su).value : null;
    const maxS = filters.maxSize ? parseSize(filters.maxSize, su).value : null;
    if (minS) q = q.gte("size_sqyd", minS);
    if (maxS) q = q.lte("size_sqyd", maxS);
    if (filters.entry) q = q.eq("entry_method", filters.entry);
    if (filters.staleOnly) q = q.lt("last_verified_at", new Date(Date.now() - STALE_DAYS * 864e5).toISOString());
    if (filters.q.trim()) q = q.ilike("notes", `%${filters.q.trim()}%`);
    const { data, count, error } = await q;
    setLoading(false);
    if (error) { setMsg(error.message); return; }
    setRows((data ?? []) as Row[]); setCount(count ?? 0); setMsg("");
  }, []);

  // Reload shortly after filters stop changing.
  useEffect(() => { const t = setTimeout(() => load(f), 300); return () => clearTimeout(t); }, [f, load]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  const update = async (id: string, patch: Partial<Row>) => {
    const { error } = await supabase.from("properties").update(patch).eq("id", id);
    if (error) { setMsg(`Save failed: ${error.message}`); return; }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const savePrice = (r: Row, input: string) => {
    if (!input.trim() || input === String(r.price_inr)) return;
    const p = parsePrice(input, r.size_sqyd, r.listing_type);
    if (p.error || !p.value) { setMsg(`Price: ${p.error}`); return; }
    update(r.id, { price_inr: p.value, last_verified_at: new Date().toISOString() });
  };

  return (
    <main>
      <h1>Inventory</h1>
      <div className="muted">{loading ? "Loading…" : `${count} matching${count > PAGE ? ` (showing ${PAGE})` : ""}`}</div>

      <div className="filters">
        <select value={f.sector} onChange={(e) => set("sector", e.target.value)}>
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={f.type} onChange={(e) => set("type", e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <select value={f.listing} onChange={(e) => set("listing", e.target.value)}>
          <option value="">Sale + rent</option><option value="sale">Sale</option><option value="rent">Rent</option>
        </select>
        <select value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input placeholder="Min price (90 L)" value={f.minPrice} onChange={(e) => set("minPrice", e.target.value)} />
        <input placeholder="Max price (1.5 cr)" value={f.maxPrice} onChange={(e) => set("maxPrice", e.target.value)} />
        <input placeholder={`Min ${unitLabel(sizeUnit(f.type))}`} inputMode="numeric" value={f.minSize} onChange={(e) => set("minSize", e.target.value)} />
        <input placeholder={`Max ${unitLabel(sizeUnit(f.type))}`} inputMode="numeric" value={f.maxSize} onChange={(e) => set("maxSize", e.target.value)} />
        <select value={f.entry} onChange={(e) => set("entry", e.target.value)}>
          <option value="">Manual + bulk</option>
          <option value="manual">Manual only</option>
          <option value="bulk">Bulk only</option>
        </select>
        <input placeholder="Search notes" value={f.q} onChange={(e) => set("q", e.target.value)} />
        <label><input type="checkbox" checked={f.staleOnly} onChange={(e) => set("staleOnly", e.target.checked)} /> Needs re-check</label>
        <button onClick={() => setF(EMPTY)}>Reset</button>
      </div>
      {msg && <div className="bad">{msg}</div>}

      <div className="grid-wrap">
        <table>
          <thead>
            <tr>
              <th>Sector</th><th>Type</th><th>Size</th><th>Floor / facing</th><th>Price</th>
              <th>Status</th><th>Owner</th><th>Notes</th><th>Website</th><th>Verified</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const age = daysAgo(r.last_verified_at);
              const stale = age > STALE_DAYS;
              return (
                <tr key={r.id} className={stale ? "stale" : ""}>
                  <td className="c"><a href={`/inventory/property?id=${r.id}`}>{r.sector}</a></td>
                  <td className="c">
                    {label(r.property_type)}{r.listing_type === "rent" && <span className="pill"> rent</span>}
                    {r.exclusive && <span className="pill"> excl.</span>}
                    {r.entry_method === "bulk" && <span className="pill" title="Added via bulk import"> bulk</span>}
                  </td>
                  <td className="c">{formatSize(r.size_sqyd, r.property_type)}</td>
                  <td className="c">
                    {[r.floor, r.facing && label(r.facing), r.park_facing && "park"].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="c">
                    <input className="cell-input" defaultValue={formatINR(r.price_inr)} key={r.price_inr}
                      title="Edit: 1.2 cr / 95 L / @120"
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => e.target.value !== formatINR(r.price_inr) && savePrice(r, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                  </td>
                  <td className="c">
                    <select value={r.status} onChange={(e) => update(r.id, { status: e.target.value })}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="c">
                    {r.owner?.name ?? "—"}{" "}
                    {r.owner?.phone && <a href={`tel:+91${r.owner.phone}`}>{r.owner.phone}</a>}
                    {r.source === "co_broker" && <span className="pill"> broker</span>}
                  </td>
                  <td className="c" title={r.notes ?? ""}>{(r.notes ?? "").slice(0, 40)}</td>
                  <td className="c">
                    <input type="checkbox" checked={r.is_public} disabled={!isAdmin}
                      title={isAdmin ? "Show on website" : "Only admins can publish"}
                      onChange={(e) => update(r.id, { is_public: e.target.checked })} />
                  </td>
                  <td className="c">
                    <span className={stale ? "pill warn" : "pill"}>{age === 0 ? "today" : `${age}d ago`}</span>{" "}
                    <button onClick={() => update(r.id, { last_verified_at: new Date().toISOString() })}>✓</button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && <tr><td className="c muted" colSpan={10}>No properties match.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
