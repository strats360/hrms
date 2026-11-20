import type { PayLine } from "../../payroll";
import type { StatutoryContext, StatutoryResult } from "../types";
import { ukPayrollProfileSchema } from "./profile";
import { NI, NI_CATEGORIES, PENSION, STUDENT_LOANS, TAX_YEAR } from "./rules";
import { parseTaxCode, payeThisMonth } from "./tax";

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
const pence = (n: number) => Math.round(n * 100) / 100;

/** The tax month of a pay month: April is month 1, March month 12. */
export const taxMonthOf = (month: string) => ((Number(month.slice(5, 7)) + 8) % 12) + 1;
/** The tax year a pay month falls in, as 2026-27. */
export function taxYearOf(month: string) {
  const y = Number(month.slice(0, 4));
  const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Employee and employer Class 1 NI for one month's NIable pay. */
export function classOneNi(pay: number, category: keyof typeof NI_CATEGORIES) {
  if (category === "X") return { employee: 0, employer: 0 };
  const main = Math.max(0, Math.min(pay, NI.upperEarningsLimit) - NI.primaryThreshold);
  const upper = Math.max(0, pay - NI.upperEarningsLimit);
  const employee = category === "C" ? 0 : main * NI.employeeMain + upper * NI.employeeUpper;
  // under 21s and apprentices under 25: no employer NI up to the upper secondary threshold
  const relieved = category === "M" || category === "H";
  const er = relieved ? Math.max(0, pay - NI.upperSecondaryThreshold) : Math.max(0, pay - NI.secondaryThreshold);
  return { employee: pence(employee), employer: pence(er * NI.employer) };
}

/**
 * UK: PAYE income tax from the tax code (cumulative unless the code is month 1), Class 1
 * National Insurance by category letter, student and postgraduate loans, and workplace pension
 * auto enrolment on qualifying earnings.
 */
export function ukStatutory(ctx: StatutoryContext): StatutoryResult {
  const { input } = ctx;
  const warnings: string[] = [];
  const parsed = ukPayrollProfileSchema.safeParse(input.countryProfile ?? {});
  if (!parsed.success) warnings.push(`UK payroll details aren't valid (${parsed.error.issues[0]?.message}): using tax code 1257L and NI category A`);
  const p = parsed.success ? parsed.data : ukPayrollProfileSchema.parse({});
  if (!input.countryProfile?.taxCode) warnings.push("No tax code on file: using 1257L. Use the code from their P45 or HMRC, or 1257L M1 if they have neither");
  if (taxYearOf(input.month) !== TAX_YEAR) warnings.push(`These rates are for the ${TAX_YEAR} tax year, not ${taxYearOf(input.month)}`);

  const gross = ctx.gross;
  const taxablePay = gross - ctx.nonTaxableEarnings;
  const code = parseTaxCode(p.taxCode);
  const taxMonth = taxMonthOf(input.month);
  // pay and tax to date: earlier months on this system plus any earlier job this tax year (P45)
  const p45 = p.p45 && p.p45.taxYear === taxYearOf(input.month) ? p.p45 : null;
  const before = { pay: (input.ytd?.taxableGross ?? 0) + (p45?.pay ?? 0), tax: (input.ytd?.tds ?? 0) + (p45?.tax ?? 0) };
  if (!input.ytd && taxMonth > 1 && code.cumulative) warnings.push("No earlier months this tax year on Saralix: tax assumes nothing was paid before. Add their P45 figures if they changed jobs");
  const paye = payeThisMonth({ code, taxMonth, payThisMonth: taxablePay, payToDateBefore: before.pay, taxToDateBefore: before.tax });
  if (paye.tax < 0) warnings.push("Tax refund this month");

  const ni = classOneNi(gross, p.niCategory);

  const deductions: PayLine[] = [
    { code: "paye", label: `Income tax (${code.raw})`, amount: paye.tax },
    { code: "ni", label: `National Insurance (${p.niCategory})`, amount: ni.employee },
  ];
  const employer: PayLine[] = [{ code: "ni_er", label: `Employer NI (${pct(NI.employer)})`, amount: ni.employer }];

  // student loans: each plan on the whole pay above its threshold, in whole pounds
  for (const plan of p.studentLoans) {
    const l = STUDENT_LOANS[plan];
    deductions.push({ code: `sl_${plan}`, label: `Student loan (${l.label})`, amount: Math.floor(Math.max(0, gross - l.threshold / 12) * l.rate) });
  }
  if (p.studentLoans.length > 1) warnings.push("More than one student loan plan: HMRC collects only the one with the lowest threshold. Check their SL1 notice");
  if (p.postgraduateLoan) {
    const l = STUDENT_LOANS.postgrad;
    deductions.push({ code: "pgl", label: l.label, amount: Math.floor(Math.max(0, gross - l.threshold / 12) * l.rate) });
  }

  // auto enrolment: over the trigger, unless they opted out
  if (!p.pensionOptOut && gross > PENSION.trigger) {
    const qualifying = Math.max(0, Math.min(gross, PENSION.upperQualifying) - PENSION.lowerQualifying);
    deductions.push({ code: "pension", label: `Pension (${pct(PENSION.employeeRate)}, 1% from tax relief)`, amount: pence(qualifying * PENSION.employeeNetRate) });
    employer.push({ code: "pension_er", label: `Employer pension (${pct(PENSION.employerRate)})`, amount: pence(qualifying * PENSION.employerRate) });
  } else if (p.pensionOptOut) warnings.push("Opted out of the workplace pension: re-enrol them every three years");

  return {
    deductions,
    employer,
    tds: paye.tax,
    tax: { taxableIncome: paye.taxablePayToDate, baseTax: paye.taxDueToDate, rebate: 0, surcharge: 0, cess: 0, total: paye.taxDueToDate, projectedAnnualGross: input.structure.gross * 12, monthsLeft: 12 - taxMonth, annualised: false },
    warnings,
  };
}
