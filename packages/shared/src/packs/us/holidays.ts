const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function nth(y: number, m: number, weekday: number, n: number) {
  if (n < 0) {
    const end = new Date(Date.UTC(y, m + 1, 0));
    return plus(end, -((end.getUTCDay() - weekday + 7) % 7));
  }
  const first = new Date(Date.UTC(y, m, 1));
  return plus(first, ((weekday - first.getUTCDay() + 7) % 7) + 7 * (n - 1));
}
/** A fixed date holiday on a Saturday is observed on Friday, on a Sunday on Monday. */
function observed(y: number, m: number, d: number) {
  const day = new Date(Date.UTC(y, m, d));
  return day.getUTCDay() === 6 ? plus(day, -1) : day.getUTCDay() === 0 ? plus(day, 1) : day;
}

/** The eleven US federal holidays, as observed. */
export function usFederalHolidays(y: number) {
  const list: [Date, string][] = [
    [observed(y, 0, 1), "New Year's Day"],
    [nth(y, 0, 1, 3), "Martin Luther King Jr. Day"],
    [nth(y, 1, 1, 3), "Washington's Birthday"],
    [nth(y, 4, 1, -1), "Memorial Day"],
    [observed(y, 5, 19), "Juneteenth"],
    [observed(y, 6, 4), "Independence Day"],
    [nth(y, 8, 1, 1), "Labor Day"],
    [nth(y, 9, 1, 2), "Columbus Day"],
    [observed(y, 10, 11), "Veterans Day"],
    [nth(y, 10, 4, 4), "Thanksgiving Day"],
    [observed(y, 11, 25), "Christmas Day"],
  ];
  return list.map(([d, name]) => ({ date: iso(d), name, type: "national" as const }));
}
