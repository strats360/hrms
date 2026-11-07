import { describe, expect, it } from "vitest";
import { builtInValue, describeRule, resolveRules, statutoryRuleSchema, type RuleVersion } from "../src/statutory";
import { computePayslip, DEFAULT_RULES, professionalTax, structureFromCtc, taxOnIncome } from "../src/payroll";

const v = (key: string, category: string, scope: string, value: Record<string, unknown>, effectiveFrom: string, status = "live"): RuleVersion => ({ key, category, scope, value, effectiveFrom, status });

describe("statutory master", () => {
  it("built-ins round-trip into the same rule set", () => {
    const R = resolveRules([v("pt:Gujarat", "pt", "Gujarat", builtInValue("pt", "Gujarat")!, "2022-04-01"), v("tax:2026-27", "tax", "2026-27", builtInValue("tax", "2026-27")!, "2026-04-01"), v("pf", "pf", "All India", builtInValue("pf")!, "2014-09-01")], "2026-11-01");
    expect(R.pt.Gujarat).toEqual(DEFAULT_RULES.pt.Gujarat);
    expect(R.tax["2026-27"]).toEqual(DEFAULT_RULES.tax["2026-27"]);
    expect(R.pf).toEqual(DEFAULT_RULES.pf);
  });

  it("applies only live versions effective on the date", () => {
    const raise = { ...builtInValue("pf")!, wageCeiling: 25000 };
    const versions = [v("pf", "pf", "All India", raise, "2027-01-01"), v("esi", "esi", "All India", { employeeRate: 0.01, employerRate: 0.04, grossThreshold: 30000 }, "2026-01-01", "draft")];
    expect(resolveRules(versions, "2026-12-01").pf.wageCeiling).toBe(15000);
    expect(resolveRules(versions, "2027-01-01").pf.wageCeiling).toBe(25000);
    expect(resolveRules(versions, "2027-01-01").esi.grossThreshold).toBe(21000); // draft ignored
    expect(DEFAULT_RULES.pf.wageCeiling).toBe(15000); // defaults untouched
  });

  it("feeds the payroll engine", () => {
    const R = resolveRules([v("pt:Karnataka", "pt", "Karnataka", { slabs: [{ upTo: 30000, amount: 0 }, { upTo: null, amount: 250 }] }, "2026-04-01"), v("pf", "pf", "All India", { ...builtInValue("pf")!, wageCeiling: 25000 }, "2026-04-01")], "2026-11-01");
    expect(professionalTax("Karnataka", 28000, 11, null).amount).toBe(200);
    expect(professionalTax("Karnataka", 28000, 11, null, R).amount).toBe(0);
    expect(professionalTax("Karnataka", 40000, 11, null, R).amount).toBe(250);
    const structure = structureFromCtc(600000, undefined, { esiApplicable: false });
    const base = { month: "2026-11", structure, daysInMonth: 30, paidDays: 30, pfApplicable: true, esiApplicable: false, ptApplicable: false, state: null, regime: "new" as const };
    const withRules = computePayslip({ ...base, rules: R });
    const builtIn = computePayslip(base);
    expect(builtIn.deductions.find((d) => d.code === "pf")!.amount).toBe(1800);
    expect(withRules.deductions.find((d) => d.code === "pf")!.amount).toBe(Math.round(Math.min(structure.components.basic, 25000) * 0.12));
  });

  it("uses new tax slabs for a financial year", () => {
    const t = builtInValue("tax", "2026-27") as any;
    t.new.rebateLimit = 1500000;
    const R = resolveRules([v("tax:2027-28", "tax", "2027-28", t, "2027-04-01")], "2027-05-01");
    expect(taxOnIncome("new", "2027-28", 1400000, R).total).toBe(0);
    expect(taxOnIncome("new", "2027-28", 1400000).total).toBeGreaterThan(0);
  });

  it("validates values and describes them", () => {
    expect(statutoryRuleSchema.safeParse({ category: "pt", scope: "Goa", effectiveFrom: "2027-04-01", value: { slabs: [{ upTo: 10000, amount: 0 }] } }).success).toBe(false);
    expect(statutoryRuleSchema.safeParse({ category: "pt", effectiveFrom: "2027-04-01", value: { none: true } }).success).toBe(false);
    expect(statutoryRuleSchema.safeParse({ category: "esi", effectiveFrom: "2027-04-01", value: { employeeRate: 0.0075, employerRate: 0.0325, grossThreshold: 25000 } }).success).toBe(true);
    expect(describeRule("pt", builtInValue("pt", "Gujarat")!)).toBe("≤ ₹11,999 → ₹0 · > ₹11,999 → ₹200");
    expect(describeRule("esi", builtInValue("esi")!)).toBe("0.75% / 3.25% up to ₹21,000 gross");
  });
});
