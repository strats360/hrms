import { Hono } from "hono";
import { and, eq, notInArray } from "drizzle-orm";
import { branches, departments, designations, employees } from "@hrms/db";
import { can, type OrgPerson } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";

/**
 * Everyone currently employed, with their manager, for the org chart. HR (employees
 * "configure") sees the whole company; a manager sees themselves and everyone below them.
 */
export const orgChartRoutes = new Hono<AppEnv>();
orgChartRoutes.get("/", requirePerm("employees", "view"), async (c) => {
  const t = c.get("tenant");
  const rows: OrgPerson[] = await c
    .get("db")
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, designation: designations.name, department: departments.name, branch: branches.name, managerId: employees.managerId })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(eq(employees.tenantId, t.tenantId), notInArray(employees.status, ["exited", "inactive"])));
  if (can(t.permissions, "employees", "configure")) return c.json({ people: rows, scope: "company" });
  if (!t.employeeId) return c.json({ people: [], scope: "team" });
  // a manager's own branch of the tree
  const below = new Map<string, OrgPerson[]>();
  for (const r of rows) if (r.managerId) below.set(r.managerId, [...(below.get(r.managerId) ?? []), r]);
  const keep = new Set<string>([t.employeeId]);
  const queue = [t.employeeId];
  while (queue.length) for (const r of below.get(queue.shift()!) ?? []) if (!keep.has(r.id)) (keep.add(r.id), queue.push(r.id));
  return c.json({ people: rows.filter((r) => keep.has(r.id)).map((r) => (r.id === t.employeeId ? { ...r, managerId: null } : r)), scope: "team" });
});
