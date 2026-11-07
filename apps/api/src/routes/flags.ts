import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { featureFlags, tenants } from "@hrms/db";
import { featureFlagSchema, FEATURES, flagOn } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePlatform } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { invalidateFlags } from "../services/flags";

/** Platform console: feature flags and the current release. */
export const flagRoutes = new Hono<AppEnv>();
flagRoutes.use("*", requirePlatform());

export const RELEASE = { version: "1.4.0", name: "Phase 2: payroll, compliance, TDS, claims, payments, reports, billing, platform operations" };

flagRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(featureFlags).orderBy(asc(featureFlags.key));
  const ts = await db.select({ id: tenants.id, name: tenants.name, plan: tenants.plan, status: tenants.status }).from(tenants);
  return c.json({
    release: RELEASE,
    known: FEATURES,
    flags: rows.map((f) => ({ ...f, tenantsOn: ts.filter((t) => t.status !== "cancelled" && flagOn(f, t)).length, tenantsTotal: ts.filter((t) => t.status !== "cancelled").length })),
    tenants: ts,
  });
});

flagRoutes.post("/", requirePlatform("super_admin"), v("json", featureFlagSchema), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c.get("db").insert(featureFlags).values({ ...b, updatedBy: c.get("session")!.userId }).returning();
  invalidateFlags();
  await audit(c, { tenantId: null, action: "platform.flag_create", entity: "feature_flag", entityId: row!.id, summary: `Created flag ${b.key} (${b.enabled ? b.rollout : "off"})` });
  return c.json(row, 201);
});

flagRoutes.patch("/:id", requirePlatform("super_admin"), vPatch(featureFlagSchema.omit({ key: true }).partial()), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c.get("db").update(featureFlags).set({ ...b, updatedBy: c.get("session")!.userId }).where(eq(featureFlags.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Flag");
  invalidateFlags();
  const what = b.enabled === false ? "switched off" : b.enabled === true ? "switched on" : `rollout ${row.rollout}${row.rollout === "percent" ? ` ${row.percent}%` : row.rollout === "plans" ? ` (${row.plans.join(", ")})` : ""}`;
  await audit(c, { tenantId: null, action: "platform.flag_update", entity: "feature_flag", entityId: row.id, summary: `Flag ${row.key} ${what}`, data: b });
  return c.json(row);
});
