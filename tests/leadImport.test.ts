import { describe, it, expect } from "vitest";
import { validateLead, emptyLead, mapLeadHeader, RawLead } from "../lib/leadImport";

const SECTORS = ["Sector 21", "Sector 86", "Sector 88", "Sector 104", "NIT", "Other"];
const row = (p: Partial<RawLead>) => ({ ...emptyLead(), ...p });

describe("lead import", () => {
  it("reads a WhatsApp processor requirement row", () => {
    const r = validateLead(row({
      name: "Client of Hari", phone: "9873726088", wants: "buy", property_types: "builder_floor",
      sectors: "Sector 88;Sector 86", source: "broker", referred_by: "Hari (GURU Ji HOMES)", notes: "first floor",
    }), SECTORS);
    expect(r.errors).toEqual({});
    expect(r.clean).toMatchObject({
      wants: "sale", property_types: ["builder_floor"], sectors: ["Sector 88", "Sector 86"], source: "broker", status: "new",
    });
  });

  it("parses budgets and sizes like the lead form", () => {
    const c = validateLead(row({ name: "A", wants: "rent", budget_max: "40k", property_types: "flat", size_min: "1200" }), SECTORS).clean!;
    expect(c.budget_max).toBe(40000);
    expect(c.size_min).toBeCloseTo(133.33, 1);          // flat → sq ft → stored as sq yd
    const d = validateLead(row({ name: "B", budget_min: "90 L", budget_max: "1.2 cr", size_max: "1800", size_unit: "sqft" }), SECTORS).clean!;
    expect([d.budget_min, d.budget_max, d.size_max]).toEqual([9000000, 12000000, 200]);
  });

  it("reports bad cells", () => {
    const r = validateLead(row({ phone: "123", sectors: "Sector 999", wants: "maybe", budget_min: "2 cr", budget_max: "1 cr" }), SECTORS);
    expect(Object.keys(r.errors).sort()).toEqual(["budget_max", "name", "phone", "sectors", "wants"]);
  });

  it("dates, status and blanks", () => {
    const c = validateLead(row({ name: "C", follow_up_on: "01/12/2026", status: "Active" }), SECTORS).clean!;
    expect([c.follow_up_on, c.status, c.phone, c.sectors]).toEqual(["2026-12-01", "active", null, []]);
    expect(validateLead(row({ name: "D", follow_up_on: "31/02/2026" }), SECTORS).errors.follow_up_on).toBeTruthy();
  });

  it("maps headers", () => {
    expect(["name", "Phone", "Mobile", "Budget", "Follow up", "size_unit"].map(mapLeadHeader))
      .toEqual(["name", "phone", "phone", "budget_max", "follow_up_on", "size_unit"]);
  });
});
