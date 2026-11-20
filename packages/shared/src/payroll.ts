import type { TaxDeclarationData, Verified } from "./tax";
import type { CountryCode } from "./countries";
import { packFor } from "./packs";
import { roundMoney } from "./format";

/**
 * Payroll engine: pure functions shared by the API (and previews in the web app).
 *
 * All money is in whole rupees. Component amounts are rounded to the nearest rupee
 * after proration; ESI rounds up to the next rupee as the ESIC rules require.
 *
 * IMPORTANT: statutory rates, PT/LWF tables and income-tax slabs below are data.
 * They must be reviewed by a payroll consultant/CA before go-live and whenever the
 * law changes (Budget, state notifications). Tenants will be able to override them
 * from the statutory master.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SalaryTemplate {
  /** Basic as % of monthly gross. */
  basicPctOfGross: number;
  /** HRA as % of basic (50 for metro cities, 40 otherwise). */
  hraPctOfBasic: number;
  /** Fixed monthly conveyance allowance. */
  conveyance: number;
  /** Fixed monthly medical allowance. */
  medical: number;
  /** Employer PF on actual basic instead of the ₹15,000 ceiling. */
  pfOnFullBasic: boolean;
  /** The company's own allowances (telephone, LTA, shift, food...), taken out of gross before special allowance. */
  extras?: ExtraComponentDef[];
}

/** A custom allowance in a template: a fixed monthly amount or a % of basic. */
export interface ExtraComponentDef {
  code: string;
  label: string;
  mode: "fixed" | "pct_basic";
  value: number;
  /** Counts as taxable salary (most allowances are; e.g. meal coupons within limits aren't). */
  taxable: boolean;
  /** Counts as ESI wages. */
  esiWage: boolean;
  /** Counts as "wages" under the Labour Codes, like dearness or retaining allowance (most allowances don't). */
  wages?: boolean;
}

/** One custom allowance on a structure. PF is on Code wages (basic plus allowances marked as wages, at least half the gross). */
export interface ExtraComponent {
  code: string;
  label: string;
  amount: number;
  taxable?: boolean;
  esiWage?: boolean;
  /** Counts as Code wages (dearness or retaining allowance). */
  wages?: boolean;
}

/** A named template (e.g. "Sales field staff", "Grade M2"). The company's default has no id. */
export type NamedTemplate = SalaryTemplate & { id: string; name: string };
/** The default template, carrying the company's other templates so each employee gets theirs. */
export type TemplateBook = SalaryTemplate & { templates?: NamedTemplate[] };

/** The template an employee is on: their own if assigned and still there, else the default. */
export function templateFor(book: TemplateBook, templateId?: string | null): SalaryTemplate {
  const own = templateId ? book.templates?.find((t) => t.id === templateId) : undefined;
  if (own) return own;
  const { templates: _t, ...base } = book;
  return base;
}

export const DEFAULT_SALARY_TEMPLATE: SalaryTemplate = {
  basicPctOfGross: 50,
  hraPctOfBasic: 40,
  conveyance: 1600,
  medical: 1250,
  pfOnFullBasic: false,
};

export const STATUTORY = {
  // EPF wage ceiling ₹25,000 from 17 Sep 2026 (S.O. 5109(E)); it was ₹15,000 from 1 Sep 2014
  pf: { employeeRate: 0.12, employerRate: 0.12, epsRate: 0.0833, edliRate: 0.005, adminRate: 0.005, wageCeiling: 25000 },
  // ESI: ₹21,000 a month, ₹25,000 for persons with disability
  esi: { employeeRate: 0.0075, employerRate: 0.0325, grossThreshold: 21000, disabledThreshold: 25000 },
} as const;

/**
 * Professional Tax by state. [upTo, amount] slabs, Infinity for the last. Most states charge
 * monthly on the month's gross. Half-yearly and yearly states set `basis`: their slabs are on the
 * period's income, deducted in `months`. The yearly cap is ₹2,500 everywhere.
 */
export interface PtRule {
  slabs: [number, number][];
  /** Slabs for women where the state gives a different exemption. */
  femaleSlabs?: [number, number][];
  /** Amount charged in February instead of the top slab (annual top-up). */
  februaryTop?: number;
  /** How the slabs read: on monthly gross (default), half-yearly or yearly income. */
  basis?: "monthly" | "half_yearly" | "yearly";
  /** Months (1 to 12) a half-yearly or yearly amount is deducted in. */
  months?: number[];
  /** Exempt from this age (senior citizens). */
  seniorAge?: number;
}
/** Who's exempt from PT: persons with disability (most states), and seniors where the state says so. */
export interface PtPerson {
  disabled?: boolean;
  age?: number | null;
}
export const PT_RULES: Record<string, PtRule> = {
  // FY 2026-27, from the India HR compliance report (Treelife). Confirm the starred states:
  // Jharkhand, Manipur, Mizoram, Nagaland, Tripura and Assam, where published summaries differ.
  Gujarat: { slabs: [[11999, 0], [Infinity, 200]] },
  Maharashtra: {
    slabs: [[7500, 0], [10000, 175], [Infinity, 200]],
    femaleSlabs: [[25000, 0], [Infinity, 200]],
    februaryTop: 300,
  },
  Karnataka: { slabs: [[24999, 0], [Infinity, 200]], februaryTop: 300 },
  "West Bengal": { slabs: [[10000, 0], [15000, 110], [25000, 130], [40000, 150], [Infinity, 200]] },
  Telangana: { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  "Andhra Pradesh": { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  "Madhya Pradesh": { slabs: [[18750, 0], [25000, 125], [33333, 167], [Infinity, 208]], februaryTop: 212 },
  Assam: { slabs: [[10000, 0], [15000, 150], [Infinity, 208]] },
  Punjab: { slabs: [[24999, 0], [Infinity, 200]] },
  Sikkim: { slabs: [[20000, 0], [30000, 125], [40000, 150], [Infinity, 200]] },
  Tripura: { slabs: [[7500, 0], [15000, 100], [Infinity, 200]] },
  Mizoram: { slabs: [[5000, 0], [Infinity, 208]] },
  Nagaland: { slabs: [[5000, 0], [Infinity, 208]] },
  // half-yearly on the half year's income, deducted in the month it's due
  Kerala: { basis: "half_yearly", months: [8, 2], slabs: [[11999, 0], [17999, 120], [29999, 180], [44999, 300], [59999, 450], [74999, 600], [99999, 750], [124999, 1000], [Infinity, 1250]] },
  "Tamil Nadu": { basis: "half_yearly", months: [9, 3], slabs: [[21000, 0], [30000, 135], [45000, 315], [60000, 690], [75000, 1025], [Infinity, 1250]] },
  // yearly on the year's income
  Bihar: { basis: "yearly", months: [11], slabs: [[300000, 0], [500000, 1000], [1000000, 2000], [Infinity, 2500]] },
  Jharkhand: { basis: "yearly", months: [10], slabs: [[300000, 0], [500000, 1200], [800000, 1800], [1000000, 2100], [Infinity, 2500]] },
  Manipur: { basis: "yearly", months: [3], slabs: [[50000, 0], [75000, 1200], [100000, 2000], [Infinity, 2500]] },
};
/** States/UTs that do not levy Professional Tax (no warning raised). */
export const NO_PT_STATES = new Set([
  // Odisha abolished PT from 1 April 2026
  "Odisha", "Arunachal Pradesh", "Chhattisgarh",
  "Delhi", "Uttar Pradesh", "Haryana", "Rajasthan", "Himachal Pradesh", "Uttarakhand", "Goa", "Chandigarh",
  "Jammu and Kashmir", "Ladakh", "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep",
]);

/** Labour Welfare Fund: deducted only in the listed months (1-12). */
export interface LwfRule {
  months: number[];
  employee: number;
  employer: number;
  /** Only deducted when monthly gross exceeds this. */
  minGross?: number;
  /** Not deducted above this monthly gross (managerial staff are usually out). */
  maxGross?: number;
  /** A share of gross in place of a fixed amount (Haryana: 0.2%), capped at `employee`. */
  employeeRate?: number;
  /** The employer pays this many times the employee's share (Haryana: twice). */
  employerFactor?: number;
}
const H = [6, 12];
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const LWF_RULES: Record<string, LwfRule> = {
  // employee + employer per period, rates as of July 2026 (SalaryBox). Confirm deposit dates and wage limits per state.
  Gujarat: { months: H, employee: 6, employer: 12 },
  Maharashtra: { months: H, employee: 25, employer: 75, minGross: 3000 },
  Chhattisgarh: { months: H, employee: 15, employer: 45 },
  Goa: { months: H, employee: 60, employer: 180 },
  "Madhya Pradesh": { months: H, employee: 10, employer: 30 },
  Odisha: { months: H, employee: 20, employer: 40 },
  "West Bengal": { months: H, employee: 3, employer: 30 },
  Delhi: { months: H, employee: 0.75, employer: 2.25 },
  Haryana: { months: ALL, employee: 35, employer: 70, employeeRate: 0.002, employerFactor: 2 },
  Punjab: { months: ALL, employee: 5, employer: 20 },
  Chandigarh: { months: ALL, employee: 5, employer: 20 },
  // shops and establishments; IT and ITES pay 100 + 100
  Kerala: { months: ALL, employee: 50, employer: 50 },
  "Andhra Pradesh": { months: [12], employee: 30, employer: 70 },
  Karnataka: { months: [12], employee: 50, employer: 100 },
  "Tamil Nadu": { months: [12], employee: 20, employer: 40 },
  Telangana: { months: [12], employee: 2, employer: 5 },
};

// ---------------------------------------------------------------------------
// Structure from CTC
// ---------------------------------------------------------------------------

export interface MonthlyComponents {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  special: number;
  extras?: ExtraComponent[];
}

/** Monthly gross of a set of components. */
export const componentsGross = (c: MonthlyComponents) => c.basic + c.hra + c.conveyance + c.medical + c.special + (c.extras ?? []).reduce((s, x) => s + x.amount, 0);

export const COMPONENT_LABELS: Record<Exclude<keyof MonthlyComponents, "extras">, string> = {
  basic: "Basic",
  hra: "House rent allowance",
  conveyance: "Conveyance allowance",
  medical: "Medical allowance",
  special: "Special allowance",
};

export interface Structure {
  annualCtc: number;
  monthlyCtc: number;
  gross: number;
  components: MonthlyComponents;
  employer: { pf: number; esi: number };
  esiApplicable: boolean;
}

const r = (n: number) => Math.round(n);

/**
 * "Wages" under the Code on Wages and the Code on Social Security (in force from 21 Nov 2025):
 * basic plus dearness and retaining allowance. When everything else (HRA, conveyance, special
 * allowance and the rest) comes to more than half of the pay, the excess counts as wages too,
 * so wages are never below half the gross. PF, ESI eligibility, gratuity and leave encashment
 * are all worked out on this figure.
 */
export function codeWages(c: MonthlyComponents): number {
  const own = c.basic + (c.extras ?? []).filter((x) => x.wages).reduce((s, x) => s + x.amount, 0);
  return r(Math.max(own, componentsGross(c) / 2));
}

function employerPf(wages: number, t: SalaryTemplate, pfApplicable: boolean, R: StatutoryRules = DEFAULT_RULES) {
  if (!pfApplicable) return 0;
  const wage = t.pfOnFullBasic ? wages : Math.min(wages, R.pf.wageCeiling);
  return r(wage * R.pf.employerRate);
}

/** Split a gross into template components (allowances never push special below zero). */
export function componentsFromGross(gross: number, t: SalaryTemplate): MonthlyComponents {
  const basic = r((gross * t.basicPctOfGross) / 100);
  let left = gross - basic;
  const hra = Math.min(left, r((basic * t.hraPctOfBasic) / 100));
  left -= hra;
  const conveyance = Math.min(left, t.conveyance);
  left -= conveyance;
  const medical = Math.min(left, t.medical);
  left -= medical;
  const extras: ExtraComponent[] = [];
  for (const x of t.extras ?? []) {
    const amount = Math.min(left, Math.max(0, r(x.mode === "pct_basic" ? (basic * x.value) / 100 : x.value)));
    left -= amount;
    extras.push({ code: x.code, label: x.label, amount, taxable: x.taxable, esiWage: x.esiWage, ...(x.wages ? { wages: true } : {}) });
  }
  return { basic, hra, conveyance, medical, special: left, ...(extras.length ? { extras } : {}) };
}

/**
 * Work out monthly gross and components from annual CTC, where
 * monthly CTC = gross + employer PF + employer ESI (if gross is within the ESI threshold).
 */
export function structureFromCtc(annualCtc: number, t: SalaryTemplate = DEFAULT_SALARY_TEMPLATE, opts: { pfApplicable?: boolean; esiApplicable?: boolean; rules?: StatutoryRules } = {}): Structure {
  const R = opts.rules ?? DEFAULT_RULES;
  const pfOn = opts.pfApplicable ?? true;
  const esiOn = opts.esiApplicable ?? true;
  const monthlyCtc = r(annualCtc / 12);
  const solve = (withEsi: boolean) => {
    let gross = monthlyCtc;
    for (let i = 0; i < 50; i++) {
      const pf = employerPf(codeWages(componentsFromGross(gross, t)), t, pfOn, R);
      const esi = withEsi ? Math.ceil(gross * R.esi.employerRate) : 0;
      const next = monthlyCtc - pf - esi;
      if (Math.abs(next - gross) < 0.5) {
        gross = next;
        break;
      }
      gross = next;
    }
    return Math.max(0, r(gross));
  };
  let gross = solve(false);
  let esiApplicable = false;
  // ESI eligibility is on Code wages, so a gross of up to twice the threshold can still be covered
  if (esiOn && codeWages(componentsFromGross(gross, t)) <= R.esi.grossThreshold) {
    gross = solve(true);
    esiApplicable = true;
  }
  const components = componentsFromGross(gross, t);
  const pf = employerPf(codeWages(components), t, pfOn, R);
  const esi = esiApplicable ? monthlyCtc - gross - pf : 0; // absorbs rounding so CTC adds up exactly
  return { annualCtc, monthlyCtc, gross, components, employer: { pf, esi: Math.max(0, esi) }, esiApplicable };
}

/** Rebuild a structure from explicit (custom) monthly components. */
export function structureFromComponents(components: MonthlyComponents, t: SalaryTemplate = DEFAULT_SALARY_TEMPLATE, opts: { pfApplicable?: boolean; esiApplicable?: boolean; rules?: StatutoryRules } = {}): Structure {
  const R = opts.rules ?? DEFAULT_RULES;
  const gross = componentsGross(components);
  const pf = employerPf(codeWages(components), t, opts.pfApplicable ?? true, R);
  const esiApplicable = (opts.esiApplicable ?? true) && codeWages(components) <= R.esi.grossThreshold;
  const esi = esiApplicable ? Math.ceil(gross * R.esi.employerRate) : 0;
  const monthlyCtc = gross + pf + esi;
  return { annualCtc: monthlyCtc * 12, monthlyCtc, gross, components, employer: { pf, esi }, esiApplicable };
}

// ---------------------------------------------------------------------------
// Professional Tax and LWF
// ---------------------------------------------------------------------------

export function professionalTax(state: string | null | undefined, monthlyGross: number, month1: number, gender?: string | null, R: StatutoryRules = DEFAULT_RULES, person: PtPerson = {}): { amount: number; configured: boolean } {
  if (!state) return { amount: 0, configured: false };
  if (R.noPt.includes(state)) return { amount: 0, configured: true };
  const rule = R.pt[state];
  if (!rule) return { amount: 0, configured: false };
  if (person.disabled || (rule.seniorAge && person.age != null && person.age >= rule.seniorAge)) return { amount: 0, configured: true };
  // half-yearly and yearly states: only in their months, on the period's income
  const basis = rule.basis ?? "monthly";
  if (basis !== "monthly" && !(rule.months ?? []).includes(month1)) return { amount: 0, configured: true };
  const income = basis === "half_yearly" ? monthlyGross * 6 : basis === "yearly" ? monthlyGross * 12 : monthlyGross;
  const slabs = gender === "female" && rule.femaleSlabs ? rule.femaleSlabs : rule.slabs;
  const slab = slabs.find(([upTo]) => income <= upTo) ?? slabs[slabs.length - 1]!;
  let amount = slab[1];
  const top = slabs[slabs.length - 1]![1];
  if (month1 === 2 && rule.februaryTop && amount === top) amount = rule.februaryTop;
  return { amount, configured: true };
}

export function labourWelfareFund(state: string | null | undefined, monthlyGross: number, month1: number, R: StatutoryRules = DEFAULT_RULES) {
  const rule = state ? R.lwf[state] : undefined;
  if (!rule || !rule.months.includes(month1) || monthlyGross <= (rule.minGross ?? 0)) return { employee: 0, employer: 0 };
  if (rule.maxGross && monthlyGross > rule.maxGross) return { employee: 0, employer: 0 };
  if (rule.employeeRate) {
    // a share of wages, capped (Haryana 0.2% up to ₹35), the employer paying a multiple of it
    const employee = Math.round(Math.min(rule.employee, monthlyGross * rule.employeeRate) * 100) / 100;
    return { employee, employer: Math.round(employee * (rule.employerFactor ?? 1) * 100) / 100 };
  }
  return { employee: rule.employee, employer: rule.employer };
}

// ---------------------------------------------------------------------------
// Income tax (TDS on salary, section 192)
// ---------------------------------------------------------------------------

export type Regime = "new" | "old";

export interface TaxTable {
  standardDeduction: number;
  slabs: [number, number][]; // [upTo, rate]
  rebateLimit: number; // taxable income up to which 87A makes tax nil
  surcharge: [number, number][]; // [above, rate]
}

/**
 * Slabs per financial year. FY 2026-27 is carried forward from FY 2025-26 (Finance Act 2025).
 * Confirm against the Finance Act before processing payroll for a new FY.
 */
export const TAX_TABLES: Record<string, Record<Regime, TaxTable>> = {
  "2025-26": {
    new: {
      standardDeduction: 75000,
      slabs: [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]],
      rebateLimit: 1200000,
      surcharge: [[5000000, 0.1], [10000000, 0.15], [20000000, 0.25]],
    },
    old: {
      standardDeduction: 50000,
      slabs: [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],
      rebateLimit: 500000,
      surcharge: [[5000000, 0.1], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]],
    },
  },
};
TAX_TABLES["2026-27"] = TAX_TABLES["2025-26"]!;

/**
 * Every statutory number the engine uses, in one object. The built-in values below are
 * the defaults; the platform's statutory master publishes newer versions, and payroll
 * passes the set effective for the month being processed.
 */
export interface StatutoryRules {
  pf: { employeeRate: number; employerRate: number; epsRate: number; edliRate: number; adminRate: number; wageCeiling: number };
  esi: { employeeRate: number; employerRate: number; grossThreshold: number; disabledThreshold?: number };
  pt: Record<string, PtRule>;
  noPt: string[];
  lwf: Record<string, LwfRule>;
  tax: Record<string, Record<Regime, TaxTable>>;
  minWage: Record<string, { monthly: number; zone?: string; skill?: string; rates?: Partial<Record<"unskilled" | "semi_skilled" | "skilled" | "highly_skilled", number>> }>;
}
export const DEFAULT_RULES: StatutoryRules = {
  pf: { ...STATUTORY.pf },
  esi: { ...STATUTORY.esi },
  pt: PT_RULES,
  noPt: [...NO_PT_STATES],
  lwf: LWF_RULES,
  tax: TAX_TABLES,
  minWage: {},
};

function slabTax(income: number, slabs: [number, number][]) {
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of slabs) {
    if (income > prev) tax += (Math.min(income, cap) - prev) * rate;
    prev = cap;
    if (income <= cap) break;
  }
  return tax;
}

export interface TaxInput {
  regime: Regime;
  financialYear: string; // "2026-27"
  annualGross: number;
  /** Old regime: Chapter VI-A deductions (80C incl. employee PF, 80D, ...), already capped. */
  deductions?: number;
  /** Old regime: professional tax paid in the year (deductible u/s 16(iii)). */
  professionalTax?: number;
  /** Old regime: HRA exemption u/s 10(13A). */
  hraExemption?: number;
  rules?: StatutoryRules;
}

export interface TaxResult {
  taxableIncome: number;
  baseTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total: number;
}

/** Annual income tax with 87A rebate (incl. marginal relief), surcharge (with marginal relief) and 4% cess. */
export function annualIncomeTax(input: TaxInput): TaxResult {
  const table = taxTable(input.financialYear, input.regime, input.rules);
  let taxable = input.annualGross - table.standardDeduction;
  if (input.regime === "old") taxable -= (input.deductions ?? 0) + (input.professionalTax ?? 0) + (input.hraExemption ?? 0);
  return taxOnIncome(input.regime, input.financialYear, taxable, input.rules);
}

export function taxTable(financialYear: string, regime: Regime, R: StatutoryRules = DEFAULT_RULES): TaxTable {
  // a year without its own table uses the latest one on or before it (or the earliest)
  const years = Object.keys(R.tax).sort();
  const fy = R.tax[financialYear] ? financialYear : ([...years].reverse().find((y) => y <= financialYear) ?? years[0]!);
  return R.tax[fy]![regime];
}

/** Tax on a total income: slabs, 87A rebate (with marginal relief), surcharge (with marginal relief), 4% cess. */
export function taxOnIncome(regime: Regime, financialYear: string, income: number, R: StatutoryRules = DEFAULT_RULES): TaxResult {
  const table = taxTable(financialYear, regime, R);
  const taxable = Math.max(0, Math.round(income / 10) * 10); // s.288A: round to nearest ₹10

  const base = slabTax(taxable, table.slabs);
  let rebate = 0;
  if (taxable <= table.rebateLimit) rebate = base;
  else if (regime === "new") {
    // marginal relief: tax can't exceed the income above the rebate limit
    const excess = taxable - table.rebateLimit;
    if (base > excess) rebate = base - excess;
  }
  const afterRebate = base - rebate;

  let surcharge = 0;
  for (let i = table.surcharge.length - 1; i >= 0; i--) {
    const [above, rate] = table.surcharge[i]!;
    if (taxable > above) {
      surcharge = afterRebate * rate;
      // marginal relief: tax + surcharge can't exceed tax at the threshold + income above it
      const atThreshold = slabTax(above, table.slabs) * (1 + (i > 0 ? table.surcharge[i - 1]![1] : 0));
      const cap = atThreshold + (taxable - above);
      if (afterRebate + surcharge > cap) surcharge = Math.max(0, cap - afterRebate);
      break;
    }
  }
  const cess = (afterRebate + surcharge) * 0.04;
  const total = Math.round(afterRebate + surcharge + cess);
  return { taxableIncome: taxable, baseTax: Math.round(base), rebate: Math.round(rebate), surcharge: Math.round(surcharge), cess: Math.round(cess), total };
}

/** Slab-by-slab breakdown for a computation statement. */
export function slabBreakdown(regime: Regime, financialYear: string, taxable: number, R: StatutoryRules = DEFAULT_RULES) {
  const out: { from: number; to: number | null; rate: number; amount: number; tax: number }[] = [];
  let prev = 0;
  for (const [cap, rate] of taxTable(financialYear, regime, R).slabs) {
    const amount = Math.max(0, Math.min(taxable, cap) - prev);
    out.push({ from: prev, to: cap === Infinity ? null : cap, rate, amount, tax: Math.round(amount * rate) });
    prev = cap;
    if (taxable <= cap) break;
  }
  return out;
}

/** Months left in the financial year including `month` ("YYYY-MM"). April = 12, March = 1. */
export function remainingFyMonths(month: string) {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? 12 - (m - 4) : 4 - m;
}

/** Financial year label ("2026-27") for a payroll month ("2026-11"). */
export function fyOfMonth(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Monthly payslip
// ---------------------------------------------------------------------------

export interface Adjustment {
  label: string;
  kind: "earning" | "deduction";
  amount: number;
  /** Earnings only: subject to TDS (default true). */
  taxable?: boolean;
  /** Earnings only: counts as ESI wages (default true; false for annual bonus). */
  esiWage?: boolean;
}

export interface PayLine {
  code: string;
  label: string;
  amount: number;
}

export interface PayslipInput {
  month: string; // YYYY-MM
  /** Country of the employee's legal entity; picks the country pack (default India). */
  country?: CountryCode;
  /**
   * Facts some country packs need: nationality (ISO 3166 alpha 2) decides who pays into a
   * national pension scheme in the Gulf; region is the entity's state or emirate.
   */
  /** Nationality, state or emirate, and (Saudi Arabia) when they were first insured with GOSI. */
  profile?: { nationality?: string | null; region?: string | null; insuredSince?: string | null; joinedOn?: string | null };
  /** Per employee payroll details a country pack reads (the UK's tax code, NI category, loans, P45). */
  countryProfile?: Record<string, unknown> | null;
  structure: Structure;
  template?: SalaryTemplate;
  daysInMonth: number;
  paidDays: number;
  adjustments?: Adjustment[];
  /** Approved expense reimbursements paid with this salary: not income, so outside gross, TDS, ESI and PT. */
  reimbursement?: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  state: string | null;
  gender?: string | null;
  regime: Regime;
  /**
   * India: the employee was covered by ESI earlier in this contribution period (April to September
   * or October to March), so ESI continues to the period's end even if their wages crossed the limit.
   */
  esiContinue?: boolean;
  /**
   * Year-to-date figures from earlier payroll months of the same FY. Leave undefined when
   * there's no history (e.g. first month on this system): TDS is then annualised, assuming
   * earlier months were paid at the same rate.
   */
  ytd?: { taxableGross: number; tds: number; employeePf: number; professionalTax: number };
  /** The employee's tax declaration for the FY and HR-verified amounts (old regime deductions, HRA, previous employer). */
  taxProfile?: { declaration?: TaxDeclarationData | null; verified?: Verified | null };
  /** Statutory rules in force for the month (defaults to the built-in rules). */
  rules?: StatutoryRules;
}

export interface PayslipResult {
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  reimbursement: number;
  employerCost: number;
  ctc: number;
  tds: number;
  tax: TaxResult & { projectedAnnualGross: number; monthsLeft: number; annualised: boolean };
  /** Earnings this month that aren't taxable (non-taxable allowances and one-time pay). */
  nonTaxable: number;
  warnings: string[];
  /** India: Code wages earned, the PF base. */
  wages?: number;
}

export function computePayslip(input: PayslipInput): PayslipResult {
  const pack = packFor(input.country);
  // payslip lines round the way the country pays: whole rupees in India, fils or baisa in the Gulf
  const r = (n: number) => roundMoney(n, pack.payroll.roundingDecimals);
  const t = input.template ?? DEFAULT_SALARY_TEMPLATE;
  const R = input.rules ?? DEFAULT_RULES;
  const month1 = Number(input.month.slice(5, 7));
  const warnings: string[] = [];
  const factor = input.daysInMonth > 0 ? Math.max(0, Math.min(1, input.paidDays / input.daysInMonth)) : 0;
  const c = input.structure.components;

  const labels = { ...COMPONENT_LABELS, ...(pack.payroll.componentLabels ?? {}) };
  const std = (k: Exclude<keyof MonthlyComponents, "extras">) => ({ code: k, label: labels[k], amount: r(c[k] * factor) });
  const extras = (c.extras ?? []).map((x) => ({ code: `x_${x.code}`, label: x.label, amount: r(x.amount * factor), taxable: x.taxable !== false, esiWage: x.esiWage !== false }));
  const earnings: PayLine[] = [std("basic"), std("hra"), std("conveyance"), std("medical"), ...extras.map(({ code, label, amount }) => ({ code, label, amount })), std("special")].filter((e) => e.amount > 0);
  const adj = input.adjustments ?? [];
  for (const [i, a] of adj.entries()) if (a.kind === "earning" && a.amount) earnings.push({ code: `adj_e${i}`, label: a.label, amount: r(a.amount) });

  const gross = r(earnings.reduce((s, e) => s + e.amount, 0));
  const basicEarned = earnings.find((e) => e.code === "basic")?.amount ?? 0;
  const nonEsiAdj = adj.filter((a) => a.kind === "earning" && a.esiWage === false).reduce((s, a) => s + r(a.amount), 0) + extras.filter((x) => !x.esiWage).reduce((s, x) => s + x.amount, 0);
  const nonTaxableAdj = adj.filter((a) => a.kind === "earning" && a.taxable === false).reduce((s, a) => s + r(a.amount), 0) + extras.filter((x) => !x.taxable).reduce((s, x) => s + x.amount, 0);
  // a full month's non-taxable allowances, for projecting the rest of the year
  const fullNonTaxable = (c.extras ?? []).filter((x) => x.taxable === false).reduce((s, x) => s + x.amount, 0);

  // Statutory deductions, employer contributions and income tax come from the country pack.
  const stat = pack.payroll.statutory({
    input,
    template: t,
    rules: R,
    month1,
    factor,
    components: c,
    earnings,
    gross,
    basicEarned,
    nonContributoryEarnings: nonEsiAdj,
    nonTaxableEarnings: nonTaxableAdj,
    fullMonthNonTaxable: fullNonTaxable,
    round: r,
  });
  warnings.push(...stat.warnings);
  const { tds, tax } = stat;

  const deductions: PayLine[] = [...stat.deductions];
  for (const [i, a] of adj.entries()) if (a.kind === "deduction" && a.amount) deductions.push({ code: `adj_d${i}`, label: a.label, amount: r(a.amount) });
  const deductionLines = deductions.filter((d) => d.amount > 0);
  const totalDeductions = r(deductionLines.reduce((s, d) => s + d.amount, 0));

  const employer: PayLine[] = stat.employer.filter((e) => e.amount > 0);
  const employerCost = r(employer.reduce((s, e) => s + e.amount, 0));

  const reimbursement = Math.max(0, r(input.reimbursement ?? 0));
  const net = r(gross - totalDeductions + reimbursement);
  const salaryNet = net - reimbursement;
  if (salaryNet < 0) warnings.push("Deductions exceed earnings");
  else if (gross > 0 && salaryNet < gross * 0.5) warnings.push("Net pay is below half of gross");
  if (factor === 0) warnings.push("No paid days this month");

  return {
    earnings,
    deductions: deductionLines,
    employer,
    gross,
    totalDeductions,
    net,
    reimbursement,
    employerCost,
    ctc: gross + employerCost,
    tds,
    tax,
    nonTaxable: nonTaxableAdj,
    warnings,
    ...(stat.wages !== undefined ? { wages: stat.wages } : {}),
  };
}

/** Indian-style amount in words for payslips: "One lakh twenty-three thousand four hundred five rupees only". */
export function rupeesInWords(n: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const two = (x: number) => (x < 20 ? ones[x]! : tens[Math.floor(x / 10)]! + (x % 10 ? "-" + ones[x % 10] : ""));
  const three = (x: number) => (x >= 100 ? ones[Math.floor(x / 100)] + " hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
  let v = Math.round(Math.abs(n));
  if (v === 0) return "Zero rupees only";
  const parts: string[] = [];
  const crore = Math.floor(v / 1e7);
  v %= 1e7;
  const lakh = Math.floor(v / 1e5);
  v %= 1e5;
  const thousand = Math.floor(v / 1000);
  v %= 1000;
  if (crore) parts.push(three(crore) + " crore");
  if (lakh) parts.push(two(lakh) + " lakh");
  if (thousand) parts.push(two(thousand) + " thousand");
  if (v) parts.push(three(v));
  const s = parts.join(" ") + " rupees only";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
