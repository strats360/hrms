import { describe, expect, it } from "vitest";
import { accruedLeave, computeSettlement, headcountObligations, indiaYearlyDates, oshLeave, quarterOf, statutoryBonus } from "../src";

describe("OSH Code leave", () => {
  it("gives 1 day for every 20 days worked last year, once 180 were worked", () => {
    expect(oshLeave(179)).toBe(0);
    expect(oshLeave(180)).toBe(9);
    expect(oshLeave(250)).toBe(12);
    expect(accruedLeave({ annualQuota: 0, accrual: "worked_days" }, 2026, "2026-06-30", "2020-01-01", 240)).toBe(12);
  });
});

describe("retrenchment", () => {
  const base = { type: "retrenchment" as const, dateOfJoining: "2020-01-01", resignationDate: "2026-09-30", lastWorkingDay: "2026-10-31", monthlyBasic: 20000, monthlyGross: 40000, monthlyWages: 20000, noticeDays: 30, noticeWaived: false, payInLieu: true, leave: [], manual: [], tds: 0 };
  it("pays 15 days' wages per completed year and puts 15 days into the re-skilling fund", () => {
    const s = computeSettlement(base);
    const comp = s.lines.find((l) => l.key === "retrenchment")!;
    expect(comp.amount).toBeCloseTo((15 / 26) * 20000 * s.service.completedYears, 2);
    expect(s.employerDues).toEqual([{ label: "Worker re-skilling fund (15 days' wages)", amount: 11538.46, due: "2026-11-10" }]);
    expect(s.lines.some((l) => l.key === "gratuity")).toBe(true); // six years: gratuity too
  });
  it("needs a year of service", () => {
    expect(computeSettlement({ ...base, dateOfJoining: "2026-03-01" }).lines.some((l) => l.key === "retrenchment")).toBe(false);
  });
});

describe("statutory bonus", () => {
  it("counts wages at ₹7,000 a month, or the minimum wage if higher", () => {
    const year = Array.from({ length: 12 }, () => ({ wage: 15000, paidDays: 30 }));
    expect(statutoryBonus(year).amount).toBe(6997);
    expect(statutoryBonus(year, 8.33, 12870).wageBase).toBe(154440);
  });
});

describe("headcount thresholds", () => {
  it("lists what applies and what's close", () => {
    const r = headcountObligations({ employees: 18, workers: 9 });
    expect(r.find((o) => o.obligation.startsWith("ESI registration"))!.status).toBe("applies");
    expect(r.find((o) => o.obligation.startsWith("EPF registration"))!.status).toBe("near"); // 18 of 20
    expect(r.find((o) => o.obligation.startsWith("Labour Code registration"))!.status).toBe("near"); // 9 workers of 10
    expect(r.find((o) => o.obligation === "Creche facility")!.status).toBe("not_yet");
  });
});

describe("compliance calendar", () => {
  it("adds the Labour Codes' yearly dates", () => {
    const d = indiaYearlyDates("2026-11-20", "2027-03-31").map((x) => `${x.date} ${x.title.split(" ").slice(0, 2).join(" ")}`);
    expect(d).toEqual(["2026-11-30 Statutory bonus", "2027-01-31 POSH annual", "2027-02-28 Unified annual"]);
    expect(quarterOf("2026-11")).toEqual({ from: "2026-10", to: "2026-12" });
  });
});
