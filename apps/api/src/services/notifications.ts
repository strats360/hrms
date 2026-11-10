import type { Context } from "hono";
import { and, eq, or, sql } from "drizzle-orm";
import { employees, memberships, tenants, user, type Database } from "@hrms/db";
import { notificationOn, type NotificationKey, type NotificationPrefs } from "@hrms/shared";
import type { AppEnv } from "../env";
import type { EmailMessage } from "../lib/email";

export const companyNotificationPrefs = (settings: unknown): NotificationPrefs => (settings as { notifications?: NotificationPrefs } | null)?.notifications ?? {};

/**
 * Which of these addresses should get this email: not turned off by the company, and not
 * turned off by the person (matched on their login email or their work email).
 */
export async function allowedRecipients(db: Database, tenantId: string, key: NotificationKey, emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.filter(Boolean))];
  if (!list.length) return new Set();
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const company = companyNotificationPrefs(t?.settings);
  if (company[key] === false) return new Set();
  const lower = list.map((e) => e.toLowerCase());
  const optedOut = await db
    .select({ login: user.email, work: employees.workEmail })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .leftJoin(employees, eq(employees.id, memberships.employeeId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        sql`${memberships.notificationPrefs} ->> ${key} = 'false'`,
        or(sql`lower(${user.email}) in ${lower}`, sql`lower(${employees.workEmail}) in ${lower}`),
      ),
    );
  const off = new Set(optedOut.flatMap((r) => [r.login, r.work]).filter(Boolean).map((e) => e!.toLowerCase()));
  return new Set(list.filter((e) => notificationOn(key, company, off.has(e.toLowerCase()) ? { [key]: false } : {})));
}

/** Send an email people can switch off. Returns whether it went out. */
export async function sendNotification(c: Context<AppEnv>, key: NotificationKey, msg: EmailMessage, tenantId = c.get("tenant").tenantId) {
  const ok = await allowedRecipients(c.get("db"), tenantId, key, [msg.to]);
  if (!ok.has(msg.to)) return false;
  await c.get("mailer").send(msg);
  return true;
}
