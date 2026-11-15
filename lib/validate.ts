import * as N from "./normalize";

// Columns of the import grid / template, in order.
export const COLUMNS = [
  { key: "property_type", label: "Type", required: true, hint: "plot / bf / kothi / flat / shop" },
  { key: "listing_type", label: "Sale/Rent", hint: "sale" },
  { key: "sector", label: "Sector", required: true, hint: "21 / Sec 21" },
  { key: "size_sqyd", label: "Size", required: true, hint: "sq yd; flats: sq ft" },
  { key: "floor", label: "Floor", hint: "GF / FF / Full" },
  { key: "facing", label: "Facing", hint: "E / NE" },
  { key: "park_facing", label: "Park", hint: "yes/no" },
  { key: "price", label: "Price", required: true, hint: "1.10 cr / 90 L / @110" },
  { key: "status", label: "Status", hint: "available" },
  { key: "owner_name", label: "Owner name" },
  { key: "owner_phone", label: "Owner phone", required: true, hint: "98xxxxxxxx" },
  { key: "source", label: "Source", hint: "direct / broker" },
  { key: "exclusive", label: "Exclusive", hint: "yes/no" },
  { key: "noc", label: "NOC", hint: "yes / applied / no" },
  { key: "notes", label: "Notes" },
] as const;

export type ColKey = (typeof COLUMNS)[number]["key"];
export type RawRow = Record<ColKey, string>;
export const emptyRow = (): RawRow =>
  Object.fromEntries(COLUMNS.map((c) => [c.key, ""])) as RawRow;

export type CleanRow = {
  property_type: string; listing_type: string; sector: string; size_sqyd: number;
  floor: string | null; facing: string | null; park_facing: boolean; price_inr: number;
  status: string; owner_name: string | null; owner_phone: string; source: string;
  exclusive: boolean; noc: string | null; notes: string | null;
};

export type RowResult = {
  clean: CleanRow | null;
  errors: Partial<Record<ColKey, string>>;
  warnings: string[];
};

export const isBlank = (r: RawRow) => COLUMNS.every((c) => !String(r[c.key] ?? "").trim());

export function validateRow(r: RawRow, sectors: string[]): RowResult {
  const errors: RowResult["errors"] = {};
  const take = <T,>(key: ColKey, p: N.Parsed<T>): T | null => {
    if (p.error) errors[key] = p.error;
    return p.value;
  };

  const property_type = take("property_type", N.parseType(r.property_type));
  const listing_type = take("listing_type", N.parseListing(r.listing_type));
  const sector = take("sector", N.parseSector(r.sector, sectors));
  const size_sqyd = take("size_sqyd", N.parseSize(r.size_sqyd, N.sizeUnit(property_type)));
  const facing = take("facing", N.parseFacing(r.facing));
  const park_facing = take("park_facing", N.parseBool(r.park_facing));
  const price_inr = take("price", N.parsePrice(r.price, size_sqyd, listing_type));
  const status = take("status", N.parseStatus(r.status));
  const owner_phone = take("owner_phone", N.parsePhone(r.owner_phone));
  const source = take("source", N.parseSource(r.source));
  const exclusive = take("exclusive", N.parseBool(r.exclusive));
  // NOC only applies to plots for sale; ignored otherwise.
  const noc = N.nocApplies(property_type, listing_type) ? take("noc", N.parseNoc(r.noc)) : null;

  const warnings: string[] = [];
  if (price_inr && listing_type === "sale" && price_inr < 5e5) warnings.push("Sale price under ₹5 L — check");
  if (price_inr && listing_type === "rent" && price_inr > 1e6) warnings.push("Rent over ₹10 L/month — check");

  if (Object.keys(errors).length) return { clean: null, errors, warnings };
  return {
    errors, warnings,
    clean: {
      property_type: property_type!, listing_type: listing_type!, sector: sector!, size_sqyd: size_sqyd!,
      floor: String(r.floor ?? "").trim() || null, facing, park_facing: park_facing!, price_inr: price_inr!,
      status: status!, owner_name: String(r.owner_name ?? "").trim() || null, owner_phone: owner_phone!,
      source: source!, exclusive: exclusive!, noc, notes: String(r.notes ?? "").trim() || null,
    },
  };
}

// Same sector + type + listing + size, price within 5% → likely the same property.
export type DupKey = Pick<CleanRow, "sector" | "property_type" | "listing_type" | "size_sqyd" | "price_inr">;
export function isLikelyDup(a: DupKey, b: DupKey): boolean {
  return a.sector === b.sector && a.property_type === b.property_type && a.listing_type === b.listing_type &&
    Number(a.size_sqyd) === Number(b.size_sqyd) &&
    Math.abs(a.price_inr - b.price_inr) <= 0.05 * Math.max(a.price_inr, b.price_inr);
}

// Map arbitrary file headers ("Owner Phone", "size", "Price (Rs)") to our keys.
export function mapHeader(h: string): ColKey | null {
  const s = h.toLowerCase().replace(/[^a-z]/g, "");
  for (const c of COLUMNS) {
    if (s === c.key.replace(/_/g, "") || s === c.label.toLowerCase().replace(/[^a-z]/g, "")) return c.key;
  }
  const extra: Record<string, ColKey> = {
    type: "property_type", propertytype: "property_type", size: "size_sqyd", area: "size_sqyd", gaj: "size_sqyd",
    sale: "listing_type", salerent: "listing_type", phone: "owner_phone", mobile: "owner_phone", contact: "owner_phone",
    owner: "owner_name", name: "owner_name", demand: "price", pricers: "price", remarks: "notes", park: "park_facing",
  };
  return extra[s] ?? null;
}
