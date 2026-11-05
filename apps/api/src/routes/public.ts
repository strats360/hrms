import { Hono, type Context } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  adminInvites,
  departments,
  designations,
  branches,
  employees,
  memberships,
  onboardingInvites,
  roles,
  tenants,
} from "@hrms/db";
import { companySignupSchema, onboardingAcceptSchema, sha256Hex } from "@hrms/shared";
import type { AppEnv } from "../env";
import { v } from "../lib/validate";
import { badRequest, conflict, notFound } from "../lib/errors";
import { findUserByEmail, upsertLogin } from "../services/users";
import { provisionTenant } from "../services/provisioning";
import { signInAndRespond } from "../lib/signin";
import { audit } from "../lib/audit";

export const publicRoutes = new Hono<AppEnv>();

/** Self-serve company signup: creates the admin login and the tenant, then signs in. */
publicRoutes.post("/signup", v("json", companySignupSchema), async (c) => {
  const input = c.req.valid("json");
  const db = c.get("db");
  if (await findUserByEmail(db, input.email)) {
    throw conflict("An account with this email already exists. Sign in instead.");
  }
  const userId = await upsertLogin(db, { email: input.email, name: input.adminName, password: input.password });
  const { tenant } = await provisionTenant(db, {
    name: input.companyName,
    legalName: input.legalName ?? input.companyName,
    state: input.state,
    ownerUserId: userId,
  });
  if (input.phone) await db.update(tenants).set({ contactPhone: input.phone, contactEmail: input.email }).where(eq(tenants.id, tenant.id));
  await audit(c, { tenantId: tenant.id, action: "tenant.signup", entity: "tenant", entityId: tenant.id, summary: `${input.companyName} signed up` });
  return signInAndRespond(c, input.email, input.password, { tenantId: tenant.id });
});

async function findInvite(c: Context<AppEnv>, token: string) {
  const db = c.get("db");
  const hash = await sha256Hex(token);
  const [row] = await db
    .select({ inv: onboardingInvites, emp: employees, tenant: tenants })
    .from(onboardingInvites)
    .innerJoin(employees, eq(employees.id, onboardingInvites.employeeId))
    .innerJoin(tenants, eq(tenants.id, onboardingInvites.tenantId))
    .where(eq(onboardingInvites.tokenHash, hash));
  return row ?? null;
}

/** Details shown on the invite landing page. Marks the invite as opened. */
publicRoutes.get("/onboarding/:token", async (c) => {
  const row = await findInvite(c, c.req.param("token"));
  if (!row) throw notFound("Invite");
  const db = c.get("db");
  const expired = row.inv.expiresAt < new Date();
  if (!expired && row.inv.status === "invited") {
    await db.update(onboardingInvites).set({ status: "opened", openedAt: new Date() }).where(eq(onboardingInvites.id, row.inv.id));
  }
  const [dept] = row.emp.departmentId ? await db.select().from(departments).where(eq(departments.id, row.emp.departmentId)) : [];
  const [desig] = row.emp.designationId ? await db.select().from(designations).where(eq(designations.id, row.emp.designationId)) : [];
  const [branch] = row.emp.branchId ? await db.select().from(branches).where(eq(branches.id, row.emp.branchId)) : [];
  const [mgr] = row.emp.managerId ? await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, row.emp.managerId)) : [];
  return c.json({
    companyName: row.tenant.name,
    employeeName: row.emp.fullName,
    firstName: row.emp.firstName,
    email: row.inv.email,
    designation: desig?.name ?? null,
    department: dept?.name ?? null,
    branch: branch?.name ?? null,
    manager: mgr?.name ?? null,
    dateOfJoining: row.emp.dateOfJoining,
    expiresAt: row.inv.expiresAt,
    expired,
    status: row.inv.status,
  });
});

/** Accept invite: set a password, create the login and link it to the employee. */
publicRoutes.post("/onboarding/accept", v("json", onboardingAcceptSchema), async (c) => {
  const { token, password } = c.req.valid("json");
  const row = await findInvite(c, token);
  if (!row) throw notFound("Invite");
  if (row.inv.expiresAt < new Date()) throw badRequest("This invite has expired. Ask HR to resend it.");
  if (row.inv.status === "verified") throw badRequest("You've already completed onboarding. Sign in instead.");
  const db = c.get("db");
  const userId = await upsertLogin(db, { email: row.inv.email, name: row.emp.fullName, password, verified: true });
  await db.update(employees).set({ userId }).where(eq(employees.id, row.emp.id));
  const [existing] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, row.tenant.id), eq(memberships.userId, userId)));
  if (existing) {
    await db.update(memberships).set({ employeeId: row.emp.id, status: "active" }).where(eq(memberships.id, existing.id));
  } else {
    await db.insert(memberships).values({ tenantId: row.tenant.id, userId, employeeId: row.emp.id, status: "active" });
  }
  const steps = new Set(row.inv.completedSteps);
  steps.add("account");
  await db
    .update(onboardingInvites)
    .set({
      status: row.inv.status === "submitted" ? "submitted" : "in_progress",
      completedSteps: [...steps],
      progress: Math.max(row.inv.progress, 15),
    })
    .where(eq(onboardingInvites.id, row.inv.id));
  return signInAndRespond(c, row.inv.email, password, { tenantId: row.tenant.id });
});

/** Admin invites (e.g. an external CA or a new HR user). */
publicRoutes.get("/admin-invite/:token", async (c) => {
  const db = c.get("db");
  const hash = await sha256Hex(c.req.param("token"));
  const [row] = await db
    .select({ inv: adminInvites, tenantName: tenants.name, roleName: roles.name })
    .from(adminInvites)
    .innerJoin(tenants, eq(tenants.id, adminInvites.tenantId))
    .leftJoin(roles, eq(roles.id, adminInvites.roleId))
    .where(and(eq(adminInvites.tokenHash, hash), isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, new Date())));
  if (!row) throw notFound("Invite");
  const existing = await findUserByEmail(db, row.inv.email);
  return c.json({ companyName: row.tenantName, role: row.roleName, name: row.inv.name, email: row.inv.email, hasAccount: !!existing });
});

publicRoutes.post("/admin-invite/accept", v("json", onboardingAcceptSchema), async (c) => {
  const { token, password } = c.req.valid("json");
  const db = c.get("db");
  const hash = await sha256Hex(token);
  const [inv] = await db
    .select()
    .from(adminInvites)
    .where(and(eq(adminInvites.tokenHash, hash), isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, new Date())));
  if (!inv) throw notFound("Invite");
  const userId = await upsertLogin(db, { email: inv.email, name: inv.name, password, verified: true });
  const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, inv.tenantId), eq(memberships.userId, userId)));
  if (m) {
    await db.update(memberships).set({ roleId: inv.roleId, status: "active", scope: inv.scope }).where(eq(memberships.id, m.id));
  } else {
    const [emp] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, inv.tenantId), eq(employees.workEmail, inv.email)));
    await db.insert(memberships).values({ tenantId: inv.tenantId, userId, roleId: inv.roleId, scope: inv.scope, employeeId: emp?.id ?? null, status: "active" });
  }
  await db.update(adminInvites).set({ acceptedAt: new Date() }).where(eq(adminInvites.id, inv.id));
  return signInAndRespond(c, inv.email, password, { tenantId: inv.tenantId });
});
