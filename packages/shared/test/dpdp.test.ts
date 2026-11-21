import { describe, expect, it } from "vitest";
import { breachDeadlines, dueForErasure } from "../src/dpdp";

describe("DPDP", () => {
  it("tracks the 72 hour report to the Board", () => {
    const b = breachDeadlines({ discoveredAt: "2026-11-20T10:00:00Z" }, new Date("2026-11-21T10:00:00Z"));
    expect(b).toMatchObject({ reportDue: "2026-11-23T10:00:00.000Z", overdue: false });
    expect(b.open).toEqual(["Tell the Data Protection Board now", "Send the Board the full report", "Tell the people affected"]);
    expect(breachDeadlines({ discoveredAt: "2026-11-17T10:00:00Z", boardIntimatedAt: "2026-11-17T12:00:00Z" }, new Date("2026-11-21T10:00:00Z"))).toMatchObject({ overdue: true, open: ["The full report to the Board is overdue", "Tell the people affected"] });
  });
  it("finds data kept past retention", () => {
    expect(dueForErasure("2018-03-31", 8, "2026-11-21")).toEqual({ due: true, from: "2026-03-31" });
    expect(dueForErasure("2020-03-31", 8, "2026-11-21")).toEqual({ due: false, from: "2028-03-31" });
    expect(dueForErasure(null, 8, "2026-11-21").due).toBe(false);
  });
});
