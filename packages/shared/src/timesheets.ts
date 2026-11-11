import { z } from "zod";

/** Weekly timesheets against projects, approved by the reporting manager. */
export const TIMESHEET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];
export const TIMESHEET_STATUS_LABEL: Record<TimesheetStatus, string> = { draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Sent back" };

export const MAX_DAY_MINUTES = 24 * 60;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The Monday of the week a date falls in. */
export function weekStart(date: string) {
  const d = day(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0
  d.setUTCDate(d.getUTCDate() - dow);
  return iso(d);
}
/** The seven dates of a week, Monday first. */
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => iso(new Date(day(monday).getTime() + i * 86_400_000)));
export const addWeeks = (monday: string, n: number) => iso(new Date(day(monday).getTime() + n * 7 * 86_400_000));

/** "7h 30m", or "0h". */
export function hoursLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
/** Hours typed as 7.5, 7:30 or 7h30 into minutes. Null when it can't be read. */
export function parseHours(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return 0;
  let m = /^(\d{1,2})(?::|h\s*)(\d{1,2})m?$/.exec(s);
  if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  m = /^(\d{1,2}(?:\.\d{1,2})?)h?$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

export interface GridRow {
  projectId: string;
  note: string;
  minutes: Record<string, number>;
}
/** What stops a week being saved or submitted, or null. */
export function timesheetProblem(rows: GridRow[], dates: string[], submit: boolean) {
  for (const d of dates) {
    const total = rows.reduce((a, r) => a + (r.minutes[d] ?? 0), 0);
    if (total > MAX_DAY_MINUTES) return `More than 24 hours on ${d}`;
  }
  if (rows.some((r) => Object.keys(r.minutes).some((d) => !dates.includes(d)))) return "Some hours are outside this week";
  if (submit && !rows.some((r) => Object.values(r.minutes).some((m) => m > 0))) return "Add some hours before you submit";
  return null;
}

export const projectSchema = z.object({
  code: z.string().trim().min(2, "Give it a short code").max(20),
  name: z.string().trim().min(2, "Name the project").max(120),
  client: z.string().trim().max(120).nullable().default(null),
  billable: z.boolean().default(true),
  status: z.enum(["active", "archived"]).default("active"),
});
export const timesheetSaveSchema = z.object({
  rows: z
    .array(
      z.object({
        projectId: z.string(),
        note: z.string().trim().max(300).default(""),
        minutes: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int().min(0).max(MAX_DAY_MINUTES)),
      }),
    )
    .max(40),
  submit: z.boolean().default(false),
});
export const timesheetRejectSchema = z.object({ reason: z.string().trim().min(3, "Say what needs fixing").max(1000) });
