import { z } from "zod";
import { FILING_STATUSES } from "./rules";

const money = z.coerce.number().min(0).max(1e7).default(0);

/** Form W-4 (2020 and later) and pre-tax benefits, per US employee. */
export const usPayrollProfileSchema = z.object({
  filingStatus: z.enum(Object.keys(FILING_STATUSES) as [keyof typeof FILING_STATUSES, ...(keyof typeof FILING_STATUSES)[]]).default("single"),
  /** Step 2: multiple jobs or a working spouse, box checked. */
  multipleJobs: z.boolean().default(false),
  /** Step 3: credits for dependants, a year. */
  dependents: money,
  /** Step 4(a): other income a year. */
  otherIncome: money,
  /** Step 4(b): deductions a year beyond the standard deduction. */
  deductions: money,
  /** Step 4(c): extra withholding each pay period. */
  extraWithholding: money,
  /** Claimed exemption from federal income tax withholding (renewed each February). */
  exempt: z.boolean().default(false),
  /** Pre-tax 401(k) contribution, % of pay. */
  k401Percent: z.coerce.number().min(0).max(100).default(0),
  /** Pre-tax (Section 125) health premium each month. */
  preTaxHealth: money,
});
export type UsPayrollProfile = z.infer<typeof usPayrollProfileSchema>;
