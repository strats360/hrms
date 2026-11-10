import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { employees, memberships, platformStaff, roles, tenants } from "@hrms/db";
import type { AppEnv } from "../env";
import { loadFlags } from "../services/flags";
import { activeAccess } from "../services/support";
import { evaluateFlags, readTwoFactorPolicy, twoFactorRequired } from "@hrms/shared";

export const meRoutes = new Hono<AppEnv>();

/** Who am I: memberships (tenants + role permissions) and platform staff role. */
meRoutes.get("/", async (c) => {
  const s = c.get("session")!;
  const db = c.get("db");
  const rows = await db
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantCode: tenants.code,
      tenantStatus: tenants.status,
      plan: tenants.plan,
      settings: tenants.settings,
      setupCompletedAt: tenants.setupCompletedAt,
      roleId: roles.id,
      roleName: roles.name,
      permissions: roles.permissions,
      employeeId: memberships.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      designationId: employees.designationId,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(employees, eq(employees.id, memberships.employeeId))
    .where(eq(memberships.userId, s.userId));
  const [staff] = await db.select().from(platformStaff).where(eq(platformStaff.userId, s.userId));

  const flags = await loadFlags(db);

  // touch last-active (best effort)
  await db.update(memberships).set({ lastActiveAt: new Date() }).where(eq(memberships.userId, s.userId));

  // platform support: running read-only sessions show up as extra (view-only) companies
  const support = staff?.status === "active" ? await activeAccess(db, s.userId) : [];
  const supportTenants = support.length ? await db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status, plan: tenants.plan }).from(tenants) : [];
  return c.json({
    user: { id: s.userId, name: s.name, email: s.email, twoFactorEnabled: s.twoFactorEnabled },
    supportSessions: support.map((a) => {
      const t = supportTenants.find((x) => x.id === a.access.tenantId)!;
      return { tenantId: t.id, tenantName: t.name, tenantCode: t.code, tenantStatus: t.status, plan: t.plan, features: evaluateFlags(flags, { id: t.id, plan: t.plan }), ticketId: a.access.ticketId, ticketNumber: a.number, accessId: a.access.id, expiresAt: a.access.expiresAt };
    }),
    platformRole: staff?.status === "active" ? staff.role : null,
    memberships: rows
      .filter((r) => r.status === "active")
      .map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantCode: r.tenantCode,
        tenantStatus: r.tenantStatus,
        setupComplete: !!r.setupCompletedAt,
        roleId: r.roleId,
        roleName: r.roleName,
        permissions: r.permissions ?? {},
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
        plan: r.plan,
        features: evaluateFlags(flags, { id: r.tenantId, plan: r.plan }),
        twoFactorRequired: twoFactorRequired(readTwoFactorPolicy(r.settings), !!r.roleId),
      })),
  });
});
