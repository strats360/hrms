import { describe, expect, it } from "vitest";
import { computePayslip, federalWithholding, packFor, structureFromCtc, usFederalHolidays, usPayrollProfileSchema, type PayslipInput } from "../src";

const flat = packFor("US").payroll.salaryTemplate;
const slip = (o: Partial<PayslipInput> & { annual: number }) =>
  computePayslip({
    country: "US",
    month: "2026-01",
    structure: structureFromCtc(o.annual, flat, { pfApplicable: false, esiApplicable: false }),
    daysInMonth: 31,
    paidDays: 31,
    pfApplicable: false,
    esiApplicable: false,
    ptApplicable: false,
    state: "Texas",
    regime: "new",
    ...o,
  });
const line = (l: { code: string; amount: number }[], code: string) => l.find((x) => x.code === code)?.amount;
const w4 = (o: Record<string, unknown> = {}) => usPayrollProfileSchema.parse(o);
const ytd = (pay: number) => ({ taxableGross: pay, tds: 0, employeePf: 0, professionalTax: 0 });

describe("Federal withholding (Pub 15-T percentage method)", () => {
  it("annualises, takes off the standard deduction, and spreads the tax over the year", () => {
    expect(federalWithholding(5000, w4({ filingStatus: "single" }))).toBe(418.33); // (1,240 + 31,500 × 12%) / 12
    expect(federalWithholding(10000, w4({ filingStatus: "married" }))).toBe(836.67);
  });
  it("halves the deduction and brackets with Step 2, and takes credits and extras into account", () => {
    expect(federalWithholding(5000, w4({ multipleJobs: true }))).toBe(732.08);
    expect(federalWithholding(5000, w4({ dependents: 2000 }))).toBe(251.67);
    expect(federalWithholding(5000, w4({ extraWithholding: 50 }))).toBe(468.33);
    expect(federalWithholding(5000, w4({ exempt: true }))).toBe(0);
  });
});

describe("US paychecks", () => {
  it("withholds federal tax and FICA, and the employer pays FICA and FUTA", () => {
    const p = slip({ annual: 60000, countryProfile: { filingStatus: "single" } });
    expect(p.earnings).toEqual([{ code: "basic", label: "Salary", amount: 5000 }]);
    expect(line(p.deductions, "fit")).toBe(418.33);
    expect(line(p.deductions, "ss")).toBe(310);
    expect(line(p.deductions, "medicare")).toBe(72.5);
    expect(line(p.employer, "futa_er")).toBe(30);
    expect(p.net).toBe(4199.17);
    expect(p.warnings.join(" ")).not.toMatch(/Texas income tax/);
  });
  it("takes 401(k) off income tax wages only, and pre-tax health off FICA wages too", () => {
    const p = slip({ annual: 60000, countryProfile: { filingStatus: "single", k401Percent: 5, preTaxHealth: 200 } });
    expect(line(p.deductions, "k401")).toBe(250);
    expect(line(p.deductions, "health")).toBe(200);
    expect(line(p.deductions, "fit")).toBe(federalWithholding(4550, w4()));
    expect(line(p.deductions, "ss")).toBe(297.6); // 6.2% of 4,800
  });
  it("stops Social Security at the wage base and adds Medicare over $200,000", () => {
    const p = slip({ annual: 60000, month: "2026-11", countryProfile: { filingStatus: "single" }, ytd: ytd(182000) });
    expect(line(p.deductions, "ss")).toBe(155); // only 2,500 left under 184,500
    expect(p.warnings.join(" ")).toMatch(/wage base/);
    expect(line(slip({ annual: 60000, month: "2026-11", countryProfile: { filingStatus: "single" }, ytd: ytd(198000) }).deductions, "medicare_addl")).toBe(27);
    expect(line(slip({ annual: 60000, month: "2026-03", countryProfile: { filingStatus: "single" }, ytd: ytd(5000) }).employer, "futa_er")).toBe(12);
    expect(line(slip({ annual: 60000, month: "2026-03", countryProfile: { filingStatus: "single" }, ytd: ytd(7000) }).employer, "futa_er")).toBeUndefined();
  });
  it("says when a state's income tax needs the payroll partner, and when there's no W-4", () => {
    expect(slip({ annual: 60000, state: "California", countryProfile: { filingStatus: "single" } }).warnings.join(" ")).toMatch(/California income tax isn't worked out/);
    expect(slip({ annual: 60000 }).warnings.join(" ")).toMatch(/No W-4 on file/);
  });
});

describe("US final pay and holidays", () => {
  it("pays unused PTO, with no notice or severance by law", () => {
    const s = packFor("US").settlement({ type: "resignation", dateOfJoining: "2024-02-01", resignationDate: "2026-10-01", lastWorkingDay: "2026-10-15", monthlyBasic: 5000, monthlyGross: 5000, noticeDays: 14, noticeWaived: false, payInLieu: false, leave: [{ leaveTypeId: "pto", name: "PTO", days: 4 }], manual: [], tds: 0 });
    expect(s.lines).toEqual([expect.objectContaining({ key: "encash:pto", amount: 923.08 })]); // 4 × 60,000 / 260
    expect(s.notice.shortfall).toBe(0);
  });
  it("observes federal holidays on the nearest weekday", () => {
    const h = Object.fromEntries(usFederalHolidays(2026).map((x) => [x.name, x.date]));
    expect(h).toMatchObject({ "Martin Luther King Jr. Day": "2026-01-19", "Memorial Day": "2026-05-25", "Independence Day": "2026-07-03", "Thanksgiving Day": "2026-11-26", "Christmas Day": "2026-12-25" });
  });
});
