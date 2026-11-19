/**
 * Number, money and date helpers shared by the API and the web app.
 *
 * Each site (instance) has a default time zone and currency, set once at start up with
 * setLocalDefaults (India: Asia/Kolkata and INR). Anything that belongs to a legal entity in
 * another zone or currency passes it explicitly. See docs/MULTI_COUNTRY.md.
 */

let DEFAULT_ZONE = "Asia/Kolkata";
let DEFAULT_CURRENCY = "INR";

/** Set the site's default time zone and currency (Worker start up, or the web app after sign in). */
export function setLocalDefaults(d: { timeZone?: string | null; currency?: string | null }) {
  if (d.timeZone) DEFAULT_ZONE = d.timeZone;
  if (d.currency) DEFAULT_CURRENCY = d.currency;
}
export const localTimeZone = () => DEFAULT_ZONE;
export const localCurrency = () => DEFAULT_CURRENCY;

/** Minor units for a currency: 3 for KWD, OMR and BHD, 0 for JPY, otherwise 2. */
export function currencyDecimals(currency: string = DEFAULT_CURRENCY): number {
  if (["KWD", "OMR", "BHD", "JOD", "TND", "LYD", "IQD"].includes(currency)) return 3;
  if (["JPY", "KRW", "VND", "CLP"].includes(currency)) return 0;
  return 2;
}

/** Round to a currency's minor units (or to `decimals`). */
export function roundMoney(n: number, decimals = currencyDecimals()): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", GBP: "£", EUR: "€" };
const LOCALES: Record<string, string> = { INR: "en-IN", USD: "en-US", GBP: "en-GB" };

/**
 * A money amount for display: ₹1,23,456 in India, AED 12,345.00, $1,234.00.
 * `decimals` defaults to 0 for INR (whole rupees, as the app has always shown) and to the
 * currency's minor units otherwise.
 */
export function fmtMoney(n: number | string | null | undefined, opts: { decimals?: number; currency?: string } = {}): string {
  const v = Number(n ?? 0);
  const cur = opts.currency ?? DEFAULT_CURRENCY;
  const d = opts.decimals ?? (cur === "INR" ? 0 : currencyDecimals(cur));
  const sym = SYMBOLS[cur] ?? cur + " ";
  return sym + v.toLocaleString(LOCALES[cur] ?? "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Compact amounts: ₹1.42 Cr and ₹14.40 L for rupees, $1.4M and AED 23.5K elsewhere. */
export function fmtMoneyCompact(n: number | string | null | undefined, opts: { currency?: string } = {}): string {
  const v = Number(n ?? 0);
  const cur = opts.currency ?? DEFAULT_CURRENCY;
  const sym = SYMBOLS[cur] ?? cur + " ";
  if (cur === "INR") {
    if (Math.abs(v) >= 1e7) return sym + (v / 1e7).toFixed(2) + " Cr";
    if (Math.abs(v) >= 1e5) return sym + (v / 1e5).toFixed(2) + " L";
    return fmtMoney(v, { currency: cur });
  }
  if (Math.abs(v) >= 1e6) return sym + (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e4) return sym + (v / 1e3).toFixed(1) + "K";
  return fmtMoney(v, { currency: cur, decimals: 0 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-05" -> "05 Nov 2026" */
export function fmtDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[Number(m) - 1]}${withYear ? " " + y : ""}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function maskAccount(acct: string | null | undefined): string {
  if (!acct) return "—";
  return "···· " + acct.slice(-4);
}

// ---- dates and times in a time zone ----
// India has no daylight saving, so Asia/Kolkata keeps the fast fixed offset. Other zones use Intl.

const IST_OFFSET = 330;
const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneParts(d: Date, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute), s: Number(p.second) };
}

/** Minutes the zone is ahead of UTC at that moment (330 for India, 240 for Dubai). */
export function zoneOffsetMinutes(tz: string = DEFAULT_ZONE, at: Date = new Date()): number {
  if (tz === "Asia/Kolkata") return IST_OFFSET;
  const p = zoneParts(at, tz);
  const asUtc = Date.parse(`${p.date}T${String(p.h).padStart(2, "0")}:${String(p.m).padStart(2, "0")}:${String(p.s).padStart(2, "0")}Z`);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The calendar date (YYYY-MM-DD) of a moment in a time zone. */
export function toLocalDate(d: Date, tz: string = DEFAULT_ZONE): string {
  if (tz === "Asia/Kolkata") return new Date(d.getTime() + IST_OFFSET * 60_000).toISOString().slice(0, 10);
  return zoneParts(d, tz).date;
}

/** Today's date (YYYY-MM-DD) in the site's time zone, or `tz`, whatever the server's zone. */
export function todayLocal(now: Date = new Date(), tz: string = DEFAULT_ZONE): string {
  return toLocalDate(now, tz);
}

/** "HH:MM" of a moment in a time zone. */
export function toLocalTime(d: Date | string | null | undefined, tz: string = DEFAULT_ZONE): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  if (tz === "Asia/Kolkata") return new Date(t.getTime() + IST_OFFSET * 60_000).toISOString().slice(11, 16);
  const p = zoneParts(t, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.m).padStart(2, "0")}`;
}

/** Minutes since local midnight for a moment in a time zone. */
export function localMinutes(d: Date, tz: string = DEFAULT_ZONE): number {
  if (tz === "Asia/Kolkata") {
    const ist = new Date(d.getTime() + IST_OFFSET * 60_000);
    return ist.getUTCHours() * 60 + ist.getUTCMinutes();
  }
  const p = zoneParts(d, tz);
  return p.h * 60 + p.m;
}

/** The moment a local date and "HH:MM" happen in a time zone, e.g. 09:00 on 2026-11-05 in Dubai. */
export function zonedDateTime(date: string, hhmm: string, tz: string = DEFAULT_ZONE): Date {
  const guess = new Date(`${date}T${hhmm.length === 5 ? hhmm + ":00" : hhmm}Z`);
  // the offset at the guess, then again at the result, handles daylight saving changes
  const first = new Date(guess.getTime() - zoneOffsetMinutes(tz, guess) * 60_000);
  return new Date(guess.getTime() - zoneOffsetMinutes(tz, first) * 60_000);
}

/** Inclusive list of YYYY-MM-DD dates between two dates. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 0 = Sunday ... 6 = Saturday for a YYYY-MM-DD date. */
export function weekday(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Indian financial year (April to March) label for a date, e.g. "2026-27". */
export function financialYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
