"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import AuthGate from "@/components/AuthGate";
import { formatINR, fromSqyd, leadSizeUnit, unitLabel } from "@/lib/normalize";
import { isoDate } from "@/components/LeadForm";

type Lead = {
  id: string; name: string; phone: string | null; wants: string; property_types: string[]; sectors: string[];
  size_min: number | null; size_max: number | null; budget_min: number | null; budget_max: number | null;
  status: string; follow_up_on: string | null; source: string | null;
};

const range = (a: number | null, b: number | null, fmt: (n: number) => string) =>
  a == null && b == null ? "" : `${a != null ? fmt(a) : "…"}–${b != null ? fmt(b) : "…"}`;

export default function LeadsPage() {
  return <AuthGate><Leads /></AuthGate>;
}

function Leads() {
  const [view, setView] = useState<"today" | "open" | "closed" | "all">("today");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const today = isoDate(new Date());
    let query = supabase.from("leads").select("*").limit(300);
    // Due/overdue follow-ups, plus brand-new leads nobody has scheduled yet.
    if (view === "today") query = query.in("status", ["new", "active"])
      .or(`follow_up_on.lte.${today},and(status.eq.new,follow_up_on.is.null)`)
      .order("follow_up_on", { nullsFirst: true });
    if (view === "open") query = query.in("status", ["new", "active"]).order("follow_up_on", { nullsFirst: false });
    if (view === "closed") query = query.in("status", ["closed_won", "closed_lost"]).order("updated_at", { ascending: false });
    if (view === "all") query = query.order("created_at", { ascending: false });
    const s = q.trim().replace(/[,()]/g, "");
    if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
    const [{ data, error }, { data: c }] = await Promise.all([query, supabase.rpc("lead_match_counts")]);
    if (error) { setMsg(error.message); return; }
    setRows((data ?? []) as Lead[]);
    setCounts(Object.fromEntries(((c ?? []) as { lead_id: string; n: number }[]).map((r) => [r.lead_id, Number(r.n)])));
    setMsg("");
  }, [view, q]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const update = async (id: string, patch: Partial<Lead>) => {
    const { error } = await supabase.from("leads").update(patch).eq("id", id);
    if (error) { setMsg(`Save failed: ${error.message}`); return; }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const snooze = (id: string, days: number) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    update(id, { follow_up_on: isoDate(d), status: "active" });
  };

  const today = isoDate(new Date());

  return (
    <main>
      <div className="bar">
        <h1 style={{ margin: 0 }}>Leads</h1>
        <a className="btn" href="/leads/lead">+ New lead</a>
      </div>

      <div className="bar">
        {([["today", "Call today"], ["open", "Open"], ["closed", "Closed"], ["all", "All"]] as const).map(([v, l]) => (
          <button key={v} className={view === v ? "primary" : ""} onClick={() => setView(v)}>{l}</button>
        ))}
        <input className="search" placeholder="Search name / phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {msg && <div className="bad">{msg}</div>}

      <div className="lead-list">
        {rows.map((l) => {
          const overdue = l.follow_up_on && l.follow_up_on < today && (l.status === "new" || l.status === "active");
          const n = counts[l.id];
          return (
            <div key={l.id} className="lead-card">
              <div className="lead-top">
                <a href={`/leads/lead?id=${l.id}`}><strong>{l.name}</strong></a>
                {l.phone && <a href={`tel:+91${l.phone}`}>{l.phone}</a>}
                {n != null && <a className={n ? "pill ok-pill" : "pill"} href={`/leads/lead?id=${l.id}`}>{n} match{n === 1 ? "" : "es"}</a>}
              </div>
              <div className="muted">
                {l.wants === "rent" ? "Rent" : "Buy"}
                {l.property_types.length ? ` · ${l.property_types.map((t) => t.replace(/_/g, " ")).join(", ")}` : ""}
                {l.sectors.length ? ` · ${l.sectors.join(", ")}` : ""}
                {(() => { const u = leadSizeUnit(l.property_types); const r = range(l.size_min, l.size_max, (x) => `${fromSqyd(x, u)}`);
                  return r && ` · ${r} ${unitLabel(u)}`; })()}
                {range(l.budget_min, l.budget_max, formatINR) && ` · ${range(l.budget_min, l.budget_max, formatINR)}`}
              </div>
              <div className="lead-actions">
                <select value={l.status} onChange={(e) => update(l.id, { status: e.target.value })}>
                  <option value="new">New</option><option value="active">Active</option>
                  <option value="closed_won">Won</option><option value="closed_lost">Lost</option>
                </select>
                <span className={overdue ? "pill warn" : "pill"}>
                  {l.follow_up_on ? (l.follow_up_on === today ? "Today" : l.follow_up_on) : "No follow-up"}
                </span>
                <button onClick={() => snooze(l.id, 1)}>+1d</button>
                <button onClick={() => snooze(l.id, 3)}>+3d</button>
                <button onClick={() => snooze(l.id, 7)}>+7d</button>
              </div>
            </div>
          );
        })}
        {!rows.length && <p className="muted">{view === "today" ? "No calls due today." : "No leads here."}</p>}
      </div>
    </main>
  );
}
