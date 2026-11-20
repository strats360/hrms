import { describe, expect, it } from "vitest";
import { classOneNi, computePayslip, englandBankHolidays, packFor, parseTaxCode, payeThisMonth, structureFromCtc, taxMonthOf, taxYearOf, ukPayrollProfileSchema, type PayslipInput } from "../src";

const flat = packFor("GB").payroll.salaryTemplate;
const slip = (o: Partial<PayslipInput> & { annual: number }) =>
  computePayslip({
    country: "GB",
    month: "2026-04",
    structure: structureFromCtc(o.annual, flat, { pfApplicable: false, esiApplicable: false }),
    daysInMonth: 30,
    paidDays: 30,
    pfApplicable: false,
    esiApplicable: false,
    ptApplicable: false,
    state: null,
    regime: "new",
    ...o,
  });
const line = (l: { code: string; amount: number }[], code: string) => l.find((x) => x.code === code)?.amount;

describe("UK tax codes", () => {
  it("reads the common codes", () => {
    expect(parseTaxCode("1257L")).toMatchObject({ allowance: 12579, cumulative: true, region: "rUK" });
    expect(parseTaxCode("S1257L")).toMatchObject({ region: "scotland" });
    expect(parseTaxCode("C1257L")).toMatchObject({ region: "wales" });
    expect(parseTaxCode("1257L M1")).toMatchObject({ cumulative: false });
    expect(parseTaxCode("K475")).toMatchObject({ allowance: -4750 });
    expect(parseTaxCode("BR")).toMatchObject({ flat: 0.2 });
    expect(parseTaxCode("D0")).toMatchObject({ flat: 0.4 });
    expect(parseTaxCode("NT")).toMatchObject({ noTax: true });
    expect(ukPayrollProfileSchema.safeParse({ taxCode: "12X" }).success).toBe(false);
  });
  it("numbers tax months from April", () => {
    expect([taxMonthOf("2026-04"), taxMonthOf("2026-11"), taxMonthOf("2027-03")]).toEqual([1, 8, 12]);
    expect([taxYearOf("2026-04"), taxYearOf("2027-03")]).toEqual(["2026-27", "2026-27"]);
  });
});

describe("UK payslips", () => {
  it("works out PAYE, NI and pension for a basic rate taxpayer", () => {
    const p = slip({ annual: 36000, countryProfile: { taxCode: "1257L" } });
    expect(p.earnings).toEqual([{ code: "basic", label: "Salary", amount: 3000 }]);
    expect(line(p.deductions, "paye")).toBe(390.2); // (3,000 − 1,048.25) to whole pounds × 20%
    expect(line(p.deductions, "ni")).toBe(156.16); // (3,000 − 1,048) × 8%
    expect(line(p.deductions, "pension")).toBe(99.2); // 4% of 3,000 − 520
    expect(line(p.employer, "ni_er")).toBe(387.45); // (3,000 − 417) × 15%
    expect(line(p.employer, "pension_er")).toBe(74.4);
    expect(p.net).toBe(2354.44);
  });
  it("taxes higher earners at 40% and NI at 2% above the upper limit", () => {
    const p = slip({ annual: 72000, countryProfile: { taxCode: "1257L" } });
    expect(line(p.deductions, "paye")).toBe(1352.06);
    expect(line(p.deductions, "ni")).toBe(287.5);
  });
  it("is cumulative: tax this month is tax due to date less tax already paid", () => {
    const p = slip({ annual: 36000, month: "2026-11", countryProfile: { taxCode: "1257L" }, ytd: { taxableGross: 21000, tds: 2731.4, employeePf: 0, professionalTax: 0 } });
    expect(line(p.deductions, "paye")).toBe(391.4); // 20% of 24,000 − 8,386 to date, less 2,731.40
    // and a month 1 code ignores the year so far
    expect(line(slip({ annual: 36000, month: "2026-11", countryProfile: { taxCode: "1257L M1" }, ytd: { taxableGross: 21000, tds: 0, employeePf: 0, professionalTax: 0 } }).deductions, "paye")).toBe(390.2);
  });
  it("counts pay and tax from an earlier job this year (P45)", () => {
    const p = slip({ annual: 36000, month: "2026-05", countryProfile: { taxCode: "1257L", p45: { taxYear: "2026-27", pay: 3000, tax: 390.2 } } });
    expect(line(p.deductions, "paye")).toBe(390.4); // 20% of 6,000 − 2,096.50 to whole pounds, less 390.20
  });
  it("handles K, BR and NT codes, with K codes capped at half the pay", () => {
    expect(line(slip({ annual: 24000, countryProfile: { taxCode: "K100" } }).deductions, "paye")).toBe(416.6);
    expect(line(slip({ annual: 24000, countryProfile: { taxCode: "BR" } }).deductions, "paye")).toBe(400);
    expect(line(slip({ annual: 24000, countryProfile: { taxCode: "NT" } }).deductions, "paye")).toBeUndefined();
    expect(payeThisMonth({ code: parseTaxCode("K5000"), taxMonth: 1, payThisMonth: 1000, payToDateBefore: 0, taxToDateBefore: 0 }).tax).toBe(500);
  });
  it("uses Scottish bands for S codes", () => {
    expect(line(slip({ annual: 36000, countryProfile: { taxCode: "S1257L" } }).deductions, "paye")).toBeCloseTo(394.92, 1);
  });
  it("collects student loans in whole pounds, and skips employer NI for under 21s", () => {
    const p = slip({ annual: 36000, countryProfile: { taxCode: "1257L", studentLoans: ["plan2"], postgraduateLoan: true } });
    expect(line(p.deductions, "sl_plan2")).toBe(56); // 9% of 3,000 − 2,372.50
    expect(line(p.deductions, "pgl")).toBe(75); // 6% of 3,000 − 1,750
    expect(classOneNi(3000, "M")).toEqual({ employee: 156.16, employer: 0 });
    expect(classOneNi(3000, "C").employee).toBe(0);
    expect(classOneNi(3000, "X")).toEqual({ employee: 0, employer: 0 });
  });
  it("leaves out the pension below the trigger or after an opt out, and flags a missing tax code", () => {
    expect(line(slip({ annual: 9000, countryProfile: { taxCode: "1257L" } }).deductions, "pension")).toBeUndefined();
    const out = slip({ annual: 36000, countryProfile: { taxCode: "1257L", pensionOptOut: true } });
    expect(line(out.deductions, "pension")).toBeUndefined();
    expect(slip({ annual: 36000 }).warnings.join(" ")).toMatch(/No tax code on file/);
  });
});

describe("UK final pay", () => {
  it("pays unused holiday and notice in lieu, all taxable, and no gratuity", () => {
    const s = packFor("GB").settlement({ type: "termination", dateOfJoining: "2022-01-10", resignationDate: "2026-10-15", lastWorkingDay: "2026-10-31", monthlyBasic: 3000, monthlyGross: 3000, noticeDays: 30, noticeWaived: false, payInLieu: true, leave: [{ leaveTypeId: "al", name: "Annual leave", days: 5 }], manual: [], tds: 0 });
    expect(s.lines.find((l) => l.key === "encash:al")!.amount).toBe(692.31); // 5 × 36,000 / 260
    expect(s.lines.find((l) => l.key === "notice_pay")!.amount).toBe(1282.19); // 13 days short × 36,000 / 365
    expect(s.gratuityEligible).toBe(false);
    expect(s.taxable).toBe(s.earnings);
  });
});

describe("Bank holidays", () => {
  it("knows Easter and the substitute days", () => {
    const h = englandBankHolidays(2026).map((x) => `${x.date} ${x.name}`);
    expect(h).toContain("2026-04-03 Good Friday");
    expect(h).toContain("2026-04-06 Easter Monday");
    expect(h).toContain("2026-12-28 Boxing Day"); // 26 December 2026 is a Saturday
    expect(englandBankHolidays(2027).map((x) => x.date)).toEqual(expect.arrayContaining(["2027-12-27", "2027-12-28"]));
  });
});
