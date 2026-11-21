import * as N from "./normalize";

// Columns of the leads import grid / template. Same headers as the WhatsApp processor's requirements.csv.
export const LEAD_COLUMNS = [
  { key: "name", label: "Name", required: true, hint: "Mr. Gupta" },
  { key: "phone", label: "Phone", hint: "98xxxxxxxx" },
  { key: "wants", label: "Wants", hint: "buy / rent" },
  { key: "property_types", label: "Types", hint: "plot;bf (blank = any)" },
  { key: "sectors", label: "Sectors", hint: "21;NIT (blank = any)" },
  { key: "size_min", label: "Size min" },
  { key: "size_max", label: "Size max" },
  { key: "size_unit", label: "Unit", hint: "sqyd / sqft" },
  { key: "budget_min", label: "Budget min", hint: "90 L" },
  { key: "budget_max", label: "Budget max", hint: "1.2 cr" },
  { key: "status", label: "Status", hint: "new" },
  { key: "follow_up_on", label: "Follow up", hint: "2026-12-01" },
  { key: "source", label: "Source", hint: "referral / broker" },
  { key: "referred_by", label: "Referred by" },
  { key: "notes", label: "Notes" },
] as const;

export type LeadKey = (typeof LEAD_COLUMNS)[number]["key"];
export type RawLead = Record<LeadKey, string>;
export const emptyLead = (): RawLead => Object.fromEntries(LEAD_COLUMNS.map((c) => [c.key, ""])) as RawLead;
export const isBlankLead = (r: RawLead) => LEAD_COLUMNS.every((c) => !String(r[c.key] ?? "").trim());

export type CleanLead = {
  name: string; phone: string | null; wants: string; property_types: string[]; sectors: string[];
  size_min: number | null; size_max: number | null; budget_min: number | null; budget_max: number | null;
  status: string; follow_up_on: string | null; source: string | null; referred_by: string | null; notes: string | null;
};
export type LeadResult = { clean: CleanLead | null; errors: Partial<Record<LeadKey, string>>; warnings: string[] };

const s = (v: unknown) => String(v ?? "").trim();
const list = (v: unknown) => s(v).split(/[;,|/]/).map((x) => x.trim()).filter(Boolean);
const STATUSES: Record<string, string> = {
  new: "new", active: "active", won: "closed_won", closed_won: "closed_won", lost: "closed_lost", closed_lost: "closed_lost",
};
const SOURCES = ["referral", "walk-in", "website", "broker", "other"];

export function validateLead(r: RawLead, known: string[]): LeadResult {
  const errors: LeadResult["errors"] = {};
  const warnings: string[] = [];

  const name = s(r.name);
  if (!name) errors.name = "Required";

  const phone = s(r.phone) ? N.parsePhone(r.phone) : { value: null };
  if ("error" in phone && phone.error) errors.phone = phone.error;

  const w = s(r.wants).toLowerCase();
  const wants = !w || ["buy", "buyer", "sale", "purchase"].includes(w) ? "sale" : ["rent", "tenant", "lease"].includes(w) ? "rent" : null;
  if (!wants) errors.wants = "Use buy or rent";

  const types: string[] = [];
  for (const t of list(r.property_types)) {
    const p = N.parseType(t);
    if (p.error) { errors.property_types = p.error; break; }
    if (p.value === "other") continue;            // "other" means unknown: match any type
    if (!types.includes(p.value!)) types.push(p.value!);
  }

  const sectors: string[] = [];
  for (const t of list(r.sectors)) {
    const p = N.parseSector(t, known);
    if (p.error) { errors.sectors = p.error; break; }
    if (!sectors.includes(p.value!)) sectors.push(p.value!);
  }

  const u = s(r.size_unit).toLowerCase();
  const unit: N.SizeUnit = /ft/.test(u) ? "sqft" : /yd|gaj/.test(u) ? "sqyd" : N.leadSizeUnit(types);
  const size = (k: "size_min" | "size_max") => {
    if (!s(r[k])) return null;
    const p = N.parseSize(r[k], unit);
    if (p.error) errors[k] = p.error;
    return p.value;
  };
  const size_min = size("size_min"), size_max = size("size_max");

  // Same reading as the lead form: bare numbers are rupees, "90 L" / "1.2 cr" / "40k" work too.
  const money = (k: "budget_min" | "budget_max") => {
    if (!s(r[k])) return null;
    const p = N.parsePrice(r[k], null, "rent");
    if (p.error) errors[k] = p.error;
    return p.value;
  };
  const budget_min = money("budget_min"), budget_max = money("budget_max");

  const st = s(r.status).toLowerCase().replace(/[\s-]+/g, "_");
  const status = st ? STATUSES[st] : "new";
  if (!status) errors.status = "Use new / active / won / lost";

  const fu = s(r.follow_up_on);
  const follow_up_on = fu ? toDate(fu) : null;
  if (fu && !follow_up_on) errors.follow_up_on = "Use YYYY-MM-DD or DD/MM/YYYY";

  const src = s(r.source).toLowerCase();
  const source = !src ? "referral" : SOURCES.includes(src) ? src : src === "walkin" ? "walk-in" : "other";

  if (size_min != null && size_max != null && size_min > size_max) errors.size_max = "Smaller than min";
  if (budget_min != null && budget_max != null && budget_min > budget_max) errors.budget_max = "Smaller than min";
  if (wants === "sale" && budget_max != null && budget_max < 5e5) warnings.push("Budget under ₹5 L — per sq yd?");

  if (Object.keys(errors).length) return { clean: null, errors, warnings };
  return {
    errors, warnings,
    clean: {
      name, phone: phone.value, wants: wants!, property_types: types, sectors, size_min, size_max, budget_min, budget_max,
      status, follow_up_on, source, referred_by: s(r.referred_by) || null, notes: s(r.notes) || null,
    },
  };
}

// "2026-12-01", "01/12/2026", "1-12-26" (day first, Indian style) → "2026-12-01"
function toDate(v: string): string | null {
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function mapLeadHeader(h: string): LeadKey | null {
  const k = h.toLowerCase().replace(/[^a-z]/g, "");
  for (const c of LEAD_COLUMNS) {
    if (k === c.key.replace(/_/g, "") || k === c.label.toLowerCase().replace(/[^a-z]/g, "")) return c.key;
  }
  const extra: Record<string, LeadKey> = {
    mobile: "phone", contact: "phone", client: "name", type: "property_types", propertytype: "property_types",
    sector: "sectors", budget: "budget_max", minbudget: "budget_min", maxbudget: "budget_max", followup: "follow_up_on",
    followupon: "follow_up_on", referredby: "referred_by", remarks: "notes", minsize: "size_min", maxsize: "size_max",
  };
  return extra[k] ?? null;
}
