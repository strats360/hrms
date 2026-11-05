import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { employees } from "@hrms/db";
import { can, type Module } from "@hrms/shared";
import type { AppEnv } from "../env";

/**
 * Data scope for a module. Roles with "configure" on the module act
 * organisation-wide; everyone else (e.g. managers) only sees their direct reports.
 * Returns null for "all employees", otherwise the list of visible employee IDs.
 */
export async function teamScope(c: Context<AppEnv>, module: Module): Promise<string[] | null> {
  const t = c.get("tenant");
  if (can(t.permissions, module, "configure")) return null;
  if (!t.employeeId) return [];
  const rows = await c
    .get("db")
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, t.tenantId), eq(employees.managerId, t.employeeId)));
  return rows.map((r) => r.id);
}

export function inScope(scope: string[] | null, employeeId: string) {
  return scope === null || scope.includes(employeeId);
}
