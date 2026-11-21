import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { attendanceRecords, employees, leaveTypes, payrollItems, payrollRuns, shiftRoster, shifts, type Database } from "@hrms/db";
import { healthCheckDue, isNightShift, maternityBenefit, MATERNITY_EVENT_LABELS, MATERNITY_EVENTS, todayLocal } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { applyLeave, decideLeave } from "../services/leave";
import { entityOf } from "../services/entities";

/** Maternity benefit, women's night shift consent and health checks from 40 (Indian Labour Codes). */
export const workplaceRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const maternityQuery = z.object({
  event: z.enum(MATERNITY_EVENTS),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  survivingChildren: z.coerce.number().int().min(0).max(20).default(0),
  freeMedicalCare: z.preprocess((x) => x === true || x === "true", z.boolean()).default(false),
});

/** What the benefit works from: days worked in the 12 months before, and the average daily wage over the last three paid months. */
async function maternityFor(db: Database, tenantId: string, employeeId: string, q: z.infer<typeof maternityQuery>) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!e) throw notFound("Employee");
  const ent = await entityOf(db, tenantId, e.entityId);
  if (ent.country !== "IN") throw badRequest("Maternity benefit here follows Indian law; this employee is paid outside India");
  if (e.gender !== "female" && q.event !== "adoption") throw badRequest("Maternity benefit is for women employees");
  const to = q.eventDate < todayLocal() ? q.eventDate : todayLocal();
  const from = addDays(q.eventDate, -365);
  const [w] = await db
    .select({ n: sql<number>`coalesce(sum(case when ${attendanceRecords.status} in ('present','late','wfh','on_leave','holiday') then 1 when ${attendanceRecords.status} = 'half_day' then 0.5 else 0 end),0)::float` })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.employeeId, employeeId), gte(attendanceRecords.date, from), lt(attendanceRecords.date, to)));
  const paid = await db
    .select({ gross: payrollItems.gross, paidDays: payrollItems.paidDays })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tenantId), eq(payrollItems.employeeId, employeeId), eq(payrollRuns.kind, "regular"), inArray(payrollRuns.status, ["approved", "paid"]), lte(payrollRuns.periodEnd, to)))
    .orderBy(desc(payrollRuns.periodStart))
    .limit(3);
  // attendance may not go back a full year (it started later, or came in as payroll only): paid days in payroll count too
  const [pd] = await db
    .select({ n: sql<number>`coalesce(sum(${payrollItems.paidDays}),0)::float` })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tenantId), eq(payrollItems.employeeId, employeeId), eq(payrollRuns.kind, "regular"), inArray(payrollRuns.status, ["approved", "paid"]), gte(payrollRuns.periodStart, from), lte(payrollRuns.periodEnd, to)));
  const worked = Math.round(Math.max(Number(w?.n ?? 0), Number(pd?.n ?? 0)));
  const days = paid.reduce((s, p) => s + Number(p.paidDays), 0);
  const avg = days ? paid.reduce((s, p) => s + Number(p.gross), 0) / days : Number(e.annualCtc) / 365;
  const b = maternityBenefit({ ...q, daysWorkedLast12Months: worked, averageDailyWage: avg, esiCovered: e.esiApplicable });
  return { employee: e, basis: { daysWorkedLast12Months: worked, wageMonths: paid.length, esiCovered: e.esiApplicable }, benefit: b };
}

workplaceRoutes.get("/maternity/:employeeId", requirePerm("leave", "view"), v("query", maternityQuery), async (c) => {
  const r = await maternityFor(c.get("db"), tid(c), c.req.param("employeeId"), c.req.valid("query"));
  return c.json({ ...r.basis, ...r.benefit, event: MATERNITY_EVENT_LABELS[c.req.valid("query").event] });
});

/** Grant it: approved maternity leave, split at the year end. Paid leave, or unpaid when ESIC pays. */
workplaceRoutes.post("/maternity/:employeeId", requirePerm("leave", "approve"), v("json", maternityQuery), async (c) => {
  const db = c.get("db");
  const q = c.req.valid("json");
  const r = await maternityFor(db, tid(c), c.req.param("employeeId"), q);
  if (!r.benefit.eligible) throw badRequest(r.benefit.reasons[0] ?? "She isn't eligible yet");
  const esi = r.benefit.paidBy === "esi";
  const code = esi ? "MLE" : "ML";
  let [type] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tid(c)), eq(leaveTypes.code, code)));
  if (!type) [type] = await db.insert(leaveTypes).values({ tenantId: tid(c), code, name: esi ? "Maternity leave (ESIC pays)" : "Maternity leave", isPaid: !esi, annualQuota: 0, accrual: "none", allowHalfDay: false, allowNegative: true }).returning();
  const uid = c.get("session")!.userId;
  const pieces: [string, string][] = [];
  let s = r.benefit.startDate;
  while (s <= r.benefit.endDate) {
    const yearEnd = `${s.slice(0, 4)}-12-31`;
    const e = r.benefit.endDate < yearEnd ? r.benefit.endDate : yearEnd;
    pieces.push([s, e]);
    s = addDays(e, 1);
  }
  const codes: string[] = [];
  for (const [startDate, endDate] of pieces) {
    const { request } = await applyLeave(db, tid(c), { employeeId: r.employee.id, leaveTypeId: type!.id, startDate, endDate, halfDay: false, reason: `${MATERNITY_EVENT_LABELS[q.event]}: ${r.benefit.weeks} weeks` }, uid);
    await decideLeave(db, tid(c), request.id, "approved", uid, "Maternity benefit");
    codes.push(request.code);
  }
  await audit(c, { action: "leave.maternity", entity: "employee", entityId: r.employee.id, summary: `Granted ${r.benefit.weeks} weeks of maternity leave to ${r.employee.fullName}, ${r.benefit.startDate} to ${r.benefit.endDate} (${codes.join(", ")}); ${esi ? "ESIC pays the benefit" : "paid by the company"}` });
  return c.json({ ...r.benefit, requests: codes }, 201);
});

/** Women rostered outside 6 am to 7 pm, now or in the next 30 days, without written consent on file. */
workplaceRoutes.get("/night-shifts", requirePerm("compliance", "view"), async (c) => {
  const db = c.get("db");
  const today = todayLocal();
  const until = addDays(today, 30);
  const women = await db
    .select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, profile: employees.countryProfile, shiftId: employees.shiftId })
    .from(employees)
    .where(and(eq(employees.tenantId, tid(c)), eq(employees.gender, "female"), inArray(employees.status, ["active", "probation", "notice", "onboarding"])));
  const all = await db.select().from(shifts).where(eq(shifts.tenantId, tid(c)));
  const night = new Map(all.filter((s) => isNightShift(s.startTime, s.endTime)).map((s) => [s.id, s]));
  const roster = night.size && women.length ? await db.select().from(shiftRoster).where(and(eq(shiftRoster.tenantId, tid(c)), gte(shiftRoster.date, today), lte(shiftRoster.date, until), inArray(shiftRoster.employeeId, women.map((w) => w.id)), ne(shiftRoster.isOff, true))) : [];
  const rows = women
    .map((w) => {
      const dates = roster.filter((r) => r.employeeId === w.id && r.shiftId && night.has(r.shiftId));
      const usual = w.shiftId && night.has(w.shiftId) ? night.get(w.shiftId)! : null;
      const first = dates.sort((a, b) => a.date.localeCompare(b.date))[0];
      const shift = usual ?? (first ? night.get(first.shiftId!)! : null);
      return shift ? { employeeId: w.id, code: w.code, name: w.name, shift: `${shift.name} ${shift.startTime}–${shift.endTime}`, from: usual ? "Usual shift" : `Rostered ${first!.date}`, consent: !!(w.profile as { nightShiftConsent?: boolean } | null)?.nightShiftConsent } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return c.json({ rows, missing: rows.filter((r) => !r.consent).length });
});

/** Employees 40 or older whose free yearly health check is due. */
workplaceRoutes.get("/health-checks", requirePerm("compliance", "view"), async (c) => {
  const today = todayLocal();
  const rows = await c
    .get("db")
    .select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, dob: employees.dateOfBirth, profile: employees.countryProfile })
    .from(employees)
    .where(and(eq(employees.tenantId, tid(c)), inArray(employees.status, ["active", "probation", "notice"])));
  const out = rows
    .map((r) => {
      const last = (r.profile as { lastHealthCheckOn?: string | null } | null)?.lastHealthCheckOn ?? null;
      const h = healthCheckDue(r.dob, last, today);
      return h.age !== null && h.age >= 40 ? { employeeId: r.id, code: r.code, name: r.name, age: h.age, lastCheck: last, due: h.due, nextBy: h.nextBy ?? null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Number(b.due) - Number(a.due) || a.code.localeCompare(b.code));
  return c.json({ rows: out, due: out.filter((r) => r.due).length });
});
