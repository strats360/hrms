import { Hono } from "hono";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { auditLogs, employees, memberships, platformStaff, roles, tenants, user } from "@hrms/db";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePlatform } from "../lib/context";
import { v } from "../lib/validate";
import { notFound } from "../lib/errors";
import { audit } from "../lib/audit";

/** SaaS operator console. Separate from tenant admin; requires platform_staff membership. */
export const platformRoutes = new Hono<AppEnv>();
platformRoutes.use("*", requirePlatform());

const empCount = sql<number>`(select count(*)::int from ${employees} e where e.tenant_id = ${tenants.id} and e.status not in ('exited','inactive'))`;

platformRoutes.get("/overview", async (c) => {
  const db = c.get("db");
  const byStatus = await db.select({ status: tenants.status, n: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.status);
  const byPlan = await db.select({ plan: tenants.plan, n: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.plan);
  const [emp] = await db.select({ n: sql<number>`count(*)::int` }).from(employees).where(sql`${employees.status} not in ('exited','inactive')`);
  const [users] = await db.select({ n: sql<number>`count(*)::int` }).from(user);
  const recent = await db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status, plan: tenants.plan, createdAt: tenants.createdAt }).from(tenants).orderBy(desc(tenants.createdAt)).limit(5);
  const trialsEnding = await db
    .select({ id: tenants.id, name: tenants.name, trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(and(eq(tenants.status, "trial"), sql`${tenants.trialEndsAt} < now() + interval '7 days'`))
    .orderBy(tenants.trialEndsAt);
  return c.json({ byStatus, byPlan, activeEmployees: emp?.n ?? 0, users: users?.n ?? 0, recent, trialsEnding });
});

platformRoutes.get("/tenants", v("query", z.object({ q: z.string().optional(), status: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const conds = [];
  if (q.q) conds.push(or(ilike(tenants.name, `%${q.q}%`), ilike(tenants.code, `%${q.q}%`), ilike(tenants.gstin, `%${q.q}%`))!);
  if (q.status) conds.push(eq(tenants.status, q.status));
  const rows = await c
    .get("db")
    .select({ id: tenants.id, code: tenants.code, name: tenants.name, state: tenants.state, plan: tenants.plan, status: tenants.status, gstin: tenants.gstin, trialEndsAt: tenants.trialEndsAt, setupCompletedAt: tenants.setupCompletedAt, createdAt: tenants.createdAt, employees: empCount })
    .from(tenants)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(tenants.createdAt));
  return c.json(rows);
});

platformRoutes.get("/tenants/:id", async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ t: tenants, employees: empCount }).from(tenants).where(eq(tenants.id, c.req.param("id")));
  if (!t) throw notFound("Tenant");
  const admins = await db
    .select({ name: user.name, email: user.email, role: roles.name, status: memberships.status, lastActiveAt: memberships.lastActiveAt })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(eq(memberships.tenantId, t.t.id));
  return c.json({ ...t.t, employees: t.employees, admins });
});

platformRoutes.patch(
  "/tenants/:id",
  requirePlatform("super_admin"),
  v("json", z.object({ status: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]).optional(), plan: z.enum(["trial", "starter", "growth", "enterprise"]).optional(), trialEndsAt: z.string().datetime().optional() })),
  async (c) => {
    const body = c.req.valid("json");
    const [row] = await c
      .get("db")
      .update(tenants)
      .set({ ...body, trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : undefined })
      .where(eq(tenants.id, c.req.param("id")))
      .returning();
    if (!row) throw notFound("Tenant");
    await audit(c, { tenantId: null, action: "platform.tenant_update", entity: "tenant", entityId: row.id, summary: `Updated ${row.name}: ${Object.entries(body).map(([k, v]) => `${k}=${v}`).join(", ")}` });
    return c.json(row);
  },
);

platformRoutes.get("/staff", async (c) => {
  const rows = await c
    .get("db")
    .select({ userId: platformStaff.userId, role: platformStaff.role, status: platformStaff.status, name: user.name, email: user.email, createdAt: platformStaff.createdAt })
    .from(platformStaff)
    .innerJoin(user, eq(user.id, platformStaff.userId));
  return c.json(rows);
});

platformRoutes.get("/audit", async (c) => {
  const rows = await c
    .get("db")
    .select({ log: auditLogs, tenantName: tenants.name })
    .from(auditLogs)
    .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);
  return c.json(rows.map((r) => ({ ...r.log, tenantName: r.tenantName })));
});
