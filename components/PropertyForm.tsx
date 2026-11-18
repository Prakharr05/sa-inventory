"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import * as N from "@/lib/normalize";
import { useIsAdmin } from "@/components/AuthGate";
import PropertyLeads from "@/components/PropertyLeads";
import { uploadPhoto, deletePhotos, photoUrl, uuid } from "@/lib/photos";

const TYPES = [
  ["plot", "Plot"], ["builder_floor", "Builder floor"], ["kothi", "Kothi"], ["flat", "Flat"],
  ["shop", "Shop"], ["office", "Office"], ["land", "Land"], ["other", "Other"],
] as const;
const FACINGS = ["", "east", "west", "north", "south", "north_east", "north_west", "south_east", "south_west"];
const STATUSES = ["available", "token", "sold", "withdrawn"];

type Form = {
  property_type: string; listing_type: string; sector: string; size: string; floor: string;
  facing: string; park_facing: boolean; price: string; status: string; owner_name: string;
  owner_phone: string; source: string; exclusive: boolean; notes: string; is_public: boolean; noc: string;
};
const BLANK: Form = {
  property_type: "", listing_type: "sale", sector: "", size: "", floor: "", facing: "",
  park_facing: false, price: "", status: "available", owner_name: "", owner_phone: "",
  source: "direct_owner", exclusive: false, notes: "", is_public: false, noc: "",
};

export default function PropertyForm({ id }: { id: string | null }) {
  const isAdmin = useIsAdmin();
  const [f, setF] = useState<Form>(BLANK);
  const [photos, setPhotos] = useState<string[]>([]);       // saved paths
  const [removed, setRemoved] = useState<string[]>([]);     // saved paths to delete on save
  const [newFiles, setNewFiles] = useState<File[]>([]);     // not yet uploaded
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setDupWarn(null); };

  useEffect(() => {
    supabase.from("sectors").select("name").then(({ data }) =>
      setSectors((data ?? []).map((d) => d.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))));
    if (!id) return;
    supabase.from("properties").select("*, owner:contacts(name,phone)").eq("id", id).single()
      .then(({ data, error }) => {
        setLoading(false);
        if (error || !data) { setMsg(error?.message ?? "Not found"); return; }
        setF({
          property_type: data.property_type, listing_type: data.listing_type, sector: data.sector,
          size: String(N.fromSqyd(data.size_sqyd, N.sizeUnit(data.property_type))), floor: data.floor ?? "", facing: data.facing ?? "",
          park_facing: data.park_facing, price: data.price_inr == null ? "" : N.formatINR(data.price_inr).replace("₹", ""),
          status: data.status, owner_name: data.owner?.name ?? "", owner_phone: data.owner?.phone ?? "",
          source: data.source ?? "direct_owner", exclusive: data.exclusive, notes: data.notes ?? "", noc: data.noc ?? "",
          is_public: data.is_public,
        });
        setPhotos(data.photos ?? []);
      });
  }, [id]);

  // Live parse for preview + validation
  const type = N.parseType(f.property_type);
  const sector = N.parseSector(f.sector, sectors);
  const unit = N.sizeUnit(type.value);
  const size = N.parseSize(f.size, unit);
  // Price optional: blank → null.
  const price: N.Parsed<number> = f.price.trim() ? N.parsePrice(f.price, size.value, f.listing_type) : { value: null };
  const phone = f.owner_phone.trim() ? N.parsePhone(f.owner_phone) : { value: null };
  const errors = [
    type.error && "Pick a type", sector.error && `Sector: ${sector.error}`, size.error && `Size: ${size.error}`,
    price.error && `Price: ${price.error}`, phone.error && `Phone: ${phone.error}`,
    !id && !phone.value && "Owner phone is required",
  ].filter(Boolean) as string[];

  const save = async (force = false) => {
    if (errors.length) { setMsg(errors[0]); return; }
    setBusy(true); setMsg("");

    // Duplicate check (new properties only)
    if (!id && !force) {
      // Server-side check: staff learn only "similar exists", not the other listing.
      const { data: dup } = await supabase.rpc("similar_property_exists", {
        p_sector: sector.value, p_type: type.value, p_listing: f.listing_type,
        p_size: size.value, p_price: price.value });
      if (dup) {
        setBusy(false);
        setDupWarn("A similar property (same sector, type, size, price within 5%) already exists.");
        return;
      }
    }

    try {
      const pid = id ?? uuid();
      const uploaded: string[] = [];
      for (const file of newFiles) uploaded.push(await uploadPhoto(pid, file));
      const keep = photos.filter((p) => !removed.includes(p));

      const { error } = await supabase.rpc("save_property_guarded", { p: {
        id: pid, property_type: type.value, listing_type: f.listing_type, sector: sector.value,
        size_sqyd: size.value, floor: f.floor, facing: f.facing, park_facing: f.park_facing,
        price_inr: price.value, status: f.status, source: f.source, exclusive: f.exclusive, noc: N.nocApplies(type.value, f.listing_type) ? f.noc : "",
        owner_name: f.owner_name.trim(), owner_phone: phone.value ?? "", notes: f.notes.trim(),
        photos: [...keep, ...uploaded], is_public: f.is_public,
      } });
      if (error) { await deletePhotos(uploaded); throw error; }
      await deletePhotos(removed);

      setPhotos([...keep, ...uploaded]); setRemoved([]); setNewFiles([]); setDupWarn(null);
      setSavedId(pid);
    } catch (e) {
      setMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Keep sector/type/listing for the next entry — usually adding several in one area.
  const addAnother = () => {
    setF({ ...BLANK, property_type: f.property_type, listing_type: f.listing_type, sector: f.sector });
    setPhotos([]); setSavedId(null); setMsg("");
    window.scrollTo(0, 0);
  };

  if (loading) return <main className="pf"><p className="muted">Loading…</p></main>;

  if (savedId && !id) {
    return (
      <main className="pf">
        <h1>Saved ✓</h1>
        <p>{TYPES.find((t) => t[0] === type.value)?.[1]} · {sector.value} · {N.formatSize(size.value!, type.value!)} · {N.formatINR(price.value)}</p>
        <div className="pf-actions">
          <button className="primary" onClick={addAnother}>Add another</button>
          <a className="btn" href={`/inventory/property?id=${savedId}`}>Edit this one</a>
          <a className="btn" href="/inventory">Back to inventory</a>
        </div>
      </main>
    );
  }

  return (
    <main className="pf">
      <h1>{id ? "Edit property" : "Add property"}</h1>

      <label className="pf-label">Type *</label>
      <div className="chips">
        {TYPES.map(([v, l]) => (
          <button type="button" key={v} className={f.property_type === v ? "chip on" : "chip"}
            onClick={() => set("property_type", v)}>{l}</button>
        ))}
      </div>

      <div className="chips">
        {(["sale", "rent"] as const).map((v) => (
          <button type="button" key={v} className={f.listing_type === v ? "chip on" : "chip"}
            onClick={() => set("listing_type", v)}>{v === "sale" ? "Sale" : "Rent"}</button>
        ))}
      </div>

      <label className="pf-label">Sector *</label>
      <input list="sector-list" inputMode="text" placeholder="21 / Sec 21 / NIT" value={f.sector}
        onChange={(e) => set("sector", e.target.value)} />
      <datalist id="sector-list">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
      <Hint p={f.sector ? sector : null} show={(v) => v} />

      <div className="pf-row">
        <div>
          <label className="pf-label">Size ({N.unitLabel(unit)}) *</label>
          <input inputMode="decimal" placeholder={unit === "sqft" ? "1200" : "200"} value={f.size} onChange={(e) => set("size", e.target.value)} />
        </div>
        <div>
          <label className="pf-label">{f.listing_type === "rent" ? "Rent / month" : "Price"} <span className="muted">(optional)</span></label>
          <input placeholder={f.listing_type === "rent" ? "45k / 45000" : "1.10 cr / 90 L / @110"} value={f.price}
            onChange={(e) => set("price", e.target.value)} />
          <Hint p={f.price ? price : null} show={(v) => N.formatINR(v)} />
        </div>
      </div>

      <div className="pf-row">
        <div>
          <label className="pf-label">Floor</label>
          <input placeholder="GF / FF / Full" value={f.floor} onChange={(e) => set("floor", e.target.value)} />
        </div>
        <div>
          <label className="pf-label">Facing</label>
          <select value={f.facing} onChange={(e) => set("facing", e.target.value)}>
            {FACINGS.map((x) => <option key={x} value={x}>{x ? x.replace("_", " ") : "—"}</option>)}
          </select>
        </div>
      </div>

      <div className="pf-toggles">
        <label><input type="checkbox" checked={f.park_facing} onChange={(e) => set("park_facing", e.target.checked)} /> Park facing</label>
        <label><input type="checkbox" checked={f.exclusive} onChange={(e) => set("exclusive", e.target.checked)} /> Exclusive</label>
        {isAdmin && <label><input type="checkbox" checked={f.is_public} onChange={(e) => set("is_public", e.target.checked)} /> Show on website</label>}
      </div>

      <label className="pf-label">Photos</label>
      <div className="thumbs">
        {photos.filter((p) => !removed.includes(p)).map((p) => (
          <div key={p} className="thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(p)} alt="" />
            <button type="button" onClick={() => setRemoved((r) => [...r, p])}>✕</button>
          </div>
        ))}
        {newFiles.map((file, i) => (
          <div key={i} className="thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={URL.createObjectURL(file)} alt="" />
            <button type="button" onClick={() => setNewFiles((fs) => fs.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <label className="thumb add">
          + Photo
          <input type="file" accept="image/*" multiple hidden
            onChange={(e) => { setNewFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
      </div>

      {N.nocApplies(type.value, f.listing_type) && <>
      <label className="pf-label">NOC</label>
      <div className="chips">
        {([["yes", "Yes"], ["applied", "Applied"], ["no", "No"], ["", "Not sure"]] as const).map(([v, l]) => (
          <button type="button" key={l} className={f.noc === v ? "chip on" : "chip"} onClick={() => set("noc", v)}>{l}</button>
        ))}
      </div>
      </>}

      <label className="pf-label">Owner</label>
      <input placeholder="Name" value={f.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
      <input type="tel" inputMode="tel" placeholder={id ? "Phone (leave blank to keep current)" : "Phone *"}
        value={f.owner_phone} onChange={(e) => set("owner_phone", e.target.value)} />
      <div className="chips">
        {([["direct_owner", "Direct owner"], ["co_broker", "Co-broker"], ["builder", "Builder"]] as const).map(([v, l]) => (
          <button type="button" key={v} className={f.source === v ? "chip on" : "chip"}
            onClick={() => set("source", v)}>{l}</button>
        ))}
      </div>

      <label className="pf-label">Status</label>
      <select value={f.status} onChange={(e) => set("status", e.target.value)}>
        {STATUSES.map((s) => <option key={s}>{s}</option>)}
      </select>

      <label className="pf-label">Notes</label>
      <textarea rows={3} placeholder="Corner, lift, registry ready…" value={f.notes}
        onChange={(e) => set("notes", e.target.value)} />

      {dupWarn && (
        <div className="pf-warn">
          ⚠ {dupWarn}
          <div className="pf-actions">
            <button onClick={() => save(true)} disabled={busy}>Save anyway</button>
            {isAdmin && <a className="btn" href={`/inventory?sector=${encodeURIComponent(sector.value ?? "")}`}>View sector</a>}
          </div>
        </div>
      )}
      {msg && <div className="bad">{msg}</div>}

      <div className="pf-save">
        <button className="primary" disabled={busy} onClick={() => save()}>
          {busy ? (newFiles.length ? "Uploading photos…" : "Saving…") : id ? "Save changes" : "Save property"}
        </button>
        {savedId && id && <span className="ok">Saved ✓</span>}
      </div>
      {id && <PropertyLeads id={id} />}
    </main>
  );
}

function Hint<T>({ p, show }: { p: N.Parsed<T> | null; show: (v: T) => string }) {
  if (!p) return null;
  return p.error ? <div className="hint bad">{p.error}</div> : <div className="hint ok">= {show(p.value as T)}</div>;
}
