import { describe, expect, it } from "vitest";
import { cleanCustomValues, customFieldDefsSchema, type CustomFieldDef } from "../src/custom-fields";

const defs: CustomFieldDef[] = [
  { key: "tshirt", label: "T-shirt size", type: "select", options: ["S", "M", "L"], required: true, showToEmployee: true },
  { key: "cost_centre", label: "Cost centre", type: "number", required: false, showToEmployee: false },
  { key: "vaccinated", label: "Vaccinated", type: "yes_no", required: false, showToEmployee: false },
  { key: "badge_on", label: "Badge issued on", type: "date", required: false, showToEmployee: false },
];

describe("custom fields", () => {
  it("cleans values to their types", () => {
    expect(cleanCustomValues(defs, { tshirt: "M", cost_centre: "1,200", vaccinated: "yes", badge_on: "2026-11-01", old: "kept" })).toEqual({ tshirt: "M", cost_centre: 1200, vaccinated: true, badge_on: "2026-11-01", old: "kept" });
  });
  it("explains what's wrong", () => {
    expect(() => cleanCustomValues(defs, {})).toThrow("T-shirt size is required");
    expect(() => cleanCustomValues(defs, { tshirt: "XL" })).toThrow("must be one of S, M, L");
    expect(() => cleanCustomValues(defs, { tshirt: "S", cost_centre: "abc" })).toThrow("must be a number");
    expect(cleanCustomValues(defs, {}, { partial: true })).toEqual({});
  });
  it("checks the field list", () => {
    expect(customFieldDefsSchema.safeParse([defs[0], defs[0]]).success).toBe(false);
    expect(customFieldDefsSchema.safeParse([{ key: "dept", label: "Dept", type: "select" }]).success).toBe(false);
    expect(customFieldDefsSchema.safeParse(defs).success).toBe(true);
  });
});
