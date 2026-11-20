import { describe, expect, it } from "vitest";
import { daysUntil, dueDate, ecrLine, pfWages, ptSlabSummary, tdsReturnDueDates } from "../src";

describe("due dates", () => {
  it("EPF and ESI on the 15th of next month, across year end", () => {
    expect(dueDate("epf", "2026-10")).toBe("2026-11-15");
    expect(dueDate("esi", "2026-12")).toBe("2027-01-15");
  });
  it("TDS on the 7th, March on 30 April", () => {
    expect(dueDate("tds", "2026-10")).toBe("2026-11-07");
    expect(dueDate("tds", "2027-03")).toBe("2027-04-30");
  });
  it("PT by state", () => {
    expect(dueDate("pt", "2026-10", "Gujarat")).toBe("2026-11-15");
    expect(dueDate("pt", "2026-02", "Maharashtra")).toBe("2026-02-28");
    expect(dueDate("pt", "2026-10", "Karnataka")).toBe("2026-11-20");
  });
  it("24Q quarters", () => {
    expect(tdsReturnDueDates("2026-27").map((q) => q.due)).toEqual(["2026-07-31", "2026-10-31", "2027-01-31", "2027-05-31", "2027-06-15"]);
  });
  it("days until", () => {
    expect(daysUntil("2026-11-07", "2026-11-05")).toBe(2);
    expect(daysUntil("2026-11-07", "2026-11-09")).toBe(-2);
  });
});

describe("ECR", () => {
  it("formats an ECR 2.0 line", () => {
    const w = pfWages(58500);
    expect(w).toEqual({ epf: 25000, eps: 25000, edli: 25000 }); // the ₹25,000 ceiling from 17 Sep 2026
    expect(pfWages(58500, false, 15000)).toEqual({ epf: 15000, eps: 15000, edli: 15000 });
    expect(ecrLine({ uan: "100887654321", name: "Priya Vaghela", grossWages: 117000, epfWages: w.epf, epsWages: w.eps, edliWages: w.edli, epfEe: 3000, eps: 2083, epfEr: 917, ncpDays: 0 })).toBe(
      "100887654321#~#PRIYA VAGHELA#~#117000#~#25000#~#25000#~#25000#~#3000#~#2083#~#917#~#0#~#0",
    );
  });
});

describe("PT return", () => {
  it("groups employees into Gujarat slabs", () => {
    const s = ptSlabSummary("Gujarat", [{ gross: 9000, pt: 0 }, { gross: 30000, pt: 200 }, { gross: 50000, pt: 200 }]);
    expect(s.map((x) => [x.employees, x.amount])).toEqual([[1, 0], [2, 400]]);
  });
});
