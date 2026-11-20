/**
 * Overtime pay. Under the OSH Code (and most state Shops and Establishments Acts) overtime
 * needs the worker's consent and is paid at twice the ordinary rate of wages. The ordinary rate is worked out
 * per hour from the monthly wage, over 26 working days of 8 hours by default.
 */
export interface OvertimeSettings {
  enabled: boolean;
  /** "gross": all fixed pay (closest to the Act's "ordinary rate of wages"); "basic": basic only. */
  basis: "gross" | "basic";
  multiplier: number;
  daysPerMonth: number;
  hoursPerDay: number;
  /** Hours above this in a month get a warning. */
  monthlyLimitHours: number;
  /** The OSH Code's central cap: 144 hours a quarter (states set their own, e.g. Rajasthan 144, older rules 50 or 125). */
  quarterlyLimitHours: number;
}

export const DEFAULT_OVERTIME: OvertimeSettings = { enabled: true, basis: "gross", multiplier: 2, daysPerMonth: 26, hoursPerDay: 8, monthlyLimitHours: 50, quarterlyLimitHours: 144 };

/** The calendar quarter (Jan to Mar, Apr to Jun, ...) a month falls in, as its first and last months. */
export function quarterOf(month: string) {
  const y = Number(month.slice(0, 4));
  const q = Math.floor((Number(month.slice(5, 7)) - 1) / 3);
  const m = (n: number) => `${y}-${String(n).padStart(2, "0")}`;
  return { from: m(q * 3 + 1), to: m(q * 3 + 3) };
}

export function overtimeRate(monthly: { basic: number; gross: number }, s: OvertimeSettings = DEFAULT_OVERTIME) {
  const base = s.basis === "basic" ? monthly.basic : monthly.gross;
  return Math.round(((base / (s.daysPerMonth * s.hoursPerDay)) * s.multiplier) * 100) / 100;
}

export function overtimePay(hours: number, monthly: { basic: number; gross: number }, s: OvertimeSettings = DEFAULT_OVERTIME) {
  const rate = overtimeRate(monthly, s);
  return { ratePerHour: rate, amount: Math.round(rate * hours), overLimit: hours > s.monthlyLimitHours };
}

/** Leave encashment while in service, at basic / 26 a day (same as full and final). Taxable, and not ESI or PF wages. */
export const encashmentPerDay = (monthlyBasic: number) => Math.round((monthlyBasic / 26) * 100) / 100;
