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
    const r = validateRow({ ...base, sector: "xyz", price: "abc" }, SECTORS);
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

describe("units", () => {
  it("flat size in sq ft → sq yd", () => expect(N.parseSize("1200", "sqft").value).toBe(133.33));
  it("explicit unit overrides default", () => {
    expect(N.parseSize("1350 sqft").value).toBe(150);
    expect(N.parseSize("200 gaj", "sqft").value).toBe(200);
  });
  it("round-trips for display", () => expect(N.fromSqyd(N.parseSize("1200", "sqft").value!, "sqft")).toBe(1200));
  it("formatSize by type", () => {
    expect(N.formatSize(133.33, "flat")).toBe("1200 sq ft");
    expect(N.formatSize(200, "plot")).toBe("200 sq yd");
  });
  it("bulk row: flat size read as sq ft", () => {
    const r = validateRow({ ...emptyRow(), property_type: "flat", sector: "21", size_sqyd: "1350", price: "90 L", owner_phone: "9811012345" }, SECTORS);
    expect(r.clean?.size_sqyd).toBe(150);
  });
  it("lead unit", () => {
    expect(N.leadSizeUnit(["flat"])).toBe("sqft");
    expect(N.leadSizeUnit(["flat", "plot"])).toBe("sqyd");
    expect(N.leadSizeUnit([])).toBe("sqyd");
  });
});

describe("noc", () => {
  it.each([["yes", "yes"], ["Y", "yes"], ["applied", "applied"], ["pending", "applied"], ["no", "no"]])("%s", (i, o) =>
    expect(N.parseNoc(i).value).toBe(o));
  it("blank = not sure", () => expect(N.parseNoc("").value).toBeNull());
  it("bad value", () => expect(N.parseNoc("maybe").error).toBeTruthy());
  it("header maps", () => expect(mapHeader("NOC")).toBe("noc"));
});

describe("noc on rent", () => {
  it("ignored for rent rows", () => {
    const r = validateRow({ ...emptyRow(), property_type: "kothi", listing_type: "rent", sector: "9", size_sqyd: "300",
      price: "85000", owner_phone: "9811012345", noc: "maybe" }, SECTORS);
    expect(r.errors.noc).toBeUndefined();
    expect(r.clean?.noc).toBeNull();
  });
});

describe("noc only for plots for sale", () => {
  it("applies", () => {
    expect(N.nocApplies("plot", "sale")).toBe(true);
    expect(N.nocApplies("plot", "rent")).toBe(false);
    expect(N.nocApplies("flat", "sale")).toBe(false);
    expect(N.nocApplies("land", "sale")).toBe(true);
    expect(N.nocApplies("kothi", "sale")).toBe(true);
    expect(N.nocApplies("kothi", "rent")).toBe(false);
  });
  it("ignored for a flat row", () => {
    const r = validateRow({ ...emptyRow(), property_type: "flat", sector: "21", size_sqyd: "1200", price: "90 L",
      owner_phone: "9811012345", noc: "yes" }, SECTORS);
    expect(r.clean?.noc).toBeNull();
  });
  it("kept for a plot row", () => {
    const r = validateRow({ ...emptyRow(), property_type: "plot", sector: "21", size_sqyd: "200", price: "1.1 cr",
      owner_phone: "9811012345", noc: "applied" }, SECTORS);
    expect(r.clean?.noc).toBe("applied");
  });
});

describe("optional price", () => {
  const row = { ...emptyRow(), property_type: "plot", sector: "21", size_sqyd: "200", owner_phone: "9811012345" };
  it("blank price is valid", () => {
    const r = validateRow(row, SECTORS);
    expect(r.clean?.price_inr).toBeNull();
  });
  it("dup when price missing on one side", () => {
    const a = validateRow(row, SECTORS).clean!;
    const b = validateRow({ ...row, price: "1.1 cr" }, SECTORS).clean!;
    expect(isLikelyDup(a, b)).toBe(true);
  });
  it("formatINR(null)", () => expect(N.formatINR(null)).toBe("—"));
});

describe("named areas", () => {
  const S = [...SECTORS, "Neharpar", "Greater Faridabad", "Ballabgarh", "Sector 97", "Sector 123"];
  it.each([["Nehar Paar", "Neharpar"], ["neharpaar", "Neharpar"], ["Gr. Faridabad", "Greater Faridabad"],
    ["NIT 5", "NIT"], ["N.I.T", "NIT"], ["Ballabhgarh", "Ballabgarh"], ["Sec 97", "Sector 97"], ["123", "Sector 123"]])(
    "%s → %s", (i, o) => expect(N.parseSector(i, S).value).toBe(o));
});
