import { describe, expect, it } from "vitest";
import { addMonthsToDate, probationEndDate } from "../src/probation";
import { daysUntil } from "../src/compliance";

describe("probation", () => {
  it("adds months, keeping month ends sensible", () => {
    expect(addMonthsToDate("2026-05-15", 6)).toBe("2026-11-15");
    expect(addMonthsToDate("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsToDate("2027-08-31", 6)).toBe("2028-02-29");
  });
  it("ends at the confirmation date on record, else joining plus months", () => {
    expect(probationEndDate({ dateOfJoining: "2026-06-01", probationMonths: 3 })).toBe("2026-09-01");
    expect(probationEndDate({ dateOfJoining: "2026-06-01", probationMonths: null })).toBe("2026-12-01");
    expect(probationEndDate({ dateOfJoining: "2026-06-01", probationMonths: 3, confirmationDate: "2026-10-15" })).toBe("2026-10-15");
  });
  it("counts days left, negative when overdue", () => {
    expect(daysUntil("2026-11-20", "2026-11-11")).toBe(9);
    expect(daysUntil("2026-11-01", "2026-11-11")).toBe(-10);
  });
});
