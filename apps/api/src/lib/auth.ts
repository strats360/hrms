import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type Database } from "@hrms/db";
import type { Env } from "../env";
import { layout, type Mailer } from "./email";

/**
 * Better Auth instance. Created per request because the DB client is bound to
 * the request's Hyperdrive connection on Workers.
 *
 * Public sign-up is disabled: logins are created only by company signup,
 * employee onboarding invites and admin invites (see services/users.ts).
 */
export function createAuth(env: Env, db: Database, mailer: Mailer) {
  return betterAuth({
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins:
      env.ENVIRONMENT === "development" ? [env.APP_URL, "http://localhost:*", "http://127.0.0.1:*"] : [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        const { html, text } = layout({
          company: "Strats360 People",
          heading: "Reset your password",
          paragraphs: [
            `Hi ${user.name},`,
            "We received a request to reset the password for your account. The link below works for one hour.",
            "If you didn't ask for this, you can ignore this email. Your password stays the same.",
          ],
          cta: { label: "Choose a new password", url },
        });
        await mailer.send({ to: user.email, subject: "Reset your password", html, text });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    rateLimit: {
      enabled: env.ENVIRONMENT !== "test",
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: env.ENVIRONMENT === "development" ? 50 : 5 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: env.APP_URL.startsWith("https://"),
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
