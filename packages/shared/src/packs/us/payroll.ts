import type { PayLine } from "../../payroll";
import type { StatutoryContext, StatutoryResult } from "../types";
import { usPayrollProfileSchema, type UsPayrollProfile } from "./profile";
import { BRACKETS, FICA, FUTA, NO_WAGE_TAX_STATES, STANDARD_DEDUCTION, stateCode, TAX_YEAR, US_STATES } from "./rules";

const cents = (n: number) => Math.round(n * 100) / 100;
const PERIODS = 12;

/**
 * Federal income tax to withhold from one monthly paycheck, the Publication 15-T percentage
 * method for a 2020 or later W-4: annualise the pay, add other income and take off deductions
 * and the standard deduction, apply the brackets, take off credits, and spread it over the year.
 * With Step 2 checked, the standard deduction and brackets are halved.
 */
export function federalWithholding(wages: number, w4: UsPayrollProfile) {
  if (w4.exempt) return 0;
  const half = w4.multipleJobs ? 0.5 : 1;
  const annual = wages * PERIODS + w4.otherIncome - w4.deductions - STANDARD_DEDUCTION[w4.filingStatus] * half;
  let tax = 0;
  let lower = 0;
  for (const b of BRACKETS[w4.filingStatus]) {
    const upper = b.upTo * half;
    if (annual > lower) tax += (Math.min(annual, upper) - lower) * b.rate;
    lower = upper;
  }
  const yearly = Math.max(0, tax - w4.dependents);
  return cents(yearly / PERIODS + w4.extraWithholding);
}

/**
 * US: federal income tax withholding, Social Security and Medicare (FICA), federal unemployment
 * (FUTA) from the employer, and pre-tax 401(k) and health deductions. State income tax is only
 * worked out for states with none; for the rest, use the payroll partner.
 */
export function usStatutory(ctx: StatutoryContext): StatutoryResult {
  const { input } = ctx;
  const warnings: string[] = [];
  const parsed = usPayrollProfileSchema.safeParse(input.countryProfile ?? {});
  if (!parsed.success) warnings.push(`W-4 details aren't valid (${parsed.error.issues[0]?.message}): withholding as single with no adjustments`);
  const w4 = parsed.success ? parsed.data : usPayrollProfileSchema.parse({});
  if (!input.countryProfile?.filingStatus) warnings.push("No W-4 on file: withholding as single with no adjustments, as the IRS requires");
  if (Number(input.month.slice(0, 4)) !== TAX_YEAR) warnings.push(`These rates are for ${TAX_YEAR}, not ${input.month.slice(0, 4)}`);

  const gross = ctx.gross;
  const k401 = cents((gross * w4.k401Percent) / 100);
  const health = Math.min(gross, w4.preTaxHealth * ctx.factor);
  // 401(k) comes off income tax wages only; Section 125 health comes off FICA wages too
  const fitWages = Math.max(0, gross - ctx.nonTaxableEarnings - k401 - health);
  const ficaWages = Math.max(0, gross - health);
  const ytd = input.ytd?.taxableGross ?? 0;

  const fit = federalWithholding(fitWages, w4);
  const ssRoom = Math.max(0, FICA.socialSecurityWageBase - ytd);
  const ssWages = Math.min(ficaWages, ssRoom);
  if (ficaWages > ssRoom) warnings.push(`Social Security wage base of $${FICA.socialSecurityWageBase.toLocaleString("en-US")} reached this year`);
  const ss = cents(ssWages * FICA.socialSecurityRate);
  const medicare = cents(ficaWages * FICA.medicareRate);
  const overThreshold = Math.max(0, ytd + ficaWages - FICA.additionalMedicareThreshold) - Math.max(0, ytd - FICA.additionalMedicareThreshold);
  const addlMedicare = cents(overThreshold * FICA.additionalMedicareRate);
  const futa = cents(Math.min(ficaWages, Math.max(0, FUTA.wageBase - ytd)) * FUTA.rate);

  const deductions: PayLine[] = [
    { code: "k401", label: `401(k) (${w4.k401Percent}%, pre-tax)`, amount: k401 },
    { code: "health", label: "Health insurance (pre-tax)", amount: cents(health) },
    { code: "fit", label: "Federal income tax", amount: fit },
    { code: "ss", label: "Social Security (6.2%)", amount: ss },
    { code: "medicare", label: "Medicare (1.45%)", amount: medicare },
    { code: "medicare_addl", label: "Additional Medicare (0.9%)", amount: addlMedicare },
  ];
  const employer: PayLine[] = [
    { code: "ss_er", label: "Social Security (employer 6.2%)", amount: ss },
    { code: "medicare_er", label: "Medicare (employer 1.45%)", amount: medicare },
    { code: "futa_er", label: "Federal unemployment (FUTA 0.6%)", amount: futa },
  ];

  const state = stateCode(input.state);
  if (!state) warnings.push("No work state set: state income tax and unemployment aren't worked out");
  else if (!NO_WAGE_TAX_STATES.includes(state)) warnings.push(`${US_STATES[state]} income tax isn't worked out here yet: get it from your payroll partner and add it as a deduction`);
  if (state) warnings.push(`${US_STATES[state]} unemployment insurance (SUI) is paid at your own employer rate: your payroll partner files it`);
  if (w4.exempt) warnings.push("Exempt from federal income tax withholding: the exemption expires each February unless they file a new W-4");

  return {
    deductions,
    employer,
    tds: fit,
    tax: { taxableIncome: fitWages * PERIODS, baseTax: fit * PERIODS, rebate: 0, surcharge: 0, cess: 0, total: fit * PERIODS, projectedAnnualGross: input.structure.gross * PERIODS, monthsLeft: 12 - Number(input.month.slice(5, 7)), annualised: true },
    warnings,
  };
}
