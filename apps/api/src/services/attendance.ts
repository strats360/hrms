import { gte, inArray, lte } from "drizzle-orm";
import { attendanceRecords, holidays, leaveRequests } from "@hrms/db";
import { dateRange, todayIST, weekday, type AttendanceStatus } from "@hrms/shared";
import { holidaySet } from "./leave";
import { and, eq } from "drizzle-orm";
import { employees, shifts, type Database } from "@hrms/db";
import { DEFAULT_SHIFT, type ShiftRule } from "@hrms/shared";

export interface ResolvedShift extends ShiftRule {
  id: string | null;
  name: string;
  weeklyOffs: number[];
}

/** Shift for an employee: their own, else the tenant default, else 09:00-18:00. */
export async function shiftFor(db: Database, tenantId: string, employeeId: string): Promise<ResolvedShift> {
  const [emp] = await db.select({ shiftId: employees.shiftId }).from(employees).where(eq(employees.id, employeeId));
  const all = await db.select().from(shifts).where(eq(shifts.tenantId, tenantId));
  const s = all.find((x) => x.id === emp?.shiftId) ?? all.find((x) => x.isDefault) ?? all[0];
  if (!s) return { ...DEFAULT_SHIFT, id: null, name: "General", weeklyOffs: [0, 6] };
  return {
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    graceMinutes: s.graceMinutes,
    halfDayMinutes: s.halfDayMinutes,
    fullDayMinutes: s.fullDayMinutes,
    weeklyOffs: s.weeklyOffs,
  };
}

export async function shiftsById(db: Database, tenantId: string) {
  const all = await db.select().from(shifts).where(and(eq(shifts.tenantId, tenantId)));
  const def = all.find((s) => s.isDefault) ?? all[0] ?? null;
  return { map: new Map(all.map((s) => [s.id, s])), def };
}

/** Build a Date from an IST date (YYYY-MM-DD) and time (HH:MM). */
export function istDateTime(date: string, hhmm: string) {
  return new Date(`${date}T${hhmm}:00+05:30`);
}

// ---------------------------------------------------------------------------
// Calendar: derive a status for every employee/day from records, leave,
// holidays and weekly offs.
// ---------------------------------------------------------------------------

export type DayStatus = AttendanceStatus | "not_marked" | null;

export interface CalendarEmployee {
  id: string;
  shiftId: string | null;
  dateOfJoining: string;
  lastWorkingDay: string | null;
  branchId: string | null;
}

export async function buildCalendar(db: Database, tenantId: string, emps: CalendarEmployee[], from: string, to: string) {
  const ids = emps.map((e) => e.id);
  const today = todayIST();
  const { map: shiftMap, def } = await shiftsById(db, tenantId);
  const [records, leaves, hol] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(attendanceRecords)
          .where(and(eq(attendanceRecords.tenantId, tenantId), inArray(attendanceRecords.employeeId, ids), gte(attendanceRecords.date, from), lte(attendanceRecords.date, to)))
      : Promise.resolve([] as (typeof attendanceRecords.$inferSelect)[]),
    ids.length
      ? db
          .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, halfDay: leaveRequests.halfDay })
          .from(leaveRequests)
          .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "approved"), inArray(leaveRequests.employeeId, ids), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
      : Promise.resolve([]),
    db
      .select({ date: holidays.date, branchId: holidays.branchId })
      .from(holidays)
      .where(and(eq(holidays.tenantId, tenantId), gte(holidays.date, from), lte(holidays.date, to))),
  ]);
  const recMap = new Map(records.map((r) => [`${r.employeeId}|${r.date}`, r]));
  const leaveDays = new Map<string, boolean>();
  for (const l of leaves) for (const d of dateRange(l.startDate < from ? from : l.startDate, l.endDate > to ? to : l.endDate)) leaveDays.set(`${l.employeeId}|${d}`, l.halfDay);
  const days = dateRange(from, to);

  const status = (e: CalendarEmployee, d: string): DayStatus => {
    if (d < e.dateOfJoining || (e.lastWorkingDay && d > e.lastWorkingDay)) return null;
    const rec = recMap.get(`${e.id}|${d}`);
    if (rec) return rec.status as AttendanceStatus;
    const offs = (e.shiftId && shiftMap.get(e.shiftId)?.weeklyOffs) || def?.weeklyOffs || [0, 6];
    const isHoliday = hol.some((h) => h.date === d && (!h.branchId || h.branchId === e.branchId));
    if (isHoliday) return "holiday";
    if (offs.includes(weekday(d))) return "weekly_off";
    if (leaveDays.has(`${e.id}|${d}`)) return "on_leave";
    if (d > today) return null;
    if (d === today) return "not_marked";
    return "absent";
  };
  return { days, records: recMap, status };
}

/** Upsert a day's attendance record with evaluated status. */
export async function upsertAttendance(
  db: Database,
  values: typeof attendanceRecords.$inferInsert,
) {
  const [row] = await db
    .insert(attendanceRecords)
    .values(values)
    .onConflictDoUpdate({
      target: [attendanceRecords.tenantId, attendanceRecords.employeeId, attendanceRecords.date],
      set: {
        checkIn: values.checkIn,
        checkOut: values.checkOut,
        status: values.status,
        source: values.source,
        workMinutes: values.workMinutes ?? 0,
        lateMinutes: values.lateMinutes ?? 0,
        earlyMinutes: values.earlyMinutes ?? 0,
        overtimeMinutes: values.overtimeMinutes ?? 0,
        note: values.note,
        isManual: values.isManual ?? false,
        flags: values.flags ?? [],
        distanceM: values.distanceM ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export { holidaySet };
