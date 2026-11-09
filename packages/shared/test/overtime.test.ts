import { describe, expect, it } from "vitest";
import { DEFAULT_OVERTIME, encashmentPerDay, overtimePay, overtimeRate } from "../src/overtime";

describe("overtime", () => {
  it("pays twice the ordinary hourly rate", () => {
    // 52,000 gross / (26 x 8) = 250 an hour; twice that is 500
    expect(overtimeRate({ basic: 26000, gross: 52000 })).toBe(500);
    expect(overtimePay(12.5, { basic: 26000, gross: 52000 })).toEqual({ ratePerHour: 500, amount: 6250, overLimit: false });
  });
  it("can use basic only and other multipliers, and warns over the limit", () => {
    const s = { ...DEFAULT_OVERTIME, basis: "basic" as const, multiplier: 1.5 };
    expect(overtimeRate({ basic: 20800, gross: 52000 }, s)).toBe(150);
    expect(overtimePay(60, { basic: 20800, gross: 52000 }).overLimit).toBe(true);
  });
  it("encashes leave at basic / 26", () => {
    expect(encashmentPerDay(26000)).toBe(1000);
  });
});
