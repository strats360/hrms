import { describe, expect, it } from "vitest";
import { compareRegimes, computePayslip, computeTaxStatement, structureFromCtc } from "../src";

const salary = { gross: 1200000, basic: 600000, hra: 240000 };
const base = { financialYear: "2026-27", salary, employeePf: 21600, professionalTax: 2400 };

describe("tax computation statement", () => {
  it("old regime: HRA exemption is the least of the three limits", () => {
    const s = computeTaxStatement({ ...base, regime: "old", declaration: { rent: { monthlyRent: 20000, months: 12, metro: false } } });
    expect(s.exemptions[0]!.amount).toBe(180000); // rent 2,40,000 - 10% of basic 60,000
  });
  it("old regime: 80C capped at 1.5 L including employee PF, 80D caps by age", () => {
    const s = computeTaxStatement({
      ...base,
      regime: "old",
      declaration: { sec80C: { ppf: 150000, elss: 50000 }, sec80D: { self: 30000, parents: 60000, parentsSenior: true } },
    });
    expect(s.deductions.find((d) => d.key === "80C")!.amount).toBe(150000);
    expect(s.deductions.find((d) => d.key === "80D")!.amount).toBe(25000 + 50000);
    expect(s.taxableIncome).toBe(1200000 - 50000 - 2400 - 150000 - 75000);
  });
  it("verified amounts override what was declared", () => {
    const s = computeTaxStatement({ ...base, regime: "old", declaration: { sec80C: { ppf: 150000 } }, verified: { "80C": 50000 } });
    expect(s.deductions.find((d) => d.key === "80C")!.amount).toBe(71600);
  });
  it("home loan interest is a loss from house property, capped at ₹2 L", () => {
    const s = computeTaxStatement({ ...base, regime: "old", declaration: { homeLoanInterest: 260000 } });
    expect(s.houseProperty).toBe(-200000);
  });
  it("new regime ignores old-regime deductions and PT", () => {
    const s = computeTaxStatement({ ...base, regime: "new", declaration: { sec80C: { ppf: 150000 }, rent: { monthlyRent: 20000, months: 12, metro: true } } });
    expect(s.deductions).toHaveLength(0);
    expect(s.exemptions).toHaveLength(0);
    expect(s.professionalTax).toBe(0);
    expect(s.taxableIncome).toBe(1200000 - 75000);
  });
  it("adds previous employer salary and credits its TDS", () => {
    const s = computeTaxStatement({ ...base, regime: "new", declaration: { previousEmployer: { gross: 300000, tds: 20000, pf: 0, pt: 0 } } });
    expect(s.grossSalary).toBe(1500000);
    expect(s.previousEmployerTds).toBe(20000);
  });
  it("compares regimes", () => {
    // ₹12 L salary: new regime is nil after the 87A rebate
    const low = compareRegimes({ ...base, declaration: { sec80C: { ppf: 150000 } } });
    expect(low.new.tax.total).toBe(0);
    expect(low.better).toBe("new");
    // ₹15 L with heavy deductions: old regime wins
    const heavy = compareRegimes({
      financialYear: "2026-27",
      salary: { gross: 1500000, basic: 750000, hra: 375000 },
      employeePf: 21600,
      professionalTax: 2400,
      declaration: { sec80C: { ppf: 150000 }, sec80CCD1B: 50000, sec80D: { self: 25000, parents: 50000, parentsSenior: true }, rent: { monthlyRent: 30000, months: 12, metro: true }, homeLoanInterest: 200000 },
    });
    expect(heavy.better).toBe("old");
    expect(heavy.saving).toBe(heavy.new.tax.total - heavy.old.tax.total);
  });
});

describe("payslip TDS with declarations", () => {
  it("lower TDS for an old-regime employee who declares investments", () => {
    const s = structureFromCtc(1440000);
    const p = { month: "2026-04", daysInMonth: 30, paidDays: 30, pfApplicable: true, esiApplicable: false, ptApplicable: true, state: "Gujarat", regime: "old" as const, structure: s };
    const without = computePayslip(p);
    const withDecl = computePayslip({ ...p, taxProfile: { declaration: { sec80C: { ppf: 150000 }, rent: { monthlyRent: 20000, months: 12, metro: false } } } });
    expect(withDecl.tds).toBeLessThan(without.tds);
  });
  it("previous employer TDS reduces this employer's deduction", () => {
    const s = structureFromCtc(1800000);
    const p = { month: "2026-10", daysInMonth: 31, paidDays: 31, pfApplicable: true, esiApplicable: false, ptApplicable: true, state: "Gujarat", regime: "new" as const, structure: s, ytd: { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 } };
    const a = computePayslip({ ...p, taxProfile: { declaration: { previousEmployer: { gross: 600000, tds: 0 } } } });
    const b = computePayslip({ ...p, taxProfile: { declaration: { previousEmployer: { gross: 600000, tds: 40000 } } } });
    expect(Math.abs(a.tds - b.tds - 40000 / 6)).toBeLessThanOrEqual(1);
  });
});
