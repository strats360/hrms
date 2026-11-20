import { describe, expect, it } from "vitest";
import { computePayslip, eiThisMonth, federalBpa, ontarioHealthPremium, ontarioHolidays, ontarioNoticeWeeks, packFor, pensionThisMonth, structureFromCtc, type PayslipInput } from "../src";

const flat = packFor("CA").payroll.salaryTemplate;
const slip = (o: Partial<PayslipInput> & { annual: number }) =>
  computePayslip({
    country: "CA",
    month: "2026-01",
    structure: structureFromCtc(o.annual, flat, { pfApplicable: false, esiApplicable: false }),
    daysInMonth: 31,
    paidDays: 31,
    pfApplicable: false,
    esiApplicable: false,
    ptApplicable: false,
    state: "Ontario",
    regime: "new",
    ...o,
  });
const line = (l: { code: string; amount: number }[], code: string) => l.find((x) => x.code === code)?.amount;
const ytd = (pay: number) => ({ taxableGross: pay, tds: 0, employeePf: 0, professionalTax: 0 });

describe("CPP, CPP2 and EI", () => {
  it("takes CPP on pay over the monthly exemption, and stops at the year's maximum", () => {
    expect(pensionThisMonth({ pay: 5000, ytdPay: 0, monthsBefore: 0, quebec: false })).toMatchObject({ cpp: 280.15, cpp2: 0 }); // 5.95% of 5,000 − 291.67
    const late = pensionThisMonth({ pay: 10000, ytdPay: 70000, monthsBefore: 7, quebec: false });
    expect(late.cpp).toBeLessThan(595);
    expect(late.cpp2).toBe(216); // 4% of 79,000 above the 74,600 YMPE
    expect(pensionThisMonth({ pay: 10000, ytdPay: 90000, monthsBefore: 9, quebec: false })).toMatchObject({ cpp: 0, cpp2: 0 });
    expect(pensionThisMonth({ pay: 5000, ytdPay: 0, monthsBefore: 0, quebec: true }).cpp).toBe(301.33); // QPP 6.4%
  });
  it("takes EI on insurable earnings up to the maximum, lower in Quebec", () => {
    expect(eiThisMonth({ pay: 5000, ytdPay: 0, quebec: false })).toBe(81.5);
    expect(eiThisMonth({ pay: 5000, ytdPay: 66900, quebec: false })).toBe(32.6); // only 2,000 left
    expect(eiThisMonth({ pay: 5000, ytdPay: 0, quebec: true })).toBe(65);
  });
});

describe("Canadian income tax", () => {
  it("reduces the federal basic personal amount for high earners", () => {
    expect(federalBpa(100000)).toBe(16452);
    expect(federalBpa(300000)).toBe(14829);
    expect(federalBpa((181440 + 258482) / 2)).toBeCloseTo(15640.5, 0);
  });
  it("works out the Ontario health premium in steps", () => {
    expect([15000, 22000, 30000, 40000, 60000, 100000, 250000].map(ontarioHealthPremium)).toEqual([0, 120, 300, 450, 600, 750, 900]);
  });
  it("pays federal and Ontario tax, CPP and EI on a $60,000 salary", () => {
    const p = slip({ annual: 60000, countryProfile: {} });
    expect(p.earnings).toEqual([{ code: "basic", label: "Salary", amount: 5000 }]);
    expect(line(p.deductions, "fed_tax")).toBeCloseTo(444.86, 1);
    expect(line(p.deductions, "prov_tax")).toBeCloseTo(248.52, 1);
    expect(line(p.deductions, "cpp")).toBe(280.15);
    expect(line(p.deductions, "ei")).toBe(81.5);
    expect(line(p.employer, "ei_er")).toBe(114.1);
    expect(line(p.employer, "cpp_er")).toBe(280.15);
    expect(p.warnings.join(" ")).not.toMatch(/income tax isn't worked out/);
  });
  it("lowers tax for a bigger TD1 claim, and adds extra tax asked for", () => {
    const base = line(slip({ annual: 60000, countryProfile: {} }).deductions, "fed_tax")!;
    expect(line(slip({ annual: 60000, countryProfile: { federalClaim: 26452 } }).deductions, "fed_tax")).toBeCloseTo(base - 10000 * 0.14 / 12, 1);
    expect(line(slip({ annual: 60000, countryProfile: { extraTax: 100 } }).deductions, "fed_tax")).toBeCloseTo(base + 100, 2);
  });
  it("in Quebec: QPP, QPIP, the lower EI rate and the federal abatement, with Quebec tax left to the partner", () => {
    const q = slip({ annual: 60000, state: "Quebec", countryProfile: {} });
    expect(line(q.deductions, "cpp")).toBe(301.33);
    expect(line(q.deductions, "qpip")).toBe(24.7);
    expect(line(q.deductions, "ei")).toBe(65);
    expect(q.deductions.find((d) => d.code === "cpp")!.label).toBe("QPP");
    expect(line(q.deductions, "prov_tax")).toBeUndefined();
    expect(q.warnings.join(" ")).toMatch(/Quebec income tax isn't worked out/);
  });
  it("flags other provinces for the payroll partner, and respects CPP and EI exemptions", () => {
    expect(slip({ annual: 60000, state: "Alberta", countryProfile: {} }).warnings.join(" ")).toMatch(/Alberta income tax isn't worked out/);
    const x = slip({ annual: 60000, countryProfile: { cppExempt: true, eiExempt: true } });
    expect(line(x.deductions, "cpp")).toBeUndefined();
    expect(line(x.deductions, "ei")).toBeUndefined();
  });
});

describe("Canadian final pay and holidays", () => {
  it("pays Ontario ESA termination pay when notice isn't worked", () => {
    expect([60, 200, 3 * 365, 12 * 365].map(ontarioNoticeWeeks)).toEqual([0, 1, 3, 8]);
    const s = packFor("CA").settlement({ type: "termination", dateOfJoining: "2022-01-03", resignationDate: "2026-10-31", lastWorkingDay: "2026-10-31", monthlyBasic: 5000, monthlyGross: 5000, noticeDays: 0, noticeWaived: false, payInLieu: true, leave: [{ leaveTypeId: "v", name: "Vacation", days: 3 }], manual: [], tds: 0 });
    expect(s.lines.find((l) => l.key === "notice_pay")!.amount).toBeCloseTo((60000 / 52) * 4 - (60000 / 52 / 7), 1); // 4 weeks less the one day given
    expect(s.lines.find((l) => l.key === "encash:v")!.amount).toBe(692.31);
    expect(packFor("CA").settlement({ type: "resignation", dateOfJoining: "2022-01-03", resignationDate: "2026-10-01", lastWorkingDay: "2026-10-31", monthlyBasic: 5000, monthlyGross: 5000, noticeDays: 14, noticeWaived: false, payInLieu: false, leave: [], manual: [], tds: 0 }).lines).toEqual([]);
  });
  it("knows Ontario's public holidays", () => {
    const h = Object.fromEntries(ontarioHolidays(2026).map((x) => [x.name, x.date]));
    expect(h).toMatchObject({ "Family Day": "2026-02-16", "Good Friday": "2026-04-03", "Victoria Day": "2026-05-18", "Labour Day": "2026-09-07", Thanksgiving: "2026-10-12" });
  });
});
