import { and, asc, eq } from "drizzle-orm";
import { employees, legalEntities, tenants, type Database } from "@hrms/db";
import { COUNTRIES, type CountryCode } from "@hrms/shared";

export type LegalEntity = typeof legalEntities.$inferSelect;

/**
 * Phase 1: the default entity mirrors the tenant's company profile and statutory settings.
 * The company settings screens and the setup wizard still edit the tenant, and this copies the
 * Indian fields across. Editing the default entity directly writes them back to the tenant, so
 * both always agree. See docs/MULTI_COUNTRY.md.
 */
function fromTenant(t: typeof tenants.$inferSelect) {
  const registrations: Record<string, string> = {};
  for (const [k, v] of [["gstin", t.gstin], ["pan", t.pan], ["tan", t.tan], ["cin", t.llpinCin]] as const) if (v) registrations[k] = v;
  return { name: t.name, legalName: t.legalName, state: t.state, address: t.registeredAddress, registrations, statutory: t.statutory as LegalEntity["statutory"] };
}

/** Tenant columns to write when the default entity changes (the reverse of fromTenant). */
export function tenantPatchFor(e: Pick<LegalEntity, "legalName" | "state" | "address" | "registrations" | "statutory">) {
  const r = e.registrations ?? {};
  return { legalName: e.legalName, state: e.state, registeredAddress: e.address, gstin: r.gstin ?? null, pan: r.pan ?? null, tan: r.tan ?? null, llpinCin: r.cin ?? null, statutory: e.statutory };
}

/** The tenant's default entity, created from the tenant if it's missing. */
export async function defaultEntity(db: Database, tenantId: string): Promise<LegalEntity> {
  const [e] = await db.select().from(legalEntities).where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.isDefault, true)));
  if (e) return e;
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new Error(`Tenant ${tenantId} not found`);
  const c = COUNTRIES.IN;
  const [row] = await db
    .insert(legalEntities)
    .values({ tenantId, code: "E01", country: c.code, currency: c.currency, timeZone: c.timeZone, isDefault: true, ...fromTenant(t) })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // created by a parallel request
  const [again] = await db.select().from(legalEntities).where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.isDefault, true)));
  return again!;
}

/** Copy the tenant's company profile and statutory settings onto its default entity. */
export async function syncDefaultEntity(db: Database, tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return;
  const e = await defaultEntity(db, tenantId);
  await db.update(legalEntities).set({ ...fromTenant(t), updatedAt: new Date() }).where(eq(legalEntities.id, e.id));
}

export async function listEntities(db: Database, tenantId: string) {
  await defaultEntity(db, tenantId);
  return db.select().from(legalEntities).where(eq(legalEntities.tenantId, tenantId)).orderBy(asc(legalEntities.code));
}

/** The entity an employee belongs to; employees without one belong to the default entity. */
export async function entityOf(db: Database, tenantId: string, entityId: string | null | undefined) {
  if (entityId) {
    const [e] = await db.select().from(legalEntities).where(and(eq(legalEntities.id, entityId), eq(legalEntities.tenantId, tenantId)));
    if (e) return e;
  }
  return defaultEntity(db, tenantId);
}

/** Next free short code: E01, E02, ... */
export async function nextEntityCode(db: Database, tenantId: string) {
  const used = new Set((await db.select({ code: legalEntities.code }).from(legalEntities).where(eq(legalEntities.tenantId, tenantId))).map((r) => r.code));
  for (let i = 1; ; i++) {
    const code = `E${String(i).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
}

export const countryInfo = (c: string) => COUNTRIES[c as CountryCode];

/** An employee's time zone: their legal entity's zone. */
export async function zoneOfEmployee(db: Database, tenantId: string, employeeId: string) {
  const [e] = await db.select({ entityId: employees.entityId }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  return (await entityOf(db, tenantId, e?.entityId)).timeZone;
}

/** Time zone by entity id for a whole tenant, for loops over many employees. */
export async function entityZones(db: Database, tenantId: string) {
  const list = await listEntities(db, tenantId);
  const def = list.find((x) => x.isDefault)!.timeZone;
  const byId = new Map(list.map((x) => [x.id, x.timeZone]));
  return (entityId: string | null | undefined) => (entityId && byId.get(entityId)) || def;
}
