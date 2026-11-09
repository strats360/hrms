/**
 * Overtime pay. Under the Factories Act (and most state Shops and Establishments Acts)
 * overtime is paid at twice the ordinary rate of wages. The ordinary rate is worked out
 * per hour from the monthly wage, over 26 working days of 8 hours by default.
 */
export interface OvertimeSettings {
  enabled: boolean;
  /** "gross": all fixed pay (closest to the Act's "ordinary rate of wages"); "basic": basic only. */
  basis: "gross" | "basic";
  multiplier: number;
  daysPerMonth: number;
  hoursPerDay: number;
  /** Hours above this in a month get a warning (the Factories Act allows 50 a quarter, 125 under some state rules). */
  monthlyLimitHours: number;
}

export const DEFAULT_OVERTIME: OvertimeSettings = { enabled: true, basis: "gross", multiplier: 2, daysPerMonth: 26, hoursPerDay: 8, monthlyLimitHours: 50 };

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
