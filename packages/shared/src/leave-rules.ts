import { dateRange, weekday } from "./format";

/**
 * Count chargeable leave days in a range. Weekly offs and holidays inside the
 * range are not charged (no sandwich rule). Half day is only valid for one day.
 */
export function countLeaveDays(
  startDate: string,
  endDate: string,
  opts: { halfDay?: boolean; weeklyOffs?: number[]; holidays?: Iterable<string> } = {},
): number {
  const offs = new Set(opts.weeklyOffs ?? [0, 6]);
  const hol = new Set(opts.holidays ?? []);
  const days = dateRange(startDate, endDate).filter((d) => !offs.has(weekday(d)) && !hol.has(d)).length;
  if (opts.halfDay) return days > 0 ? 0.5 : 0;
  return days;
}

export interface LeaveTypeRule {
  annualQuota: number;
  accrual: "yearly" | "monthly" | "none";
}

/**
 * Leave accrued for a calendar leave year up to and including `asOf`.
 * - yearly: the full quota on 1 Jan, prorated by remaining months for mid-year joiners.
 * - monthly: quota/12 credited on the 1st of every month the employee is in service.
 * Results are rounded down to the nearest half day.
 */
export function accruedLeave(rule: LeaveTypeRule, year: number, asOf: string, dateOfJoining?: string | null): number {
  if (rule.accrual === "none" || rule.annualQuota <= 0) return 0;
  const [ay, am] = asOf.split("-").map(Number) as [number, number];
  if (ay < year) return 0;
  const lastMonth = ay > year ? 12 : am;
  let firstMonth = 1;
  if (dateOfJoining) {
    const [jy, jm, jd] = dateOfJoining.split("-").map(Number) as [number, number, number];
    if (jy > year) return 0;
    if (jy === year) firstMonth = jd <= 15 ? jm : jm + 1; // joined after the 15th: start next month
  }
  if (firstMonth > 12) return 0;
  let months: number;
  if (rule.accrual === "yearly") months = 12 - firstMonth + 1;
  else months = Math.max(0, lastMonth - firstMonth + 1);
  const raw = (rule.annualQuota * months) / 12;
  return Math.floor(raw * 2) / 2;
}

export function availableBalance(b: { opening: number; accrued: number; used: number; adjusted: number }): number {
  return Number(b.opening) + Number(b.accrued) + Number(b.adjusted) - Number(b.used);
}
