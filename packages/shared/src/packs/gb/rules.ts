/**
 * UK payroll rules for the 2026/27 tax year (6 April 2026 to 5 April 2027), monthly pay.
 * Everything here must be checked by a UK payroll professional against HMRC's current rates
 * and thresholds before the pack pays anyone (see golden/GB.json).
 */
export const TAX_YEAR = "2026-27";

/** Income tax bands above the personal allowance (which comes from the tax code). */
export interface Band {
  upTo: number;
  rate: number;
  name: string;
}
/** England, Wales and Northern Ireland. Welsh rates (C codes) are the same today. */
export const RUK_BANDS: Band[] = [
  { upTo: 37700, rate: 0.2, name: "basic" },
  { upTo: 125140, rate: 0.4, name: "higher" },
  { upTo: Infinity, rate: 0.45, name: "additional" },
];
/** Scotland (S codes). Confirm: these are the 2025/26 bands; Scotland sets new ones every year. */
export const SCOTTISH_BANDS: Band[] = [
  { upTo: 2827, rate: 0.19, name: "starter" },
  { upTo: 14921, rate: 0.2, name: "basic" },
  { upTo: 31092, rate: 0.21, name: "intermediate" },
  { upTo: 62430, rate: 0.42, name: "higher" },
  { upTo: 112570, rate: 0.45, name: "advanced" },
  { upTo: Infinity, rate: 0.48, name: "top" },
];

/** National Insurance thresholds, per month. */
export const NI = {
  primaryThreshold: 1048,
  upperEarningsLimit: 4189,
  secondaryThreshold: 417,
  /** Upper secondary threshold for under 21s, and the apprentice threshold for under 25s. */
  upperSecondaryThreshold: 4189,
  employeeMain: 0.08,
  employeeUpper: 0.02,
  employer: 0.15,
};

/** NI category letters this pack supports. */
export const NI_CATEGORIES = {
  A: "Standard",
  C: "Over State Pension age (no employee NI)",
  H: "Apprentice under 25",
  M: "Under 21",
  X: "Not liable for NI",
} as const;
export type NiCategory = keyof typeof NI_CATEGORIES;

/** Student and postgraduate loans: annual thresholds and rates. Confirm the 2026/27 thresholds. */
export const STUDENT_LOANS = {
  plan1: { label: "Plan 1", threshold: 26065, rate: 0.09 },
  plan2: { label: "Plan 2", threshold: 28470, rate: 0.09 },
  plan4: { label: "Plan 4", threshold: 32745, rate: 0.09 },
  plan5: { label: "Plan 5", threshold: 25000, rate: 0.09 },
  postgrad: { label: "Postgraduate loan", threshold: 21000, rate: 0.06 },
} as const;
export type LoanPlan = keyof typeof STUDENT_LOANS;

/**
 * Workplace pension auto enrolment, on qualifying earnings between the lower and upper limits.
 * The pack assumes relief at source: the employee's 5% is taken as 4% from net pay and the
 * scheme claims the other 1% from HMRC. The employer pays 3%.
 */
export const PENSION = {
  /** Earnings trigger for automatic enrolment, per month. */
  trigger: 833,
  lowerQualifying: 520,
  upperQualifying: 4189,
  employeeRate: 0.05,
  /** What the employee actually pays from net pay under relief at source. */
  employeeNetRate: 0.04,
  employerRate: 0.03,
};

export const UK_CONFIRM = "Check every rate and threshold against HMRC's 2026/27 tables, the Scottish bands, student loan thresholds, and whether your pension scheme uses relief at source or a net pay arrangement.";
