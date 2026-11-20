import type { PayLine } from "../../payroll";
import type { StatutoryContext, StatutoryResult } from "../types";
import { ANNUITY_EXISTING, ANNUITY_NEW_STEPS, GCC_OTHERS, GOSI_NEW_LAW_FROM, GOSI_WAGE, HAZARDS, SANED } from "./rules";

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** The annuity rate for a Saudi in a given month (YYYY-MM), by when they were first insured. */
export function annuityRate(month: string, insuredSince: string | null | undefined): number {
  if (!insuredSince || insuredSince < GOSI_NEW_LAW_FROM) return ANNUITY_EXISTING;
  const on = `${month}-01`;
  let rate = ANNUITY_NEW_STEPS[0]!.rate;
  for (const s of ANNUITY_NEW_STEPS) if (s.from <= on) rate = s.rate;
  return rate;
}

/**
 * Saudi Arabia: no income tax on salaries. GOSI on the contribution wage (basic plus housing,
 * between SAR 1,500 and 45,000): Saudis pay annuities and SANED, and the employer matches them;
 * the employer also pays 2% occupational hazards for everyone. Other GCC nationals follow their
 * home scheme, which is flagged for HR.
 */
export function saudiStatutory(ctx: StatutoryContext): StatutoryResult {
  const { input, round: r } = ctx;
  const warnings: string[] = [];
  const nationality = input.profile?.nationality ?? null;
  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];

  const c = input.structure.components;
  const wage = (c.basic ?? 0) + (c.hra ?? 0);
  const full = Math.min(GOSI_WAGE.max, Math.max(GOSI_WAGE.min, wage));
  const base = full * ctx.factor;
  if (wage > GOSI_WAGE.max) warnings.push(`GOSI wage capped at SAR ${GOSI_WAGE.max.toLocaleString("en-US")}`);

  if (!nationality) warnings.push("Nationality isn't set: if this person is Saudi, GOSI annuities and SANED are missing");
  if (nationality === "SA") {
    const insuredSince = input.profile?.insuredSince ?? null;
    const rate = annuityRate(input.month, insuredSince);
    if (!insuredSince) warnings.push("GOSI start date isn't set (IDs & visas › GOSI number): using the rate for people insured before 3 July 2024");
    deductions.push({ code: "gosi", label: `GOSI annuities (${pct(rate)})`, amount: r(base * rate) });
    deductions.push({ code: "saned", label: `SANED (${pct(SANED)})`, amount: r(base * SANED) });
    employer.push({ code: "gosi_er", label: `GOSI annuities (employer ${pct(rate)})`, amount: r(base * rate) });
    employer.push({ code: "saned_er", label: `SANED (employer ${pct(SANED)})`, amount: r(base * SANED) });
  } else if (nationality && GCC_OTHERS.includes(nationality)) {
    warnings.push("GCC national: pension contributions follow their home country's scheme. Add them as a deduction until that scheme is supported");
  }
  employer.push({ code: "hazards_er", label: `GOSI occupational hazards (${pct(HAZARDS)})`, amount: r(base * HAZARDS) });

  return {
    deductions,
    employer,
    tds: 0,
    tax: { taxableIncome: 0, baseTax: 0, rebate: 0, surcharge: 0, cess: 0, total: 0, projectedAnnualGross: input.structure.gross * 12, monthsLeft: 12, annualised: true },
    warnings,
  };
}
