import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env";
import { onError } from "./lib/errors";
import { loadSession, readOnlyGuard, requireAdmin, requireAuth, requireFeature, requireTenant, services } from "./lib/context";
import { publicRoutes } from "./routes/public";
import { cashfreeWebhook, tenantPayRoutes } from "./routes/cashfree";
import { meRoutes } from "./routes/me";
import { orgRoutes } from "./routes/org";
import { accessRoutes } from "./routes/access";
import { employeeRoutes } from "./routes/employees";
import { onboardingAdminRoutes } from "./routes/onboarding";
import { attendanceRoutes } from "./routes/attendance";
import { leaveRoutes } from "./routes/leave";
import { dashboardRoutes } from "./routes/dashboard";
import { essRoutes } from "./routes/ess";
import { essExitRoutes, exitRoutes } from "./routes/exits";
import { attendanceImportRoutes, devicePunchRoutes } from "./routes/attendance-devices";
import { leaveExtrasRoutes, payrollExtrasRoutes } from "./routes/pay-extras";
import { essPayslipFileRoutes, payslipFileRoutes } from "./routes/payslip-files";
import { platformRoutes } from "./routes/platform";
import { auditRoutes } from "./routes/audit";
import { fileRoutes } from "./routes/files";
import { payrollRoutes } from "./routes/payroll";
import { complianceRoutes } from "./routes/compliance";
import { essTaxRoutes, tdsRoutes } from "./routes/tds";
import { essClaimRoutes, reimbursementRoutes } from "./routes/reimbursements";
import { paymentRoutes } from "./routes/payments";
import { reportRoutes } from "./routes/reports";
import { platformBillingRoutes, tenantBillingRoutes } from "./routes/billing";
import { flagRoutes, RELEASE } from "./routes/flags";
import { createDb } from "@hrms/db";
import { sql } from "drizzle-orm";
import { statutoryRoutes } from "./routes/statutory";
import { platformSupportRoutes, tenantSupportRoutes } from "./routes/support";

/** Better Auth endpoints we expose. Sign-up and everything else stays closed. */
const AUTH_ALLOW = [
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/api/auth/get-session",
  "/api/auth/request-password-reset",
  "/api/auth/forget-password",
  "/api/auth/reset-password",
  "/api/auth/change-password",
  "/api/auth/list-sessions",
  "/api/auth/revoke-other-sessions",
];

export function buildApp() {
  const app = new Hono<AppEnv>();
  app.onError(onError);

  const api = new Hono<AppEnv>();
  api.use("*", secureHeaders());
  api.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  api.get("/health", async (c) => {
    const base = { ok: true, version: RELEASE.version, environment: c.env.ENVIRONMENT ?? "development" };
    if (!c.req.query("deep")) return c.json(base);
    // deep check for the deploy smoke test: database, storage and configuration
    const checks: Record<string, boolean> = {
      authSecret: (c.env.BETTER_AUTH_SECRET ?? "").length >= 32,
      encryptionKey: !!c.env.ENCRYPTION_KEY,
      files: !!c.env.FILES,
      email: !!(c.env.RESEND_API_KEY && c.env.EMAIL_FROM),
      payments: !!(c.env.CASHFREE_APP_ID && c.env.CASHFREE_SECRET_KEY),
      database: false,
    };
    let migrations = 0;
    const url = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
    if (url) {
      const db = createDb(url, { max: 1 });
      try {
        const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
        migrations = r?.n ?? 0;
        checks.database = true;
      } catch (err) {
        console.error("health: database check failed", err);
      } finally {
        const close = db.$client.end({ timeout: 5 });
        try {
          c.executionCtx.waitUntil(close);
        } catch {
          void close; // no execution context (Node tests)
        }
      }
    }
    const ok = checks.database && checks.authSecret && checks.encryptionKey;
    return c.json({ ...base, ok, checks, migrations }, ok ? 200 : 503);
  });
  api.use("*", services);

  api.on(["GET", "POST"], "/auth/*", (c) => {
    const path = new URL(c.req.url).pathname;
    if (!AUTH_ALLOW.some((p) => path === p || path.startsWith(p + "/"))) {
      return c.json({ error: { message: "Not found", code: "not_found" } }, 404);
    }
    return c.get("auth").handler(c.req.raw);
  });

  api.use("*", loadSession);
  api.route("/public/payments", cashfreeWebhook);
  api.route("/public/attendance", devicePunchRoutes);
  api.route("/public", publicRoutes);

  api.use("/me/*", requireAuth);
  api.route("/me", meRoutes);

  api.use("/platform/*", requireAuth);
  api.route("/platform/billing", platformBillingRoutes);
  api.route("/platform/flags", flagRoutes);
  api.route("/platform/statutory", statutoryRoutes);
  api.route("/platform/support", platformSupportRoutes);
  api.route("/platform", platformRoutes);

  // Tenant-scoped routes
  const t = new Hono<AppEnv>();
  t.use("*", requireAuth, requireTenant, readOnlyGuard);
  // plan / feature-flag gates (before the routes they guard)
  t.use("/ess/tax/*", requireFeature("module.tds"));
  t.use("/admin/tds/*", requireFeature("module.tds"));
  t.use("/ess/claims/*", requireFeature("module.reimbursements"));
  t.use("/admin/reimbursements/*", requireFeature("module.reimbursements"));
  t.use("/admin/payments/*", requireFeature("module.payments"));
  t.use("/admin/reports/*", requireFeature("module.reports"));
  t.use("/admin/compliance/*", requireFeature("module.compliance"));
  t.route("/ess/tax", essTaxRoutes);
  t.route("/ess/claims", essClaimRoutes);
  t.route("/ess", essRoutes);
  t.route("/ess", essExitRoutes);
  t.route("/ess", essPayslipFileRoutes);
  t.route("/files", fileRoutes);
  t.use("/admin/*", requireAdmin);
  t.route("/admin/dashboard", dashboardRoutes);
  t.route("/admin/org", orgRoutes);
  t.route("/admin/access", accessRoutes);
  t.route("/admin/exits", exitRoutes);
  t.route("/admin/employees", employeeRoutes);
  t.route("/admin/onboarding", onboardingAdminRoutes);
  t.route("/admin/attendance", attendanceImportRoutes);
  t.route("/admin/attendance", attendanceRoutes);
  t.route("/admin/leave", leaveExtrasRoutes);
  t.route("/admin/leave", leaveRoutes);
  t.route("/admin/payroll", payrollExtrasRoutes);
  t.route("/admin/payroll", payslipFileRoutes);
  t.route("/admin/payroll", payrollRoutes);
  t.route("/admin/compliance", complianceRoutes);
  t.route("/admin/tds", tdsRoutes);
  t.route("/admin/reimbursements", reimbursementRoutes);
  t.route("/admin/payments", paymentRoutes);
  t.route("/admin/reports", reportRoutes);
  t.route("/admin/billing", tenantPayRoutes);
  t.route("/admin/billing", tenantBillingRoutes);
  t.route("/admin/support", tenantSupportRoutes);
  t.route("/admin/audit", auditRoutes);
  api.route("/", t);

  api.notFound((c) => c.json({ error: { message: "Not found", code: "not_found" } }, 404));
  app.route("/api", api);
  return app;
}
