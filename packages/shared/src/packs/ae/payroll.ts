import type { PayLine } from "../../payroll";
import type { StatutoryContext, StatutoryResult } from "../types";
import { ADPF, GCC_OTHERS, GPSSA, type PensionRule } from "./rules";

/** Abu Dhabi employers' nationals go to ADPF; everywhere else in the UAE, GPSSA. */
export const pensionFor = (region: string | null | undefined): PensionRule => (/abu\s*dhabi/i.test(region ?? "") ? ADPF : GPSSA);

/**
 * UAE: no income tax on salaries. UAE nationals pay into the national pension scheme (GPSSA, or
 * ADPF for Abu Dhabi employers) on their contribution salary; expats pay nothing through payroll.
 * Other GCC nationals follow their home country's scheme, which is flagged for HR to set up.
 */
export function uaeStatutory(ctx: StatutoryContext): StatutoryResult {
  const { input, round: r } = ctx;
  const warnings: string[] = [];
  const nationality = input.profile?.nationality ?? null;
  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];

  if (!nationality) warnings.push("Nationality isn't set: if this person is a UAE national, pension contributions are missing");
  if (nationality === "AE") {
    const rule = pensionFor(input.profile?.region);
    // contribution salary: the full month's contracted pay, kept inside the scheme's limits,
    // then prorated for the days paid like the rest of the payslip
    const full = Math.min(rule.maxSalary, Math.max(rule.minSalary, input.structure.gross));
    const base = full * ctx.factor;
    deductions.push({ code: "pension", label: `${rule.name} (employee ${Math.round(rule.employeeRate * 1000) / 10}%)`, amount: r(base * rule.employeeRate) });
    employer.push({ code: "pension_er", label: `${rule.name} (employer ${Math.round(rule.employerRate * 1000) / 10}%)`, amount: r(base * rule.employerRate) });
    if (input.structure.gross > rule.maxSalary) warnings.push(`Contribution salary capped at AED ${rule.maxSalary.toLocaleString("en-US")}`);
  } else if (nationality && GCC_OTHERS.includes(nationality)) {
    warnings.push("GCC national: pension contributions follow their home country's scheme. Add them as a deduction until that scheme is supported");
  }

  return {
    deductions,
    employer,
    tds: 0,
    tax: { taxableIncome: 0, baseTax: 0, rebate: 0, surcharge: 0, cess: 0, total: 0, projectedAnnualGross: input.structure.gross * 12, monthsLeft: 12, annualised: true },
    warnings,
  };
}
