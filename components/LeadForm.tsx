"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import * as N from "@/lib/normalize";
import { propertyMessage, whatsappLink, ShareProperty } from "@/lib/share";

const TYPES = [
  ["plot", "Plot"], ["builder_floor", "Builder floor"], ["kothi", "Kothi"], ["flat", "Flat"],
  ["shop", "Shop"], ["office", "Office"], ["land", "Land"],
] as const;
const SOURCES = ["referral", "walk-in", "website", "broker", "other"];
const STATUSES = [["new", "New"], ["active", "Active"], ["closed_won", "Closed – won"], ["closed_lost", "Closed – lost"]] as const;

type Form = {
  name: string; phone: string; wants: string; property_types: string[]; sectors: string[];
  size_min: string; size_max: string; budget_min: string; budget_max: string; status: string;
  follow_up_on: string; source: string; referred_by: string; notes: string;
};
const BLANK: Form = {
  name: "", phone: "", wants: "sale", property_types: [], sectors: [], size_min: "", size_max: "",
  budget_min: "", budget_max: "", status: "new", follow_up_on: "", source: "referral", referred_by: "", notes: "",
};

type Match = ShareProperty & { id: string; status: string };

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const money = (s: string) => (s.trim() ? N.parsePrice(s, null, "rent") : { value: null });
const num = (s: string) => (s.trim() ? N.parseSize(s) : { value: null });
const shortINR = (n: number | null) => (n == null ? "" : N.formatINR(n).replace("₹", ""));
export const isoDate = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

export default function LeadForm({ id: initialId }: { id: string | null }) {
  const [id, setId] = useState(initialId);
  const [f, setF] = useState<Form>(BLANK);
  const [sectorInput, setSectorInput] = useState("");
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!initialId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setSaved(false); };

  const loadMatches = async (leadId: string) => {
    const { data } = await supabase.rpc("matches_for_lead", { p_lead: leadId });
    setMatches((data ?? []) as Match[]);
  };

  useEffect(() => {
    supabase.from("sectors").select("name").then(({ data }) =>
      setSectors((data ?? []).map((d) => d.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))));
    if (!initialId) return;
    supabase.from("leads").select("*").eq("id", initialId).single().then(({ data, error }) => {
      setLoading(false);
      if (error || !data) { setMsg(error?.message ?? "Not found"); return; }
      setF({
        name: data.name, phone: data.phone ?? "", wants: data.wants, property_types: data.property_types ?? [],
        sectors: data.sectors ?? [], size_min: data.size_min ? String(Number(data.size_min)) : "",
        size_max: data.size_max ? String(Number(data.size_max)) : "", budget_min: shortINR(data.budget_min),
        budget_max: shortINR(data.budget_max), status: data.status, follow_up_on: data.follow_up_on ?? "",
        source: data.source ?? "referral", referred_by: data.referred_by ?? "", notes: data.notes ?? "",
      });
      loadMatches(initialId);
    });
  }, [initialId]);

  const addSector = () => {
    const p = N.parseSector(sectorInput, sectors);
    if (p.error) { setMsg(p.error); return; }
    if (!f.sectors.includes(p.value!)) set("sectors", [...f.sectors, p.value!]);
    setSectorInput(""); setMsg("");
  };

  const phone = f.phone.trim() ? N.parsePhone(f.phone) : { value: null };
  const bMin = money(f.budget_min), bMax = money(f.budget_max);
  const sMin = num(f.size_min), sMax = num(f.size_max);
  const errors = [
    !f.name.trim() && "Name is required",
    "error" in phone && phone.error && `Phone: ${phone.error}`,
    "error" in bMin && bMin.error && `Min budget: ${bMin.error}`,
    "error" in bMax && bMax.error && `Max budget: ${bMax.error}`,
    "error" in sMin && sMin.error && `Min size: ${sMin.error}`,
    "error" in sMax && sMax.error && `Max size: ${sMax.error}`,
  ].filter(Boolean) as string[];

  const save = async () => {
    if (sectorInput.trim()) { setMsg("Tap Add for the sector you typed, or clear it"); return; }
    if (errors.length) { setMsg(errors[0]); return; }
    setBusy(true); setMsg("");
    const row = {
      name: f.name.trim(), phone: phone.value, wants: f.wants, property_types: f.property_types,
      sectors: f.sectors, size_min: sMin.value, size_max: sMax.value, budget_min: bMin.value,
      budget_max: bMax.value, status: f.status, follow_up_on: f.follow_up_on || null,
      source: f.source, referred_by: f.referred_by.trim() || null, notes: f.notes.trim() || null,
    };
    const res = id
      ? await supabase.from("leads").update(row).eq("id", id).select("id").single()
      : await supabase.from("leads").insert(row).select("id").single();
    setBusy(false);
    if (res.error) { setMsg(`Save failed: ${res.error.message}`); return; }
    const newId = res.data.id as string;
    if (!id) { setId(newId); window.history.replaceState(null, "", `/leads/lead?id=${newId}`); }
    setSaved(true);
    loadMatches(newId);
  };

  if (loading) return <main className="pf"><p className="muted">Loading…</p></main>;

  return (
    <main className="pf">
      <h1>{id ? f.name || "Lead" : "New lead"}</h1>

      <label className="pf-label">Name *</label>
      <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Mr. Gupta" />
      <input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" />

      <label className="pf-label">Looking to</label>
      <div className="chips">
        {([["sale", "Buy"], ["rent", "Rent"]] as const).map(([v, l]) => (
          <button type="button" key={v} className={f.wants === v ? "chip on" : "chip"} onClick={() => set("wants", v)}>{l}</button>
        ))}
      </div>

      <label className="pf-label">Property types <span className="muted">(none = any)</span></label>
      <div className="chips">
        {TYPES.map(([v, l]) => (
          <button type="button" key={v} className={f.property_types.includes(v) ? "chip on" : "chip"}
            onClick={() => set("property_types", toggle(f.property_types, v))}>{l}</button>
        ))}
      </div>

      <label className="pf-label">Sectors <span className="muted">(none = any)</span></label>
      <div className="pf-inline">
        <input list="lead-sectors" value={sectorInput} placeholder="21 / NIT"
          onChange={(e) => setSectorInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSector(); } }} />
        <button type="button" onClick={addSector}>Add</button>
      </div>
      <datalist id="lead-sectors">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="chips">
        {f.sectors.map((s) => (
          <button type="button" key={s} className="chip on" onClick={() => set("sectors", f.sectors.filter((x) => x !== s))}>{s} ✕</button>
        ))}
      </div>

      <div className="pf-row">
        <div>
          <label className="pf-label">Size (sq yd)</label>
          <div className="pf-inline">
            <input inputMode="decimal" placeholder="min" value={f.size_min} onChange={(e) => set("size_min", e.target.value)} />
            <input inputMode="decimal" placeholder="max" value={f.size_max} onChange={(e) => set("size_max", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="pf-label">{f.wants === "rent" ? "Rent / month" : "Budget"}</label>
          <div className="pf-inline">
            <input placeholder="min" value={f.budget_min} onChange={(e) => set("budget_min", e.target.value)} />
            <input placeholder={f.wants === "rent" ? "40k" : "1.2 cr"} value={f.budget_max} onChange={(e) => set("budget_max", e.target.value)} />
          </div>
          {(bMin.value || bMax.value) && (
            <div className="hint ok">= {bMin.value ? N.formatINR(bMin.value) : "any"} – {bMax.value ? N.formatINR(bMax.value) : "any"}</div>
          )}
        </div>
      </div>

      <div className="pf-row">
        <div>
          <label className="pf-label">Status</label>
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="pf-label">Follow up on</label>
          <input type="date" value={f.follow_up_on} onChange={(e) => set("follow_up_on", e.target.value)} />
        </div>
      </div>

      <label className="pf-label">Source</label>
      <div className="chips">
        {SOURCES.map((s) => (
          <button type="button" key={s} className={f.source === s ? "chip on" : "chip"} onClick={() => set("source", s)}>{s}</button>
        ))}
      </div>
      {f.source === "referral" && (
        <input placeholder="Referred by" value={f.referred_by} onChange={(e) => set("referred_by", e.target.value)} />
      )}

      <label className="pf-label">Notes</label>
      <textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Wants corner, ready to move by March…" />

      {msg && <div className="bad">{msg}</div>}
      <div className="pf-save">
        <button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : id ? "Save changes" : "Save lead"}</button>
        {saved && <span className="ok">Saved ✓</span>}
      </div>

      {matches && (
        <section className="matches">
          <h2>Matching properties ({matches.length})</h2>
          {!matches.length && <p className="muted">Nothing fits yet. Try widening sectors, size or budget.</p>}
          {matches.map((p) => (
            <div key={p.id} className="match">
              <a href={`/inventory/property?id=${p.id}`}>
                <strong>{p.property_type.replace(/_/g, " ")} · {p.sector} · {Number(p.size_sqyd)} yd</strong>
              </a>
              <div>{N.formatINR(p.price_inr)}{[p.floor, p.facing?.replace(/_/g, " "), p.park_facing && "park"].filter(Boolean).map((x) => ` · ${x}`)}</div>
              <a className="btn wa" target="_blank" rel="noreferrer" href={whatsappLink(phone.value, propertyMessage(p))}>
                Send on WhatsApp
              </a>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
