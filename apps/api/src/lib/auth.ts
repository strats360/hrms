import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
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
export const AUTH_APP_NAME = "Strats360 People";

/** Tell the user when two-factor sign-in is turned on or off for their account. */
export async function sendTwoFactorNotice(mailer: Mailer, user: { name: string; email: string }, on: boolean, by?: string) {
  const { html, text } = layout({
    company: AUTH_APP_NAME,
    heading: on ? "Two-factor sign-in is on" : "Two-factor sign-in is off",
    paragraphs: on
      ? [`Hi ${user.name},`, "Two-factor sign-in is now on for your account. You'll enter a code from your authenticator app each time you sign in on a new device.", "Keep your backup codes somewhere safe. If you didn't do this, reset your password and contact your HR team."]
      : [`Hi ${user.name},`, by ? `${by} reset two-factor sign-in for your account. You can sign in with just your password until you set it up again.` : "Two-factor sign-in has been turned off for your account.", "If you didn't expect this, reset your password and contact your HR team."],
  });
  await mailer.send({ to: user.email, subject: on ? "Two-factor sign-in turned on" : "Two-factor sign-in turned off", html, text });
}

export function createAuth(env: Env, db: Database, mailer: Mailer) {
  return betterAuth({
    appName: AUTH_APP_NAME,
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
        twoFactor: schema.twoFactor,
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
    plugins: [
      twoFactor({
        issuer: AUTH_APP_NAME,
        backupCodeOptions: { amount: 10, length: 10 },
        // the sign-in code step stays open for 10 minutes; "trust this device" lasts 30 days
        twoFactorCookieMaxAge: 600,
        trustDeviceMaxAge: 30 * 24 * 60 * 60,
      }),
    ],
    databaseHooks: {
      user: {
        update: {
          after: async (user, ctx) => {
            const path = ctx?.path;
            if ((path === "/two-factor/verify-totp" && user.twoFactorEnabled) || (path === "/two-factor/disable" && !user.twoFactorEnabled)) {
              await sendTwoFactorNotice(mailer, user, !!user.twoFactorEnabled).catch((e) => console.error("2fa notice failed", e));
            }
          },
        },
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
