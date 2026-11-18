// Turns messy human input ("Sec 21", "1.10 cr", "@90", "200 gaj") into clean DB values.
// Each parser returns { value } or { error }.

export type Parsed<T> = { value: T | null; error?: string };

const ok = <T,>(value: T | null): Parsed<T> => ({ value });
const err = <T,>(error: string): Parsed<T> => ({ value: null, error });
const clean = (s: unknown) => String(s ?? "").trim();

// ---------- Property type ----------
const TYPE_ALIASES: Record<string, string> = {
  plot: "plot", land: "land", agri: "land",
  bf: "builder_floor", "builder floor": "builder_floor", builder_floor: "builder_floor", floor: "builder_floor",
  kothi: "kothi", house: "kothi", villa: "kothi", independent: "kothi",
  flat: "flat", apartment: "flat", society: "flat",
  shop: "shop", sco: "shop", booth: "shop",
  office: "office", other: "other",
};
export function parseType(input: unknown): Parsed<string> {
  const s = clean(input).toLowerCase();
  if (!s) return err("Required");
  return TYPE_ALIASES[s] ? ok(TYPE_ALIASES[s]) : err(`Unknown type "${input}"`);
}

// ---------- Listing type ----------
export function parseListing(input: unknown): Parsed<string> {
  const s = clean(input).toLowerCase();
  if (!s || ["sale", "sell", "s", "resale"].includes(s)) return ok("sale");
  if (["rent", "lease", "r"].includes(s)) return ok("rent");
  return err(`Use sale or rent`);
}

// ---------- Sector ----------
// Named areas (not numbered sectors): spelling variants → the canonical name in the sectors table.
// Keep in sync with the WhatsApp processor's sector_aliases.csv.
export const AREA_ALIASES: Record<string, string> = {
  "nit": "NIT", "n.i.t": "NIT", "n.i.t.": "NIT", "nit faridabad": "NIT",
  "neharpar": "Neharpar", "nehar par": "Neharpar", "neharpaar": "Neharpar", "nehar paar": "Neharpar",
  "neharpar faridabad": "Neharpar",
  "greater faridabad": "Greater Faridabad", "gr faridabad": "Greater Faridabad", "gr. faridabad": "Greater Faridabad",
  "greater fbd": "Greater Faridabad", "gr. fbd": "Greater Faridabad",
  "old faridabad": "Old Faridabad", "old fbd": "Old Faridabad",
  "ballabgarh": "Ballabgarh", "ballabhgarh": "Ballabgarh", "ballabgadh": "Ballabgarh", "ballabhgadh": "Ballabgarh",
  "greenfield": "Greenfield Colony", "greenfield colony": "Greenfield Colony", "green field colony": "Greenfield Colony",
  "green field": "Greenfield Colony",
  "surajkund": "Surajkund", "suraj kund": "Surajkund",
  "other": "Other",
};

export function parseSector(input: unknown, known: string[]): Parsed<string> {
  const s = clean(input);
  if (!s) return err("Required");
  const m = s.match(/^(?:sector|sec|s)?[\s\-.]*(\d{1,3})$/i);
  // "NIT 1", "NIT-5" → NIT (zone number belongs in notes)
  const key = s.toLowerCase().replace(/\s+/g, " ").replace(/^(n\.?i\.?t\.?)[\s\-]*\d+$/, "nit");
  const candidate = m ? `Sector ${parseInt(m[1], 10)}` : AREA_ALIASES[key] ?? s;
  const hit = known.find((k) => k.toLowerCase() === candidate.toLowerCase());
  return hit ? ok(hit) : err(`Unknown sector "${s}"`);
}

// ---------- Size ----------
// Stored in sq yd for every type (so matching works across types).
// Flats are entered/shown in sq ft. Add "shop"/"office" here to switch them too.
export type SizeUnit = "sqyd" | "sqft";
export const SQFT_TYPES = ["flat"];
export const sizeUnit = (type: string | null | undefined): SizeUnit =>
  type && SQFT_TYPES.includes(type) ? "sqft" : "sqyd";
// A lead uses sq ft only if every type it wants is a sq-ft type.
export const leadSizeUnit = (types: string[]): SizeUnit =>
  types.length && types.every((t) => SQFT_TYPES.includes(t)) ? "sqft" : "sqyd";
export const unitLabel = (u: SizeUnit) => (u === "sqft" ? "sq ft" : "sq yd");
const round2 = (n: number) => Math.round(n * 100) / 100;
export const fromSqyd = (sqyd: number, u: SizeUnit) => (u === "sqft" ? Math.round(Number(sqyd) * 9) : round2(Number(sqyd)));
export const formatSize = (sqyd: number, type: string) => `${fromSqyd(sqyd, sizeUnit(type))} ${unitLabel(sizeUnit(type))}`;

// Returns sq yd. "200", "200 gaj", "1200 sqft" — an explicit unit overrides the default.
export function parseSize(input: unknown, defaultUnit: SizeUnit = "sqyd"): Parsed<number> {
  const s = clean(input).toLowerCase().replace(/,/g, "");
  if (!s) return err("Required");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(sq\.?\s*yds?|sqyd|yds?|y|gaj|g|sq\.?\s*ft|sqft|sft|ft)?$/);
  if (!m) return err(`Can't read size "${input}" (use ${unitLabel(defaultUnit)})`);
  const n = parseFloat(m[1]);
  const unit: SizeUnit = m[2] ? (/f/.test(m[2]) ? "sqft" : "sqyd") : defaultUnit;
  const sqyd = round2(unit === "sqft" ? n / 9 : n);
  if (sqyd <= 0 || sqyd > 100000) return err("Size out of range");
  return ok(sqyd);
}

// ---------- Price → rupees ----------
// "1.10 cr", "1.1cr", "90 L", "90 lakh", "@110" (=1.10 cr), "@90" (=90 L),
// "45k", "85000", "1.2 psyd" (lakh per sq yd × size)
export function parsePrice(input: unknown, sizeSqyd: number | null, listing: string | null): Parsed<number> {
  const s = clean(input).toLowerCase().replace(/,/g, "").replace(/₹|rs\.?/g, "").trim();
  if (!s) return err("Required");

  let m;
  if ((m = s.match(/^@\s*(\d+(?:\.\d+)?)$/))) {
    const n = parseFloat(m[1]);
    return ok(Math.round(n >= 100 ? (n / 100) * 1e7 : n * 1e5));
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(cr|crore|crores)$/))) return ok(Math.round(parseFloat(m[1]) * 1e7));
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs)$/))) return ok(Math.round(parseFloat(m[1]) * 1e5));
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*k$/))) return ok(Math.round(parseFloat(m[1]) * 1e3));
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*psyd$/))) {
    if (!sizeSqyd) return err("psyd needs a valid size");
    return ok(Math.round(parseFloat(m[1]) * 1e5 * sizeSqyd));
  }
  if ((m = s.match(/^\d+(?:\.\d+)?$/))) {
    const n = parseFloat(s);
    // Bare small numbers on a sale are almost certainly lakh/cr typos — refuse to guess.
    if (listing !== "rent" && n < 100000) return err(`Ambiguous "${input}" — add cr/L`);
    return ok(Math.round(n));
  }
  return err(`Can't read price "${input}"`);
}

// ---------- Phone (India, 10 digits) ----------
export function parsePhone(input: unknown): Parsed<string> {
  const digits = clean(input).replace(/\D/g, "");
  if (!digits) return err("Required");
  const d = digits.replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? ok(d) : err(`Invalid phone "${input}"`);
}

// ---------- Small enums ----------
const FACING: Record<string, string> = {
  n: "north", north: "north", s: "south", south: "south", e: "east", east: "east", w: "west", west: "west",
  ne: "north_east", "north east": "north_east", nw: "north_west", "north west": "north_west",
  se: "south_east", "south east": "south_east", sw: "south_west", "south west": "south_west",
};
export function parseFacing(input: unknown): Parsed<string> {
  const s = clean(input).toLowerCase().replace(/[-_]/g, " ");
  if (!s) return ok<string>(null);
  return FACING[s] ? ok(FACING[s]) : err(`Unknown facing "${input}"`);
}

export function parseBool(input: unknown): Parsed<boolean> {
  const s = clean(input).toLowerCase();
  if (!s) return ok(false);
  if (["y", "yes", "true", "1", "park", "haan"].includes(s)) return ok(true);
  if (["n", "no", "false", "0", "nahi"].includes(s)) return ok(false);
  return err(`Use yes/no`);
}

// NOC applies only to these types, for sale. Change here to widen it (single source of truth).
export const NOC_TYPES = ["plot", "land", "kothi"];
export const nocApplies = (type: string | null | undefined, listing: string | null | undefined) =>
  !!type && NOC_TYPES.includes(type) && listing === "sale";

// NOC: yes / applied / no; blank = not sure
export function parseNoc(input: unknown): Parsed<string> {
  const s = clean(input).toLowerCase();
  if (!s || ["?", "na", "n/a", "unknown", "not sure"].includes(s)) return ok<string>(null);
  if (["y", "yes", "haan", "available", "ok", "clear"].includes(s)) return ok("yes");
  if (["applied", "pending", "in process", "process"].includes(s)) return ok("applied");
  if (["n", "no", "nahi"].includes(s)) return ok("no");
  return err(`Use yes / applied / no`);
}

export function parseStatus(input: unknown): Parsed<string> {
  const s = clean(input).toLowerCase();
  if (!s) return ok("available");
  const map: Record<string, string> = { available: "available", avl: "available", token: "token", sold: "sold", withdrawn: "withdrawn" };
  return map[s] ? ok(map[s]) : err(`Unknown status "${input}"`);
}

export function parseSource(input: unknown): Parsed<string> {
  const s = clean(input).toLowerCase().replace(/[-\s]/g, "_");
  if (!s) return ok("direct_owner");
  const map: Record<string, string> = { direct: "direct_owner", owner: "direct_owner", direct_owner: "direct_owner",
    broker: "co_broker", co_broker: "co_broker", cobroker: "co_broker", builder: "builder" };
  return map[s] ? ok(map[s]) : err(`Unknown source "${input}"`);
}

// ---------- Display helper ----------
export function formatINR(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, "")} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}
