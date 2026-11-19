/**
 * Golden payroll cases: real payslip examples per country pack, with every figure written out.
 * CI recomputes them on every change and fails on any difference, so a fix for one country
 * can't quietly change another country's pay. See docs/MULTI_COUNTRY.md.
 *
 * Each file golden/<COUNTRY>.json has a sign off block. A local payroll expert checks the cases
 * by hand and fills it in. When the law changes, regenerate with `pnpm --filter @hrms/shared golden`,
 * review the differences, and get the new figures signed off again.
 */
import { computePayslip, structureFromCtc, type Adjustment, type PayslipInput, type PayslipResult, type Regime } from "../src";
import type { CountryCode } from "../src/countries";
import type { TaxDeclarationData } from "../src/tax";

export interface GoldenCase {
  name: string;
  /** What the case is there to prove. */
  why: string;
  input: {
    annualCtc: number;
    month: string;
    daysInMonth: number;
    paidDays: number;
    state: string | null;
    gender?: string | null;
    regime: Regime;
    pfApplicable: boolean;
    esiApplicable: boolean;
    ptApplicable: boolean;
    ytd?: PayslipInput["ytd"];
    adjustments?: Adjustment[];
    declaration?: TaxDeclarationData;
  };
  expect?: Figures;
}

export interface GoldenFile {
  country: CountryCode;
  signedOff: { by: string | null; on: string | null; note: string };
  cases: GoldenCase[];
}

/** Every amount on the payslip, keyed so a difference names the line: earn.basic, ded.pf, emp.epf_er. */
export interface Figures {
  gross: number;
  totalDeductions: number;
  net: number;
  tds: number;
  employerCost: number;
  lines: Record<string, number>;
}

export function run(country: CountryCode, c: GoldenCase): PayslipResult {
  const i = c.input;
  return computePayslip({
    country,
    month: i.month,
    structure: structureFromCtc(i.annualCtc, undefined, { pfApplicable: i.pfApplicable, esiApplicable: i.esiApplicable }),
    daysInMonth: i.daysInMonth,
    paidDays: i.paidDays,
    state: i.state,
    gender: i.gender ?? null,
    regime: i.regime,
    pfApplicable: i.pfApplicable,
    esiApplicable: i.esiApplicable,
    ptApplicable: i.ptApplicable,
    ytd: i.ytd,
    adjustments: i.adjustments,
    taxProfile: i.declaration ? { declaration: i.declaration } : undefined,
  });
}

export function figures(r: PayslipResult): Figures {
  const lines: Record<string, number> = {};
  for (const e of r.earnings) lines[`earn.${e.code}`] = e.amount;
  for (const d of r.deductions) lines[`ded.${d.code}`] = d.amount;
  for (const e of r.employer) lines[`emp.${e.code}`] = e.amount;
  return { gross: r.gross, totalDeductions: r.totalDeductions, net: r.net, tds: r.tds, employerCost: r.employerCost, lines };
}
