import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env";
import { onError } from "./lib/errors";
import { loadSession, requireAdmin, requireAuth, requireTenant, services } from "./lib/context";
import { publicRoutes } from "./routes/public";
import { meRoutes } from "./routes/me";
import { orgRoutes } from "./routes/org";
import { accessRoutes } from "./routes/access";
import { employeeRoutes } from "./routes/employees";
import { onboardingAdminRoutes } from "./routes/onboarding";
import { attendanceRoutes } from "./routes/attendance";
import { leaveRoutes } from "./routes/leave";
import { dashboardRoutes } from "./routes/dashboard";
import { essRoutes } from "./routes/ess";
import { platformRoutes } from "./routes/platform";
import { auditRoutes } from "./routes/audit";
import { fileRoutes } from "./routes/files";
import { payrollRoutes } from "./routes/payroll";
import { complianceRoutes } from "./routes/compliance";
import { essTaxRoutes, tdsRoutes } from "./routes/tds";

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
  api.get("/health", (c) => c.json({ ok: true }));
  api.use("*", services);

  api.on(["GET", "POST"], "/auth/*", (c) => {
    const path = new URL(c.req.url).pathname;
    if (!AUTH_ALLOW.some((p) => path === p || path.startsWith(p + "/"))) {
      return c.json({ error: { message: "Not found", code: "not_found" } }, 404);
    }
    return c.get("auth").handler(c.req.raw);
  });

  api.use("*", loadSession);
  api.route("/public", publicRoutes);

  api.use("/me/*", requireAuth);
  api.route("/me", meRoutes);

  api.use("/platform/*", requireAuth);
  api.route("/platform", platformRoutes);

  // Tenant-scoped routes
  const t = new Hono<AppEnv>();
  t.use("*", requireAuth, requireTenant);
  t.route("/ess/tax", essTaxRoutes);
  t.route("/ess", essRoutes);
  t.route("/files", fileRoutes);
  t.use("/admin/*", requireAdmin);
  t.route("/admin/dashboard", dashboardRoutes);
  t.route("/admin/org", orgRoutes);
  t.route("/admin/access", accessRoutes);
  t.route("/admin/employees", employeeRoutes);
  t.route("/admin/onboarding", onboardingAdminRoutes);
  t.route("/admin/attendance", attendanceRoutes);
  t.route("/admin/leave", leaveRoutes);
  t.route("/admin/payroll", payrollRoutes);
  t.route("/admin/compliance", complianceRoutes);
  t.route("/admin/tds", tdsRoutes);
  t.route("/admin/audit", auditRoutes);
  api.route("/", t);

  api.notFound((c) => c.json({ error: { message: "Not found", code: "not_found" } }, 404));
  app.route("/api", api);
  return app;
}
