import { Hono, type Context } from "hono";
import { sendNotification } from "../services/notifications";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { departments, employees, holidays, leaveBalances, leaveRequests, leaveTypes } from "@hrms/db";
import {
  can,
  waitingLabel,
  type ResolvedStep,
  bulkDecisionSchema,
  decisionSchema,
  fmtDate,
  holidaySchema,
  leaveAdjustSchema,
  leaveApplySchema,
  leaveTypeSchema,
  todayIST,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { applyLeave, balanceSummary, cancelLeave, decideLeave, ensureBalances } from "../services/leave";
import { inScope, teamScope } from "../services/scope";
import { approvalPolicy, approvalScope, chainFor, recordDecision, waitingOn } from "../services/approvals";
import { layout } from "../lib/email";
import { notifyLeaveDecision } from "../services/notify";

export const leaveRoutes = new Hono<AppEnv>();

// ---------- requests ----------
const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

leaveRoutes.get("/requests", requirePerm("leave", "view"), v("query", listQuery), async (c) => {
  const q = c.req.valid("query");
  const tid = c.get("tenant").tenantId;
  const scope = await approvalScope(c, "leave", "leave");
  const conds = [eq(leaveRequests.tenantId, tid)];
  if (q.status) conds.push(inArray(leaveRequests.status, q.status.split(",")));
  if (scope) conds.push(inArray(leaveRequests.employeeId, scope.length ? scope : ["-"]));
  if (q.q) conds.push(or(ilike(employees.fullName, `%${q.q}%`), ilike(employees.employeeCode, `%${q.q}%`), ilike(leaveRequests.code, `%${q.q}%`))!);
  if (q.from) conds.push(sql`${leaveRequests.endDate} >= ${q.from}`);
  if (q.to) conds.push(sql`${leaveRequests.startDate} <= ${q.to}`);
  const rows = await c
    .get("db")
    .select({
      r: leaveRequests,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      department: departments.name,
      typeName: leaveTypes.name,
      typeCode: leaveTypes.code,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(...conds))
    .orderBy(desc(leaveRequests.createdAt))
    .limit(1000);
  // where each pending request is in its approval chain, and whether it's this person's turn
  const db = c.get("db");
  const policy = await approvalPolicy(db, tid);
  const t = c.get("tenant");
  const isHr = can(t.permissions, "leave", "configure");
  const out = [];
  for (const x of rows) {
    let waiting = null;
    if (x.r.status === "pending") {
      const chain = await chainFor(db, tid, "leave", x.r.employeeId, Number(x.r.days), policy);
      waiting = waitingOn(chain, x.r.approvals);
      if (waiting) waiting = { ...waiting, yourTurn: x.r.employeeId !== t.employeeId && (isHr || waiting.approverEmployeeId === t.employeeId), asHr: isHr && waiting.step !== "hr" && waiting.approverEmployeeId !== t.employeeId };
    }
    out.push({ ...x.r, employeeName: x.employeeName, employeeCode: x.employeeCode, department: x.department, typeName: x.typeName, typeCode: x.typeCode, waitingOn: waiting });
  }
  return c.json(out);
});

leaveRoutes.post("/requests", requirePerm("leave", "edit"), v("json", leaveApplySchema), async (c) => {
  const body = c.req.valid("json");
  if (!body.employeeId) throw badRequest("Pick an employee");
  const tid = c.get("tenant").tenantId;
  const { request, employee } = await applyLeave(c.get("db"), tid, { ...body, employeeId: body.employeeId }, c.get("session")!.userId);
  await audit(c, { action: "leave.apply_on_behalf", entity: "leave_request", entityId: request.id, summary: `Applied ${request.days} day(s) leave for ${employee.fullName}` });
  return c.json(request, 201);
});

/** Email the next approver in the chain (managers; HR sees it in their queue). */
export async function notifyNextApprover(c: Context<AppEnv>, req: typeof leaveRequests.$inferSelect, next: ResolvedStep | null | undefined, first = false) {
  if (!next?.approverEmployeeId) return;
  try {
    const db = c.get("db");
    const [a] = await db.select({ email: employees.workEmail }).from(employees).where(eq(employees.id, next.approverEmployeeId));
    const [e] = await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, req.employeeId));
    if (!a) return;
    const { html, text } = layout({ company: "Strats360 People", heading: `Leave to approve: ${e?.name ?? req.code}`, paragraphs: [`${e?.name} has asked for ${req.days} day${Number(req.days) === 1 ? "" : "s"} of leave from ${req.startDate} to ${req.endDate}. ${first ? "It needs your approval." : "It's been approved so far and needs your approval next."}`], cta: { label: "Review leave", url: `${c.env.APP_URL}/leave` } });
    await sendNotification(c, "leave_to_approve", { to: a.email, subject: `Leave to approve: ${e?.name ?? req.code}`, html, text });
  } catch (err) {
    console.error("next approver email failed", err);
  }
}

async function decide(c: Context<AppEnv>, id: string, decision: "approved" | "rejected", note?: string | null) {
  const db = c.get("db");
  const t = c.get("tenant");
  const [req] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, t.tenantId)));
  if (!req) throw notFound("Leave request");
  if (req.employeeId === t.employeeId) throw forbidden("You can't approve your own leave");
  if (!inScope(await approvalScope(c, "leave", "leave"), req.employeeId)) throw forbidden("This employee isn't in your team");
  if (req.status !== "pending") throw badRequest("This request has already been decided");
  if (decision === "rejected" && !note) throw badRequest("Add a reason for rejecting");
  const step = await recordDecision(c, "leave", "leave", { employeeId: req.employeeId, approvals: req.approvals, days: Number(req.days) }, decision, note);
  if (!step.final) {
    // approved at this step; on to the next approver
    const [row] = await db.update(leaveRequests).set({ approvals: step.approvals }).where(and(eq(leaveRequests.id, id), eq(leaveRequests.status, "pending"))).returning();
    await audit(c, { action: "leave.approve_step", entity: "leave_request", entityId: id, summary: `Approved ${req.code} at step ${step.approvals.length} of ${step.chain.length}; now with ${step.next ? waitingLabel(step.next) : "the next approver"}` });
    await notifyNextApprover(c, req, step.next);
    return row!;
  }
  await db.update(leaveRequests).set({ approvals: step.approvals }).where(eq(leaveRequests.id, id));
  const updated = await decideLeave(db, t.tenantId, id, decision, c.get("session")!.userId, note);
  await audit(c, { action: `leave.${decision}`, entity: "leave_request", entityId: id, summary: `${decision === "approved" ? "Approved" : "Rejected"} ${req.code}`, data: note ? { note } : undefined });
  await notifyLeaveDecision(c, updated);
  return updated;
}

leaveRoutes.post("/requests/:id/decision", requirePerm("leave", "approve"), v("json", decisionSchema), async (c) => {
  const b = c.req.valid("json");
  return c.json(await decide(c, c.req.param("id"), b.decision, b.note));
});

leaveRoutes.post("/requests/bulk-decision", requirePerm("leave", "approve"), v("json", bulkDecisionSchema), async (c) => {
  const b = c.req.valid("json");
  const errors: { id: string; message: string }[] = [];
  for (const id of b.ids) {
    try {
      await decide(c, id, b.decision, b.note);
    } catch (e) {
      errors.push({ id, message: (e as Error).message });
    }
  }
  return c.json({ done: b.ids.length - errors.length, errors });
});

leaveRoutes.post("/requests/:id/cancel", requirePerm("leave", "edit"), async (c) => {
  const req = await cancelLeave(c.get("db"), c.get("tenant").tenantId, c.req.param("id"), c.get("session")!.userId);
  await audit(c, { action: "leave.cancel", entity: "leave_request", entityId: req.id, summary: `Cancelled ${req.code}` });
  return c.json({ ok: true });
});

// ---------- balances ----------
const balQuery = z.object({ year: z.coerce.number().int().optional(), q: z.string().optional(), departmentId: z.string().optional() });

async function balances(c: Context<AppEnv>, qy: z.infer<typeof balQuery>) {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const year = qy.year ?? Number(todayIST().slice(0, 4));
  const scope = await teamScope(c, "leave");
  const conds = [eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive')`];
  if (scope) conds.push(inArray(employees.id, scope.length ? scope : ["-"]));
  if (qy.q) conds.push(or(ilike(employees.fullName, `%${qy.q}%`), ilike(employees.employeeCode, `%${qy.q}%`))!);
  if (qy.departmentId) conds.push(eq(employees.departmentId, qy.departmentId));
  const emps = await db
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, department: departments.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(...conds))
    .orderBy(asc(employees.fullName));
  const types = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tid), eq(leaveTypes.active, true))).orderBy(asc(leaveTypes.code));
  const rows = [];
  for (const e of emps) {
    const s = await balanceSummary(db, tid, e.id, year);
    rows.push({ employeeId: e.id, name: e.name, code: e.code, department: e.department, balances: s });
  }
  return { year, types: types.map((t) => ({ id: t.id, code: t.code, name: t.name })), rows };
}

leaveRoutes.get("/balances", requirePerm("leave", "view"), v("query", balQuery), async (c) => c.json(await balances(c, c.req.valid("query"))));

leaveRoutes.get("/register.csv", requirePerm("leave", "export"), v("query", balQuery), async (c) => {
  const data = await balances(c, c.req.valid("query"));
  const header = ["Employee ID", "Name", "Department"];
  for (const t of data.types)
    header.push(`${t.code} opening`, `${t.code} accrued`, `${t.code} adjusted`, `${t.code} availed`, `${t.code} closing`);
  const csv = toCsv(
    header,
    data.rows.map((r) => [
      r.code,
      r.name,
      r.department,
      ...data.types.flatMap((t): (number | null)[] => {
        const b = r.balances.find((x) => x.leaveTypeId === t.id);
        return b ? [b.opening, b.accrued, b.adjusted, b.used, b.available] : ([null, null, null, null, null] as (number | null)[]);
      }),
    ]),
  );
  await audit(c, { action: "leave.export", entity: "leave", summary: `Exported leave register ${data.year}` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leave-register-${data.year}.csv"` });
});

leaveRoutes.post("/balances/adjust", requirePerm("leave", "configure"), v("json", leaveAdjustSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [emp] = await db.select({ name: employees.fullName }).from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tid)));
  if (!emp) throw notFound("Employee");
  await ensureBalances(db, tid, b.employeeId, b.year);
  const [row] = await db
    .update(leaveBalances)
    .set({ adjusted: sql`${leaveBalances.adjusted} + ${b.delta}` })
    .where(and(eq(leaveBalances.tenantId, tid), eq(leaveBalances.employeeId, b.employeeId), eq(leaveBalances.leaveTypeId, b.leaveTypeId), eq(leaveBalances.year, b.year)))
    .returning();
  if (!row) throw notFound("Leave balance");
  await audit(c, { action: "leave.adjust", entity: "leave_balance", entityId: row.id, summary: `Adjusted ${emp.name}'s balance by ${b.delta}`, data: { note: b.note } });
  return c.json(row);
});

// ---------- leave types (policies) ----------
leaveRoutes.get("/types", requirePerm("leave", "view"), async (c) =>
  c.json(await c.get("db").select().from(leaveTypes).where(eq(leaveTypes.tenantId, c.get("tenant").tenantId)).orderBy(asc(leaveTypes.code))),
);
leaveRoutes.post("/types", requirePerm("leave", "configure"), v("json", leaveTypeSchema), async (c) => {
  const [row] = await c.get("db").insert(leaveTypes).values({ ...c.req.valid("json"), tenantId: c.get("tenant").tenantId }).returning();
  await audit(c, { action: "leave_type.create", entity: "leave_type", entityId: row!.id, summary: `Added leave type ${row!.name}` });
  return c.json(row, 201);
});
leaveRoutes.patch("/types/:id", requirePerm("leave", "configure"), vPatch(leaveTypeSchema.partial()), async (c) => {
  const [row] = await c
    .get("db")
    .update(leaveTypes)
    .set(c.req.valid("json"))
    .where(and(eq(leaveTypes.id, c.req.param("id")), eq(leaveTypes.tenantId, c.get("tenant").tenantId)))
    .returning();
  if (!row) throw notFound("Leave type");
  await audit(c, { action: "leave_type.update", entity: "leave_type", entityId: row.id, summary: `Updated leave policy ${row.name}`, data: c.req.valid("json") });
  return c.json(row);
});

// ---------- holidays ----------
leaveRoutes.get("/holidays", async (c) => {
  const year = Number(c.req.query("year") ?? todayIST().slice(0, 4));
  const rows = await c
    .get("db")
    .select()
    .from(holidays)
    .where(and(eq(holidays.tenantId, c.get("tenant").tenantId), sql`extract(year from ${holidays.date}) = ${year}`))
    .orderBy(asc(holidays.date));
  return c.json(rows);
});
leaveRoutes.post("/holidays", requirePerm("leave", "configure"), v("json", holidaySchema), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c.get("db").insert(holidays).values({ ...b, tenantId: c.get("tenant").tenantId }).returning();
  await audit(c, { action: "holiday.create", entity: "holiday", entityId: row!.id, summary: `Added holiday ${b.name} on ${fmtDate(b.date)}` });
  return c.json(row, 201);
});
leaveRoutes.delete("/holidays/:id", requirePerm("leave", "configure"), async (c) => {
  const [row] = await c
    .get("db")
    .delete(holidays)
    .where(and(eq(holidays.id, c.req.param("id")), eq(holidays.tenantId, c.get("tenant").tenantId)))
    .returning();
  if (!row) throw notFound("Holiday");
  await audit(c, { action: "holiday.delete", entity: "holiday", entityId: row.id, summary: `Removed holiday ${row.name}` });
  return c.json({ ok: true });
});
