import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { employees, memberships, platformStaff, roles, tenants } from "@hrms/db";
import type { AppEnv } from "../env";

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

  // touch last-active (best effort)
  await db.update(memberships).set({ lastActiveAt: new Date() }).where(eq(memberships.userId, s.userId));

  return c.json({
    user: { id: s.userId, name: s.name, email: s.email },
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
      })),
  });
});
