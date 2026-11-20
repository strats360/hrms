import { describe, expect, it } from "vitest";
import { computePayslip, isPeriodStart, nextPeriod, packFor, periodContaining, periodIndex, periodLabel, structureFromCtc, type PayslipInput } from "../src";

describe("pay calendar", () => {
  it("splits semi-monthly pay at the 15th, paid on the 15th and the last day", () => {
    expect(periodContaining("semi_monthly", "2026-03-10")).toMatchObject({ start: "2026-03-01", end: "2026-03-15", payDate: "2026-03-15", days: 15, perYear: 24 });
    const second = periodContaining("semi_monthly", "2026-02-20");
    expect(second).toMatchObject({ start: "2026-02-16", end: "2026-02-28", payDate: "2026-02-28", days: 13 });
    expect(nextPeriod(second).start).toBe("2026-03-01");
  });
  it("runs biweekly and weekly periods on from the anchor, paid the Friday after", () => {
    const p = periodContaining("biweekly", "2026-01-20", "2026-01-05");
    expect(p).toMatchObject({ start: "2026-01-19", end: "2026-02-01", payDate: "2026-02-06", month: "2026-02", days: 14, perYear: 26 });
    expect(periodContaining("biweekly", "2025-12-30", "2026-01-05").start).toBe("2025-12-22"); // before the anchor too
    expect(periodContaining("weekly", "2026-01-14", "2026-01-05")).toMatchObject({ start: "2026-01-12", end: "2026-01-18", perYear: 52 });
    expect(isPeriodStart("biweekly", "2026-01-19", "2026-01-05")).toBe(true);
    expect(isPeriodStart("biweekly", "2026-01-12", "2026-01-05")).toBe(false);
    expect(() => periodContaining("biweekly", "2026-01-20")).toThrow(/first day of a pay period/);
  });
  it("numbers periods within the tax year by pay date", () => {
    const anchor = "2026-01-05";
    expect(periodIndex(periodContaining("biweekly", "2025-12-30", anchor), 1, anchor)).toBe(1); // paid 9 Jan 2026
    expect(periodIndex(periodContaining("biweekly", "2026-01-20", anchor), 1, anchor)).toBe(3);
    expect(periodIndex(periodContaining("semi_monthly", "2026-03-20"), 1)).toBe(6);
    expect(periodIndex(periodContaining("monthly", "2026-03-20"), 1)).toBe(3);
  });
  it("labels periods", () => {
    expect(periodLabel({ frequency: "monthly", periodStart: "2026-03-01", periodEnd: "2026-03-31", month: "2026-03" })).toBe("March 2026");
    expect(periodLabel({ frequency: "semi_monthly", periodStart: "2026-03-16", periodEnd: "2026-03-31", month: "2026-03" })).toBe("16 to 31 Mar 2026");
    expect(periodLabel({ frequency: "biweekly", periodStart: "2026-01-19", periodEnd: "2026-02-01", month: "2026-02" })).toBe("19 Jan to 1 Feb 2026");
    expect(periodLabel({ frequency: "biweekly", periodStart: "2025-12-22", periodEnd: "2026-01-04", month: "2026-01" })).toBe("22 Dec 2025 to 4 Jan 2026");
  });
});

describe("payslips for shorter periods", () => {
  const slip = (country: "US" | "CA", perYear: number, o: Partial<PayslipInput> = {}) =>
    computePayslip({
      country,
      month: "2026-02",
      structure: structureFromCtc(60000, packFor(country).payroll.salaryTemplate, { pfApplicable: false, esiApplicable: false }),
      period: { perYear, index: 3 },
      daysInMonth: 14,
      paidDays: 14,
      pfApplicable: false,
      esiApplicable: false,
      ptApplicable: false,
      state: country === "US" ? "Texas" : "Ontario",
      regime: "new",
      countryProfile: country === "US" ? { filingStatus: "single" } : {},
      ...o,
    });
  const line = (l: { code: string; amount: number }[], code: string) => l.find((x) => x.code === code)?.amount;

  it("pays a biweekly US salary as 1/26 of the year, with tax annualised over 26 pays", () => {
    const p = slip("US", 26);
    expect(p.gross).toBe(2307.69);
    expect(line(p.deductions, "fit")).toBeCloseTo(5020 / 26, 1);
    expect(line(p.deductions, "ss")).toBe(143.08);
  });
  it("pays semi-monthly as half a month", () => {
    const p = slip("US", 24);
    expect(p.gross).toBe(2500);
    expect(line(p.deductions, "fit")).toBeCloseTo(5020 / 24, 1);
  });
  it("spreads Canada's CPP exemption over 26 pays", () => {
    const p = slip("CA", 26);
    expect(line(p.deductions, "cpp")).toBe(129.3); // 5.95% of 2,307.69 − 3,500 / 26
  });
  it("prorates unpaid days within the period", () => {
    expect(slip("US", 26, { paidDays: 7 }).gross).toBe(1153.85);
  });
});
