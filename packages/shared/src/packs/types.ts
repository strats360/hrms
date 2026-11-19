import type { CountryCode, CountryInfo } from "../countries";
import type { MonthlyComponents, PayLine, PayslipInput, PayslipResult, SalaryTemplate, StatutoryRules } from "../payroll";
import type { FnfInput, FnfResult } from "../fnf";

/**
 * A country pack: everything that differs by country, behind one object. The payroll engine and
 * the rest of the core only talk to this, never to a country's rules directly.
 * See docs/MULTI_COUNTRY.md. Parts are added here as the core moves away from India-only code.
 */
export interface CountryPack {
  code: CountryCode;
  info: CountryInfo;
  payroll: {
    /** Statutory deductions, employer contributions and income tax for one payslip. */
    statutory(ctx: StatutoryContext): StatutoryResult;
    /** Decimals payslip lines are rounded to: 0 for whole rupees, 3 for Kuwaiti fils. */
    roundingDecimals: number;
    /** Net pay in words on payslips, in the country's style. */
    amountInWords(n: number): string;
  };
  /** Final settlement when someone leaves: end of service pay, leave encashment, notice recovery. */
  settlement(input: FnfInput): FnfResult;
  /** Registration numbers the legal entity form asks for. */
  entityRegistrations: { key: string; label: string }[];
  /** Categories this pack reads from the statutory rule table. */
  ruleCategories: readonly string[];
}

/** What the engine has worked out before it asks the pack for statutory lines. */
export interface StatutoryContext {
  input: PayslipInput;
  template: SalaryTemplate;
  rules: StatutoryRules;
  /** Calendar month, 1 to 12. */
  month1: number;
  /** Paid days over days in the month, 0 to 1. */
  factor: number;
  components: MonthlyComponents;
  earnings: PayLine[];
  gross: number;
  basicEarned: number;
  /** Earnings this month that don't count as social insurance wages (e.g. annual bonus). */
  nonContributoryEarnings: number;
  /** Earnings this month that aren't taxable. */
  nonTaxableEarnings: number;
  /** A full month's non-taxable allowances, for projecting the year. */
  fullMonthNonTaxable: number;
  /** Rounds an amount the way this payslip does. */
  round: (n: number) => number;
}

export interface StatutoryResult {
  /** Employee deductions in payslip order, zero lines included (the engine drops them). */
  deductions: PayLine[];
  /** Employer contributions, zero lines included. */
  employer: PayLine[];
  /** Income tax withheld this month. */
  tds: number;
  tax: PayslipResult["tax"];
  warnings: string[];
}
