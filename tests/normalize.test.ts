import { describe, it, expect } from "vitest";
import * as N from "../lib/normalize";
import { validateRow, emptyRow, isLikelyDup, mapHeader } from "../lib/validate";

const SECTORS = [...Array.from({ length: 89 }, (_, i) => `Sector ${i + 1}`), "NIT", "Greenfield Colony"];

describe("price", () => {
  it.each([
    ["1.10 cr", 11000000], ["1.1Cr", 11000000], ["90 L", 9000000], ["90 lakh", 9000000],
    ["@110", 11000000], ["@90", 9000000], ["₹1,25,00,000", 12500000],
  ])("%s", (inp, out) => expect(N.parsePrice(inp, 200, "sale").value).toBe(out));
  it("psyd uses size", () => expect(N.parsePrice("1.2 psyd", 200, "sale").value).toBe(24000000));
  it("rent bare / k", () => {
    expect(N.parsePrice("85000", null, "rent").value).toBe(85000);
    expect(N.parsePrice("45k", null, "rent").value).toBe(45000);
  });
  it("refuses ambiguous sale number", () => expect(N.parsePrice("90", 200, "sale").error).toBeTruthy());
});

describe("sector/size/phone/type", () => {
  it.each(["21", "Sec 21", "sector-21", "S21", "sec.21"])("%s → Sector 21", (s) =>
    expect(N.parseSector(s, SECTORS).value).toBe("Sector 21"));
  it("named area", () => expect(N.parseSector("nit", SECTORS).value).toBe("NIT"));
  it("unknown sector", () => expect(N.parseSector("Sector 200", SECTORS).error).toBeTruthy());
  it("size", () => { expect(N.parseSize("200 gaj").value).toBe(200); expect(N.parseSize("250 sq yd").value).toBe(250); });
  it.each(["+91 98110 12345", "09811012345", "9811012345"])("phone %s", (p) =>
    expect(N.parsePhone(p).value).toBe("9811012345"));
  it("bad phone", () => expect(N.parsePhone("12345").error).toBeTruthy());
  it("type alias", () => expect(N.parseType("BF").value).toBe("builder_floor"));
});

describe("row + dup + headers", () => {
  const base = { ...emptyRow(), property_type: "plot", sector: "21", size_sqyd: "200", price: "@110", owner_phone: "9811012345" };
  it("valid row", () => {
    const r = validateRow(base, SECTORS);
    expect(r.clean?.price_inr).toBe(11000000);
    expect(r.clean?.listing_type).toBe("sale");
  });
  it("errors collected per field", () => {
    const r = validateRow({ ...base, sector: "xyz", price: "" }, SECTORS);
    expect(Object.keys(r.errors).sort()).toEqual(["price", "sector"]);
  });
  it("dup within 5%", () => {
    const a = validateRow(base, SECTORS).clean!;
    expect(isLikelyDup(a, { ...a, price_inr: 11300000 })).toBe(true);
    expect(isLikelyDup(a, { ...a, price_inr: 12000000 })).toBe(false);
  });
  it("headers", () => {
    expect(mapHeader("Owner Phone")).toBe("owner_phone");
    expect(mapHeader("Size (sq yd)")).toBe("size_sqyd");
    expect(mapHeader("Demand")).toBe("price");
  });
});
