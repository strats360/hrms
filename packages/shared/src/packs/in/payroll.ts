import { codeWages, fyOfMonth, labourWelfareFund, professionalTax, remainingFyMonths, type PayLine } from "../../payroll";
import { carPerquisite, computeTaxStatement } from "../../tax";
import type { StatutoryContext, StatutoryResult } from "../types";

/**
 * India: EPF (with EPS, EDLI and admin charges), ESI, Professional Tax, Labour Welfare Fund and
 * TDS on salary (section 392 of the Income Tax Act 2025, section 192 before), projected over the year.
 * PF and ESI eligibility are on Code wages: basic plus wage allowances, at least half the gross.
 */
export function indiaStatutory(ctx: StatutoryContext): StatutoryResult {
  if (ctx.input.offCycle) return offCycle(ctx);
  const { input, template: t, rules: R, month1, gross, basicEarned, round: r } = ctx;
  const warnings: string[] = [];

  // Code wages for the full month and for the days paid
  const wagesFull = codeWages(input.structure.components);
  const wagesEarned = r(wagesFull * ctx.factor);
  void basicEarned;

  // PF
  const pfWage = input.pfApplicable ? (t.pfOnFullBasic ? wagesEarned : Math.min(wagesEarned, R.pf.wageCeiling)) : 0;
  const pfCappedWage = Math.min(pfWage, R.pf.wageCeiling);
  const employeePf = r(pfWage * R.pf.employeeRate);
  const employerPfTotal = r(pfWage * R.pf.employerRate);
  const eps = Math.min(employerPfTotal, r(pfCappedWage * R.pf.epsRate));
  const epfEr = employerPfTotal - eps;
  const edli = r(pfCappedWage * R.pf.edliRate);
  const pfAdmin = r(pfWage * R.pf.adminRate);

  // ESI: eligibility on the full month's Code wages; ₹25,000 for persons with disability. Once
  // covered in a contribution period (April to September, October to March), it continues to the end.
  const disabled = !!(input.countryProfile as { disability?: boolean } | null | undefined)?.disability;
  const esiLimit = disabled ? (R.esi.disabledThreshold ?? 25000) : R.esi.grossThreshold;
  const withinLimit = wagesFull <= esiLimit;
  const esiOn = input.esiApplicable && (withinLimit || !!input.esiContinue);
  if (input.esiApplicable && !withinLimit && input.esiContinue) warnings.push("Wages are over the ESI limit, but ESI continues until the contribution period ends");
  const esiWage = gross - ctx.nonContributoryEarnings;
  const employeeEsi = esiOn ? Math.ceil(esiWage * R.esi.employeeRate) : 0;
  const employerEsi = esiOn ? Math.ceil(esiWage * R.esi.employerRate) : 0;

  // voluntary PF, employer NPS and the car perquisite, from the employee's India profile
  const prof = (input.countryProfile ?? {}) as { vpfPercent?: number; npsEmployerPercent?: number; car?: "none" | "small" | "large"; driver?: boolean };
  const vpf = input.pfApplicable && prof.vpfPercent ? r((wagesEarned * prof.vpfPercent) / 100) : 0;
  const nps = prof.npsEmployerPercent ? r((wagesEarned * prof.npsEmployerPercent) / 100) : 0;
  const npsFull = prof.npsEmployerPercent ? r((wagesFull * prof.npsEmployerPercent) / 100) : 0;
  const perqMonth = carPerquisite(fyOfMonth(input.month), prof.car ?? "none", !!prof.driver);

  // PT and LWF
  let pt = 0;
  if (input.ptApplicable) {
    const p = professionalTax(input.state, gross, month1, input.gender, R, { disabled });
    pt = p.amount;
    if (!p.configured) warnings.push(`Professional Tax rules for ${input.state ?? "this branch"} aren't configured`);
  }
  const lwf = labourWelfareFund(input.state, gross, month1, R);

  // TDS: project the year, then spread what's left over the remaining months
  const monthsLeft = remainingFyMonths(input.month);
  const ytd = input.ytd ?? { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 };
  const fullMonthGross = input.structure.gross - ctx.fullMonthNonTaxable;
  const fullMonthPf = input.pfApplicable ? r(Math.min(wagesFull, t.pfOnFullBasic ? Infinity : R.pf.wageCeiling) * R.pf.employeeRate) : 0;
  const fullMonthPt = input.ptApplicable ? professionalTax(input.state, input.structure.gross, 1, input.gender, R).amount : 0;
  const annualised = input.ytd === undefined;
  const pastMonths = 12 - monthsLeft;
  const projectedAnnualGross = annualised
    ? fullMonthGross * 12 + (gross - ctx.nonTaxableEarnings - fullMonthGross)
    : ytd.taxableGross + (gross - ctx.nonTaxableEarnings) + fullMonthGross * (monthsLeft - 1);
  // Basic and HRA for the year, in proportion to the structure (used for the HRA exemption)
  const sg = input.structure.gross || 1;
  const statement = computeTaxStatement({
    regime: input.regime,
    financialYear: fyOfMonth(input.month),
    salary: {
      gross: projectedAnnualGross,
      basic: (projectedAnnualGross * input.structure.components.basic) / sg,
      hra: (projectedAnnualGross * input.structure.components.hra) / sg,
    },
    employeePf: (annualised ? fullMonthPf * 11 + employeePf : ytd.employeePf + employeePf + fullMonthPf * (monthsLeft - 1)) + vpf * 12,
    employerNps: npsFull * 12,
    npsWages: wagesFull * 12,
    // past months' perquisites are already in the year to date taxable salary
    perquisites: perqMonth * (annualised ? 12 : monthsLeft),
    professionalTax: annualised ? fullMonthPt * 11 + pt : ytd.professionalTax + pt + fullMonthPt * (monthsLeft - 1),
    declaration: input.taxProfile?.declaration,
    verified: input.taxProfile?.verified,
    rules: R,
  });
  const tax = statement.tax;
  const alreadyDeducted = statement.previousEmployerTds;
  const tds = annualised
    ? Math.max(0, Math.round((tax.total - alreadyDeducted) / 12))
    : Math.max(0, Math.round((tax.total - alreadyDeducted - ytd.tds) / monthsLeft));
  if (annualised && pastMonths > 0 && tds > 0) warnings.push("TDS assumes earlier months of this financial year were paid at the same rate. Add opening balances for exact figures.");

  const deductions: PayLine[] = [
    { code: "pf", label: "Provident fund (employee)", amount: employeePf },
    { code: "vpf", label: `Voluntary PF (${prof.vpfPercent ?? 0}%)`, amount: vpf },
    { code: "esi", label: "ESI (employee)", amount: employeeEsi },
    { code: "pt", label: "Professional tax", amount: pt },
    { code: "lwf", label: "Labour welfare fund", amount: lwf.employee },
    { code: "tds", label: "Income tax (TDS)", amount: tds },
  ];
  const employer: PayLine[] = [
    { code: "epf_er", label: "EPF (employer)", amount: epfEr },
    { code: "eps", label: "EPS (pension)", amount: eps },
    { code: "edli", label: "EDLI", amount: edli },
    { code: "pf_admin", label: "PF admin charges", amount: pfAdmin },
    { code: "esi_er", label: "ESI (employer)", amount: employerEsi },
    { code: "nps_er", label: `NPS (employer ${prof.npsEmployerPercent ?? 0}%)`, amount: nps },
    { code: "lwf_er", label: "LWF (employer)", amount: lwf.employer },
  ];
  if (perqMonth) warnings.push(`Car perquisite of ${perqMonth.toLocaleString("en-IN")} a month is taxed through TDS`);
  return { deductions, employer, tds, tax: { ...tax, projectedAnnualGross, monthsLeft, annualised }, warnings, wages: wagesEarned, perquisites: perqMonth };
}

/**
 * An off-cycle payment (bonus, arrears, incentive): no PF, ESI, PT or LWF, as one-off pay isn't
 * Code wages. TDS is the extra tax it adds to the year: tax on the year's salary plus this
 * payment, less tax on the salary alone.
 */
function offCycle(ctx: StatutoryContext): StatutoryResult {
  const { input, rules: R } = ctx;
  const taxable = ctx.gross - ctx.nonTaxableEarnings;
  const year = (input.ytd?.taxableGross ?? 0) + input.structure.gross * remainingFyMonths(input.month);
  const sg = input.structure.gross || 1;
  const statement = (extra: number) =>
    computeTaxStatement({
      regime: input.regime,
      financialYear: fyOfMonth(input.month),
      salary: { gross: year + extra, basic: (year * input.structure.components.basic) / sg, hra: (year * input.structure.components.hra) / sg },
      employeePf: 0,
      professionalTax: 0,
      declaration: input.taxProfile?.declaration,
      verified: input.taxProfile?.verified,
      rules: R,
    });
  const base = statement(0);
  const withExtra = statement(taxable);
  const tds = Math.max(0, Math.round(withExtra.tax.total - base.tax.total));
  return {
    deductions: [{ code: "tds", label: "Income tax (TDS)", amount: tds }],
    employer: [],
    tds,
    tax: { ...withExtra.tax, projectedAnnualGross: year + taxable, monthsLeft: remainingFyMonths(input.month), annualised: false },
    warnings: taxable > 0 ? [] : ["Nothing taxable in this payment"],
  };
}
