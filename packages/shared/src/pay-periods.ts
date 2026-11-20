/**
 * Pay frequencies and the pay calendar. Monthly is the default everywhere; the US and Canada
 * also pay semi-monthly (the 15th and the last day), biweekly and weekly. Biweekly and weekly
 * periods run on from an anchor date, the first day of any one period.
 */
export const PAY_FREQUENCIES = ["monthly", "semi_monthly", "biweekly", "weekly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = { monthly: "Monthly", semi_monthly: "Semi-monthly (15th and last day)", biweekly: "Every two weeks", weekly: "Weekly" };
export const PERIODS_PER_YEAR: Record<PayFrequency, number> = { monthly: 12, semi_monthly: 24, biweekly: 26, weekly: 52 };

export interface PayPeriod {
  frequency: PayFrequency;
  start: string;
  end: string;
  payDate: string;
  /** The month the pay date falls in, YYYY-MM: reports and year to date group by it. */
  month: string;
  days: number;
  perYear: number;
}

const DAY = 86400000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Days between two dates, inclusive. */
const span = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY) + 1;

function make(frequency: PayFrequency, start: string, end: string, payDate: string): PayPeriod {
  return { frequency, start, end, payDate, month: payDate.slice(0, 7), days: span(start, end), perYear: PERIODS_PER_YEAR[frequency] };
}

/** Biweekly and weekly pay on the Friday after the period ends (five days after a Sunday). */
const PAY_LAG_DAYS = 5;

/** The period that contains `date`. Biweekly and weekly need the anchor. */
export function periodContaining(frequency: PayFrequency, date: string, anchor?: string | null): PayPeriod {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const ym = date.slice(0, 7);
  if (frequency === "monthly") {
    const end = `${ym}-${String(lastDay(y, m)).padStart(2, "0")}`;
    return make(frequency, `${ym}-01`, end, end);
  }
  if (frequency === "semi_monthly") {
    const end = `${ym}-${String(lastDay(y, m)).padStart(2, "0")}`;
    return d <= 15 ? make(frequency, `${ym}-01`, `${ym}-15`, `${ym}-15`) : make(frequency, `${ym}-16`, end, end);
  }
  const len = frequency === "biweekly" ? 14 : 7;
  if (!anchor) throw new Error("Biweekly and weekly pay need the first day of a pay period");
  const k = Math.floor((toDate(date).getTime() - toDate(anchor).getTime()) / DAY / len);
  const start = addDays(anchor, k * len);
  const end = addDays(start, len - 1);
  return make(frequency, start, end, addDays(end, PAY_LAG_DAYS));
}

/** The period right after `p`. */
export const nextPeriod = (p: PayPeriod, anchor?: string | null) => periodContaining(p.frequency, addDays(p.end, 1), anchor ?? p.start);

/** Is `start` the first day of a period on this calendar? */
export const isPeriodStart = (frequency: PayFrequency, start: string, anchor?: string | null) => periodContaining(frequency, start, anchor).start === start;

/**
 * The position of a period in its tax year, counted by pay date: 1 for the first pay of the year.
 * `startMonth` is the month the tax year starts (1 in the US and Canada).
 */
export function periodIndex(p: PayPeriod, startMonth = 1, anchor?: string | null): number {
  const y = Number(p.payDate.slice(0, 4));
  const m = Number(p.payDate.slice(5, 7));
  const yearStart = `${m >= startMonth ? y : y - 1}-${String(startMonth).padStart(2, "0")}-01`;
  let n = 1;
  let prev = p;
  // walk back while the earlier pay date is still in this tax year
  for (let i = 0; i < 60; i++) {
    const before = periodContaining(p.frequency, addDays(prev.start, -1), anchor ?? p.start);
    if (before.payDate < yearStart) break;
    n++;
    prev = before;
  }
  return n;
}

/** A short label: "March 2026" for monthly, "1 to 15 Mar 2026" otherwise. */
export function periodLabel(p: { frequency?: string | null; periodStart: string; periodEnd: string; month: string }): string {
  if (!p.frequency || p.frequency === "monthly") {
    const [y, m] = p.month.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const f = (s: string, withMonth: boolean, withYear: boolean) => {
    const d = toDate(s);
    return [d.getUTCDate(), withMonth ? d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) : null, withYear ? d.getUTCFullYear() : null].filter(Boolean).join(" ");
  };
  const sameMonth = p.periodStart.slice(0, 7) === p.periodEnd.slice(0, 7);
  const sameYear = p.periodStart.slice(0, 4) === p.periodEnd.slice(0, 4);
  return `${f(p.periodStart, !sameMonth, !sameYear)} to ${f(p.periodEnd, true, true)}`;
}
