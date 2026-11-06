import { computeTaxStatement, type TaxDeclarationData, type Verified } from "./tax";

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
}

export const DEFAULT_SALARY_TEMPLATE: SalaryTemplate = {
  basicPctOfGross: 50,
  hraPctOfBasic: 40,
  conveyance: 1600,
  medical: 1250,
  pfOnFullBasic: false,
};

export const STATUTORY = {
  pf: { employeeRate: 0.12, employerRate: 0.12, epsRate: 0.0833, edliRate: 0.005, adminRate: 0.005, wageCeiling: 15000 },
  esi: { employeeRate: 0.0075, employerRate: 0.0325, grossThreshold: 21000 },
} as const;

/** Professional Tax monthly slabs by state. [upToMonthlyGross, amount]; Infinity for the last slab. */
interface PtRule {
  slabs: [number, number][];
  /** Slabs for women where the state gives a different exemption. */
  femaleSlabs?: [number, number][];
  /** Amount charged in February instead of the top slab (annual top-up). */
  februaryTop?: number;
}
export const PT_RULES: Record<string, PtRule> = {
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
};
/** States/UTs that do not levy Professional Tax (no warning raised). */
export const NO_PT_STATES = new Set([
  "Delhi", "Uttar Pradesh", "Haryana", "Rajasthan", "Himachal Pradesh", "Uttarakhand", "Goa", "Chandigarh",
  "Jammu and Kashmir", "Ladakh", "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep",
]);

/** Labour Welfare Fund: deducted only in the listed months (1-12). */
interface LwfRule {
  months: number[];
  employee: number;
  employer: number;
  /** Only deducted when monthly gross exceeds this. */
  minGross?: number;
}
export const LWF_RULES: Record<string, LwfRule> = {
  Gujarat: { months: [6, 12], employee: 6, employer: 12 },
  Maharashtra: { months: [6, 12], employee: 25, employer: 75, minGross: 3000 },
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
}

export const COMPONENT_LABELS: Record<keyof MonthlyComponents, string> = {
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

function employerPf(basic: number, t: SalaryTemplate, pfApplicable: boolean) {
  if (!pfApplicable) return 0;
  const wage = t.pfOnFullBasic ? basic : Math.min(basic, STATUTORY.pf.wageCeiling);
  return r(wage * STATUTORY.pf.employerRate);
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
  return { basic, hra, conveyance, medical, special: left };
}

/**
 * Work out monthly gross and components from annual CTC, where
 * monthly CTC = gross + employer PF + employer ESI (if gross is within the ESI threshold).
 */
export function structureFromCtc(annualCtc: number, t: SalaryTemplate = DEFAULT_SALARY_TEMPLATE, opts: { pfApplicable?: boolean; esiApplicable?: boolean } = {}): Structure {
  const pfOn = opts.pfApplicable ?? true;
  const esiOn = opts.esiApplicable ?? true;
  const monthlyCtc = r(annualCtc / 12);
  const solve = (withEsi: boolean) => {
    let gross = monthlyCtc;
    for (let i = 0; i < 50; i++) {
      const basic = r((gross * t.basicPctOfGross) / 100);
      const pf = employerPf(basic, t, pfOn);
      const esi = withEsi ? Math.ceil(gross * STATUTORY.esi.employerRate) : 0;
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
  if (esiOn && gross <= STATUTORY.esi.grossThreshold) {
    gross = solve(true);
    esiApplicable = true;
  }
  const components = componentsFromGross(gross, t);
  const pf = employerPf(components.basic, t, pfOn);
  const esi = esiApplicable ? monthlyCtc - gross - pf : 0; // absorbs rounding so CTC adds up exactly
  return { annualCtc, monthlyCtc, gross, components, employer: { pf, esi: Math.max(0, esi) }, esiApplicable };
}

/** Rebuild a structure from explicit (custom) monthly components. */
export function structureFromComponents(components: MonthlyComponents, t: SalaryTemplate = DEFAULT_SALARY_TEMPLATE, opts: { pfApplicable?: boolean; esiApplicable?: boolean } = {}): Structure {
  const gross = components.basic + components.hra + components.conveyance + components.medical + components.special;
  const pf = employerPf(components.basic, t, opts.pfApplicable ?? true);
  const esiApplicable = (opts.esiApplicable ?? true) && gross <= STATUTORY.esi.grossThreshold;
  const esi = esiApplicable ? Math.ceil(gross * STATUTORY.esi.employerRate) : 0;
  const monthlyCtc = gross + pf + esi;
  return { annualCtc: monthlyCtc * 12, monthlyCtc, gross, components, employer: { pf, esi }, esiApplicable };
}

// ---------------------------------------------------------------------------
// Professional Tax and LWF
// ---------------------------------------------------------------------------

export function professionalTax(state: string | null | undefined, monthlyGross: number, month1: number, gender?: string | null): { amount: number; configured: boolean } {
  if (!state) return { amount: 0, configured: false };
  if (NO_PT_STATES.has(state)) return { amount: 0, configured: true };
  const rule = PT_RULES[state];
  if (!rule) return { amount: 0, configured: false };
  const slabs = gender === "female" && rule.femaleSlabs ? rule.femaleSlabs : rule.slabs;
  const slab = slabs.find(([upTo]) => monthlyGross <= upTo) ?? slabs[slabs.length - 1]!;
  let amount = slab[1];
  const top = slabs[slabs.length - 1]![1];
  if (month1 === 2 && rule.februaryTop && amount === top) amount = rule.februaryTop;
  return { amount, configured: true };
}

export function labourWelfareFund(state: string | null | undefined, monthlyGross: number, month1: number) {
  const rule = state ? LWF_RULES[state] : undefined;
  if (!rule || !rule.months.includes(month1) || monthlyGross <= (rule.minGross ?? 0)) return { employee: 0, employer: 0 };
  return { employee: rule.employee, employer: rule.employer };
}

// ---------------------------------------------------------------------------
// Income tax (TDS on salary, section 192)
// ---------------------------------------------------------------------------

export type Regime = "new" | "old";

interface TaxTable {
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
  const table = taxTable(input.financialYear, input.regime);
  let taxable = input.annualGross - table.standardDeduction;
  if (input.regime === "old") taxable -= (input.deductions ?? 0) + (input.professionalTax ?? 0) + (input.hraExemption ?? 0);
  return taxOnIncome(input.regime, input.financialYear, taxable);
}

export function taxTable(financialYear: string, regime: Regime): TaxTable {
  return (TAX_TABLES[financialYear] ?? TAX_TABLES["2026-27"]!)[regime];
}

/** Tax on a total income: slabs, 87A rebate (with marginal relief), surcharge (with marginal relief), 4% cess. */
export function taxOnIncome(regime: Regime, financialYear: string, income: number): TaxResult {
  const table = taxTable(financialYear, regime);
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
export function slabBreakdown(regime: Regime, financialYear: string, taxable: number) {
  const out: { from: number; to: number | null; rate: number; amount: number; tax: number }[] = [];
  let prev = 0;
  for (const [cap, rate] of taxTable(financialYear, regime).slabs) {
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
  structure: Structure;
  template?: SalaryTemplate;
  daysInMonth: number;
  paidDays: number;
  adjustments?: Adjustment[];
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  state: string | null;
  gender?: string | null;
  regime: Regime;
  /**
   * Year-to-date figures from earlier payroll months of the same FY. Leave undefined when
   * there's no history (e.g. first month on this system): TDS is then annualised, assuming
   * earlier months were paid at the same rate.
   */
  ytd?: { taxableGross: number; tds: number; employeePf: number; professionalTax: number };
  /** The employee's tax declaration for the FY and HR-verified amounts (old regime deductions, HRA, previous employer). */
  taxProfile?: { declaration?: TaxDeclarationData | null; verified?: Verified | null };
}

export interface PayslipResult {
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  ctc: number;
  tds: number;
  tax: TaxResult & { projectedAnnualGross: number; monthsLeft: number; annualised: boolean };
  warnings: string[];
}

export function computePayslip(input: PayslipInput): PayslipResult {
  const t = input.template ?? DEFAULT_SALARY_TEMPLATE;
  const month1 = Number(input.month.slice(5, 7));
  const warnings: string[] = [];
  const factor = input.daysInMonth > 0 ? Math.max(0, Math.min(1, input.paidDays / input.daysInMonth)) : 0;
  const c = input.structure.components;

  const earnings: PayLine[] = (Object.keys(COMPONENT_LABELS) as (keyof MonthlyComponents)[])
    .map((k) => ({ code: k, label: COMPONENT_LABELS[k], amount: r(c[k] * factor) }))
    .filter((e) => e.amount > 0);
  const adj = input.adjustments ?? [];
  for (const [i, a] of adj.entries()) if (a.kind === "earning" && a.amount) earnings.push({ code: `adj_e${i}`, label: a.label, amount: r(a.amount) });

  const gross = earnings.reduce((s, e) => s + e.amount, 0);
  const basicEarned = earnings.find((e) => e.code === "basic")?.amount ?? 0;
  const nonEsiAdj = adj.filter((a) => a.kind === "earning" && a.esiWage === false).reduce((s, a) => s + r(a.amount), 0);
  const nonTaxableAdj = adj.filter((a) => a.kind === "earning" && a.taxable === false).reduce((s, a) => s + r(a.amount), 0);

  // PF
  const pfWage = input.pfApplicable ? (t.pfOnFullBasic ? basicEarned : Math.min(basicEarned, STATUTORY.pf.wageCeiling)) : 0;
  const pfCappedWage = Math.min(pfWage, STATUTORY.pf.wageCeiling);
  const employeePf = r(pfWage * STATUTORY.pf.employeeRate);
  const employerPfTotal = r(pfWage * STATUTORY.pf.employerRate);
  const eps = Math.min(employerPfTotal, r(pfCappedWage * STATUTORY.pf.epsRate));
  const epfEr = employerPfTotal - eps;
  const edli = r(pfCappedWage * STATUTORY.pf.edliRate);
  const pfAdmin = r(pfWage * STATUTORY.pf.adminRate);

  // ESI: eligibility is decided on the full-month structure gross
  const esiOn = input.esiApplicable && input.structure.gross <= STATUTORY.esi.grossThreshold;
  const esiWage = gross - nonEsiAdj;
  const employeeEsi = esiOn ? Math.ceil(esiWage * STATUTORY.esi.employeeRate) : 0;
  const employerEsi = esiOn ? Math.ceil(esiWage * STATUTORY.esi.employerRate) : 0;

  // PT and LWF
  let pt = 0;
  if (input.ptApplicable) {
    const p = professionalTax(input.state, gross, month1, input.gender);
    pt = p.amount;
    if (!p.configured) warnings.push(`Professional Tax rules for ${input.state ?? "this branch"} aren't configured`);
  }
  const lwf = labourWelfareFund(input.state, gross, month1);

  // TDS: project the year, then spread what's left over the remaining months
  const monthsLeft = remainingFyMonths(input.month);
  const ytd = input.ytd ?? { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 };
  const fullMonthGross = input.structure.gross;
  const fullMonthPf = input.pfApplicable ? r(Math.min(input.structure.components.basic, t.pfOnFullBasic ? Infinity : STATUTORY.pf.wageCeiling) * STATUTORY.pf.employeeRate) : 0;
  const fullMonthPt = input.ptApplicable ? professionalTax(input.state, fullMonthGross, 1, input.gender).amount : 0;
  const annualised = input.ytd === undefined;
  const pastMonths = 12 - monthsLeft;
  const projectedAnnualGross = annualised
    ? fullMonthGross * 12 + (gross - nonTaxableAdj - fullMonthGross)
    : ytd.taxableGross + (gross - nonTaxableAdj) + fullMonthGross * (monthsLeft - 1);
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
  for (const [i, a] of adj.entries()) if (a.kind === "deduction" && a.amount) deductions.push({ code: `adj_d${i}`, label: a.label, amount: r(a.amount) });
  const deductionLines = deductions.filter((d) => d.amount > 0);
  const totalDeductions = deductionLines.reduce((s, d) => s + d.amount, 0);

  const employer: PayLine[] = [
    { code: "epf_er", label: "EPF (employer)", amount: epfEr },
    { code: "eps", label: "EPS (pension)", amount: eps },
    { code: "edli", label: "EDLI", amount: edli },
    { code: "pf_admin", label: "PF admin charges", amount: pfAdmin },
    { code: "esi_er", label: "ESI (employer)", amount: employerEsi },
    { code: "lwf_er", label: "LWF (employer)", amount: lwf.employer },
  ].filter((e) => e.amount > 0);
  const employerCost = employer.reduce((s, e) => s + e.amount, 0);

  const net = gross - totalDeductions;
  if (net < 0) warnings.push("Deductions exceed earnings");
  else if (gross > 0 && net < gross * 0.5) warnings.push("Net pay is below half of gross");
  if (factor === 0) warnings.push("No paid days this month");

  return {
    earnings,
    deductions: deductionLines,
    employer,
    gross,
    totalDeductions,
    net,
    employerCost,
    ctc: gross + employerCost,
    tds,
    tax: { ...tax, projectedAnnualGross, monthsLeft, annualised },
    warnings,
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
