import type { Database } from "@hrms/db";
import type { PermissionMatrix } from "@hrms/shared";
import type { Mailer } from "./lib/email";
import type { Auth } from "./lib/auth";

export interface Env {
  /** Cloudflare Hyperdrive binding in front of Neon Postgres. */
  HYPERDRIVE?: Hyperdrive;
  /** Direct connection string, used in local dev/tests when Hyperdrive is not bound. */
  DATABASE_URL?: string;
  /** R2 bucket for employee documents and logos. */
  FILES?: R2Bucket;
  /** Static assets of the web app (Workers static assets). */
  ASSETS?: Fetcher;

  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  ENCRYPTION_KEY: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  ENVIRONMENT?: string;
  /** Cashfree Payment Gateway (subscription invoices). App ID and secret are Worker secrets. */
  CASHFREE_APP_ID?: string;
  CASHFREE_SECRET_KEY?: string;
  /** sandbox | production (default sandbox) */
  CASHFREE_ENV?: string;
  /** PG API version header (default 2023-08-01). */
  CASHFREE_API_VERSION?: string;
  /** Subscriptions (autopay) API version header (default 2025-01-01). */
  CASHFREE_SUBS_API_VERSION?: string;
}

export interface Session {
  userId: string;
  email: string;
  name: string;
}

export interface TenantContext {
  tenantId: string;
  membershipId: string;
  roleId: string | null;
  roleName: string | null;
  permissions: PermissionMatrix;
  employeeId: string | null;
  plan: string;
  /** Feature flags evaluated for this tenant. */
  features: Record<string, boolean>;
  /** Platform support viewing the tenant read-only (no membership). */
  readOnly?: { ticketId: string; accessId: string; expiresAt: string } | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Database;
    auth: Auth;
    mailer: Mailer;
    session: Session | null;
    tenant: TenantContext;
    platformRole: string | null;
  };
};
