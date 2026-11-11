import { describe, expect, it } from "vitest";
import { computeSettlement, defaultNoticeDays, serviceLength, type FnfInput } from "../src/fnf";

const base: FnfInput = {
  type: "resignation",
  dateOfJoining: "2019-06-03",
  resignationDate: "2026-10-01",
  lastWorkingDay: "2026-10-30",
  monthlyBasic: 52000,
  monthlyGross: 104000,
  noticeDays: 30,
  noticeWaived: false,
  payInLieu: false,
  leave: [{ leaveTypeId: "el", name: "Earned leave", days: 12 }],
  manual: [],
  tds: 0,
};
const line = (r: ReturnType<typeof computeSettlement>, key: string) => r.lines.find((l) => l.key === key);

describe("full and final settlement", () => {
  it("rounds a part year of more than 6 months up", () => {
    expect(serviceLength("2019-06-03", "2026-10-30").completedYears).toBe(7); // 7y 5m
    expect(serviceLength("2019-06-03", "2027-01-15").completedYears).toBe(8); // 7y 7m
  });

  it("pays gratuity and leave encashment, and recovers the notice shortfall", () => {
    const r = computeSettlement(base);
    expect(line(r, "gratuity")!.amount).toBe(210000); // 15/26 x 52,000 x 7
    expect(line(r, "encash:el")!.amount).toBe(24000); // 12 x 52,000 / 26
    expect(r.notice).toEqual({ required: 30, served: 30, shortfall: 0 });
    expect(line(r, "notice_recovery")).toBeUndefined();
    const short = computeSettlement({ ...base, lastWorkingDay: "2026-10-20" });
    expect(short.notice.shortfall).toBe(10);
    expect(line(short, "notice_recovery")!.amount).toBeCloseTo(34666.67, 2);
    expect(computeSettlement({ ...base, lastWorkingDay: "2026-10-20", noticeWaived: true }).lines.some((l) => l.key === "notice_recovery")).toBe(false);
  });

  it("needs 4 years 240 days for gratuity, except on death", () => {
    const early = { ...base, dateOfJoining: "2022-06-01" }; // 4y 5m
    expect(computeSettlement(early).gratuityEligible).toBe(false);
    expect(computeSettlement({ ...base, dateOfJoining: "2022-02-01" }).gratuityEligible).toBe(true); // 4y 9m
    const death = computeSettlement({ ...early, type: "death", dateOfJoining: "2025-01-01" });
    expect(death.gratuityEligible).toBe(true);
    expect(death.notice.shortfall).toBe(0);
  });

  it("takes loans and advances still owed off the settlement", () => {
    const plain = computeSettlement(base);
    const owed = computeSettlement({ ...base, recoveries: [{ key: "loan:x", label: "Salary advance ADV-0001 balance", amount: 15000 }] });
    expect(line(owed, "loan:x")).toMatchObject({ kind: "deduction", amount: 15000 });
    expect(owed.net).toBeCloseTo(plain.net - 15000, 2);
  });

  it("caps gratuity at ₹20 lakh", () => {
    const r = computeSettlement({ ...base, monthlyBasic: 500000, dateOfJoining: "2000-01-01" });
    expect(line(r, "gratuity")!.amount).toBe(2000000);
  });

  it("pays notice in lieu on a termination and counts it as taxable", () => {
    const r = computeSettlement({ ...base, type: "termination", payInLieu: true, resignationDate: "2026-10-30" });
    expect(line(r, "notice_pay")!.amount).toBeCloseTo(100533.33, 2); // 29 days x 104,000 / 30
    expect(r.taxable).toBeCloseTo(100533.33, 2);
  });

  it("adds manual lines and TDS, and can come out negative", () => {
    const r = computeSettlement({ ...base, leave: [], dateOfJoining: "2025-01-01", lastWorkingDay: "2026-10-05", manual: [{ label: "Laptop not returned", kind: "deduction", amount: 45000 }, { label: "Joining bonus", kind: "earning", amount: 5000 }], tds: 500 });
    expect(r.earnings).toBe(5000);
    expect(r.deductions).toBeGreaterThan(45500);
    expect(r.net).toBeLessThan(0);
    expect(r.taxable).toBe(5000);
  });

  it("uses the shorter notice period on probation", () => {
    expect(defaultNoticeDays("probation", {})).toBe(15);
    expect(defaultNoticeDays("active", { noticeDays: 60 })).toBe(60);
  });
});
