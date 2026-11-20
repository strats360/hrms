import { describe, expect, it } from "vitest";
import { evalFormula, formulaError } from "../src";

describe("salary formulas", () => {
  const vars = { gross: 50000, basic: 25000, ctc: 55000, hra: 10000 };
  it("works out arithmetic, brackets and functions", () => {
    expect(evalFormula("min(basic * 0.1, 1600)", vars)).toBe(1600);
    expect(evalFormula("round(gross * 0.035)", vars)).toBe(1750);
    expect(evalFormula("(ctc - gross) / 2", vars)).toBe(2500);
    expect(evalFormula("max(0, 20000 - basic)", vars)).toBe(0);
    expect(evalFormula("-basic + 30000", vars)).toBe(5000);
    expect(evalFormula("basic / 0", vars)).toBe(0);
  });
  it("refuses anything that isn't a formula, with a message a person can act on", () => {
    expect(formulaError("min(basic * 0.1, 1600)")).toBeNull();
    expect(formulaError("salary * 2")).toMatch(/isn't something the formula knows/);
    expect(formulaError("alert(1)")).toMatch(/isn't a function/);
    expect(formulaError("(basic * 2")).toMatch(/isn't closed/);
    expect(formulaError("basic; drop")).toMatch(/Unexpected/);
    expect(formulaError("constructor.constructor('x')()")).not.toBeNull();
  });
});

import { componentsFromGross } from "../src/payroll";
import { extraComponentDefSchema } from "../src/schemas";

describe("formula allowances", () => {
  it("pays a formula allowance inside the template", () => {
    const c = componentsFromGross(50000, { basicPctOfGross: 50, hraPctOfBasic: 40, extras: [{ code: "lta", label: "LTA", mode: "formula", value: 0, formula: "min(basic * 0.1, 1600)", taxable: true, esiWage: true }], conveyance: 0, medical: 0, pfOnFullBasic: false });
    expect(c.extras?.[0]?.amount).toBe(1600);
    expect(c.special).toBe(50000 - 25000 - 10000 - 1600);
  });
  it("rejects a formula it can't read", () => {
    expect(extraComponentDefSchema.safeParse({ code: "xa", label: "X", mode: "formula", value: 0, formula: "basic *" }).success).toBe(false);
    expect(extraComponentDefSchema.safeParse({ code: "xa", label: "X", mode: "formula", value: 0, formula: "basic * 0.1" }).success).toBe(true);
  });
});
