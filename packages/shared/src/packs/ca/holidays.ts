import { easter } from "../gb/holidays";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function nth(y: number, m: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(y, m, 1));
  return plus(first, ((weekday - first.getUTCDay() + 7) % 7) + 7 * (n - 1));
}

/** Ontario's nine public holidays; other provinces add or swap a few (HR adjusts per entity). */
export function ontarioHolidays(y: number) {
  const may25 = new Date(Date.UTC(y, 4, 25));
  const victoria = plus(may25, -(((may25.getUTCDay() + 6) % 7) || 7)); // the Monday before 25 May
  const e = easter(y);
  const list: [Date, string][] = [
    [new Date(Date.UTC(y, 0, 1)), "New Year's Day"],
    [nth(y, 1, 1, 3), "Family Day"],
    [plus(e, -2), "Good Friday"],
    [victoria, "Victoria Day"],
    [new Date(Date.UTC(y, 6, 1)), "Canada Day"],
    [nth(y, 8, 1, 1), "Labour Day"],
    [nth(y, 9, 1, 2), "Thanksgiving"],
    [new Date(Date.UTC(y, 11, 25)), "Christmas Day"],
    [new Date(Date.UTC(y, 11, 26)), "Boxing Day"],
  ];
  return list.map(([d, name]) => ({ date: iso(d), name, type: "national" as const }));
}
