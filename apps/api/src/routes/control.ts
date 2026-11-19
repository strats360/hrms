import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { employees, invoices, legalEntities, memberships, platformStaff, tenants, user } from "@hrms/db";
import { RELEASE } from "./flags";
import { safeEqual } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { v } from "../lib/validate";

/**
 * The control plane's view of this site (docs/MULTI_COUNTRY.md, phase 3). Company level data
 * only: no employees' names, details or pay ever leave the site through here.
 *
 * Every call needs `Authorization: Bearer <CONTROL_TOKEN>`. The site's CONTROL_TOKEN is derived
 * from the shared CONTROL_PLANE_KEY at deploy time (siteControlToken). Without one set, this
 * whole API answers 404.
 */
export const controlRoutes = new Hono<AppEnv>();

controlRoutes.use("*", async (c, next) => {
  const expected = c.env.CONTROL_TOKEN;
  if (!expected) return c.json({ error: { message: "Not found", code: "not_found" } }, 404);
  const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got || !safeEqual(got, expected)) return c.json({ error: { message: "Not allowed", code: "unauthorized" } }, 401);
  await next();
});

const site = (env: AppEnv["Bindings"]) => ({ key: env.INSTANCE_KEY ?? "local", name: env.INSTANCE_NAME ?? "Saralix (local)", region: env.INSTANCE_REGION ?? null, countries: (env.ALLOWED_COUNTRIES ?? "IN").split(","), version: RELEASE.version });

const activeEmployees = sql<number>`count(*) filter (where ${employees.status} not in ('exited','inactive','onboarding'))::int`;

/** Headline numbers for this site. */
controlRoutes.get("/summary", async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ n: sql<number>`count(*)::int`, live: sql<number>`count(*) filter (where ${tenants.status} in ('active','past_due'))::int` }).from(tenants);
  const [e] = await db.select({ n: activeEmployees }).from(employees);
  return c.json({ site: site(c.env), companies: t?.n ?? 0, payingCompanies: t?.live ?? 0, activeEmployees: e?.n ?? 0 });
});

/** Every company on this site: who they are, their plan and status, and how big. */
controlRoutes.get("/tenants", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ id: tenants.id, code: tenants.code, name: tenants.name, plan: tenants.plan, status: tenants.status, trialEndsAt: tenants.trialEndsAt, createdAt: tenants.createdAt, settings: tenants.settings, country: legalEntities.country, currency: legalEntities.currency })
    .from(tenants)
    .leftJoin(legalEntities, and(eq(legalEntities.tenantId, tenants.id), eq(legalEntities.isDefault, true)))
    .orderBy(tenants.name);
  const counts = new Map((await db.select({ t: employees.tenantId, n: activeEmployees }).from(employees).groupBy(employees.tenantId)).map((r) => [r.t, r.n]));
  return c.json({
    site: site(c.env),
    tenants: rows.map(({ settings, ...r }) => ({ ...r, demo: !!(settings as { demo?: boolean } | null)?.demo, employees: counts.get(r.id) ?? 0 })),
  });
});

/** Does someone with this email sign in here? Used by the login page to send people to their site. Nothing is stored. */
controlRoutes.post("/route", v("json", z.object({ email: z.string().trim().toLowerCase().email().max(254) })), async (c) => {
  const db = c.get("db");
  const email = c.req.valid("json").email;
  const [u] = await db.select({ id: user.id }).from(user).where(eq(sql`lower(${user.email})`, email));
  if (!u) return c.json({ found: false });
  const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.status, "active"))).limit(1);
  const [s] = m ? [] : await db.select({ id: platformStaff.userId }).from(platformStaff).where(and(eq(platformStaff.userId, u.id), eq(platformStaff.status, "active")));
  return c.json({ found: !!(m || s) });
});

/** Subscription revenue by month and currency: invoiced and collected. Void invoices are left out. */
controlRoutes.get("/revenue", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({
      period: invoices.period,
      invoiced: sql<number>`coalesce(sum(${invoices.total}), 0)::float`,
      collected: sql<number>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'paid'), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(sql`${invoices.status} <> 'void'`)
    .groupBy(invoices.period)
    .orderBy(sql`${invoices.period} desc`)
    .limit(24);
  // invoices are in INR until billing is per country (phase 3.4)
  return c.json({ site: site(c.env), months: rows.map((r) => ({ ...r, currency: "INR" })) });
});
