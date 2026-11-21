import { describe, expect, it } from "vitest";
import { healthCheckDue, isNightShift, maternityBenefit } from "../src/maternity";

const base = { survivingChildren: 0, daysWorkedLast12Months: 200, averageDailyWage: 1000, esiCovered: false };

describe("maternity benefit", () => {
  it("gives 26 weeks for a first or second child, from up to 8 weeks before", () => {
    const r = maternityBenefit({ ...base, event: "delivery", eventDate: "2027-03-01" });
    expect(r).toMatchObject({ eligible: true, weeks: 26, startDate: "2027-01-04", endDate: "2027-07-04", days: 182, amount: 182000, paidBy: "employer", medicalBonus: 3500, employerPays: 185500 });
  });
  it("gives 12 weeks from the third child, and none without 80 days worked", () => {
    expect(maternityBenefit({ ...base, event: "delivery", eventDate: "2027-03-01", survivingChildren: 2 })).toMatchObject({ weeks: 12, beforeWeeks: 6, startDate: "2027-01-18" });
    const no = maternityBenefit({ ...base, event: "delivery", eventDate: "2027-03-01", daysWorkedLast12Months: 60 });
    expect(no.eligible).toBe(false);
    expect(no.reasons[0]).toMatch(/60 days/);
  });
  it("has ESIC pay when she's covered, and handles adoption and miscarriage", () => {
    expect(maternityBenefit({ ...base, event: "delivery", eventDate: "2027-03-01", esiCovered: true })).toMatchObject({ paidBy: "esi", employerPays: 0, medicalBonus: 0 });
    expect(maternityBenefit({ ...base, event: "adoption", eventDate: "2027-02-10", daysWorkedLast12Months: 10 })).toMatchObject({ eligible: true, weeks: 12, startDate: "2027-02-10" });
    expect(maternityBenefit({ ...base, event: "miscarriage", eventDate: "2026-11-20" })).toMatchObject({ weeks: 6, startDate: "2026-11-21", days: 42 });
  });
  it("clamps an early start", () => {
    const r = maternityBenefit({ ...base, event: "delivery", eventDate: "2027-03-01", startDate: "2026-12-01" });
    expect(r.startDate).toBe("2027-01-04");
    expect(r.reasons[0]).toMatch(/at most 8 weeks/);
    expect(r.eligible).toBe(true);
  });
});

describe("night shifts and health checks", () => {
  it("spots shifts outside 6 am to 7 pm", () => {
    expect(isNightShift("09:30", "18:30")).toBe(false);
    expect(isNightShift("14:00", "22:00")).toBe(true);
    expect(isNightShift("05:30", "14:00")).toBe(true);
    expect(isNightShift("22:00", "06:00")).toBe(true);
  });
  it("is due yearly from 40", () => {
    expect(healthCheckDue("1990-01-01", null, "2026-11-21")).toEqual({ age: 36, due: false });
    expect(healthCheckDue("1985-06-01", null, "2026-11-21")).toMatchObject({ age: 41, due: true });
    expect(healthCheckDue("1985-06-01", "2026-02-01", "2026-11-21")).toMatchObject({ due: false, nextBy: "2027-02-01" });
  });
});
