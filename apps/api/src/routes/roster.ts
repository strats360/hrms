import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { attendanceRecords, employees, payrollRuns, shiftRoster, shifts } from "@hrms/db";
import { dateRange, evaluateAttendance, todayIST, weekday } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden } from "../lib/errors";
import { can } from "@hrms/shared";
import { createMiddleware } from "hono/factory";
import { audit } from "../lib/audit";
import { buildCalendar, shiftFor, upsertAttendance } from "../services/attendance";
import { scopedEmployees } from "./attendance";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The last day of the last locked payroll: the roster can't change before then. */
async function lockedUntil(c: Context<AppEnv>) {
  const [r] = await c.get("db").select({ end: payrollRuns.periodEnd }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]))).orderBy(desc(payrollRuns.periodEnd)).limit(1);
  return r?.end ?? null;
}

type Entry = { employeeId: string; date: string; shiftId: string | null; isOff: boolean } | { employeeId: string; date: string; clear: true };

/**
 * Save roster entries, then re-check any attendance already punched on those days against
 * the new shift (late, early, overtime).
 */
async function saveEntries(c: Context<AppEnv>, entries: Entry[]) {
  const db = c.get("db");
  if (!entries.length) return 0;
  const visible = new Map((await scopedEmployees(c)).map((e) => [e.id, e]));
  const companyShifts = new Set((await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.tenantId, tid(c)))).map((s) => s.id));
  const locked = await lockedUntil(c);
  for (const e of entries) {
    const emp = visible.get(e.employeeId);
    if (!emp) throw badRequest("You can only plan shifts for people on your team");
    if (locked && e.date <= locked) throw badRequest(`Payroll up to ${locked} is locked. Plan shifts from the day after.`);
    if (e.date < emp.dateOfJoining || (emp.lastWorkingDay && e.date > emp.lastWorkingDay)) continue;
    if (!("clear" in e) && !e.isOff && (!e.shiftId || !companyShifts.has(e.shiftId))) throw badRequest("Pick one of the company's shifts");
  }
  const userId = c.get("session")!.userId;
  for (const e of entries) {
    if ("clear" in e) await db.delete(shiftRoster).where(and(eq(shiftRoster.employeeId, e.employeeId), eq(shiftRoster.date, e.date), eq(shiftRoster.tenantId, tid(c))));
    else
      await db
        .insert(shiftRoster)
        .values({ tenantId: tid(c), employeeId: e.employeeId, date: e.date, shiftId: e.isOff ? null : e.shiftId, isOff: e.isOff, createdBy: userId })
        .onConflictDoUpdate({ target: [shiftRoster.employeeId, shiftRoster.date], set: { shiftId: e.isOff ? null : e.shiftId, isOff: e.isOff, createdBy: userId, updatedAt: new Date() } });
  }
  // punches already in on those days: evaluate them again with the shift now planned
  const past = entries.filter((e) => e.date <= todayIST());
  if (past.length) {
    const recs = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.tenantId, tid(c)), inArray(attendanceRecords.employeeId, [...new Set(past.map((e) => e.employeeId))]), inArray(attendanceRecords.date, [...new Set(past.map((e) => e.date))])));
    for (const r of recs.filter((r) => r.checkIn && !r.isManual && past.some((e) => e.employeeId === r.employeeId && e.date === r.date))) {
      const s = await shiftFor(db, tid(c), r.employeeId, r.date);
      const ev = evaluateAttendance(s, r.checkIn, r.checkOut, { wfh: r.source === "wfh" });
      await upsertAttendance(db, { ...r, status: ev.status, workMinutes: ev.workMinutes, lateMinutes: ev.lateMinutes, earlyMinutes: ev.earlyMinutes, overtimeMinutes: ev.overtimeMinutes });
    }
  }
  return entries.length;
}

/** Planning shifts: HR (attendance edit) or managers (attendance approve), each within their scope. */
const canPlan = createMiddleware<AppEnv>(async (c, next) => {
  const p = c.get("tenant").permissions;
  if (!can(p, "attendance", "edit") && !can(p, "attendance", "approve")) throw forbidden();
  await next();
});

export const rosterRoutes = new Hono<AppEnv>();

/** A week (or up to 31 days) of the roster: each person's shift or day off, by day. */
rosterRoutes.get("/", requirePerm("attendance", "view"), v("query", z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(31).default(7), departmentId: z.string().optional(), branchId: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const db = c.get("db");
  const to = plus(q.from, q.days - 1);
  const emps = await scopedEmployees(c, q);
  const all = await db.select().from(shifts).where(eq(shifts.tenantId, tid(c)));
  const def = all.find((s) => s.isDefault) ?? all[0] ?? null;
  const cal = await buildCalendar(db, tid(c), emps, q.from, to);
  const days = dateRange(q.from, to);
  const rows = emps.map((e) => {
    const usual = all.find((s) => s.id === e.shiftId) ?? def;
    return {
      employeeId: e.id,
      name: e.name,
      code: e.code,
      department: e.department,
      usualShiftId: usual?.id ?? null,
      cells: Object.fromEntries(
        days.map((d) => {
          const r = cal.roster.get(`${e.id}|${d}`);
          const st = cal.status(e, d);
          const employed = !(d < e.dateOfJoining || (e.lastWorkingDay && d > e.lastWorkingDay));
          return [
            d,
            {
              rostered: !!r,
              shiftId: r ? r.shiftId : (usual?.weeklyOffs ?? [0, 6]).includes(weekday(d)) ? null : (usual?.id ?? null),
              isOff: r ? r.isOff : (usual?.weeklyOffs ?? [0, 6]).includes(weekday(d)),
              holiday: st === "holiday",
              leave: st === "on_leave",
              employed,
            },
          ];
        }),
      ),
    };
  });
  return c.json({ days, shifts: all.map((s) => ({ id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime, isDefault: s.isDefault })), rows, lockedUntil: await lockedUntil(c) });
});

const entrySchema = z.union([
  z.object({ employeeId: z.string().min(1), date: isoDate, clear: z.literal(true) }),
  z.object({ employeeId: z.string().min(1), date: isoDate, shiftId: z.string().nullable(), isOff: z.boolean() }),
]);

rosterRoutes.put("/", canPlan, v("json", z.object({ entries: z.array(entrySchema).min(1).max(2000) })), async (c) => {
  const n = await saveEntries(c, c.req.valid("json").entries as Entry[]);
  await audit(c, { action: "roster.update", entity: "shift_roster", summary: `Updated ${n} roster ${n === 1 ? "entry" : "entries"}` });
  return c.json({ saved: n });
});

/** Plan a stretch of days for a group: one shift, with the chosen weekdays off. */
rosterRoutes.post("/fill", canPlan, v("json", z.object({ employeeIds: z.array(z.string()).min(1).max(500), from: isoDate, to: isoDate, shiftId: z.string().min(1), offDays: z.array(z.number().int().min(0).max(6)).max(6) })), async (c) => {
  const b = c.req.valid("json");
  if (b.to < b.from) throw badRequest("The end date is before the start");
  const days = dateRange(b.from, b.to);
  if (days.length > 62) throw badRequest("Plan up to two months at a time");
  const entries: Entry[] = b.employeeIds.flatMap((employeeId) => days.map((date) => ({ employeeId, date, shiftId: b.shiftId, isOff: b.offDays.includes(weekday(date)) })));
  const n = await saveEntries(c, entries);
  await audit(c, { action: "roster.fill", entity: "shift_roster", summary: `Planned ${b.employeeIds.length} ${b.employeeIds.length === 1 ? "person" : "people"} from ${b.from} to ${b.to}`, data: b });
  return c.json({ saved: n });
});

/** Copy one week's roster onto another week, for the same people. */
rosterRoutes.post("/copy-week", canPlan, v("json", z.object({ fromWeek: isoDate, toWeek: isoDate, employeeIds: z.array(z.string()).min(1).max(500) })), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const src = await db
    .select()
    .from(shiftRoster)
    .where(and(eq(shiftRoster.tenantId, tid(c)), inArray(shiftRoster.employeeId, b.employeeIds), gte(shiftRoster.date, b.fromWeek), lte(shiftRoster.date, plus(b.fromWeek, 6))));
  if (!src.length) throw badRequest("There's nothing planned in that week to copy");
  const shiftBy = Math.round((Date.parse(b.toWeek) - Date.parse(b.fromWeek)) / 86_400_000);
  const n = await saveEntries(c, src.map((r) => ({ employeeId: r.employeeId, date: plus(r.date, shiftBy), shiftId: r.shiftId, isOff: r.isOff })));
  await audit(c, { action: "roster.copy", entity: "shift_roster", summary: `Copied the roster from the week of ${b.fromWeek} to ${b.toWeek} (${n} entries)` });
  return c.json({ saved: n });
});

/** Self-service: my shifts for the next two weeks. */
export const essRosterRoutes = new Hono<AppEnv>();
essRosterRoutes.use("*", requireEmployee);
essRosterRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  const from = todayIST();
  const to = plus(from, 13);
  const all = await db.select().from(shifts).where(eq(shifts.tenantId, tid(c)));
  const [e] = await db.select({ id: employees.id, shiftId: employees.shiftId, branchId: employees.branchId, dateOfJoining: employees.dateOfJoining, lastWorkingDay: employees.lastWorkingDay }).from(employees).where(eq(employees.id, eid));
  if (!e) return c.json({ days: [] });
  const cal = await buildCalendar(db, tid(c), [e], from, to);
  const usual = all.find((s) => s.id === e.shiftId) ?? all.find((s) => s.isDefault) ?? all[0];
  return c.json({
    days: dateRange(from, to).map((d) => {
      const r = cal.roster.get(`${eid}|${d}`);
      const st = cal.status(e, d);
      const shift = r ? all.find((s) => s.id === r.shiftId) : usual;
      const off = st === "weekly_off";
      return { date: d, status: st === "holiday" ? "holiday" : st === "on_leave" ? "leave" : off ? "off" : "work", shift: !off && shift ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime } : null, changed: !!r };
    }),
  });
});
