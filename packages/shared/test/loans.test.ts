import { describe, expect, it } from "vitest";
import { addMonths, DEFAULT_LOAN_POLICY, emiFor, loanLimitError, loanSchedule, totalPayable } from "../src/loans";

describe("loans", () => {
  it("splits an interest-free loan evenly, with the remainder in the last month", () => {
    const s = loanSchedule(10000, 0, 3, "2026-11");
    expect(s.map((x) => [x.month, x.emi])).toEqual([["2026-11", 3334], ["2026-12", 3334], ["2027-01", 3332]]);
    expect(totalPayable(s)).toBe(10000);
    expect(s.at(-1)!.balance).toBe(0);
  });
  it("charges interest on the reducing balance", () => {
    expect(emiFor(100000, 12, 12)).toBe(8885);
    const s = loanSchedule(100000, 12, 12, "2026-04");
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ interest: 1000, principal: 7885 });
    expect(s.at(-1)!.balance).toBe(0);
    expect(totalPayable(s)).toBeGreaterThan(106000);
    expect(totalPayable(s)).toBeLessThan(106700);
  });
  it("pushes skipped months back", () => {
    const s = loanSchedule(6000, 0, 3, "2026-11", ["2026-12"]);
    expect(s.map((x) => x.month)).toEqual(["2026-11", "2027-01", "2027-02"]);
  });
  it("adds months across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("checks requests against the company limits", () => {
    expect(loanLimitError(DEFAULT_LOAN_POLICY, "advance", 50000, 1, 40000)).toMatch(/up to 100% of your monthly gross \(₹40,000\)/);
    expect(loanLimitError(DEFAULT_LOAN_POLICY, "advance", 30000, 6, 40000)).toMatch(/within 3 months/);
    expect(loanLimitError(DEFAULT_LOAN_POLICY, "loan", 100000, 12, 40000)).toBeNull();
    expect(loanLimitError(DEFAULT_LOAN_POLICY, "loan", 200000, 12, 40000)).toMatch(/3 months of your gross/);
  });
});
