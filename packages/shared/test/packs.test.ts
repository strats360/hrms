import { describe, expect, it } from "vitest";
import { allowedCountries, computePayslip, COUNTRIES, hasPackFor, packFor, structureFromCtc } from "../src";

describe("country packs", () => {
  it("has India and nothing else yet", () => {
    expect(packFor("IN").code).toBe("IN");
    expect(packFor().code).toBe("IN"); // default
    expect(hasPackFor("IN")).toBe(true);
    for (const c of ["AE", "SA", "QA", "KW", "OM", "GB", "US"]) {
      expect(hasPackFor(c)).toBe(false);
      expect(() => packFor(c)).toThrow(/isn't supported yet/);
    }
  });

  it("only lets an instance use countries that have a pack", () => {
    expect(allowedCountries(undefined)).toEqual(["IN"]);
    expect(allowedCountries("IN, AE, xx")).toEqual(["IN"]); // AE has no pack yet, xx isn't a country
    expect(allowedCountries("AE")).toEqual([]);
  });

  it("knows each country's currency, decimals and weekend", () => {
    expect(COUNTRIES.KW).toMatchObject({ currency: "KWD", decimals: 3 });
    expect(COUNTRIES.OM.decimals).toBe(3);
    expect(COUNTRIES.SA.weekend).toEqual([5, 6]);
    expect(COUNTRIES.AE.weekend).toEqual([0, 6]);
  });

  it("gives the same India payslip with or without the country set", () => {
    const base = { month: "2026-11", daysInMonth: 30, paidDays: 28, pfApplicable: true, esiApplicable: true, ptApplicable: true, state: "Gujarat", regime: "new" as const, structure: structureFromCtc(1440000) };
    expect(computePayslip({ ...base, country: "IN" })).toEqual(computePayslip(base));
  });

  it("refuses to run payroll for a country without a pack", () => {
    const base = { month: "2026-11", daysInMonth: 30, paidDays: 30, pfApplicable: false, esiApplicable: false, ptApplicable: false, state: null, regime: "new" as const, structure: structureFromCtc(600000) };
    expect(() => computePayslip({ ...base, country: "AE" })).toThrow(/United Arab Emirates isn't supported yet/);
  });

  it("India pack lists the entity registrations and rule categories", () => {
    expect(packFor("IN").entityRegistrations.map((f) => f.key)).toEqual(["gstin", "pan", "tan", "cin"]);
    expect(packFor("IN").ruleCategories).toContain("pf");
    expect(packFor("IN").payroll.amountInWords(105)).toBe("One hundred five rupees only");
  });
});
