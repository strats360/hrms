import { describe, expect, it } from "vitest";
import { carPerquisite, computePayslip, computeTaxStatement, structureFromCtc, type PayslipInput } from "../src";

const base = (o: Partial<PayslipInput> = {}) =>
  computePayslip({ month: "2026-11", daysInMonth: 30, paidDays: 30, pfApplicable: true, esiApplicable: false, ptApplicable: false, state: null, regime: "new", structure: structureFromCtc(1440000), ...o });
const line = (l: { code: string; amount: number }[], code: string) => l.find((x) => x.code === code)?.amount;

describe("VPF, employer NPS and the car perquisite", () => {
  it("takes voluntary PF as a % of Code wages", () => {
    const p = base({ countryProfile: { vpfPercent: 10 } });
    expect(line(p.deductions, "vpf")).toBe(5850); // 10% of 58,500
    expect(line(base().deductions, "vpf")).toBeUndefined();
  });
  it("pays employer NPS, taxed as salary and deducted again under 80CCD(2) up to the cap", () => {
    const withNps = base({ countryProfile: { npsEmployerPercent: 10 } });
    expect(line(withNps.employer, "nps_er")).toBe(5850);
    expect(withNps.tds).toBe(base().tds); // within 14% of wages: added and deducted in full
    expect(base({ countryProfile: { npsEmployerPercent: 20 } }).tds).toBeGreaterThan(base().tds); // the 6% over the cap is taxed
  });
  it("taxes the car perquisite at the 2026-27 values", () => {
    expect(carPerquisite("2026-27", "small", false)).toBe(5000);
    expect(carPerquisite("2026-27", "large", true)).toBe(10000);
    expect(carPerquisite("2025-26", "large", true)).toBe(3300);
    const p = base({ countryProfile: { car: "large", driver: true } });
    expect(p.perquisites).toBe(10000);
    expect(p.tds).toBeGreaterThan(base().tds);
    expect(p.gross).toBe(base().gross); // not paid out
  });
  it("caps 80CCD(2) at 14% of wages in the new regime and 10% in the old", () => {
    const s = (regime: "new" | "old") => computeTaxStatement({ regime, financialYear: "2026-27", salary: { gross: 1200000, basic: 600000, hra: 0 }, employeePf: 0, professionalTax: 0, employerNps: 120000, npsWages: 600000 });
    expect(s("new").deductions.find((d) => d.key === "80CCD2")!.amount).toBe(84000);
    expect(s("old").deductions.find((d) => d.key === "80CCD2")!.amount).toBe(60000);
    expect(s("new").grossSalary).toBe(1320000);
  });
});
