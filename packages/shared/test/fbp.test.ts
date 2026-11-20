import { describe, expect, it } from "vitest";
import { checkFbpAllocations, fbpMonthlyCredit, FBP_SUGGESTED_HEADS as H, sumFbp } from "../src/fbp";

describe("flexible benefit plan", () => {
  it("checks a declaration against caps, regime and the special allowance", () => {
    expect(checkFbpAllocations(H, "old", { fuel: 21600, lta: 30000, meals: 0 }, 120000)).toEqual({ fuel: 21600, lta: 30000 });
    expect(() => checkFbpAllocations(H, "new", { lta: 30000 }, 120000)).toThrow(/new regime/);
    expect(() => checkFbpAllocations(H, "old", { fuel: 30000 }, 120000)).toThrow(/at most 21,600/);
    expect(() => checkFbpAllocations(H, "old", { fuel: 21600, telephone: 24000 }, 40000)).toThrow(/more than your special allowance of 40,000/);
    expect(() => checkFbpAllocations(H, "old", { yacht: 1 }, 40000)).toThrow(/no benefit called yacht/);
  });
  it("credits a twelfth each month, within the special allowance, skipping heads the regime doesn't allow", () => {
    expect(fbpMonthlyCredit(H, "old", { fuel: 21600, telephone: 12000 }, 10000)).toEqual({ fuel: 1800, telephone: 1000 });
    expect(fbpMonthlyCredit(H, "old", { fuel: 21600, telephone: 12000 }, 2000)).toEqual({ fuel: 1800, telephone: 200 });
    expect(fbpMonthlyCredit(H, "new", { fuel: 21600, lta: 24000 }, 10000)).toEqual({ fuel: 1800 });
    expect(sumFbp({ fuel: 1800, telephone: 200.5 })).toBe(2000.5);
  });
});
