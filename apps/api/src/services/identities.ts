import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { createDb, employeeIdentities, employees, memberships, roles, tenants, user, type Database } from "@hrms/db";
import { daysToExpiry, expiryState, fmtDate, idType, idTypesFor, todayLocal } from "@hrms/shared";
import type { Env } from "../env";
import { mailerFor } from "../lib/context";
import { layout } from "../lib/email";
import { allowedRecipients } from "./notifications";
import { entityOf, entityZones } from "./entities";

/** An employee's ID documents with expiry state, and the types to offer for their entity's country. */
export async function identitiesView(db: Database, tenantId: string, employeeId: string, entityId: string | null) {
  const ent = await entityOf(db, tenantId, entityId);
  const today = todayLocal(new Date(), ent.timeZone);
  const rows = await db
    .select()
    .from(employeeIdentities)
    .where(and(eq(employeeIdentities.tenantId, tenantId), eq(employeeIdentities.employeeId, employeeId)))
    .orderBy(sql`${employeeIdentities.expiresOn} asc nulls last`, asc(employeeIdentities.createdAt));
  return {
    identities: rows.map(({ remindedFor: _r, ...r }) => ({ ...r, label: labelOf(r), state: expiryState(r, today), daysLeft: r.expiresOn ? daysToExpiry(r.expiresOn, today) : null })),
    types: idTypesFor(ent.country).map((x) => ({ key: x.key, label: x.label, expires: x.expires })),
  };
}

const labelOf = (r: { type: string; name: string | null }) => (r.type === "other" ? (r.name ?? "Other") : idType(r.type).label);

/** How many IDs expire within their reminder window (or already have), for the HR dashboard. */
export async function expiringCount(db: Database, tenantId: string) {
  const rows = await db
    .select({ type: employeeIdentities.type, expiresOn: employeeIdentities.expiresOn })
    .from(employeeIdentities)
    .innerJoin(employees, eq(employees.id, employeeIdentities.employeeId))
    .where(and(eq(employeeIdentities.tenantId, tenantId), isNotNull(employeeIdentities.expiresOn), sql`${employees.status} not in ('exited','inactive')`));
  const today = todayLocal();
  return rows.filter((r) => ["due", "expired"].includes(expiryState(r, today))).length;
}

/**
 * Daily: email HR and the employee once when a passport, visa or permit enters its reminder
 * window (180 days for passports, 60 for visas, 30 for local IDs). A new expiry date re-arms it.
 */
export async function idExpiryReminders(db: Database, env: Env) {
  const ts = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.status, ["active", "trial", "past_due"]));
  const mailer = mailerFor(env);
  let sent = 0;
  for (const t of ts) {
    const zoneOf = await entityZones(db, t.id);
    const rows = await db
      .select({ i: employeeIdentities, name: employees.fullName, first: employees.firstName, email: employees.workEmail, entityId: employees.entityId })
      .from(employeeIdentities)
      .innerJoin(employees, eq(employees.id, employeeIdentities.employeeId))
      .where(and(eq(employeeIdentities.tenantId, t.id), isNotNull(employeeIdentities.expiresOn), sql`${employees.status} not in ('exited','inactive')`));
    const todo = rows.filter((r) => r.i.remindedFor !== r.i.expiresOn && ["due", "expired"].includes(expiryState(r.i, todayLocal(new Date(), zoneOf(r.entityId)))));
    if (!todo.length) continue;
    const hr = await db
      .select({ email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, t.id), eq(memberships.status, "active"), inArray(roles.key, ["super_admin", "hr_admin"])));
    for (const r of todo) {
      const days = daysToExpiry(r.i.expiresOn!, todayLocal(new Date(), zoneOf(r.entityId)));
      const what = labelOf(r.i);
      const when = days < 0 ? `expired on ${fmtDate(r.i.expiresOn)}` : days === 0 ? "expires today" : `expires on ${fmtDate(r.i.expiresOn)}, in ${days} day${days === 1 ? "" : "s"}`;
      const allowed = await allowedRecipients(db, t.id, "id_expiry", [...new Set([r.email, ...hr.map((h) => h.email)])]);
      for (const to of allowed) {
        const self = to === r.email;
        const { html, text } = layout({
          company: t.name,
          heading: self ? `Your ${what.toLowerCase()} ${when}` : `${r.name}'s ${what.toLowerCase()} ${when}`,
          paragraphs: self
            ? [`Hi ${r.first},`, `Your ${what.toLowerCase()} (number ending ${r.i.number.slice(-4)}) ${when}.`, "Please start the renewal and send the new one to HR when you have it."]
            : [`${r.name}'s ${what.toLowerCase()} (number ending ${r.i.number.slice(-4)}) ${when}.`, "Check the renewal is under way, then update the new number and dates on their profile."],
          cta: { label: self ? "Open your profile" : "Open their profile", url: self ? `${env.APP_URL}/me/profile` : `${env.APP_URL}/employees/${r.i.employeeId}` },
        });
        try {
          await mailer.send({ to, subject: self ? `Reminder: your ${what.toLowerCase()} ${when}` : `${r.name}: ${what} ${when}`, html, text });
          sent++;
        } catch (e) {
          console.error("id expiry email failed", e);
        }
      }
      await db.update(employeeIdentities).set({ remindedFor: r.i.expiresOn }).where(eq(employeeIdentities.id, r.i.id));
    }
  }
  return { sent };
}

export async function runIdExpiryReminders(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return { sent: 0 };
  const db = createDb(url, { max: 2 });
  try {
    return await idExpiryReminders(db, env);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
