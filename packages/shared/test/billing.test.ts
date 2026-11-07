import { describe, expect, it } from "vitest";
import { billableSeats, dunningStage, invoiceTax, stateCodeOf } from "../src/billing";

describe("SaaS billing", () => {
  it("finds the place of supply", () => {
    expect(stateCodeOf("24ABCFS1234K1Z5", "Maharashtra")).toBe("24");
    expect(stateCodeOf(null, "maharashtra")).toBe("27");
    expect(stateCodeOf(null, "Atlantis")).toBeNull();
  });
  it("splits GST within a state and charges IGST across states", () => {
    expect(invoiceTax(37250, "24", "24")).toEqual({ intra: true, cgst: 3352.5, sgst: 3352.5, igst: 0, total: 43955 });
    expect(invoiceTax(37250, "24", "27")).toEqual({ intra: false, cgst: 0, sgst: 0, igst: 6705, total: 43955 });
    expect(invoiceTax(100, "24", null).igst).toBe(18);
  });
  it("bills at least the plan minimum", () => {
    expect(billableSeats(12, 25)).toBe(25);
    expect(billableSeats(250, 25)).toBe(250);
  });
  it("follows the dunning schedule", () => {
    expect(dunningStage(0, 0)).toEqual({ remind: false, pastDue: false, suspend: false });
    expect(dunningStage(1, 0).remind).toBe(true);
    expect(dunningStage(3, 1).remind).toBe(false);
    expect(dunningStage(8, 1)).toEqual({ remind: true, pastDue: false, suspend: false });
    expect(dunningStage(16, 3)).toEqual({ remind: false, pastDue: true, suspend: false });
    expect(dunningStage(46, 3).suspend).toBe(true);
  });
});
