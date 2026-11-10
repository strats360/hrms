import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { employees, memberships, tenants } from "@hrms/db";
import { NOTIFICATIONS, notificationPrefsSchema } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { forbidden } from "../lib/errors";
import { audit } from "../lib/audit";
import { companyNotificationPrefs } from "../services/notifications";

const label = (k: string) => NOTIFICATIONS.find((n) => n.key === k)?.label ?? k;

/** Company-wide switches: HR turns an email off for everyone. */
export const orgNotificationRoutes = new Hono<AppEnv>();

orgNotificationRoutes.get("/", requirePerm("settings", "view"), async (c) => {
  const [t] = await c.get("db").select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, c.get("tenant").tenantId));
  return c.json({ company: companyNotificationPrefs(t?.settings) });
});

orgNotificationRoutes.put("/", requirePerm("settings", "edit"), v("json", notificationPrefsSchema), async (c) => {
  const id = c.get("tenant").tenantId;
  const b = c.req.valid("json");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ notifications: b })}::jsonb` }).where(eq(tenants.id, id));
  const off = Object.entries(b).filter(([, on]) => on === false).map(([k]) => label(k));
  await audit(c, { action: "settings.notifications", entity: "tenant", entityId: id, summary: off.length ? `Email notifications turned off for everyone: ${off.join(", ")}` : "All email notifications on", data: b });
  return c.json({ company: b });
});

/** Each person's own switches, for the company they're signed in to. */
export const myNotificationRoutes = new Hono<AppEnv>();

myNotificationRoutes.get("/", async (c) => {
  const t = c.get("tenant");
  if (t.readOnly) throw forbidden("Not available in the support view");
  const db = c.get("db");
  const [[tn], [m], [reports]] = await Promise.all([
    db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, t.tenantId)),
    db.select({ prefs: memberships.notificationPrefs }).from(memberships).where(eq(memberships.id, t.membershipId)),
    t.employeeId
      ? db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.tenantId, t.tenantId), eq(employees.managerId, t.employeeId)))
      : Promise.resolve([{ n: 0 }]),
  ]);
  const groups = [...(t.employeeId ? ["self"] : []), ...(t.roleId || (reports?.n ?? 0) > 0 ? ["approver"] : [])];
  return c.json({ company: companyNotificationPrefs(tn?.settings), personal: m?.prefs ?? {}, groups });
});

myNotificationRoutes.put("/", v("json", notificationPrefsSchema), async (c) => {
  const t = c.get("tenant");
  if (t.readOnly) throw forbidden("Not available in the support view");
  const b = c.req.valid("json");
  await c.get("db").update(memberships).set({ notificationPrefs: b }).where(eq(memberships.id, t.membershipId));
  return c.json({ personal: b });
});
