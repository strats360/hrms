/**
 * Income-tax computation statement for salary (the basis of Form 16 Part B and
 * monthly TDS). Caps follow the Income-tax Act for FY 2025-26/2026-27; confirm
 * with a CA when the Finance Act changes.
 */
import { z } from "zod";
import { slabBreakdown, taxOnIncome, taxTable, type Regime, type StatutoryRules, type TaxResult } from "./payroll";

// ---------------------------------------------------------------------------
// Declaration model (what an employee declares, and what HR verifies)
// ---------------------------------------------------------------------------
const amt = z.coerce.number().min(0).max(1e9).default(0);

export const taxDeclarationDataSchema = z.object({
  rent: z
    .object({
      monthlyRent: amt,
      months: z.coerce.number().int().min(0).max(12).default(12),
      metro: z.boolean().default(false),
      landlordName: z.string().trim().max(120).optional().nullable(),
      landlordPan: z.string().trim().toUpperCase().max(10).optional().nullable(),
    })
    .optional(),
  sec80C: z
    .object({ lic: amt, ppf: amt, elss: amt, nsc: amt, tuition: amt, homeLoanPrincipal: amt, sukanya: amt, taxSaverFd: amt, other: amt })
    .partial()
    .optional(),
  sec80CCD1B: amt.optional(),
  sec80D: z.object({ self: amt, parents: amt, selfSenior: z.boolean().default(false), parentsSenior: z.boolean().default(false) }).partial().optional(),
  homeLoanInterest: amt.optional(),
  sec80E: amt.optional(),
  sec80G: amt.optional(),
  sec80TTA: amt.optional(),
  otherIncome: amt.optional(),
  previousEmployer: z
    .object({ name: z.string().trim().max(120).optional().nullable(), tan: z.string().trim().toUpperCase().max(10).optional().nullable(), gross: amt, tds: amt, pf: amt, pt: amt })
    .partial()
    .optional(),
});
export type TaxDeclarationData = z.infer<typeof taxDeclarationDataSchema>;

/** Sections HR verifies against proofs. */
export const TAX_SECTIONS = ["hra", "80C", "80CCD1B", "80D", "24b", "80E", "80G", "80TTA", "previousEmployer"] as const;
export type TaxSection = (typeof TAX_SECTIONS)[number];
export const TAX_SECTION_LABELS: Record<TaxSection, string> = {
  hra: "House rent (HRA)",
  "80C": "80C investments",
  "80CCD1B": "80CCD(1B) NPS",
  "80D": "80D health insurance",
  "24b": "24(b) home loan interest",
  "80E": "80E education loan interest",
  "80G": "80G donations (eligible amount)",
  "80TTA": "80TTA savings interest",
  previousEmployer: "Previous employer income",
};

export type Verified = Partial<Record<TaxSection, number>>;

export const CAPS = { sec80C: 150000, sec80CCD1B: 50000, sec80D: 25000, sec80DSenior: 50000, homeLoanInterest: 200000, sec80TTA: 10000 };

/** Declared amount per section (before caps), e.g. for proof verification screens. */
export function declaredBySection(d: TaxDeclarationData | null | undefined): Record<TaxSection, number> {
  const c = d?.sec80C ?? {};
  return {
    hra: (d?.rent?.monthlyRent ?? 0) * (d?.rent?.months ?? 12),
    "80C": Object.values(c).reduce<number>((s, v) => s + (Number(v) || 0), 0),
    "80CCD1B": d?.sec80CCD1B ?? 0,
    "80D": (d?.sec80D?.self ?? 0) + (d?.sec80D?.parents ?? 0),
    "24b": d?.homeLoanInterest ?? 0,
    "80E": d?.sec80E ?? 0,
    "80G": d?.sec80G ?? 0,
    "80TTA": d?.sec80TTA ?? 0,
    previousEmployer: d?.previousEmployer?.gross ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Computation statement
// ---------------------------------------------------------------------------
export interface StatementInput {
  regime: Regime;
  financialYear: string;
  /** Salary from this employer for the year (actual + projected). */
  salary: { gross: number; basic: number; hra: number };
  employeePf: number;
  professionalTax: number;
  declaration?: TaxDeclarationData | null;
  /** HR-verified amounts. A verified section overrides what was declared. */
  verified?: Verified | null;
  /** Statutory rules (tax slabs) to use; defaults to the built-in tables. */
  rules?: StatutoryRules;
}

export interface StatementLine {
  key: string;
  label: string;
  amount: number;
  note?: string;
}

export interface TaxStatement {
  regime: Regime;
  financialYear: string;
  grossSalary: number;
  exemptions: StatementLine[];
  standardDeduction: number;
  professionalTax: number;
  incomeFromSalary: number;
  houseProperty: number;
  otherIncome: number;
  grossTotalIncome: number;
  deductions: StatementLine[];
  totalDeductions: number;
  taxableIncome: number;
  slabs: ReturnType<typeof slabBreakdown>;
  tax: TaxResult;
  previousEmployerTds: number;
}

/**
 * Build the annual statement for one regime. Under the new regime (s.115BAC) only the
 * standard deduction applies: no HRA exemption, PT, 24(b) on self-occupied property or
 * Chapter VI-A deductions.
 */
export function computeTaxStatement(input: StatementInput): TaxStatement {
  const d = input.declaration ?? {};
  const v = input.verified ?? {};
  const declared = declaredBySection(d);
  const eff = (k: TaxSection) => (v[k] !== undefined && v[k] !== null ? Number(v[k]) : declared[k]);
  const old = input.regime === "old";
  const table = taxTable(input.financialYear, input.regime, input.rules);

  const prevGross = eff("previousEmployer");
  const prevRatio = declared.previousEmployer > 0 ? prevGross / declared.previousEmployer : 1;
  const prev = d.previousEmployer ?? {};
  const grossSalary = Math.round(input.salary.gross + prevGross);

  // HRA exemption, s.10(13A): least of HRA received, rent - 10% of basic, 50%/40% of basic
  const exemptions: StatementLine[] = [];
  if (old && d.rent) {
    const rent = eff("hra");
    const pct = d.rent.metro ? 0.5 : 0.4;
    const exempt = Math.max(0, Math.round(Math.min(input.salary.hra, rent - 0.1 * input.salary.basic, pct * input.salary.basic)));
    if (exempt > 0) exemptions.push({ key: "hra", label: "HRA exemption u/s 10(13A)", amount: exempt, note: `Least of HRA ${Math.round(input.salary.hra)}, rent less 10% of basic, ${pct * 100}% of basic` });
  }
  const exemptTotal = exemptions.reduce((s, e) => s + e.amount, 0);
  const standardDeduction = Math.min(table.standardDeduction, grossSalary - exemptTotal);
  const professionalTax = old ? Math.min(2500, Math.round(input.professionalTax + (prev.pt ?? 0) * prevRatio)) : 0;
  const incomeFromSalary = Math.max(0, grossSalary - exemptTotal - standardDeduction - professionalTax);

  const houseProperty = old ? -Math.min(CAPS.homeLoanInterest, eff("24b")) : 0;
  const otherIncome = Math.round(d.otherIncome ?? 0);
  const grossTotalIncome = Math.max(0, incomeFromSalary + houseProperty + otherIncome);

  const deductions: StatementLine[] = [];
  if (old) {
    const c80 = Math.min(CAPS.sec80C, Math.round(input.employeePf + (prev.pf ?? 0) * prevRatio + eff("80C")));
    if (c80) deductions.push({ key: "80C", label: "80C (PF, PPF, ELSS, LIC, tuition, home loan principal)", amount: c80, note: "Capped at ₹1,50,000" });
    const nps = Math.min(CAPS.sec80CCD1B, eff("80CCD1B"));
    if (nps) deductions.push({ key: "80CCD1B", label: "80CCD(1B) NPS", amount: nps });
    const dd = d.sec80D ?? {};
    const declared80D = (dd.self ?? 0) + (dd.parents ?? 0);
    const ratio80D = declared80D > 0 ? eff("80D") / declared80D : 0;
    const self = Math.min(dd.selfSenior ? CAPS.sec80DSenior : CAPS.sec80D, Math.round((dd.self ?? 0) * ratio80D));
    const parents = Math.min(dd.parentsSenior ? CAPS.sec80DSenior : CAPS.sec80D, Math.round((dd.parents ?? 0) * ratio80D));
    if (self + parents) deductions.push({ key: "80D", label: "80D health insurance", amount: self + parents });
    const edu = eff("80E");
    if (edu) deductions.push({ key: "80E", label: "80E education loan interest", amount: Math.round(edu) });
    const don = eff("80G");
    if (don) deductions.push({ key: "80G", label: "80G donations", amount: Math.round(don) });
    const sav = Math.min(CAPS.sec80TTA, eff("80TTA"));
    if (sav) deductions.push({ key: "80TTA", label: "80TTA savings interest", amount: sav });
  }
  const totalDeductions = Math.min(grossTotalIncome, deductions.reduce((s, x) => s + x.amount, 0));
  const taxableIncome = Math.max(0, Math.round((grossTotalIncome - totalDeductions) / 10) * 10);
  const tax = taxOnIncome(input.regime, input.financialYear, taxableIncome, input.rules);

  return {
    regime: input.regime,
    financialYear: input.financialYear,
    grossSalary,
    exemptions,
    standardDeduction,
    professionalTax,
    incomeFromSalary,
    houseProperty,
    otherIncome,
    grossTotalIncome,
    deductions,
    totalDeductions,
    taxableIncome,
    slabs: slabBreakdown(input.regime, input.financialYear, taxableIncome, input.rules),
    tax,
    previousEmployerTds: Math.round((prev.tds ?? 0) * prevRatio),
  };
}

/** Both regimes side by side, with the cheaper one. */
export function compareRegimes(input: Omit<StatementInput, "regime">) {
  const neu = computeTaxStatement({ ...input, regime: "new" });
  const old = computeTaxStatement({ ...input, regime: "old" });
  return { new: neu, old, better: (old.tax.total < neu.tax.total ? "old" : "new") as Regime, saving: Math.abs(old.tax.total - neu.tax.total) };
}
