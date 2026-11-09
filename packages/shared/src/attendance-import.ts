import type { AttendanceStatus } from "./constants";

/**
 * Parsing for attendance uploads (spreadsheets and biometric software exports).
 * These files come in many shapes, so dates, times and status codes are read leniently.
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, DD-Mon-YYYY or DD Mon YYYY. Indian day-first order. */
export function parseImportDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return validYmd(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    return mon ? validYmd(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, mon, +m[1]!) : null;
  }
  return null;
}

/** 9:05, 09:05, 09:05:30, 0905, 9:05 AM, 9.05 pm. Returns HH:MM (24h), "" for blank, null if invalid. */
export function parseImportTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s || s === "-" || s === "--:--") return "";
  const m = s.match(/^(\d{1,2})(?:[:.]?(\d{2}))(?::\d{2})?\s?(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]!;
  const min = +(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

const STATUS_ALIASES: Record<string, AttendanceStatus> = {
  p: "present",
  present: "present",
  late: "late",
  lt: "late",
  hd: "half_day",
  "half day": "half_day",
  half_day: "half_day",
  halfday: "half_day",
  "1/2": "half_day",
  a: "absent",
  ab: "absent",
  absent: "absent",
  l: "on_leave",
  lv: "on_leave",
  leave: "on_leave",
  on_leave: "on_leave",
  "on leave": "on_leave",
  h: "holiday",
  hol: "holiday",
  holiday: "holiday",
  wo: "weekly_off",
  "w/o": "weekly_off",
  off: "weekly_off",
  "weekly off": "weekly_off",
  weekly_off: "weekly_off",
  wfh: "wfh",
  "work from home": "wfh",
};

/** P, A, HD, L, WFH, WO, H or the full names. "" when blank, null if unknown. */
export function parseImportStatus(raw: string): AttendanceStatus | "" | null {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  return STATUS_ALIASES[s] ?? null;
}

/** Header names people use for each column. */
export const ATTENDANCE_IMPORT_COLUMNS = {
  employee: ["employee id", "emp id", "employee code", "emp code", "code", "id"],
  date: ["date", "attendance date", "day"],
  checkIn: ["check in", "check-in", "in time", "in", "punch in", "first in"],
  checkOut: ["check out", "check-out", "out time", "out", "punch out", "last out"],
  status: ["status", "attendance", "remark code"],
  note: ["note", "notes", "remarks", "remark"],
} as const;

export function matchImportColumns(header: string[]) {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[_]+/g, " "));
  const find = (names: readonly string[]) => norm.findIndex((h) => names.includes(h));
  return {
    employee: find(ATTENDANCE_IMPORT_COLUMNS.employee),
    date: find(ATTENDANCE_IMPORT_COLUMNS.date),
    checkIn: find(ATTENDANCE_IMPORT_COLUMNS.checkIn),
    checkOut: find(ATTENDANCE_IMPORT_COLUMNS.checkOut),
    status: find(ATTENDANCE_IMPORT_COLUMNS.status),
    note: find(ATTENDANCE_IMPORT_COLUMNS.note),
  };
}

/**
 * A biometric punch time: ISO with an offset, or a local "YYYY-MM-DD HH:MM[:SS]" which is
 * taken as IST (devices in India keep local time).
 */
export function parsePunchTime(raw: string): Date | null {
  const s = raw.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The IST calendar date of an instant. */
export const istDateOf = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
