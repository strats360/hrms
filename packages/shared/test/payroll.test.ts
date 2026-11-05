import { describe, expect, it } from "vitest";
import {
  annualIncomeTax,
  computePayslip,
  fyOfMonth,
  labourWelfareFund,
  professionalTax,
  remainingFyMonths,
  rupeesInWords,
  structureFromCtc,
  structureFromComponents,
} from "../src";

describe("structure from CTC", () => {
  it("splits ₹14.4 L CTC with capped employer PF", () => {
    const s = structureFromCtc(1440000);
    expect(s.monthlyCtc).toBe(120000);
    expect(s.employer.pf).toBe(1800);
    expect(s.gross).toBe(118200);
    expect(s.components).toEqual({ basic: 59100, hra: 23640, conveyance: 1600, medical: 1250, special: 32610 });
    expect(s.esiApplicable).toBe(false);
  });
  it("brings low CTC under ESI and still adds up exactly", () => {
    const s = structureFromCtc(240000);
    expect(s.esiApplicable).toBe(true);
    expect(s.gross).toBeLessThanOrEqual(21000);
    expect(s.gross + s.employer.pf + s.employer.esi).toBe(s.monthlyCtc);
    const sum = Object.values(s.components).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.gross);
  });
  it("never produces negative allowances for tiny salaries", () => {
    const s = structureFromCtc(60000);
    expect(Object.values(s.components).every((v) => v >= 0)).toBe(true);
  });
  it("builds from custom components", () => {
    const s = structureFromComponents({ basic: 20000, hra: 8000, conveyance: 1600, medical: 1250, special: 9150 });
    expect(s.gross).toBe(40000);
    expect(s.employer.pf).toBe(1800);
    expect(s.monthlyCtc).toBe(41800);
  });
});

describe("professional tax and LWF", () => {
  it("Gujarat: ₹200 from ₹12,000", () => {
    expect(professionalTax("Gujarat", 11999, 11).amount).toBe(0);
    expect(professionalTax("Gujarat", 12000, 11).amount).toBe(200);
  });
  it("Maharashtra: February top-up and women's exemption", () => {
    expect(professionalTax("Maharashtra", 30000, 2).amount).toBe(300);
    expect(professionalTax("Maharashtra", 9000, 5).amount).toBe(175);
    expect(professionalTax("Maharashtra", 20000, 5, "female").amount).toBe(0);
  });
  it("flags unconfigured states and knows states without PT", () => {
    expect(professionalTax("Kerala", 50000, 5).configured).toBe(false);
    expect(professionalTax("Delhi", 50000, 5)).toEqual({ amount: 0, configured: true });
  });
  it("Gujarat LWF only in June and December", () => {
    expect(labourWelfareFund("Gujarat", 30000, 12)).toEqual({ employee: 6, employer: 12 });
    expect(labourWelfareFund("Gujarat", 30000, 11)).toEqual({ employee: 0, employer: 0 });
  });
});

describe("income tax", () => {
  it("new regime: nil up to ₹12 L taxable", () => {
    expect(annualIncomeTax({ regime: "new", financialYear: "2026-27", annualGross: 1275000 }).total).toBe(0);
  });
  it("new regime: marginal relief just above ₹12 L", () => {
    const t = annualIncomeTax({ regime: "new", financialYear: "2026-27", annualGross: 1285000 });
    expect(t.taxableIncome).toBe(1210000);
    expect(t.baseTax - t.rebate).toBe(10000);
    expect(t.total).toBe(10400);
  });
  it("new regime: ₹13 L taxable", () => {
    expect(annualIncomeTax({ regime: "new", financialYear: "2026-27", annualGross: 1375000 }).total).toBe(78000);
  });
  it("old regime with deductions", () => {
    const t = annualIncomeTax({ regime: "old", financialYear: "2026-27", annualGross: 1000000, deductions: 150000, professionalTax: 2400 });
    expect(t.taxableIncome).toBe(797600);
    expect(t.total).toBe(74901);
  });
  it("applies surcharge with marginal relief above ₹50 L", () => {
    const at = annualIncomeTax({ regime: "new", financialYear: "2026-27", annualGross: 5075000 });
    const above = annualIncomeTax({ regime: "new", financialYear: "2026-27", annualGross: 5085000 });
    // ₹10,000 more income can't cost more than ₹10,000 extra tax+surcharge (before cess)
    expect(above.baseTax + above.surcharge - (at.baseTax + at.surcharge)).toBeLessThanOrEqual(10000);
    expect(above.surcharge).toBeGreaterThan(0);
  });
  it("financial year helpers", () => {
    expect(fyOfMonth("2026-11")).toBe("2026-27");
    expect(fyOfMonth("2027-03")).toBe("2026-27");
    expect(remainingFyMonths("2026-04")).toBe(12);
    expect(remainingFyMonths("2026-11")).toBe(5);
    expect(remainingFyMonths("2027-03")).toBe(1);
  });
});

describe("monthly payslip", () => {
  const base = { month: "2026-11", daysInMonth: 30, pfApplicable: true, esiApplicable: true, ptApplicable: true, state: "Gujarat", regime: "new" as const };
  it("full month: gross, PF, PT and net", () => {
    const s = structureFromCtc(1440000);
    const p = computePayslip({ ...base, structure: s, paidDays: 30 });
    expect(p.gross).toBe(118200);
    expect(p.deductions.find((d) => d.code === "pf")!.amount).toBe(1800);
    expect(p.deductions.find((d) => d.code === "pt")!.amount).toBe(200);
    expect(p.employer.find((e) => e.code === "eps")!.amount).toBe(1250);
    expect(p.employer.find((e) => e.code === "epf_er")!.amount).toBe(550);
    expect(p.net).toBe(p.gross - p.totalDeductions);
    expect(p.tds).toBeGreaterThan(0);
  });
  it("prorates for LOP", () => {
    const s = structureFromCtc(1440000);
    const p = computePayslip({ ...base, structure: s, paidDays: 28 });
    expect(p.earnings.find((e) => e.code === "basic")!.amount).toBe(Math.round((59100 * 28) / 30));
  });
  it("ESI rounds up and uses earned gross", () => {
    const s = structureFromCtc(240000);
    const p = computePayslip({ ...base, structure: s, paidDays: 30 });
    expect(p.deductions.find((d) => d.code === "esi")!.amount).toBe(Math.ceil(p.gross * 0.0075));
  });
  it("adds one-time earnings and deductions", () => {
    const s = structureFromCtc(600000);
    const p = computePayslip({ ...base, structure: s, paidDays: 30, adjustments: [{ label: "Sales incentive", kind: "earning", amount: 5000 }, { label: "Laptop recovery", kind: "deduction", amount: 1000 }] });
    expect(p.gross).toBe(s.gross + 5000);
    expect(p.deductions.some((d) => d.label === "Laptop recovery" && d.amount === 1000)).toBe(true);
  });
  it("spreads remaining tax after TDS already deducted", () => {
    const s = structureFromCtc(2400000);
    const first = computePayslip({ ...base, month: "2026-04", structure: s, paidDays: 30 });
    const later = computePayslip({ ...base, month: "2026-11", structure: s, paidDays: 30, ytd: { taxableGross: s.gross * 7, tds: first.tds * 7, employeePf: 1800 * 7, professionalTax: 1400 } });
    expect(Math.abs(later.tds - first.tds)).toBeLessThanOrEqual(2);
  });
  it("amount in words", () => {
    expect(rupeesInWords(142360)).toBe("One lakh forty-two thousand three hundred sixty rupees only");
    expect(rupeesInWords(10500000)).toBe("One crore five lakh rupees only");
  });
});

describe("TDS without history", () => {
  it("annualises when there is no year-to-date data", () => {
    const s = structureFromCtc(1440000);
    const p = computePayslip({ month: "2026-11", daysInMonth: 30, pfApplicable: true, esiApplicable: true, ptApplicable: true, state: "Gujarat", regime: "new", structure: s, paidDays: 30 });
    const annual = annualIncomeTax({ regime: "new", financialYear: "2026-27", annualGross: s.gross * 12 });
    expect(p.tds).toBe(Math.round(annual.total / 12));
    expect(p.tax.annualised).toBe(true);
  });
});
