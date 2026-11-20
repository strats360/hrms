/** Easter Sunday (Anonymous Gregorian algorithm). */
export function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
/** The first or last given weekday (0 = Sunday) of a month. */
function nth(y: number, m: number, weekday: number, last = false) {
  if (last) {
    const end = new Date(Date.UTC(y, m + 1, 0));
    return plus(end, -((end.getUTCDay() - weekday + 7) % 7));
  }
  const first = new Date(Date.UTC(y, m, 1));
  return plus(first, (weekday - first.getUTCDay() + 7) % 7);
}

/** England and Wales bank holidays, with substitute days when one falls on a weekend. */
export function englandBankHolidays(y: number) {
  const out: { date: string; name: string; type: "national" }[] = [];
  const add = (d: Date, name: string) => out.push({ date: iso(d), name, type: "national" });
  const ny = new Date(Date.UTC(y, 0, 1));
  add(ny.getUTCDay() === 6 ? plus(ny, 2) : ny.getUTCDay() === 0 ? plus(ny, 1) : ny, "New Year's Day");
  const e = easter(y);
  add(plus(e, -2), "Good Friday");
  add(plus(e, 1), "Easter Monday");
  add(nth(y, 4, 1), "Early May bank holiday");
  add(nth(y, 4, 1, true), "Spring bank holiday");
  add(nth(y, 7, 1, true), "Summer bank holiday");
  const xmas = new Date(Date.UTC(y, 11, 25));
  const wd = xmas.getUTCDay();
  // Christmas on Saturday: Mon 27 and Tue 28; on Sunday: Tue 27 for Christmas, Mon 26 for Boxing Day
  add(wd === 6 ? plus(xmas, 2) : wd === 0 ? plus(xmas, 2) : xmas, "Christmas Day");
  add(wd === 6 ? plus(xmas, 3) : wd === 5 ? plus(xmas, 3) : plus(xmas, 1), "Boxing Day");
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
