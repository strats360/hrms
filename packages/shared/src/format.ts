/** Indian number and date formatting helpers shared by API and web. */

export function inr(n: number | string | null | undefined, opts: { decimals?: number } = {}): string {
  const v = Number(n ?? 0);
  const d = opts.decimals ?? 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Compact INR: ₹1.42 Cr, ₹14.40 L, ₹23,498 */
export function inrCompact(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (Math.abs(v) >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  return inr(v);
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

/** Today's date in India (IST) as YYYY-MM-DD, independent of server timezone. */
export function todayIST(now: Date = new Date()): string {
  return toISTDate(now);
}

export function toISTDate(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

/** "HH:MM" in IST for a timestamp. */
export function toISTTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  const ist = new Date(t.getTime() + 330 * 60_000);
  return ist.toISOString().slice(11, 16);
}

/** Minutes since IST midnight for a timestamp. */
export function istMinutes(d: Date): number {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
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

/** Indian financial year label for a date, e.g. "2026-27". */
export function financialYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
