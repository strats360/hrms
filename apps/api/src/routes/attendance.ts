import { Hono } from "hono";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { attendanceCorrections, attendanceRecords, branches, departments, designations, employees } from "@hrms/db";
import {
  can,
  ATTENDANCE_CODES,
  ATTENDANCE_STATUS_LABELS,
  bulkDecisionSchema,
  daysInMonth,
  decisionSchema,
  evaluateAttendance,
  manualAttendanceSchema,
  todayIST,
  toISTTime,
  type AttendanceStatus,
} from "@hrms/shared";
import { z } from "zod";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { getFile } from "../lib/storage";
import { buildCalendar, istDateTime, shiftFor, upsertAttendance } from "../services/attendance";
import { inScope, teamScope } from "../services/scope";
import { approvalPolicy, approvalScope, chainFor, recordDecision, waitingOn } from "../services/approvals";

export const attendanceRoutes = new Hono<AppEnv>();

const ACTIVE = sql`${employees.status} not in ('exited','inactive','onboarding')`;

export async function scopedEmployees(c: Context<AppEnv>, extra?: { departmentId?: string; branchId?: string }) {
  const tid = c.get("tenant").tenantId;
  const scope = await teamScope(c, "attendance");
  if (scope && scope.length === 0) return [];
  const conds = [eq(employees.tenantId, tid), ACTIVE];
  if (scope) conds.push(inArray(employees.id, scope));
  if (extra?.departmentId) conds.push(eq(employees.departmentId, extra.departmentId));
  if (extra?.branchId) conds.push(eq(employees.branchId, extra.branchId));
  return c
    .get("db")
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: employees.fullName,
      shiftId: employees.shiftId,
      branchId: employees.branchId,
      dateOfJoining: employees.dateOfJoining,
      lastWorkingDay: employees.lastWorkingDay,
      department: departments.name,
      designation: designations.name,
      branch: branches.name,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(...conds))
    .orderBy(asc(employees.fullName));
}

/** Today: one row per employee with derived status, plus counts. */
attendanceRoutes.get("/today", requirePerm("attendance", "view"), v("query", z.object({ date: z.string().optional() })), async (c) => {
  const date = c.req.valid("query").date ?? todayIST();
  const emps = await scopedEmployees(c);
  const cal = await buildCalendar(c.get("db"), c.get("tenant").tenantId, emps, date, date);
  const rows = emps.map((e) => {
    const rec = cal.records.get(`${e.id}|${date}`);
    return {
      employeeId: e.id,
      code: e.code,
      name: e.name,
      department: e.department,
      designation: e.designation,
      branch: e.branch,
      status: cal.status(e, date),
      checkIn: rec?.checkIn ? toISTTime(rec.checkIn) : null,
      checkOut: rec?.checkOut ? toISTTime(rec.checkOut) : null,
      source: rec?.source ?? null,
      lateMinutes: rec?.lateMinutes ?? 0,
      workMinutes: rec?.workMinutes ?? 0,
      overtimeMinutes: rec?.overtimeMinutes ?? 0,
      earlyMinutes: rec?.earlyMinutes ?? 0,
      flags: rec?.flags ?? [],
      // where and how they punched, for the punch details view
      punch:
        rec && (rec.lat != null || rec.checkOutLat != null || rec.checkInSelfieKey || rec.checkOutSelfieKey)
          ? { recordId: rec.id, inLat: rec.lat, inLng: rec.lng, outLat: rec.checkOutLat, outLng: rec.checkOutLng, distanceM: rec.distanceM, inSelfie: !!rec.checkInSelfieKey, outSelfie: !!rec.checkOutSelfieKey }
          : null,
    };
  });
  const count = (...s: (string | null)[]) => rows.filter((r) => s.includes(r.status)).length;
  return c.json({
    date,
    summary: {
      total: rows.filter((r) => r.status !== null).length,
      present: count("present", "late", "wfh", "half_day"),
      wfh: count("wfh"),
      late: count("late"),
      flagged: rows.filter((r) => r.flags.length).length,
      halfDay: count("half_day"),
      absent: count("absent"),
      notMarked: count("not_marked"),
      onLeave: count("on_leave"),
      off: count("weekly_off", "holiday"),
    },
    rows,
  });
});

/** A punch selfie, for HR (and managers, for their own team). */
attendanceRoutes.get("/records/:id/selfie/:which", requirePerm("attendance", "view"), async (c) => {
  const which = c.req.param("which");
  if (which !== "in" && which !== "out") throw notFound("Selfie");
  const [rec] = await c.get("db").select().from(attendanceRecords).where(and(eq(attendanceRecords.id, c.req.param("id")), eq(attendanceRecords.tenantId, c.get("tenant").tenantId)));
  if (!rec || !inScope(await teamScope(c, "attendance"), rec.employeeId)) throw notFound("Selfie");
  const key = which === "in" ? rec.checkInSelfieKey : rec.checkOutSelfieKey;
  const file = key ? await getFile(c.env, key) : null;
  if (!file) throw notFound("Selfie");
  return c.body(file.body as never, 200, { "Content-Type": file.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
});

const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  departmentId: z.string().optional(),
  branchId: z.string().optional(),
});

async function monthly(c: Context<AppEnv>, q: z.infer<typeof monthQuery>) {
  const month = q.month ?? todayIST().slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const emps = await scopedEmployees(c, q);
  const cal = await buildCalendar(c.get("db"), c.get("tenant").tenantId, emps, from, to);
  const rows = emps.map((e) => {
    const statuses = cal.days.map((d) => cal.status(e, d));
    const t = (s: string) => statuses.filter((x) => x === s).length;
    const present = t("present") + t("late") + t("wfh") + t("half_day") * 0.5;
    return {
      employeeId: e.id,
      code: e.code,
      name: e.name,
      department: e.department,
      days: statuses,
      totals: {
        present,
        late: t("late"),
        halfDay: t("half_day"),
        absent: t("absent"),
        leave: t("on_leave"),
        off: t("weekly_off") + t("holiday"),
        paidDays: present + t("on_leave") + t("weekly_off") + t("holiday"),
      },
    };
  });
  return { month, days: cal.days, rows };
}

attendanceRoutes.get("/monthly", requirePerm("attendance", "view"), v("query", monthQuery), async (c) => c.json(await monthly(c, c.req.valid("query"))));

attendanceRoutes.get("/monthly.csv", requirePerm("attendance", "export"), v("query", monthQuery), async (c) => {
  const data = await monthly(c, c.req.valid("query"));
  const csv = toCsv(
    ["Employee ID", "Name", "Department", ...data.days.map((d) => d.slice(8)), "Present", "Late", "Half days", "Absent", "Leave", "Off", "Paid days"],
    data.rows.map((r) => [
      r.code,
      r.name,
      r.department,
      ...r.days.map((s) => (s && s !== "not_marked" ? ATTENDANCE_CODES[s as AttendanceStatus] : "")),
      r.totals.present,
      r.totals.late,
      r.totals.halfDay,
      r.totals.absent,
      r.totals.leave,
      r.totals.off,
      r.totals.paidDays,
    ]),
  );
  await audit(c, { action: "attendance.export", entity: "attendance", summary: `Exported attendance register ${data.month}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${data.month}.csv"` });
});

/** Manual entry / override by HR. */
attendanceRoutes.post("/manual", requirePerm("attendance", "edit"), v("json", manualAttendanceSchema), async (c) => {
  const body = c.req.valid("json");
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, body.employeeId), eq(employees.tenantId, tid)));
  if (!emp) throw notFound("Employee");
  if (body.date > todayIST()) throw badRequest("You can't mark attendance for a future date");
  const shift = await shiftFor(db, tid, emp.id, body.date);
  const checkIn = body.checkIn ? istDateTime(body.date, body.checkIn) : null;
  const checkOut = body.checkOut ? istDateTime(body.date, body.checkOut) : null;
  if (checkIn && checkOut && checkOut <= checkIn) throw badRequest("Check-out must be after check-in");
  const ev = checkIn ? evaluateAttendance(shift, checkIn, checkOut, { wfh: body.status === "wfh" }) : null;
  const row = await upsertAttendance(db, {
    tenantId: tid,
    employeeId: emp.id,
    date: body.date,
    checkIn,
    checkOut,
    source: "manual",
    status: body.status,
    workMinutes: ev?.workMinutes ?? 0,
    lateMinutes: ev?.lateMinutes ?? 0,
    earlyMinutes: ev?.earlyMinutes ?? 0,
    overtimeMinutes: ev?.overtimeMinutes ?? 0,
    note: body.note ?? null,
    isManual: true,
  });
  await audit(c, { action: "attendance.manual", entity: "attendance", entityId: row.id, summary: `Marked ${emp.fullName} ${ATTENDANCE_STATUS_LABELS[body.status]} on ${body.date}` });
  return c.json(row);
});

// ---------- corrections ----------
attendanceRoutes.get("/corrections", requirePerm("attendance", "view"), v("query", z.object({ status: z.string().optional() })), async (c) => {
  const tid = c.get("tenant").tenantId;
  const scope = await approvalScope(c, "attendance", "attendance");
  const status = c.req.valid("query").status;
  const conds = [eq(attendanceCorrections.tenantId, tid)];
  if (status) conds.push(eq(attendanceCorrections.status, status));
  if (scope) conds.push(inArray(attendanceCorrections.employeeId, scope.length ? scope : ["-"]));
  const rows = await c
    .get("db")
    .select({ r: attendanceCorrections, name: employees.fullName, code: employees.employeeCode })
    .from(attendanceCorrections)
    .innerJoin(employees, eq(employees.id, attendanceCorrections.employeeId))
    .where(and(...conds))
    .orderBy(desc(attendanceCorrections.createdAt))
    .limit(500);
  const db = c.get("db");
  const policy = await approvalPolicy(db, tid);
  const t = c.get("tenant");
  const isHr = can(t.permissions, "attendance", "configure");
  const out = [];
  for (const x of rows) {
    let waiting = null;
    if (x.r.status === "pending") {
      waiting = waitingOn(await chainFor(db, tid, "attendance", x.r.employeeId, undefined, policy), x.r.approvals);
      if (waiting) waiting = { ...waiting, yourTurn: x.r.employeeId !== t.employeeId && (isHr || waiting.approverEmployeeId === t.employeeId), asHr: isHr && waiting.step !== "hr" && waiting.approverEmployeeId !== t.employeeId };
    }
    out.push({ ...x.r, employeeName: x.name, employeeCode: x.code, waitingOn: waiting });
  }
  return c.json(out);
});

async function decideCorrection(c: Context<AppEnv>, id: string, decision: "approved" | "rejected", note: string | null | undefined) {
  const db = c.get("db");
  const t = c.get("tenant");
  const [corr] = await db.select().from(attendanceCorrections).where(and(eq(attendanceCorrections.id, id), eq(attendanceCorrections.tenantId, t.tenantId)));
  if (!corr) throw notFound("Correction request");
  if (corr.status !== "pending") throw badRequest("This request has already been decided");
  if (corr.employeeId === t.employeeId) throw forbidden("You can't approve your own request");
  if (!inScope(await approvalScope(c, "attendance", "attendance"), corr.employeeId)) throw forbidden("This employee isn't in your team");
  if (decision === "rejected" && !note) throw badRequest("Add a reason for rejecting");
  const step = await recordDecision(c, "attendance", "attendance", { employeeId: corr.employeeId, approvals: corr.approvals }, decision, note);
  await db.update(attendanceCorrections).set({ approvals: step.approvals }).where(eq(attendanceCorrections.id, id));
  if (!step.final) {
    await audit(c, { action: "attendance_correction.approve_step", entity: "attendance_correction", entityId: id, summary: `Approved the correction for ${corr.date} at step ${step.approvals.length} of ${step.chain.length}` });
    return;
  }

  if (decision === "approved") {
    const [existing] = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.tenantId, t.tenantId), eq(attendanceRecords.employeeId, corr.employeeId), eq(attendanceRecords.date, corr.date)));
    const shift = await shiftFor(db, t.tenantId, corr.employeeId, corr.date);
    const checkIn = corr.requestedCheckIn ? istDateTime(corr.date, corr.requestedCheckIn) : (existing?.checkIn ?? null);
    const checkOut = corr.requestedCheckOut ? istDateTime(corr.date, corr.requestedCheckOut) : (existing?.checkOut ?? null);
    const wfh = corr.requestedStatus === "wfh" || existing?.source === "wfh";
    const ev = evaluateAttendance(shift, checkIn, checkOut, { wfh });
    await upsertAttendance(db, {
      tenantId: t.tenantId,
      employeeId: corr.employeeId,
      date: corr.date,
      checkIn,
      checkOut,
      source: existing?.source ?? (wfh ? "wfh" : "manual"),
      status: (corr.requestedStatus as AttendanceStatus | null) ?? ev.status,
      workMinutes: ev.workMinutes,
      lateMinutes: ev.lateMinutes,
      earlyMinutes: ev.earlyMinutes,
      overtimeMinutes: ev.overtimeMinutes,
      note: `Correction ${corr.issue}`,
      isManual: true,
    });
  }
  await db
    .update(attendanceCorrections)
    .set({ status: decision, reviewerUserId: c.get("session")!.userId, reviewedAt: new Date(), reviewNote: note ?? null })
    .where(eq(attendanceCorrections.id, id));
  await audit(c, { action: `attendance_correction.${decision}`, entity: "attendance_correction", entityId: id, summary: `${decision === "approved" ? "Approved" : "Rejected"} correction for ${corr.date}` });
}

attendanceRoutes.post("/corrections/:id/decision", requirePerm("attendance", "approve"), v("json", decisionSchema), async (c) => {
  const b = c.req.valid("json");
  await decideCorrection(c, c.req.param("id"), b.decision, b.note);
  return c.json({ ok: true });
});

attendanceRoutes.post("/corrections/bulk-decision", requirePerm("attendance", "approve"), v("json", bulkDecisionSchema), async (c) => {
  const b = c.req.valid("json");
  const errors: { id: string; message: string }[] = [];
  for (const id of b.ids) {
    try {
      await decideCorrection(c, id, b.decision, b.note);
    } catch (e) {
      errors.push({ id, message: (e as Error).message });
    }
  }
  return c.json({ done: b.ids.length - errors.length, errors });
});

/** One employee's month (used on the employee profile). */
attendanceRoutes.get("/employee/:id", requirePerm("attendance", "view"), v("query", monthQuery), async (c) => {
  const id = c.req.param("id");
  if (!inScope(await teamScope(c, "attendance"), id)) throw forbidden();
  const data = await monthly(c, c.req.valid("query"));
  const row = data.rows.find((r) => r.employeeId === id);
  return c.json({ month: data.month, days: data.days, row: row ?? null });
});
