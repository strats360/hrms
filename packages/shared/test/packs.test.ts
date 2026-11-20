import { describe, expect, it } from "vitest";
import { allowedCountries, computePayslip, COUNTRIES, hasPackFor, packFor, structureFromCtc } from "../src";

describe("country packs", () => {
  it("has India and the six Gulf states", () => {
    expect(packFor("IN").code).toBe("IN");
    expect(packFor().code).toBe("IN"); // default
    expect(hasPackFor("IN")).toBe(true);
    expect(packFor("AE").review?.status).toBe("pending"); // waiting for a UAE expert's sign off
    for (const c of ["SA", "QA", "KW", "OM", "BH"]) expect(packFor(c).review?.status).toBe("pending");
    for (const c of ["GB", "US", "CA"]) {
      expect(hasPackFor(c)).toBe(false);
      expect(() => packFor(c)).toThrow(/isn't supported yet/);
    }
  });

  it("only lets an instance use countries that have a pack", () => {
    expect(allowedCountries(undefined)).toEqual(["IN"]);
    expect(allowedCountries("IN, AE, GB, xx")).toEqual(["IN", "AE"]); // GB has no pack yet, xx isn't a country
    expect(allowedCountries("GB")).toEqual([]);
  });

  it("knows each country's currency, decimals and weekend", () => {
    expect(COUNTRIES.KW).toMatchObject({ currency: "KWD", decimals: 3 });
    expect(COUNTRIES.OM.decimals).toBe(3);
    expect(COUNTRIES.BH).toMatchObject({ currency: "BHD", decimals: 3, weekend: [5, 6] });
    expect(COUNTRIES.CA).toMatchObject({ currency: "CAD", timeZone: "America/Toronto" });
    expect(COUNTRIES.SA.weekend).toEqual([5, 6]);
    expect(COUNTRIES.AE.weekend).toEqual([0, 6]);
  });

  it("gives the same India payslip with or without the country set", () => {
    const base = { month: "2026-11", daysInMonth: 30, paidDays: 28, pfApplicable: true, esiApplicable: true, ptApplicable: true, state: "Gujarat", regime: "new" as const, structure: structureFromCtc(1440000) };
    expect(computePayslip({ ...base, country: "IN" })).toEqual(computePayslip(base));
  });

  it("refuses to run payroll for a country without a pack", () => {
    const base = { month: "2026-11", daysInMonth: 30, paidDays: 30, pfApplicable: false, esiApplicable: false, ptApplicable: false, state: null, regime: "new" as const, structure: structureFromCtc(600000) };
    expect(() => computePayslip({ ...base, country: "GB" })).toThrow(/United Kingdom isn't supported yet/);
  });

  it("India pack lists the entity registrations and rule categories", () => {
    expect(packFor("IN").entityRegistrations.map((f) => f.key)).toEqual(["gstin", "pan", "tan", "cin"]);
    expect(packFor("IN").ruleCategories).toContain("pf");
    expect(packFor("IN").payroll.amountInWords(105)).toBe("One hundred five rupees only");
  });
});

describe("time zones and money", () => {
  it("works out local dates and times in any zone", async () => {
    const { toLocalDate, toLocalTime, localMinutes, zonedDateTime, zoneOffsetMinutes } = await import("../src");
    const at = new Date("2026-11-05T20:30:00Z");
    expect(toLocalDate(at, "Asia/Kolkata")).toBe("2026-11-06"); // 02:00 next day in India
    expect(toLocalDate(at, "Asia/Dubai")).toBe("2026-11-06"); // 00:30 in Dubai
    expect(toLocalDate(at, "Asia/Riyadh")).toBe("2026-11-05"); // 23:30 in Riyadh
    expect(toLocalTime(at, "Asia/Kolkata")).toBe("02:00");
    expect(toLocalTime(at, "Europe/London")).toBe("20:30");
    expect(localMinutes(at, "Asia/Dubai")).toBe(30);
    expect(zoneOffsetMinutes("Asia/Dubai", at)).toBe(240);
    expect(zonedDateTime("2026-11-05", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-11-05T03:30:00.000Z");
    expect(zonedDateTime("2026-11-05", "09:00", "Asia/Dubai").toISOString()).toBe("2026-11-05T05:00:00.000Z");
    // daylight saving: London is UTC+1 in July, New York UTC-4
    expect(zonedDateTime("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedDateTime("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("formats and rounds money per currency", async () => {
    const { fmtMoney, fmtMoneyCompact, roundMoney, currencyDecimals } = await import("../src");
    expect(fmtMoney(123456, { currency: "INR" })).toBe("₹1,23,456");
    expect(fmtMoney(12345.5, { currency: "AED" })).toBe("AED 12,345.50");
    expect(fmtMoney(1234.5678, { currency: "KWD" })).toBe("KWD 1,234.568");
    expect(fmtMoney(1234.5, { currency: "USD" })).toBe("$1,234.50");
    expect(fmtMoneyCompact(14_40_000, { currency: "INR" })).toBe("₹14.40 L");
    expect(fmtMoneyCompact(1_420_000, { currency: "USD" })).toBe("$1.4M");
    expect(currencyDecimals("OMR")).toBe(3);
    expect(roundMoney(10.0006, 3)).toBe(10.001);
  });
});
