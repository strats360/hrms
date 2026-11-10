import { Hono, type Context } from "hono";
import { sendNotification } from "../services/notifications";
import type { NotificationKey } from "@hrms/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { compOffRequests, departments, employees, tenants } from "@hrms/db";
import { compOffGrantSchema, compOffRequestSchema, fmtDate } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { inScope, teamScope } from "../services/scope";
import { approveCompOff, claimableDays, CompOffError, compOffSettings, eligibility, requestCompOff } from "../services/comp-off";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;
const wrap = async <T,>(f: () => Promise<T>) => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof CompOffError) throw badRequest(e.message);
    throw e;
  }
};
const dayLabel = (d: number) => (d === 1 ? "1 day" : `${d} day`);

// ---------------------------------------------------------------------------
// Approvers (manager for their team, HR for everyone)
// ---------------------------------------------------------------------------
export const compOffRoutes = new Hono<AppEnv>();

compOffRoutes.get("/comp-off", requirePerm("leave", "view"), v("query", z.object({ status: z.string().optional() })), async (c) => {
  const scope = await teamScope(c, "leave");
  const status = c.req.valid("query").status;
  const rows = await c
    .get("db")
    .select({ x: compOffRequests, code: employees.employeeCode, name: employees.fullName, department: departments.name })
    .from(compOffRequests)
    .innerJoin(employees, eq(employees.id, compOffRequests.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(compOffRequests.tenantId, tid(c)), status ? eq(compOffRequests.status, status) : undefined, scope ? inArray(compOffRequests.employeeId, scope.length ? scope : ["-"]) : undefined))
    .orderBy(desc(compOffRequests.createdAt))
    .limit(500);
  return c.json({ settings: await compOffSettings(c.get("db"), tid(c)), rows: rows.map((r) => ({ ...r.x, employeeCode: r.code, employeeName: r.name, department: r.department })) });
});

compOffRoutes.post("/comp-off/:id/decision", requirePerm("leave", "approve"), v("json", z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(300).nullable().optional() })), async (c) => {
  const db = c.get("db");
  const t = c.get("tenant");
  const [row] = await db.select().from(compOffRequests).where(and(eq(compOffRequests.id, c.req.param("id")), eq(compOffRequests.tenantId, tid(c))));
  if (!row) throw notFound("Comp off request");
  if (row.employeeId === t.employeeId) throw forbidden("You can't approve your own comp off");
  if (!inScope(await teamScope(c, "leave"), row.employeeId)) throw forbidden("This employee isn't in your team");
  if (row.status !== "pending") throw badRequest("This request has already been decided");
  const b = c.req.valid("json");
  if (b.decision === "rejected" && !b.note) throw badRequest("Add a reason for rejecting");
  const [e] = await db.select().from(employees).where(eq(employees.id, row.employeeId));
  const updated =
    b.decision === "approved"
      ? await wrap(() => approveCompOff(db, row, uid(c), b.note ?? null))
      : (await db.update(compOffRequests).set({ status: "rejected", decidedBy: uid(c), decidedAt: new Date(), decisionNote: b.note ?? null }).where(and(eq(compOffRequests.id, row.id), eq(compOffRequests.status, "pending"))).returning())[0];
  await audit(c, { action: `leave.comp_off_${b.decision}`, entity: "comp_off", entityId: row.id, summary: `${b.decision === "approved" ? "Approved" : "Rejected"} ${dayLabel(Number(row.days))} comp off for ${e?.fullName} (worked ${fmtDate(row.workDate)})` });
  if (e) await mail(c, "comp_off_decision", e, b.decision === "approved" ? `Comp off approved: ${dayLabel(Number(row.days))}` : "Comp off not approved", b.decision === "approved" ? [`Your comp off for working on ${fmtDate(row.workDate)} is approved and added to your leave balance.`, `Use it by ${fmtDate(updated!.expiresOn!)}; after that it lapses.`] : [`Your comp off request for ${fmtDate(row.workDate)} wasn't approved: ${b.note}`]);
  return c.json(updated);
});

compOffRoutes.put("/comp-off/settings", requirePerm("leave", "configure"), v("json", z.object({ expiryDays: z.number().int().min(7).max(365), claimWithinDays: z.number().int().min(1).max(90) })), async (c) => {
  const b = c.req.valid("json");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ compOff: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "leave.comp_off_settings", entity: "tenant", summary: `Comp off: claim within ${b.claimWithinDays} days, expires ${b.expiryDays} days after the work`, data: b });
  return c.json(b);
});

/** HR grants comp off directly (e.g. for work the attendance system didn't capture). */
compOffRoutes.post("/comp-off", requirePerm("leave", "configure"), v("json", compOffGrantSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  if (e.id === c.get("tenant").employeeId) throw forbidden("You can't grant comp off to yourself");
  const check = await eligibility(db, tid(c), e, b.date);
  const [dup] = await db.select({ id: compOffRequests.id }).from(compOffRequests).where(and(eq(compOffRequests.employeeId, e.id), eq(compOffRequests.workDate, b.date), inArray(compOffRequests.status, ["pending", "approved", "expired"])));
  if (dup) throw badRequest("Comp off for that day is already claimed");
  const [row] = await db.insert(compOffRequests).values({ tenantId: tid(c), employeeId: e.id, workDate: b.date, dayType: check.ok ? check.dayType : "granted", workMinutes: check.ok ? check.workMinutes : 0, days: b.days, reason: b.reason, createdBy: uid(c) }).returning();
  const approved = await wrap(() => approveCompOff(db, row!, uid(c), "Granted by HR"));
  await audit(c, { action: "leave.comp_off_grant", entity: "comp_off", entityId: row!.id, summary: `Granted ${dayLabel(b.days)} comp off to ${e.fullName} for ${fmtDate(b.date)}${check.ok ? "" : ` (not an off day on record: ${check.reason})`}` });
  return c.json(approved, 201);
});

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------
export const essCompOffRoutes = new Hono<AppEnv>();
essCompOffRoutes.use("/comp-off", requireEmployee);
essCompOffRoutes.use("/comp-off/*", requireEmployee);

async function me(c: Context<AppEnv>) {
  const [e] = await c.get("db").select().from(employees).where(eq(employees.id, c.get("tenant").employeeId!));
  if (!e) throw notFound("Employee");
  return e;
}

essCompOffRoutes.get("/comp-off", async (c) => {
  const e = await me(c);
  const db = c.get("db");
  const requests = await db.select().from(compOffRequests).where(eq(compOffRequests.employeeId, e.id)).orderBy(desc(compOffRequests.workDate)).limit(50);
  return c.json({ settings: await compOffSettings(db, e.tenantId), claimable: await claimableDays(db, e.tenantId, e), requests });
});

essCompOffRoutes.post("/comp-off", v("json", compOffRequestSchema), async (c) => {
  if (c.get("tenant").readOnly) throw forbidden("Read-only support view");
  const e = await me(c);
  const row = await wrap(() => requestCompOff(c.get("db"), e.tenantId, e, c.req.valid("json"), uid(c)));
  await audit(c, { action: "leave.comp_off_request", entity: "comp_off", entityId: row.id, summary: `${e.fullName} claimed ${dayLabel(Number(row.days))} comp off for ${fmtDate(row.workDate)}` });
  if (e.managerId) {
    const [m] = await c.get("db").select().from(employees).where(eq(employees.id, e.managerId));
    if (m) await mail(c, "comp_off_to_approve", m, `Comp off request: ${e.fullName}`, [`${e.fullName} worked on ${fmtDate(row.workDate)} (${row.dayType === "holiday" ? "a holiday" : "a weekly off"}) and is claiming ${dayLabel(Number(row.days))} comp off.`, `Reason: ${row.reason}`], "/leave");
  }
  return c.json(row, 201);
});

essCompOffRoutes.post("/comp-off/:id/cancel", async (c) => {
  const e = await me(c);
  const [row] = await c.get("db").update(compOffRequests).set({ status: "cancelled" }).where(and(eq(compOffRequests.id, c.req.param("id")), eq(compOffRequests.employeeId, e.id), eq(compOffRequests.status, "pending"))).returning();
  if (!row) throw badRequest("Only a request that's still waiting can be cancelled");
  return c.json(row);
});

async function mail(c: Context<AppEnv>, key: NotificationKey, to: typeof employees.$inferSelect, subject: string, paragraphs: string[], path = "/me/leave") {
  try {
    const { html, text } = layout({ company: "Strats360 People", heading: subject, paragraphs, cta: { label: "Open", url: `${c.env.APP_URL}${path}` } });
    await sendNotification(c, key, { to: to.workEmail, subject, html, text });
  } catch (err) {
    console.error("comp off email failed", err);
  }
}
