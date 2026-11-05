import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { branches, departments, designations, employees, shifts, tenants } from "@hrms/db";
import {
  branchSchema,
  companySetupSchema,
  departmentSchema,
  designationSchema,
  shiftSchema,
  tenantPayrollSettingsSchema,
  tenantProfileSchema,
} from "@hrms/shared";
import type { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { notFound, conflict } from "../lib/errors";
import { audit } from "../lib/audit";

export const orgRoutes = new Hono<AppEnv>();

// ---------- company profile ----------
orgRoutes.get("/tenant", async (c) => {
  const [t] = await c.get("db").select().from(tenants).where(eq(tenants.id, c.get("tenant").tenantId));
  if (!t) throw notFound("Company");
  return c.json(t);
});

orgRoutes.patch("/tenant", requirePerm("settings", "edit"), v("json", tenantProfileSchema.partial()), async (c) => {
  const body = c.req.valid("json");
  const [t] = await c.get("db").update(tenants).set(body).where(eq(tenants.id, c.get("tenant").tenantId)).returning();
  await audit(c, { action: "tenant.update", entity: "tenant", entityId: t!.id, summary: "Updated company profile", data: body });
  return c.json(t);
});

orgRoutes.patch("/settings", requirePerm("settings", "configure"), v("json", tenantPayrollSettingsSchema.partial()), async (c) => {
  const db = c.get("db");
  const id = c.get("tenant").tenantId;
  const [cur] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, id));
  const settings = { ...(cur?.settings ?? {}), ...c.req.valid("json") };
  await db.update(tenants).set({ settings }).where(eq(tenants.id, id));
  await audit(c, { action: "tenant.settings", entity: "tenant", entityId: id, summary: "Updated payroll and attendance settings", data: settings });
  return c.json({ settings });
});

/** Company setup wizard: saves any of profile / statutory / payroll and the current step. */
orgRoutes.post("/setup", requirePerm("settings", "configure"), v("json", companySetupSchema), async (c) => {
  const db = c.get("db");
  const id = c.get("tenant").tenantId;
  const body = c.req.valid("json");
  const [cur] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!cur) throw notFound("Company");
  const patch: Partial<typeof tenants.$inferInsert> = {};
  if (body.profile) Object.assign(patch, body.profile);
  if (body.statutory) patch.statutory = { ...cur.statutory, ...body.statutory };
  if (body.payroll) patch.settings = { ...cur.settings, ...body.payroll };
  if (body.setupStep !== undefined) patch.setupStep = String(body.setupStep);
  if (body.completed) patch.setupCompletedAt = new Date();
  const [t] = await db.update(tenants).set(patch).where(eq(tenants.id, id)).returning();
  if (body.completed) await audit(c, { action: "tenant.setup_complete", entity: "tenant", entityId: id, summary: "Completed company setup" });
  return c.json(t);
});

/** Everything a form needs for dropdowns. */
orgRoutes.get("/lookups", async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [b, d, g, s, m] = await Promise.all([
    db.select().from(branches).where(eq(branches.tenantId, tid)).orderBy(asc(branches.name)),
    db.select().from(departments).where(eq(departments.tenantId, tid)).orderBy(asc(departments.name)),
    db.select().from(designations).where(eq(designations.tenantId, tid)).orderBy(asc(designations.name)),
    db.select().from(shifts).where(eq(shifts.tenantId, tid)).orderBy(asc(shifts.name)),
    db
      .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive')`))
      .orderBy(asc(employees.fullName)),
  ]);
  return c.json({ branches: b, departments: d, designations: g, shifts: s, employees: m });
});

// ---------- simple master-data CRUD ----------
type Tbl = PgTable & { id: any; tenantId: any };

function crud<T extends Tbl>(path: string, table: T, schema: z.ZodObject<any>, entity: string, inUse?: (db: AppEnv["Variables"]["db"], tid: string, id: string) => Promise<boolean>) {
  orgRoutes.get(`/${path}`, async (c) => {
    const rows = await c.get("db").select().from(table as PgTable).where(eq(table.tenantId, c.get("tenant").tenantId));
    return c.json(rows);
  });
  orgRoutes.post(`/${path}`, requirePerm("settings", "edit"), v("json", schema), async (c) => {
    const tid = c.get("tenant").tenantId;
    const body = c.req.valid("json") as Record<string, unknown>;
    const db = c.get("db");
    if (path === "shifts" && body.isDefault) await db.update(shifts).set({ isDefault: false }).where(eq(shifts.tenantId, tid));
    if (path === "branches" && body.isHeadOffice) await db.update(branches).set({ isHeadOffice: false }).where(eq(branches.tenantId, tid));
    const [row] = await db.insert(table).values({ ...body, tenantId: tid } as any).returning();
    await audit(c, { action: `${entity}.create`, entity, entityId: (row as any).id, summary: `Added ${entity} ${body.name}` });
    return c.json(row, 201);
  });
  orgRoutes.patch(`/${path}/:id`, requirePerm("settings", "edit"), v("json", schema.partial()), async (c) => {
    const tid = c.get("tenant").tenantId;
    const body = c.req.valid("json") as Record<string, unknown>;
    const db = c.get("db");
    if (path === "shifts" && body.isDefault) await db.update(shifts).set({ isDefault: false }).where(eq(shifts.tenantId, tid));
    if (path === "branches" && body.isHeadOffice) await db.update(branches).set({ isHeadOffice: false }).where(eq(branches.tenantId, tid));
    const [row] = await db
      .update(table)
      .set(body as any)
      .where(and(eq(table.id, c.req.param("id")), eq(table.tenantId, tid)))
      .returning();
    if (!row) throw notFound(entity);
    await audit(c, { action: `${entity}.update`, entity, entityId: c.req.param("id"), data: body });
    return c.json(row);
  });
  orgRoutes.delete(`/${path}/:id`, requirePerm("settings", "edit"), async (c) => {
    const tid = c.get("tenant").tenantId;
    const id = c.req.param("id");
    if (inUse && (await inUse(c.get("db"), tid, id))) throw conflict(`This ${entity} is assigned to employees. Reassign them first.`);
    const [row] = await c
      .get("db")
      .delete(table)
      .where(and(eq(table.id, id), eq(table.tenantId, tid)))
      .returning();
    if (!row) throw notFound(entity);
    await audit(c, { action: `${entity}.delete`, entity, entityId: id, summary: `Deleted ${entity} ${(row as any).name}` });
    return c.json({ ok: true });
  });
}

const usedBy = (col: any) => async (db: AppEnv["Variables"]["db"], tid: string, id: string) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(eq(employees.tenantId, tid), eq(col, id)));
  return (r?.n ?? 0) > 0;
};

crud("branches", branches as unknown as Tbl, branchSchema, "branch", usedBy(employees.branchId));
crud("departments", departments as unknown as Tbl, departmentSchema, "department", usedBy(employees.departmentId));
crud("designations", designations as unknown as Tbl, designationSchema, "designation", usedBy(employees.designationId));
crud("shifts", shifts as unknown as Tbl, shiftSchema, "shift", usedBy(employees.shiftId));
