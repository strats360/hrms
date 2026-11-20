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
  /** "pending" until a local payroll expert signs off the golden cases; the app warns HR meanwhile. */
  review?: { status: "pending" | "signed_off"; note: string };
  /** The country's states or emirates, where they change the rules (PT in India, the pension fund in Abu Dhabi). */
  regions?: { label: string; list: string[] };
  payroll: {
    /** Statutory deductions, employer contributions and income tax for one payslip. */
    statutory(ctx: StatutoryContext): StatutoryResult;
    /** Names for the standard salary parts where the country uses other words (housing for HRA). */
    componentLabels?: Partial<Record<"basic" | "hra" | "conveyance" | "medical" | "special", string>>;
    /** How the country splits a salary, used in place of the company's Indian style template (the UK pays one salary line). */
    salaryTemplate?: SalaryTemplate;
    /** The month the tax year starts, for year to date figures: 4 (April) unless set; 1 for the US. */
    taxYearStartMonth?: number;
    /** Pay frequencies the country's rules are built for. Monthly only unless set. */
    payFrequencies?: readonly ("monthly" | "semi_monthly" | "biweekly" | "weekly")[];
    /** Decimals payslip lines are rounded to: 0 for whole rupees, 3 for Kuwaiti fils. */
    roundingDecimals: number;
    /** Net pay in words on payslips, in the country's style. */
    amountInWords(n: number): string;
  };
  /** Final settlement when someone leaves: end of service pay, leave encashment, notice recovery. */
  settlement(input: FnfInput): FnfResult;
  /** Public holidays with fixed dates, suggested for a new entity's calendar. Moving holidays (Eid, Diwali) are added by HR. */
  publicHolidays(year: number): { date: string; name: string; type: "national" }[];
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
  /** Paid days over days in the period, 0 to 1. */
  factor: number;
  /** Pay periods in a year: 12 for monthly, 24 semi-monthly, 26 biweekly, 52 weekly. */
  periodsPerYear: number;
  /** This period's position in the tax year, from 1. */
  periodIndex: number;
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
