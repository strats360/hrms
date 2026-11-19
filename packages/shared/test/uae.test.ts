import { describe, expect, it } from "vitest";
import { buildWpsSif, checkWps, computePayslip, emiratisationStatus, packFor, structureFromCtc, uaeGratuity, type PayslipInput } from "../src";

const slip = (o: Partial<PayslipInput> & { annual: number }) =>
  computePayslip({
    country: "AE",
    month: "2026-11",
    structure: structureFromCtc(o.annual, undefined, { pfApplicable: false, esiApplicable: false }),
    daysInMonth: 30,
    paidDays: 30,
    pfApplicable: false,
    esiApplicable: false,
    ptApplicable: false,
    state: null,
    regime: "new",
    ...o,
  });

describe("UAE payroll", () => {
  it("takes nothing from an expat's pay, and has no income tax", () => {
    const p = slip({ annual: 240000, profile: { nationality: "IN", region: "Dubai" } });
    expect(p.gross).toBe(20000);
    expect(p.deductions).toEqual([]);
    expect(p.employer).toEqual([]);
    expect(p.tds).toBe(0);
    expect(p.net).toBe(20000);
    expect(p.earnings.find((e) => e.code === "hra")?.label).toBe("Housing allowance");
  });
  it("puts UAE nationals into GPSSA: 11% employee, 12.5% employer", () => {
    const p = slip({ annual: 360000, profile: { nationality: "AE", region: "Dubai" } });
    expect(p.deductions).toEqual([{ code: "pension", label: "GPSSA pension (employee 11%)", amount: 3300 }]);
    expect(p.employer).toEqual([{ code: "pension_er", label: "GPSSA pension (employer 12.5%)", amount: 3750 }]);
    expect(p.net).toBe(26700);
  });
  it("caps the contribution salary at AED 70,000", () => {
    const p = slip({ annual: 1200000, profile: { nationality: "AE", region: "Sharjah" } });
    expect(p.deductions[0]!.amount).toBe(7700);
    expect(p.warnings.join(" ")).toMatch(/capped at AED 70,000/);
  });
  it("uses ADPF for Abu Dhabi employers", () => {
    const p = slip({ annual: 360000, profile: { nationality: "AE", region: "Abu Dhabi" } });
    expect(p.deductions[0]).toMatchObject({ label: "ADPF pension (employee 5%)", amount: 1500 });
    expect(p.employer[0]).toMatchObject({ amount: 4500 });
  });
  it("prorates for unpaid days, and flags what HR has to check", () => {
    const p = slip({ annual: 360000, paidDays: 15, profile: { nationality: "AE", region: "Dubai" } });
    expect(p.deductions[0]!.amount).toBe(1650);
    expect(slip({ annual: 240000, profile: { nationality: "SA" } }).warnings.join(" ")).toMatch(/GCC national/);
    expect(slip({ annual: 240000 }).warnings.join(" ")).toMatch(/Nationality isn't set/);
  });
});

describe("UAE end of service", () => {
  it("pays 21 days a year for five years, 30 after, capped at two years' basic", () => {
    expect(uaeGratuity(10000, 300).amount).toBe(0);
    expect(uaeGratuity(10000, 3 * 365).amount).toBe(21000);
    expect(uaeGratuity(10000, 7 * 365).amount).toBe(55000);
    expect(uaeGratuity(10000, 30 * 365)).toMatchObject({ amount: 240000, capped: true });
    expect(uaeGratuity(12000, 1533).amount).toBe(35280); // 4.2 years × 21 days × 12,000 / 30: part years pro rata
  });
  const base = { type: "resignation" as const, dateOfJoining: "2019-01-01", resignationDate: "2026-10-03", lastWorkingDay: "2026-10-31", monthlyBasic: 10000, monthlyGross: 18000, noticeDays: 30, noticeWaived: false, payInLieu: false, leave: [{ leaveTypeId: "al", name: "Annual leave", days: 12 }], manual: [], tds: 0 };
  it("settles an expat: gratuity, leave on basic, notice short", () => {
    const s = packFor("AE").settlement(base);
    const g = s.lines.find((l) => l.key === "gratuity")!;
    expect(g.amount).toBeGreaterThan(50000);
    expect(s.lines.find((l) => l.key === "encash:al")!.amount).toBe(4000); // 12 × 10,000 / 30
    expect(s.lines.find((l) => l.key === "notice_recovery")?.amount).toBe(600); // 1 day short × 18,000 / 30
    expect(s.taxable).toBe(0);
  });
  it("gives nationals no gratuity (their pension covers it), and leaves unpaid leave out of service", () => {
    expect(packFor("AE").settlement({ ...base, profile: { nationality: "AE" } }).lines.some((l) => l.key === "gratuity")).toBe(false);
    const shorter = packFor("AE").settlement({ ...base, unpaidLeaveDays: 365 });
    expect(shorter.service.days).toBe(packFor("AE").settlement(base).service.days - 365);
  });
});

describe("WPS salary file", () => {
  const f = {
    employerId: "1234567890123",
    employerRoutingCode: "800610101",
    month: "2026-11",
    createdAt: new Date("2026-11-28T09:30:15Z"),
    employees: [
      { name: "Sara Ahmed", personId: "12345678901234", routingCode: "803320101", iban: "AE07 0331 2345 6789 0123 456", payStart: "2026-11-01", payEnd: "2026-11-30", daysInPeriod: 30, fixed: 18000, variable: 1250.5, leaveDays: 2 },
      { name: "Ravi Nair", personId: "22345678901234", routingCode: "800610101", iban: "AE460260001015123456789", payStart: "2026-11-01", payEnd: "2026-11-30", daysInPeriod: 30, fixed: 9000, variable: 0, leaveDays: 0 },
    ],
  };
  it("writes EDR lines and a control line", () => {
    const { fileName, content } = buildWpsSif(f);
    expect(fileName).toBe("1234567890123261128093015.SIF");
    const lines = content.trimEnd().split("\r\n");
    expect(lines[0]).toBe("EDR,12345678901234,803320101,AE070331234567890123456,2026-11-01,2026-11-30,30,18000.00,1250.50,2");
    expect(lines[2]).toBe("SCR,1234567890123,800610101,2026-11-28,0930,112026,2,28250.50,AED,");
  });
  it("names what's wrong before the bank rejects it", () => {
    expect(checkWps(f)).toEqual([]);
    const bad = checkWps({ ...f, employerId: "123", employees: [{ ...f.employees[0]!, personId: "99", iban: "GB00" }] });
    expect(bad).toEqual(expect.arrayContaining([expect.stringMatching(/establishment ID must be 13 digits/), expect.stringMatching(/Sara Ahmed: the MOHRE person code/), expect.stringMatching(/Sara Ahmed: the IBAN/)]));
  });
});

describe("Emiratisation", () => {
  it("counts the shortfall against the target in force and the next one", () => {
    const s = emiratisationStatus({ employees: 120, nationals: 7, on: "2026-03-01" });
    expect(s.applies).toBe(true);
    expect(s.current).toMatchObject({ by: "2025-12-31", share: 0.08, shortfall: 3 }); // 8% of 120 = 9.6, so 10
    expect(s.next).toMatchObject({ by: "2026-06-30", share: 0.09, shortfall: 4 }); // 10.8, so 11
    expect(emiratisationStatus({ employees: 40, nationals: 0, on: "2026-03-01" })).toMatchObject({ applies: false, next: { shortfall: 0 } });
  });
});
