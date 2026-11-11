import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { attendanceRecords, departments, employees, projects, tenants, timesheetEntries, timesheets, type Database } from "@hrms/db";
import { addWeeks, fmtDate, hoursLabel, projectSchema, timesheetProblem, timesheetRejectSchema, timesheetSaveSchema, todayIST, weekDates, weekStart, type GridRow } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { toXlsx, XLSX_MIME } from "../lib/xlsx";
import { teamScope } from "../services/scope";
import { allowedRecipients } from "../services/notifications";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
type Sheet = typeof timesheets.$inferSelect;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function weekParam(c: Context<AppEnv>) {
  const w = c.req.query("week") ?? c.req.param("week") ?? todayIST();
  if (!isoDate.test(w)) throw badRequest("Pick a week");
  return weekStart(w);
}

/** Group a week's entries into grid rows: one per project and note. */
async function gridOf(db: Database, sheetId: string | null): Promise<GridRow[]> {
  if (!sheetId) return [];
  const rows = await db.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheetId)).orderBy(asc(timesheetEntries.createdAt));
  const out: GridRow[] = [];
  for (const e of rows) {
    let r = out.find((x) => x.projectId === e.projectId && x.note === e.note);
    if (!r) out.push((r = { projectId: e.projectId, note: e.note, minutes: {} }));
    r.minutes[e.date] = (r.minutes[e.date] ?? 0) + e.minutes;
  }
  return out;
}
async function attendanceMinutes(db: Database, tenantId: string, employeeId: string, dates: string[]) {
  const rows = await db
    .select({ date: attendanceRecords.date, minutes: attendanceRecords.workMinutes, status: attendanceRecords.status })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.employeeId, employeeId), gte(attendanceRecords.date, dates[0]!), lte(attendanceRecords.date, dates[6]!)));
  return Object.fromEntries(rows.map((r) => [r.date, { minutes: r.minutes, status: r.status }]));
}
const projectList = (db: Database, tenantId: string, all = false) => db.select().from(projects).where(and(eq(projects.tenantId, tenantId), all ? undefined : eq(projects.status, "active"))).orderBy(asc(projects.code));

async function mailTo(c: Context<AppEnv>, key: "timesheet_decision" | "timesheets_to_approve", to: string, subject: string, paragraphs: string[], url: string) {
  try {
    if (!(await allowedRecipients(c.get("db"), tid(c), key, [to])).has(to)) return;
    const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: subject, paragraphs, cta: { label: "Open timesheets", url } });
    await c.get("mailer").send({ to, subject, html, text });
  } catch (e) {
    console.error("timesheet email failed", e);
  }
}

/* ---------------- self-service ---------------- */

export const essTimesheetRoutes = new Hono<AppEnv>();
essTimesheetRoutes.use("*", requireEmployee);

essTimesheetRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  const week = weekParam(c);
  const dates = weekDates(week);
  const [sheet] = await db.select().from(timesheets).where(and(eq(timesheets.employeeId, eid), eq(timesheets.weekStart, week)));
  const recent = await db
    .select({ weekStart: timesheets.weekStart, status: timesheets.status, totalMinutes: timesheets.totalMinutes })
    .from(timesheets)
    .where(and(eq(timesheets.tenantId, tid(c)), eq(timesheets.employeeId, eid)))
    .orderBy(desc(timesheets.weekStart))
    .limit(10);
  const rows = await gridOf(db, sheet?.id ?? null);
  // projects used this week stay listed even if archived since
  const all = await projectList(db, tid(c), true);
  const used = new Set(rows.map((r) => r.projectId));
  return c.json({
    week,
    dates,
    current: weekStart(todayIST()),
    sheet: sheet ? { id: sheet.id, status: sheet.status, totalMinutes: sheet.totalMinutes, submittedAt: sheet.submittedAt, decidedBy: sheet.decidedBy, decidedAt: sheet.decidedAt, rejectReason: sheet.rejectReason } : null,
    rows,
    projects: all.filter((p) => p.status === "active" || used.has(p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, client: p.client, billable: p.billable, archived: p.status !== "active" })),
    attendance: await attendanceMinutes(db, tid(c), eid, dates),
    recent,
  });
});

essTimesheetRoutes.put("/:week", v("json", timesheetSaveSchema), async (c) => {
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  const week = c.req.param("week");
  if (!isoDate.test(week) || weekStart(week) !== week) throw badRequest("Weeks start on a Monday");
  if (week > weekStart(todayIST())) throw badRequest("You can't fill in a future week yet");
  const b = c.req.valid("json");
  const dates = weekDates(week);
  const rows = b.rows.map((r) => ({ ...r, minutes: Object.fromEntries(Object.entries(r.minutes).filter(([, m]) => m > 0)) })).filter((r) => Object.keys(r.minutes).length || r.note);
  const problem = timesheetProblem(rows, dates, b.submit);
  if (problem) throw badRequest(problem);
  const known = new Map((await projectList(db, tid(c), true)).map((p) => [p.id, p]));
  const [existing] = await db.select().from(timesheets).where(and(eq(timesheets.employeeId, eid), eq(timesheets.weekStart, week)));
  if (existing && (existing.status === "submitted" || existing.status === "approved")) throw badRequest(existing.status === "approved" ? "This week is approved. Ask your manager to send it back if it needs changes." : "This week is waiting for approval. Ask your manager to send it back to change it.");
  for (const r of rows) {
    const p = known.get(r.projectId);
    if (!p) throw badRequest("Pick a project for every row");
    if (p.status !== "active" && !(existing && (await gridOf(db, existing.id)).some((x) => x.projectId === p.id))) throw badRequest(`${p.name} is archived`);
  }
  const total = rows.reduce((a, r) => a + Object.values(r.minutes).reduce((x, y) => x + y, 0), 0);
  const status = b.submit ? "submitted" : existing?.status === "rejected" ? "rejected" : "draft";
  const set = { status, totalMinutes: total, submittedAt: b.submit ? new Date() : (existing?.submittedAt ?? null), updatedAt: new Date() };
  const [sheet] = existing ? await db.update(timesheets).set(set).where(eq(timesheets.id, existing.id)).returning() : await db.insert(timesheets).values({ tenantId: tid(c), employeeId: eid, weekStart: week, ...set }).returning();
  await db.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet!.id));
  const entries = rows.flatMap((r) => Object.entries(r.minutes).map(([date, minutes]) => ({ tenantId: tid(c), timesheetId: sheet!.id, projectId: r.projectId, date, minutes, note: r.note, billable: known.get(r.projectId)!.billable })));
  if (entries.length) await db.insert(timesheetEntries).values(entries);
  if (b.submit) {
    const [me] = await db.select({ name: employees.fullName, managerId: employees.managerId }).from(employees).where(eq(employees.id, eid));
    await audit(c, { action: "timesheet.submit", entity: "timesheet", entityId: sheet!.id, summary: `${me?.name} submitted the week of ${fmtDate(week)}: ${hoursLabel(total)}` });
    if (me?.managerId) {
      const [m] = await db.select({ email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, me.managerId));
      if (m) await mailTo(c, "timesheets_to_approve", m.email, `Timesheet to approve: ${me.name}, week of ${fmtDate(week)}`, [`Hi ${m.first},`, `${me.name} submitted ${hoursLabel(total)} for the week of ${fmtDate(week)}.`], `${c.env.APP_URL}/attendance/timesheets?week=${week}`);
    }
  }
  return c.json({ id: sheet!.id, status, totalMinutes: total });
});

/* ---------------- managers and HR ---------------- */

export const timesheetRoutes = new Hono<AppEnv>();
timesheetRoutes.use("*", requirePerm("attendance", "view"));

timesheetRoutes.get("/projects", async (c) => {
  const db = c.get("db");
  const list = await projectList(db, tid(c), true);
  const hours = list.length
    ? new Map((await db.select({ projectId: timesheetEntries.projectId, m: sql<number>`sum(${timesheetEntries.minutes})::int` }).from(timesheetEntries).innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId)).where(and(eq(timesheetEntries.tenantId, tid(c)), eq(timesheets.status, "approved"))).groupBy(timesheetEntries.projectId)).map((r) => [r.projectId, r.m]))
    : new Map();
  return c.json(list.map((p) => ({ ...p, approvedMinutes: hours.get(p.id) ?? 0 })));
});
timesheetRoutes.post("/projects", requirePerm("attendance", "configure"), v("json", projectSchema), async (c) => {
  const b = c.req.valid("json");
  const [dup] = await c.get("db").select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, tid(c)), eq(projects.code, b.code.toUpperCase())));
  if (dup) throw conflict(`Another project already uses the code ${b.code.toUpperCase()}`);
  const [p] = await c.get("db").insert(projects).values({ ...b, code: b.code.toUpperCase(), tenantId: tid(c) }).returning();
  await audit(c, { action: "timesheet.project_create", entity: "project", entityId: p!.id, summary: `Added project ${p!.code} ${p!.name}` });
  return c.json(p, 201);
});
timesheetRoutes.put("/projects/:id", requirePerm("attendance", "configure"), v("json", projectSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [p] = await db.select().from(projects).where(and(eq(projects.id, c.req.param("id")), eq(projects.tenantId, tid(c))));
  if (!p) throw notFound("Project");
  const code = b.code.toUpperCase();
  if (code !== p.code) {
    const [dup] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, tid(c)), eq(projects.code, code)));
    if (dup) throw conflict(`Another project already uses the code ${code}`);
  }
  const [out] = await db.update(projects).set({ ...b, code, updatedAt: new Date() }).where(eq(projects.id, p.id)).returning();
  await audit(c, { action: "timesheet.project_update", entity: "project", entityId: p.id, summary: `Updated project ${code} ${b.name}${b.status !== p.status ? `: ${b.status}` : ""}` });
  return c.json(out);
});

/** The team's week: who has submitted, and who hasn't. */
timesheetRoutes.get("/", async (c) => {
  const db = c.get("db");
  const week = weekParam(c);
  const scope = await teamScope(c, "attendance");
  const people = await db
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, department: departments.name, managerId: employees.managerId })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(employees.tenantId, tid(c)), inArray(employees.status, ["probation", "active", "notice"]), lte(employees.dateOfJoining, weekDates(week)[6]!), scope ? inArray(employees.id, scope.length ? scope : [""]) : undefined))
    .orderBy(asc(employees.fullName));
  const sheets = people.length ? await db.select().from(timesheets).where(and(eq(timesheets.weekStart, week), inArray(timesheets.employeeId, people.map((p) => p.id)))) : [];
  const byEmp = new Map(sheets.map((s) => [s.employeeId, s]));
  const billable = sheets.length
    ? new Map((await db.select({ id: timesheetEntries.timesheetId, m: sql<number>`sum(${timesheetEntries.minutes}) filter (where ${timesheetEntries.billable})::int` }).from(timesheetEntries).where(inArray(timesheetEntries.timesheetId, sheets.map((s) => s.id))).groupBy(timesheetEntries.timesheetId)).map((r) => [r.id, r.m ?? 0]))
    : new Map();
  const me = c.get("tenant").employeeId;
  return c.json({
    week,
    current: weekStart(todayIST()),
    canApprove: can(c, "approve"),
    rows: people.map((p) => {
      const s = byEmp.get(p.id);
      return { employeeId: p.id, name: p.name, code: p.code, department: p.department, id: s?.id ?? null, status: s?.status ?? "missing", totalMinutes: s?.totalMinutes ?? 0, billableMinutes: s ? (billable.get(s.id) ?? 0) : 0, submittedAt: s?.submittedAt ?? null, mine: p.id === me };
    }),
  });
});
const can = (c: Context<AppEnv>, action: "approve" | "configure") => (c.get("tenant").permissions.attendance ?? []).includes(action);

async function loadSheet(c: Context<AppEnv>, id: string) {
  const db = c.get("db");
  const [s] = await db.select().from(timesheets).where(and(eq(timesheets.id, id), eq(timesheets.tenantId, tid(c))));
  if (!s) throw notFound("Timesheet");
  const scope = await teamScope(c, "attendance");
  if (scope && !scope.includes(s.employeeId)) throw notFound("Timesheet");
  return s;
}

timesheetRoutes.get("/sheets/:id", async (c) => {
  const s = await loadSheet(c, c.req.param("id"));
  const db = c.get("db");
  const [e] = await db.select({ name: employees.fullName, code: employees.employeeCode }).from(employees).where(eq(employees.id, s.employeeId));
  const dates = weekDates(s.weekStart);
  const rows = await gridOf(db, s.id);
  const used = await db.select().from(projects).where(inArray(projects.id, rows.length ? rows.map((r) => r.projectId) : [""]));
  return c.json({ sheet: s, employee: { id: s.employeeId, ...e }, dates, rows, projects: used.map((p) => ({ id: p.id, code: p.code, name: p.name, billable: p.billable })), attendance: await attendanceMinutes(db, tid(c), s.employeeId, dates) });
});

async function decide(c: Context<AppEnv>, s: Sheet, approve: boolean, reason: string | null) {
  if (s.employeeId === c.get("tenant").employeeId) throw forbidden("Someone else approves your own timesheet");
  const db = c.get("db");
  await db.update(timesheets).set({ status: approve ? "approved" : "rejected", decidedBy: c.get("session")!.name, decidedAt: new Date(), rejectReason: approve ? null : reason, updatedAt: new Date() }).where(eq(timesheets.id, s.id));
  const [e] = await db.select({ name: employees.fullName, email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, s.employeeId));
  await audit(c, { action: approve ? "timesheet.approve" : "timesheet.reject", entity: "timesheet", entityId: s.id, summary: `${approve ? "Approved" : "Sent back"} ${e?.name}'s week of ${fmtDate(s.weekStart)} (${hoursLabel(s.totalMinutes)})${reason ? `: ${reason}` : ""}` });
  if (e) await mailTo(c, "timesheet_decision", e.email, approve ? `Timesheet approved: week of ${fmtDate(s.weekStart)}` : `Timesheet sent back: week of ${fmtDate(s.weekStart)}`, [`Hi ${e.first},`, approve ? `${c.get("session")!.name} approved your timesheet for the week of ${fmtDate(s.weekStart)} (${hoursLabel(s.totalMinutes)}).` : `${c.get("session")!.name} sent back your timesheet for the week of ${fmtDate(s.weekStart)}: ${reason}`, ...(approve ? [] : ["Please fix it and submit again."])], `${c.env.APP_URL}/me/timesheets?week=${s.weekStart}`);
}

timesheetRoutes.post("/sheets/:id/approve", requirePerm("attendance", "approve"), async (c) => {
  const s = await loadSheet(c, c.req.param("id"));
  if (s.status !== "submitted") throw badRequest(s.status === "approved" ? "Already approved" : "It hasn't been submitted");
  await decide(c, s, true, null);
  return c.json({ ok: true });
});
timesheetRoutes.post("/sheets/:id/reject", requirePerm("attendance", "approve"), v("json", timesheetRejectSchema), async (c) => {
  const s = await loadSheet(c, c.req.param("id"));
  if (s.status !== "submitted" && s.status !== "approved") throw badRequest("Only a submitted or approved week can be sent back");
  await decide(c, s, false, c.req.valid("json").reason);
  return c.json({ ok: true });
});
timesheetRoutes.post("/approve-all", requirePerm("attendance", "approve"), v("json", z.object({ week: z.string().regex(isoDate) })), async (c) => {
  const week = weekStart(c.req.valid("json").week);
  const scope = await teamScope(c, "attendance");
  const me = c.get("tenant").employeeId;
  const list = await c.get("db").select().from(timesheets).where(and(eq(timesheets.tenantId, tid(c)), eq(timesheets.weekStart, week), eq(timesheets.status, "submitted"), scope ? inArray(timesheets.employeeId, scope.length ? scope : [""]) : undefined));
  const todo = list.filter((s) => s.employeeId !== me);
  for (const s of todo) await decide(c, s, true, null);
  return c.json({ approved: todo.length });
});

timesheetRoutes.post("/remind", requirePerm("attendance", "approve"), v("json", z.object({ week: z.string().regex(isoDate) })), async (c) => {
  const db = c.get("db");
  const week = weekStart(c.req.valid("json").week);
  const scope = await teamScope(c, "attendance");
  const people = await db
    .select({ id: employees.id, email: employees.workEmail, first: employees.firstName })
    .from(employees)
    .where(and(eq(employees.tenantId, tid(c)), inArray(employees.status, ["probation", "active", "notice"]), lte(employees.dateOfJoining, weekDates(week)[6]!), scope ? inArray(employees.id, scope.length ? scope : [""]) : undefined));
  const done = new Set((await db.select({ e: timesheets.employeeId }).from(timesheets).where(and(eq(timesheets.weekStart, week), inArray(timesheets.status, ["submitted", "approved"])))).map((r) => r.e));
  const missing = people.filter((p) => !done.has(p.id) && p.id !== c.get("tenant").employeeId);
  for (const p of missing) await mailTo(c, "timesheet_decision", p.email, `Reminder: timesheet for the week of ${fmtDate(week)}`, [`Hi ${p.first},`, `Please fill in and submit your timesheet for the week of ${fmtDate(week)}.`], `${c.env.APP_URL}/me/timesheets?week=${week}`);
  await audit(c, { action: "timesheet.remind", entity: "timesheet", summary: `Reminded ${missing.length} people about the week of ${fmtDate(week)}` });
  return c.json({ reminded: missing.length });
});

/** Approved hours by project and by person, for a date range. */
async function report(c: Context<AppEnv>) {
  const from = c.req.query("from") ?? addWeeks(weekStart(todayIST()), -4);
  const to = c.req.query("to") ?? todayIST();
  if (!isoDate.test(from) || !isoDate.test(to) || to < from) throw badRequest("Pick a valid date range");
  const scope = await teamScope(c, "attendance");
  const rows = await c
    .get("db")
    .select({ projectId: projects.id, code: projects.code, project: projects.name, client: projects.client, employeeId: employees.id, name: employees.fullName, empCode: employees.employeeCode, billable: timesheetEntries.billable, minutes: sql<number>`sum(${timesheetEntries.minutes})::int` })
    .from(timesheetEntries)
    .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
    .innerJoin(projects, eq(projects.id, timesheetEntries.projectId))
    .innerJoin(employees, eq(employees.id, timesheets.employeeId))
    .where(and(eq(timesheetEntries.tenantId, tid(c)), eq(timesheets.status, "approved"), gte(timesheetEntries.date, from), lte(timesheetEntries.date, to), scope ? inArray(timesheets.employeeId, scope.length ? scope : [""]) : undefined))
    .groupBy(projects.id, projects.code, projects.name, projects.client, employees.id, employees.fullName, employees.employeeCode, timesheetEntries.billable);
  return { from, to, rows };
}
timesheetRoutes.get("/report", async (c) => {
  const r = await report(c);
  const byProject = new Map<string, { projectId: string; code: string; name: string; client: string | null; minutes: number; billable: number; people: Set<string> }>();
  const byPerson = new Map<string, { employeeId: string; name: string; code: string; minutes: number; billable: number }>();
  for (const x of r.rows) {
    const p = byProject.get(x.projectId) ?? { projectId: x.projectId, code: x.code, name: x.project, client: x.client, minutes: 0, billable: 0, people: new Set<string>() };
    p.minutes += x.minutes;
    if (x.billable) p.billable += x.minutes;
    p.people.add(x.employeeId);
    byProject.set(x.projectId, p);
    const e = byPerson.get(x.employeeId) ?? { employeeId: x.employeeId, name: x.name, code: x.empCode, minutes: 0, billable: 0 };
    e.minutes += x.minutes;
    if (x.billable) e.billable += x.minutes;
    byPerson.set(x.employeeId, e);
  }
  return c.json({ from: r.from, to: r.to, projects: [...byProject.values()].map((p) => ({ ...p, people: p.people.size })).sort((a, b) => b.minutes - a.minutes), people: [...byPerson.values()].sort((a, b) => b.minutes - a.minutes) });
});
timesheetRoutes.get("/report.xlsx", requirePerm("attendance", "export"), async (c) => {
  const r = await report(c);
  const file = toXlsx([{ name: "Approved hours", header: ["Project code", "Project", "Client", "Employee ID", "Employee", "Billable", "Hours"], rows: r.rows.map((x) => [x.code, x.project, x.client ?? "", x.empCode, x.name, x.billable ? "Yes" : "No", Math.round((x.minutes / 60) * 100) / 100]) }]);
  await audit(c, { action: "timesheet.export", entity: "timesheet", summary: `Exported approved hours ${fmtDate(r.from)} to ${fmtDate(r.to)}` });
  return c.body(file as unknown as ArrayBuffer, 200, { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="timesheets-${r.from}-to-${r.to}.xlsx"` });
});
