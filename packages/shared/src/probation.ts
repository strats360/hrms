/** Probation: when it ends, and what the manager recommends. */
export const PROBATION_RECOMMENDATIONS = ["confirm", "extend", "not_confirm"] as const;
export type ProbationRecommendation = (typeof PROBATION_RECOMMENDATIONS)[number];
export const PROBATION_RECOMMENDATION_LABEL: Record<ProbationRecommendation, string> = { confirm: "Confirm", extend: "Extend probation", not_confirm: "Don't confirm" };

export interface ProbationSettings {
  /** Remind the manager and HR this many days before probation ends. */
  reminderDays: number;
  /** Months of probation for new joiners when the employee record doesn't say. */
  defaultMonths: number;
}
export const DEFAULT_PROBATION: ProbationSettings = { reminderDays: 15, defaultMonths: 6 };

/** Add calendar months to an ISO date; the 31st becomes the month's last day if needed. */
export function addMonthsToDate(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** When probation ends: the confirmation date on record (it moves when probation is extended), else joining + months. */
export function probationEndDate(e: { dateOfJoining: string; probationMonths?: number | null; confirmationDate?: string | null }, defaultMonths = DEFAULT_PROBATION.defaultMonths) {
  return e.confirmationDate ?? addMonthsToDate(e.dateOfJoining, e.probationMonths ?? defaultMonths);
}
