import { fyOfMonth, labourWelfareFund, professionalTax, remainingFyMonths, type PayLine } from "../../payroll";
import { computeTaxStatement } from "../../tax";
import type { StatutoryContext, StatutoryResult } from "../types";

/**
 * India: EPF (with EPS, EDLI and admin charges), ESI, Professional Tax, Labour Welfare Fund and
 * TDS under section 192, projected over the financial year.
 * Moved here unchanged from the payroll engine; the payroll tests pin the figures.
 */
export function indiaStatutory(ctx: StatutoryContext): StatutoryResult {
  const { input, template: t, rules: R, month1, gross, basicEarned, round: r } = ctx;
  const warnings: string[] = [];

  // PF
  const pfWage = input.pfApplicable ? (t.pfOnFullBasic ? basicEarned : Math.min(basicEarned, R.pf.wageCeiling)) : 0;
  const pfCappedWage = Math.min(pfWage, R.pf.wageCeiling);
  const employeePf = r(pfWage * R.pf.employeeRate);
  const employerPfTotal = r(pfWage * R.pf.employerRate);
  const eps = Math.min(employerPfTotal, r(pfCappedWage * R.pf.epsRate));
  const epfEr = employerPfTotal - eps;
  const edli = r(pfCappedWage * R.pf.edliRate);
  const pfAdmin = r(pfWage * R.pf.adminRate);

  // ESI: eligibility is decided on the full-month structure gross
  const esiOn = input.esiApplicable && input.structure.gross <= R.esi.grossThreshold;
  const esiWage = gross - ctx.nonContributoryEarnings;
  const employeeEsi = esiOn ? Math.ceil(esiWage * R.esi.employeeRate) : 0;
  const employerEsi = esiOn ? Math.ceil(esiWage * R.esi.employerRate) : 0;

  // PT and LWF
  let pt = 0;
  if (input.ptApplicable) {
    const p = professionalTax(input.state, gross, month1, input.gender, R);
    pt = p.amount;
    if (!p.configured) warnings.push(`Professional Tax rules for ${input.state ?? "this branch"} aren't configured`);
  }
  const lwf = labourWelfareFund(input.state, gross, month1, R);

  // TDS: project the year, then spread what's left over the remaining months
  const monthsLeft = remainingFyMonths(input.month);
  const ytd = input.ytd ?? { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 };
  const fullMonthGross = input.structure.gross - ctx.fullMonthNonTaxable;
  const fullMonthPf = input.pfApplicable ? r(Math.min(input.structure.components.basic, t.pfOnFullBasic ? Infinity : R.pf.wageCeiling) * R.pf.employeeRate) : 0;
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
    employeePf: annualised ? fullMonthPf * 11 + employeePf : ytd.employeePf + employeePf + fullMonthPf * (monthsLeft - 1),
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
    { code: "lwf_er", label: "LWF (employer)", amount: lwf.employer },
  ];
  return { deductions, employer, tds, tax: { ...tax, projectedAnnualGross, monthsLeft, annualised }, warnings };
}
