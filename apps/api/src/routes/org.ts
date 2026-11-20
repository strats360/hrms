import { approvalPolicy } from "../services/approvals";
import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { branches, departments, designations, employees, holidays, legalEntities, payrollRuns, shifts, tenants } from "@hrms/db";
import {
  APPROVAL_STEP_LABELS,
  approvalPolicySchema,
  allowedCountries,
  emiratisationStatus,
  saudizationStatus,
  branchSchema,
  companySetupSchema,
  COUNTRIES,
  legalEntitySchema,
  packFor,
  todayLocal,
  departmentSchema,
  designationSchema,
  shiftSchema,
  tenantPayrollSettingsSchema,
  tenantProfileSchema,
} from "@hrms/shared";
import type { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, notFound, conflict } from "../lib/errors";
import { listEntities, nextEntityCode, syncDefaultEntity, tenantPatchFor } from "../services/entities";
import { audit } from "../lib/audit";

export const orgRoutes = new Hono<AppEnv>();

// ---------- company profile ----------
orgRoutes.get("/tenant", async (c) => {
  const [t] = await c.get("db").select().from(tenants).where(eq(tenants.id, c.get("tenant").tenantId));
  if (!t) throw notFound("Company");
  return c.json(t);
});

orgRoutes.patch("/tenant", requirePerm("settings", "edit"), vPatch(tenantProfileSchema.partial()), async (c) => {
  const body = c.req.valid("json");
  const [t] = await c.get("db").update(tenants).set(body).where(eq(tenants.id, c.get("tenant").tenantId)).returning();
  await syncDefaultEntity(c.get("db"), t!.id);
  await audit(c, { action: "tenant.update", entity: "tenant", entityId: t!.id, summary: "Updated company profile", data: body });
  return c.json(t);
});

orgRoutes.patch("/settings", requirePerm("settings", "configure"), vPatch(tenantPayrollSettingsSchema.partial()), async (c) => {
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
  if (body.payroll) {
    // drop zod defaults for keys the client didn't send
    const sent = (await c.req.json().catch(() => ({})))?.payroll ?? {};
    const payroll = Object.fromEntries(Object.entries(body.payroll).filter(([k]) => k in sent));
    patch.settings = { ...cur.settings, ...payroll };
  }
  if (body.setupStep !== undefined) patch.setupStep = String(body.setupStep);
  if (body.completed) patch.setupCompletedAt = new Date();
  const [t] = await db.update(tenants).set(patch).where(eq(tenants.id, id)).returning();
  if (body.profile || body.statutory) await syncDefaultEntity(db, id);
  if (body.completed) await audit(c, { action: "tenant.setup_complete", entity: "tenant", entityId: id, summary: "Completed company setup" });
  return c.json(t);
});

/** Everything a form needs for dropdowns. */
orgRoutes.get("/lookups", async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [b, d, g, s, m, ents] = await Promise.all([
    db.select().from(branches).where(eq(branches.tenantId, tid)).orderBy(asc(branches.name)),
    db.select().from(departments).where(eq(departments.tenantId, tid)).orderBy(asc(departments.name)),
    db.select().from(designations).where(eq(designations.tenantId, tid)).orderBy(asc(designations.name)),
    db.select().from(shifts).where(eq(shifts.tenantId, tid)).orderBy(asc(shifts.name)),
    db
      .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive')`))
      .orderBy(asc(employees.fullName)),
    listEntities(db, tid),
  ]);
  const entities = ents.map((e) => ({ id: e.id, code: e.code, name: e.name, country: e.country, isDefault: e.isDefault, payFrequency: e.payFrequency }));
  return c.json({ branches: b, departments: d, designations: g, shifts: s, employees: m, entities });
});

// ---------- legal entities ----------
// Each company inside a tenant, with its own country, currency and time zone. See docs/MULTI_COUNTRY.md.

/** Check the country is allowed on this instance and fill in currency and time zone defaults. */
function entityValues(c: { env: AppEnv["Bindings"] }, body: z.infer<typeof legalEntitySchema>) {
  const allowed = allowedCountries(c.env.ALLOWED_COUNTRIES);
  if (!allowed.includes(body.country)) {
    const info = COUNTRIES[body.country];
    throw badRequest(info.hasPack ? `${info.name} isn't available on this site.` : `${info.name} isn't supported yet. Its payroll and compliance rules are still being built.`);
  }
  const info = COUNTRIES[body.country];
  const timeZone = body.timeZone ?? info.timeZone;
  if (!info.timeZones.includes(timeZone)) throw badRequest(`Pick a time zone used in ${info.name}`);
  // pay frequency: monthly everywhere; others only where the country's rules are built for them
  const freqs = packFor(body.country).payroll.payFrequencies ?? ["monthly"];
  if (!freqs.includes(body.payFrequency)) throw badRequest(`${info.name} payroll is monthly only`);
  if ((body.payFrequency === "biweekly" || body.payFrequency === "weekly") && !body.payAnchor) throw badRequest("Give the first day of any one pay period");
  const { isDefault: _d, ...rest } = body;
  return { ...rest, payAnchor: body.payFrequency === "biweekly" || body.payFrequency === "weekly" ? body.payAnchor : null, currency: body.currency ?? info.currency, timeZone };
}

orgRoutes.get("/entities", async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const rows = await listEntities(db, tid);
  const counts = await db.select({ e: employees.entityId, n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive')`)).groupBy(employees.entityId);
  const n = new Map(counts.map((r) => [r.e, r.n]));
  const defaultId = rows.find((r) => r.isDefault)?.id;
  const count = (m: Map<string | null, number>, id: string) => (m.get(id) ?? 0) + (id === defaultId ? (m.get(null) ?? 0) : 0);
  // UAE entities: where they stand against the Emiratisation target
  const uae = rows.some((e) => e.country === "AE")
    ? new Map((await db.select({ e: employees.entityId, n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.tenantId, tid), eq(employees.nationality, "AE"), sql`${employees.status} not in ('exited','inactive')`)).groupBy(employees.entityId)).map((r) => [r.e, r.n]))
    : null;
  // Saudi entities: Saudization for Nitaqat, which weighs Saudis by their wage
  const saudis = rows.some((e) => e.country === "SA")
    ? await db.select({ e: employees.entityId, ctc: employees.annualCtc }).from(employees).where(and(eq(employees.tenantId, tid), eq(employees.nationality, "SA"), sql`${employees.status} not in ('exited','inactive')`))
    : [];
  const saudiWages = (id: string) => saudis.filter((r) => r.e === id || (id === defaultId && !r.e)).map((r) => Number(r.ctc) / 12);
  return c.json({
    entities: rows.map((e) => ({
      ...e,
      saudization: e.country === "SA" ? saudizationStatus({ employees: count(n, e.id), saudiWages: saudiWages(e.id) }) : null,
      countryName: COUNTRIES[e.country as keyof typeof COUNTRIES]?.name ?? e.country,
      employees: count(n, e.id),
      emiratisation: uae && e.country === "AE" ? { nationals: count(uae, e.id), ...emiratisationStatus({ employees: count(n, e.id), nationals: count(uae, e.id), on: todayLocal() }) } : null,
    })),
    countries: allowedCountries(c.env.ALLOWED_COUNTRIES).map((k) => COUNTRIES[k]),
  });
});

orgRoutes.post("/entities", requirePerm("settings", "configure"), v("json", legalEntitySchema), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const body = c.req.valid("json");
  await listEntities(db, tid); // make sure the default exists first
  const def = (await listEntities(db, tid)).find((x) => x.isDefault)!;
  const [row] = await db.insert(legalEntities).values({ ...entityValues(c, body), tenantId: tid, code: await nextEntityCode(db, tid), isDefault: false }).returning();
  // A first entity in another country gets its own holiday calendar: the company's existing
  // holidays become the default entity's, and the new country's fixed public holidays are added.
  if (row!.country !== def.country) {
    await db.update(holidays).set({ entityId: def.id }).where(and(eq(holidays.tenantId, tid), isNull(holidays.entityId)));
    const y = Number(todayLocal().slice(0, 4));
    const pack = packFor(row!.country);
    await db.insert(holidays).values([...pack.publicHolidays(y), ...pack.publicHolidays(y + 1)].map((h) => ({ ...h, tenantId: tid, entityId: row!.id })));
  }
  await audit(c, { action: "entity.create", entity: "legal_entity", entityId: row!.id, summary: `Added legal entity ${row!.name} (${row!.country})` });
  return c.json(row, 201);
});

orgRoutes.patch("/entities/:id", requirePerm("settings", "configure"), v("json", legalEntitySchema), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [cur] = await db.select().from(legalEntities).where(and(eq(legalEntities.id, c.req.param("id")), eq(legalEntities.tenantId, tid)));
  if (!cur) throw notFound("Legal entity");
  const body = c.req.valid("json");
  const values = entityValues(c, body);
  if (cur.country !== values.country) {
    const [used] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid), cur.isDefault ? sql`(${employees.entityId} = ${cur.id} or ${employees.entityId} is null)` : eq(employees.entityId, cur.id))).limit(1);
    if (used) throw conflict("This entity has employees, so its country can't change. Add a new entity for the other country instead.");
  }
  if (cur.payFrequency !== values.payFrequency || (cur.payAnchor ?? null) !== (values.payAnchor ?? null)) {
    const [open] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid), eq(payrollRuns.entityId, cur.id), inArray(payrollRuns.status, ["draft", "calculated"]))).limit(1);
    if (open) throw conflict("Finish or discard this entity's open payroll before changing how often it pays.");
  }
  const [row] = await db.update(legalEntities).set({ ...values, updatedAt: new Date() }).where(eq(legalEntities.id, cur.id)).returning();
  // the default entity mirrors the tenant's company profile (Phase 1)
  if (row!.isDefault) await db.update(tenants).set(tenantPatchFor(row!)).where(eq(tenants.id, tid));
  if (body.isDefault && !cur.isDefault) {
    await db.transaction(async (tx) => {
      await tx.update(legalEntities).set({ isDefault: false }).where(and(eq(legalEntities.tenantId, tid), eq(legalEntities.isDefault, true)));
      await tx.update(legalEntities).set({ isDefault: true }).where(eq(legalEntities.id, cur.id));
      await tx.update(tenants).set(tenantPatchFor(row!)).where(eq(tenants.id, tid));
    });
  }
  await audit(c, { action: "entity.update", entity: "legal_entity", entityId: cur.id, summary: `Updated legal entity ${row!.name}` });
  return c.json({ ...row, isDefault: body.isDefault || cur.isDefault });
});

orgRoutes.delete("/entities/:id", requirePerm("settings", "configure"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [cur] = await db.select().from(legalEntities).where(and(eq(legalEntities.id, c.req.param("id")), eq(legalEntities.tenantId, tid)));
  if (!cur) throw notFound("Legal entity");
  if (cur.isDefault) throw conflict("This is the default entity. Make another one the default first.");
  const [used] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid), eq(employees.entityId, cur.id))).limit(1);
  if (used) throw conflict("Move this entity's employees to another entity first, including people who have left.");
  await db.delete(legalEntities).where(eq(legalEntities.id, cur.id));
  await audit(c, { action: "entity.delete", entity: "legal_entity", entityId: cur.id, summary: `Removed legal entity ${cur.name}` });
  return c.json({ ok: true });
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
  orgRoutes.patch(`/${path}/:id`, requirePerm("settings", "edit"), vPatch(schema.partial()), async (c) => {
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

// ---------------------------------------------------------------------------
// Approval chains for leave and attendance corrections
// ---------------------------------------------------------------------------
orgRoutes.get("/approvals", async (c) => c.json(await approvalPolicy(c.get("db"), c.get("tenant").tenantId)));

orgRoutes.put("/approvals", requirePerm("settings", "edit"), v("json", approvalPolicySchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const id = c.get("tenant").tenantId;
  await db.update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ approvals: b })}::jsonb` }).where(eq(tenants.id, id));
  const chain = (s: string[]) => s.map((x) => APPROVAL_STEP_LABELS[x as keyof typeof APPROVAL_STEP_LABELS]).join(" → ");
  await audit(c, { action: "settings.approvals", entity: "tenant", entityId: id, summary: `Approval chains: leave ${chain(b.leave.steps)}${b.leave.longLeaveDays ? `, over ${b.leave.longLeaveDays} days ${chain(b.leave.longSteps)}` : ""}; attendance corrections ${chain(b.attendance.steps)}. Requests already waiting continue from where they are.`, data: b });
  return c.json(b);
});
