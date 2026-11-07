import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { createDb, memberships, platformStaff, roles, tenants } from "@hrms/db";
import { can, type Action, type Module } from "@hrms/shared";
import type { AppEnv } from "../env";
import { createAuth } from "./auth";
import { ConsoleMailer, ResendMailer, type Mailer } from "./email";
import { forbidden, unauthorized } from "./errors";
import { featuresFor } from "../services/flags";

let devMailer: ConsoleMailer | null = null;
/** Exposed for tests: the in-memory mailer used when no RESEND_API_KEY is set. */
export function getDevMailer() {
  devMailer ??= new ConsoleMailer();
  return devMailer;
}

/** Per-request services: DB client, mailer and Better Auth. */
export const services = createMiddleware<AppEnv>(async (c, next) => {
  const url = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
  if (!url) throw new Error("No database configured (HYPERDRIVE binding or DATABASE_URL)");
  const db = createDb(url, { max: 5 });
  const mailer: Mailer =
    c.env.RESEND_API_KEY && c.env.EMAIL_FROM ? new ResendMailer(c.env.RESEND_API_KEY, c.env.EMAIL_FROM) : getDevMailer();
  c.set("db", db);
  c.set("mailer", mailer);
  c.set("auth", createAuth(c.env, db, mailer));
  c.set("session", null);
  c.set("platformRole", null);
  try {
    await next();
  } finally {
    const close = db.$client.end({ timeout: 5 });
    try {
      c.executionCtx.waitUntil(close);
    } catch {
      // no execution context (Node tests): let it settle on its own
      void close;
    }
  }
});

/** Resolve the signed-in user (if any). */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const res = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (res?.user) c.set("session", { userId: res.user.id, email: res.user.email, name: res.user.name });
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) throw unauthorized();
  await next();
});

/**
 * Resolve the active tenant for the request. The client sends X-Tenant-Id;
 * if missing we use the user's first active membership. Every tenant-scoped
 * query must filter by c.get("tenant").tenantId.
 */
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) throw unauthorized();
  const db = c.get("db");
  const wanted = c.req.header("x-tenant-id");

  const rows = await db
    .select({ m: memberships, role: roles, tenantStatus: tenants.status, plan: tenants.plan })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.userId, session.userId), eq(memberships.status, "active")));

  const row = wanted ? rows.find((r) => r.m.tenantId === wanted) : rows[0];
  if (!row) throw forbidden("You don't have access to this company");
  if (row.tenantStatus === "suspended" || row.tenantStatus === "cancelled") {
    throw forbidden("This company's account is suspended. Contact your administrator.");
  }

  c.set("tenant", {
    tenantId: row.m.tenantId,
    membershipId: row.m.id,
    roleId: row.m.roleId,
    roleName: row.role?.name ?? null,
    permissions: row.role?.permissions ?? {},
    employeeId: row.m.employeeId,
    plan: row.plan,
    features: await featuresFor(db, { id: row.m.tenantId, plan: row.plan }),
    readOnly: null,
  });
  await next();
});

/** Block a route group when the tenant's plan or a feature flag doesn't include it. */
export const requireFeature = (key: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get("tenant").features[key] === false) throw forbidden("This feature isn't included in your plan. Contact us to upgrade.");
    await next();
  });

/** Require a module permission from the user's tenant role. */
export const requirePerm = (module: Module, action: Action = "view") =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.get("tenant").permissions, module, action)) throw forbidden();
    await next();
  });

/** Has the current user got any admin role in this tenant? */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("tenant").roleId) throw forbidden("This area is for administrators");
  await next();
});

/** Require the current user to be in a tenant as an employee (for self-service). */
export const requireEmployee = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("tenant").employeeId) throw forbidden("Your login isn't linked to an employee record");
  await next();
});

/** SaaS operator console. */
export const requirePlatform = (...allowed: string[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) throw unauthorized();
    const [staff] = await c
      .get("db")
      .select()
      .from(platformStaff)
      .where(and(eq(platformStaff.userId, session.userId), eq(platformStaff.status, "active")));
    if (!staff || (allowed.length && !allowed.includes(staff.role))) throw forbidden("Platform staff only");
    c.set("platformRole", staff.role);
    await next();
  });
