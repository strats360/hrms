import { and, eq, inArray, sql } from "drizzle-orm";
import { attendanceDevices, attendancePunches, attendanceRecords, employees, payrollRuns, type Database } from "@hrms/db";
import {
  DEFAULT_SHIFT,
  evaluateAttendance,
  istDateOf,
  matchImportColumns,
  parseImportDate,
  parseImportStatus,
  parseImportTime,
  parsePunchTime,
  todayIST,
  type AttendanceStatus,
  type ShiftRule,
} from "@hrms/shared";
import { istDateTime, shiftsById, upsertAttendance } from "./attendance";

type Emp = Pick<typeof employees.$inferSelect, "id" | "employeeCode" | "fullName" | "biometricId" | "shiftId" | "dateOfJoining" | "lastWorkingDay" | "status">;

async function employeeLookup(db: Database, tenantId: string) {
  const rows: Emp[] = await db
    .select({ id: employees.id, employeeCode: employees.employeeCode, fullName: employees.fullName, biometricId: employees.biometricId, shiftId: employees.shiftId, dateOfJoining: employees.dateOfJoining, lastWorkingDay: employees.lastWorkingDay, status: employees.status })
    .from(employees)
    .where(eq(employees.tenantId, tenantId));
  const byCode = new Map(rows.map((e) => [e.employeeCode.toUpperCase(), e]));
  const byBio = new Map(rows.filter((e) => e.biometricId).map((e) => [e.biometricId!.toUpperCase(), e]));
  return { byCode, byBio, find: (key: string) => byBio.get(key.trim().toUpperCase()) ?? byCode.get(key.trim().toUpperCase()) };
}

async function shiftResolver(db: Database, tenantId: string) {
  const { map, def } = await shiftsById(db, tenantId);
  return (shiftId: string | null): ShiftRule => {
    const s = (shiftId ? map.get(shiftId) : undefined) ?? def;
    return s ? { startTime: s.startTime, endTime: s.endTime, graceMinutes: s.graceMinutes, halfDayMinutes: s.halfDayMinutes, fullDayMinutes: s.fullDayMinutes } : DEFAULT_SHIFT;
  };
}

/** Months whose payroll is approved or paid: attendance there is final. */
async function lockedMonths(db: Database, tenantId: string) {
  const rows = await db.select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.status, ["approved", "paid"])));
  return new Set(rows.map((r) => r.month));
}

/** A day's in and out, with an out earlier than the in read as the next morning (night shifts). */
function dayTimes(date: string, inT: string, outT: string) {
  const checkIn = inT ? istDateTime(date, inT) : null;
  let checkOut = outT ? istDateTime(date, outT) : null;
  if (checkIn && checkOut && checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + 86400000);
  return { checkIn, checkOut };
}

export interface ImportRowResult {
  row: number;
  employeeCode: string;
  employeeName: string | null;
  date: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus | null;
  action: "create" | "update" | "skip" | "error";
  message: string | null;
}

/**
 * Bulk attendance from a spreadsheet or a biometric software export. A dry run checks
 * every row and says what would happen; nothing is written until it's run for real.
 * Days that already have attendance are left alone unless `overwrite` is set, and
 * months with an approved payroll are never changed.
 */
export async function importAttendance(db: Database, tenantId: string, table: string[][], opts: { dryRun: boolean; overwrite: boolean }) {
  const [header, ...lines] = table;
  if (!header) throw new Error("The file is empty");
  const col = matchImportColumns(header);
  if (col.employee < 0 || col.date < 0) throw new Error('The file needs "Employee ID" and "Date" columns, plus check-in/check-out times or a status');
  if (col.checkIn < 0 && col.status < 0) throw new Error('Add a "Check in" column, a "Status" column, or both');
  if (lines.length > 20000) throw new Error("Upload at most 20,000 rows at a time");

  const emps = await employeeLookup(db, tenantId);
  const shiftOf = await shiftResolver(db, tenantId);
  const locked = await lockedMonths(db, tenantId);
  const today = todayIST();

  type Ok = { r: ImportRowResult; emp: Emp; values: typeof attendanceRecords.$inferInsert };
  const results: ImportRowResult[] = [];
  const ok: Ok[] = [];
  const seen = new Set<string>();

  lines.forEach((cells, i) => {
    if (cells.every((x) => !x.trim())) return;
    const get = (k: number) => (k >= 0 ? (cells[k] ?? "").trim() : "");
    const code = get(col.employee);
    const r: ImportRowResult = { row: i + 2, employeeCode: code, employeeName: null, date: null, checkIn: null, checkOut: null, status: null, action: "error", message: null };
    results.push(r);
    const fail = (m: string) => (r.message = m);
    const emp = code ? emps.find(code) : undefined;
    if (!emp) return fail(code ? `Unknown employee "${code}"` : "Employee ID is missing");
    r.employeeCode = emp.employeeCode;
    r.employeeName = emp.fullName;
    const date = parseImportDate(get(col.date));
    if (!date) return fail(`"${get(col.date)}" isn't a date. Use YYYY-MM-DD or DD-MM-YYYY`);
    r.date = date;
    if (date > today) return fail("Future date");
    if (date < emp.dateOfJoining) return fail(`Before the date of joining (${emp.dateOfJoining})`);
    if (emp.lastWorkingDay && date > emp.lastWorkingDay) return fail(`After the last working day (${emp.lastWorkingDay})`);
    if (locked.has(date.slice(0, 7))) return fail(`Payroll for ${date.slice(0, 7)} is approved, so its attendance is locked`);
    const key = `${emp.id}|${date}`;
    if (seen.has(key)) return fail("This employee and date appear twice in the file");
    seen.add(key);
    const inT = parseImportTime(get(col.checkIn));
    const outT = parseImportTime(get(col.checkOut));
    if (inT === null) return fail(`"${get(col.checkIn)}" isn't a time`);
    if (outT === null) return fail(`"${get(col.checkOut)}" isn't a time`);
    if (outT && !inT) return fail("Check-out without a check-in");
    const given = parseImportStatus(get(col.status));
    if (given === null) return fail(`Unknown status "${get(col.status)}". Use P, A, HD, L, WFH, WO or H`);
    if (!inT && !given) return fail("Add a check-in time or a status");
    const { checkIn, checkOut } = dayTimes(date, inT, outT);
    const ev = checkIn ? evaluateAttendance(shiftOf(emp.shiftId), checkIn, checkOut, { wfh: given === "wfh" }) : null;
    // an explicit status wins; otherwise the shift rules decide from the times
    const status = (given || ev?.status) as AttendanceStatus;
    r.checkIn = inT || null;
    r.checkOut = outT || null;
    r.status = status;
    r.action = "create";
    ok.push({
      r,
      emp,
      values: {
        tenantId,
        employeeId: emp.id,
        date,
        checkIn,
        checkOut,
        source: "import",
        status,
        workMinutes: ev?.workMinutes ?? 0,
        lateMinutes: ev?.lateMinutes ?? 0,
        earlyMinutes: ev?.earlyMinutes ?? 0,
        overtimeMinutes: ev?.overtimeMinutes ?? 0,
        note: get(col.note) || null,
        isManual: true,
      },
    });
  });

  // what's already there
  if (ok.length) {
    const ids = [...new Set(ok.map((o) => o.emp.id))];
    const dates = ok.map((o) => o.values.date);
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await db
        .select({ e: attendanceRecords.employeeId, d: attendanceRecords.date })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.tenantId, tenantId), inArray(attendanceRecords.employeeId, ids.slice(i, i + 1000)), sql`${attendanceRecords.date} between ${min} and ${max}`));
      for (const x of rows) existing.add(`${x.e}|${x.d}`);
    }
    for (const o of ok) {
      if (!existing.has(`${o.emp.id}|${o.values.date}`)) continue;
      o.r.action = opts.overwrite ? "update" : "skip";
      o.r.message = opts.overwrite ? "Replaces the existing attendance" : "Already has attendance (tick overwrite to replace it)";
    }
  }

  let written = 0;
  if (!opts.dryRun) {
    for (const o of ok) {
      if (o.r.action === "skip") continue;
      await upsertAttendance(db, o.values);
      written++;
    }
  }
  const count = (a: ImportRowResult["action"]) => results.filter((r) => r.action === a).length;
  return { total: results.length, create: count("create"), update: count("update"), skip: count("skip"), errors: count("error"), written, results };
}

// ---------------------------------------------------------------------------
// Biometric devices
// ---------------------------------------------------------------------------
export interface PunchIn {
  userId: string;
  time: string;
  direction?: "in" | "out" | null;
}

/**
 * Store punches from a device and work out each affected day again: the first punch is
 * the check-in and the last is the check-out. Re-sending the same punches changes
 * nothing. A day HR entered or corrected by hand is kept as it is, and a month with an
 * approved payroll isn't touched.
 */
export async function ingestPunches(db: Database, device: typeof attendanceDevices.$inferSelect, punches: PunchIn[]) {
  const tenantId = device.tenantId;
  const emps = await employeeLookup(db, tenantId);
  const shiftOf = await shiftResolver(db, tenantId);
  const locked = await lockedMonths(db, tenantId);
  const unknown = new Set<string>();
  const invalid: string[] = [];
  const rows: (typeof attendancePunches.$inferInsert)[] = [];
  const now = Date.now();
  for (const p of punches) {
    const emp = emps.find(String(p.userId));
    if (!emp) {
      unknown.add(String(p.userId));
      continue;
    }
    const at = parsePunchTime(String(p.time));
    if (!at || at.getTime() > now + 10 * 60_000) {
      invalid.push(`${p.userId} @ ${p.time}`);
      continue;
    }
    rows.push({ tenantId, deviceId: device.id, employeeId: emp.id, punchedAt: at, date: istDateOf(at), direction: p.direction ?? null });
  }
  let accepted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const ins = await db.insert(attendancePunches).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: attendancePunches.id });
    accepted += ins.length;
  }

  // recompute the days these punches touch
  const days = new Map<string, { empId: string; date: string }>();
  for (const r of rows) days.set(`${r.employeeId}|${r.date}`, { empId: r.employeeId, date: r.date });
  const byId = new Map([...emps.byCode.values()].map((e) => [e.id, e]));
  let updated = 0;
  const skipped: string[] = [];
  for (const { empId, date } of days.values()) {
    const emp = byId.get(empId)!;
    if (locked.has(date.slice(0, 7))) {
      skipped.push(`${emp.employeeCode} ${date}: payroll locked`);
      continue;
    }
    const [cur] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.employeeId, empId), eq(attendanceRecords.date, date)));
    if (cur?.isManual) {
      skipped.push(`${emp.employeeCode} ${date}: entered by HR`);
      continue;
    }
    const times = (await db.select({ t: attendancePunches.punchedAt }).from(attendancePunches).where(and(eq(attendancePunches.tenantId, tenantId), eq(attendancePunches.employeeId, empId), eq(attendancePunches.date, date)))).map((x) => x.t.getTime());
    if (cur?.checkIn) times.push(cur.checkIn.getTime());
    if (cur?.checkOut) times.push(cur.checkOut.getTime());
    const first = Math.min(...times);
    const last = Math.max(...times);
    const checkIn = new Date(first);
    // a single punch is an arrival; a second one at least a minute later is the departure
    const checkOut = last - first >= 60_000 ? new Date(last) : null;
    const ev = evaluateAttendance(shiftOf(emp.shiftId), checkIn, checkOut, { wfh: cur?.status === "wfh" });
    await upsertAttendance(db, { tenantId, employeeId: empId, date, checkIn, checkOut, source: "biometric", status: ev.status, workMinutes: ev.workMinutes, lateMinutes: ev.lateMinutes, earlyMinutes: ev.earlyMinutes, overtimeMinutes: ev.overtimeMinutes, note: cur?.note ?? null, isManual: false });
    updated++;
  }
  const last = rows.reduce<Date | null>((m, r) => (!m || (r.punchedAt as Date) > m ? (r.punchedAt as Date) : m), null);
  await db
    .update(attendanceDevices)
    .set({ lastSeenAt: new Date(), punchCount: sql`${attendanceDevices.punchCount} + ${accepted}`, ...(last && (!device.lastPunchAt || last > device.lastPunchAt) ? { lastPunchAt: last } : {}) })
    .where(eq(attendanceDevices.id, device.id));
  return { received: punches.length, accepted, duplicates: rows.length - accepted, daysUpdated: updated, unknownUsers: [...unknown].slice(0, 50), invalid: invalid.slice(0, 50), skipped: skipped.slice(0, 50) };
}
