import { Hono, type Context } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { employees, fbpDeclarations, type Database } from "@hrms/db";
import { checkFbpAllocations, fbpDeclarationSchema, fbpHeadsFor, fyOfMonth, sumFbp, todayLocal, type Regime } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { entityOf } from "../services/entities";
import { fbpBalances, fbpSettings } from "../services/fbp";
import { getTemplate, resolveStructure, structuresAsOf } from "../services/payroll";
import { declarationsFor } from "../services/tax";

/** What an employee's plan comes out of: the special allowance on their current salary, and their regime. */
async function planBasis(db: Database, tid: string, eid: string, fy: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, eid), eq(employees.tenantId, tid)));
  if (!e) throw notFound("Employee");
  const ent = await entityOf(db, tid, e.entityId);
  if (ent.country !== "IN") throw badRequest("Flexible benefits are for employees paid in India");
  const today = todayLocal();
  const [structs, book, decls] = await Promise.all([structuresAsOf(db, tid, [eid], today), getTemplate(db, tid), declarationsFor(db, tid, fy, [eid])]);
  const s = resolveStructure(e, structs.get(eid), book);
  const regime = ((decls.get(eid)?.regime ?? e.taxRegime) as Regime) === "old" ? "old" : "new";
  return { employee: e, annualSpecial: s.components.special * 12, regime: regime as "new" | "old" };
}

const fyParam = (c: Context<AppEnv>) => {
  const fy = c.req.query("fy");
  return fy && /^\d{4}-\d{2}$/.test(fy) ? fy : fyOfMonth(todayLocal().slice(0, 7));
};

// ---------- employee self service ----------
export const essFbpRoutes = new Hono<AppEnv>();
essFbpRoutes.use("*", requireEmployee);
const me = (c: Context<AppEnv>) => ({ tid: c.get("tenant").tenantId, eid: c.get("tenant").employeeId! });

essFbpRoutes.get("/", async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const settings = await fbpSettings(db, tid);
  if (!settings) return c.json({ enabled: false });
  const fy = fyParam(c);
  const basis = await planBasis(db, tid, eid, fy);
  const [decl] = await db.select().from(fbpDeclarations).where(and(eq(fbpDeclarations.tenantId, tid), eq(fbpDeclarations.employeeId, eid), eq(fbpDeclarations.fy, fy)));
  return c.json({
    enabled: true,
    fy,
    regime: basis.regime,
    annualSpecial: basis.annualSpecial,
    heads: fbpHeadsFor(settings.heads, basis.regime),
    declaration: decl ? { allocations: decl.allocations, status: decl.status, note: decl.note, total: sumFbp(decl.allocations), updatedAt: decl.updatedAt } : null,
    balances: await fbpBalances(db, tid, eid, fy),
  });
});

essFbpRoutes.put("/", v("json", fbpDeclarationSchema), async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const settings = await fbpSettings(db, tid);
  if (!settings) throw badRequest("Your company doesn't offer flexible benefits");
  const fy = fyParam(c);
  const basis = await planBasis(db, tid, eid, fy);
  let allocations;
  try {
    allocations = checkFbpAllocations(settings.heads, basis.regime, c.req.valid("json").allocations, basis.annualSpecial);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const status = settings.autoApprove ? "approved" : "submitted";
  const [cur] = await db.select().from(fbpDeclarations).where(and(eq(fbpDeclarations.tenantId, tid), eq(fbpDeclarations.employeeId, eid), eq(fbpDeclarations.fy, fy)));
  const values = { allocations, status, note: null, decidedBy: null, decidedAt: settings.autoApprove ? new Date() : null, updatedAt: new Date() };
  if (cur) await db.update(fbpDeclarations).set(values).where(eq(fbpDeclarations.id, cur.id));
  else await db.insert(fbpDeclarations).values({ tenantId: tid, employeeId: eid, fy, ...values });
  await audit(c, { action: "fbp.declare", entity: "employee", entityId: eid, summary: `Flexible benefit plan for ${fy}: ${sumFbp(allocations).toLocaleString("en-IN")} a year (${status})`, data: allocations });
  return c.json({ status, total: sumFbp(allocations) });
});

// ---------- HR ----------
export const fbpAdminRoutes = new Hono<AppEnv>();

fbpAdminRoutes.get("/", requirePerm("payroll", "view"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const fy = fyParam(c);
  const rows = await db
    .select({ d: fbpDeclarations, name: employees.fullName, code: employees.employeeCode })
    .from(fbpDeclarations)
    .innerJoin(employees, eq(employees.id, fbpDeclarations.employeeId))
    .where(and(eq(fbpDeclarations.tenantId, tid), eq(fbpDeclarations.fy, fy)))
    .orderBy(asc(employees.employeeCode));
  return c.json({
    fy,
    settings: (await fbpSettings(db, tid)) ?? null,
    rows: rows.map((r) => ({ id: r.d.id, employeeId: r.d.employeeId, name: r.name, code: r.code, allocations: r.d.allocations, total: sumFbp(r.d.allocations), status: r.d.status, note: r.d.note, updatedAt: r.d.updatedAt })),
  });
});

fbpAdminRoutes.post("/:id/decision", requirePerm("payroll", "edit"), v("json", z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(300).optional() })), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const b = c.req.valid("json");
  if (b.decision === "rejected" && !b.note) throw badRequest("Say why, so the employee can fix it");
  const [d] = await db.select().from(fbpDeclarations).where(and(eq(fbpDeclarations.id, c.req.param("id")), eq(fbpDeclarations.tenantId, tid)));
  if (!d) throw notFound("Plan");
  await db.update(fbpDeclarations).set({ status: b.decision, note: b.note ?? null, decidedBy: c.get("session")!.userId, decidedAt: new Date(), updatedAt: new Date() }).where(eq(fbpDeclarations.id, d.id));
  await audit(c, { action: `fbp.${b.decision}`, entity: "employee", entityId: d.employeeId, summary: `Flexible benefit plan for ${d.fy} ${b.decision}${b.note ? `: ${b.note}` : ""}` });
  return c.json({ status: b.decision });
});
