import { describe, expect, it } from "vitest";
import { componentsFromGross, componentsGross, computePayslip, DEFAULT_SALARY_TEMPLATE, structureFromComponents, structureFromCtc, templateFor, type TemplateBook } from "../src/payroll";

const field: TemplateBook = {
  ...DEFAULT_SALARY_TEMPLATE,
  extras: [
    { code: "telephone", label: "Telephone allowance", mode: "fixed", value: 1000, taxable: true, esiWage: true },
    { code: "meal", label: "Meal coupons", mode: "fixed", value: 2200, taxable: false, esiWage: false },
    { code: "lta", label: "Leave travel allowance", mode: "pct_basic", value: 10, taxable: true, esiWage: true },
  ],
};

describe("custom salary components", () => {
  it("takes the company's allowances out of gross before special allowance", () => {
    const c = componentsFromGross(60000, field);
    expect(c.basic).toBe(30000);
    expect(c.extras?.map((x) => [x.code, x.amount])).toEqual([["telephone", 1000], ["meal", 2200], ["lta", 3000]]);
    expect(componentsGross(c)).toBe(60000);
    expect(c.special).toBe(60000 - 30000 - 12000 - 1600 - 1250 - 6200);
  });

  it("never lets allowances push special allowance below zero", () => {
    const c = componentsFromGross(15000, { ...field, extras: [{ code: "big", label: "Big", mode: "fixed", value: 99999, taxable: true, esiWage: true }] });
    expect(c.special).toBe(0);
    expect(componentsGross(c)).toBe(15000);
  });

  it("keeps CTC adding up with extras", () => {
    const s = structureFromCtc(900000, field);
    expect(s.gross + s.employer.pf + s.employer.esi).toBe(s.monthlyCtc);
    expect(s.components.extras).toHaveLength(3);
  });

  it("prorates extras, and keeps non-taxable ones out of TDS and ESI", () => {
    const structure = structureFromComponents({ basic: 9000, hra: 3600, conveyance: 1600, medical: 0, special: 2000, extras: [{ code: "meal", label: "Meal coupons", amount: 2000, taxable: false, esiWage: false }] }, DEFAULT_SALARY_TEMPLATE, { esiApplicable: true });
    expect(structure.gross).toBe(18200);
    const slip = computePayslip({ month: "2026-10", structure, daysInMonth: 30, paidDays: 15, pfApplicable: true, esiApplicable: true, ptApplicable: false, state: "Gujarat", regime: "new" });
    const meal = slip.earnings.find((e) => e.code === "x_meal")!;
    expect(meal.amount).toBe(1000);
    expect(slip.nonTaxable).toBe(1000);
    const esi = slip.deductions.find((d) => d.code === "esi")!.amount;
    expect(esi).toBe(Math.ceil((slip.gross - 1000) * 0.0075));
    expect(slip.deductions.find((d) => d.code === "pf")!.amount).toBe(540); // 12% of the earned basic only
  });

  it("picks the employee's template, falling back to the default", () => {
    const book: TemplateBook = { ...DEFAULT_SALARY_TEMPLATE, templates: [{ ...DEFAULT_SALARY_TEMPLATE, id: "sales", name: "Sales", basicPctOfGross: 40 }] };
    expect(templateFor(book, "sales").basicPctOfGross).toBe(40);
    expect(templateFor(book, "gone").basicPctOfGross).toBe(50);
    expect(templateFor(book, null)).not.toHaveProperty("templates");
  });
});
