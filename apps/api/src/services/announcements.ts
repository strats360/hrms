import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { announcements, createDb, employees, tenants, type Database } from "@hrms/db";
import { ANNOUNCEMENT_CATEGORY_LABEL, type AnnouncementCategory } from "@hrms/shared";
import type { Env } from "../env";
import { layout } from "../lib/email";
import { mailerFor } from "../lib/context";
import { allowedRecipients } from "./notifications";

export type Announcement = typeof announcements.$inferSelect;

/** Current staff an announcement is for. */
export async function audienceOf(db: Database, a: Pick<Announcement, "tenantId" | "audience">) {
  return db
    .select({ id: employees.id, email: employees.workEmail, first: employees.firstName })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, a.tenantId),
        inArray(employees.status, ["onboarding", "probation", "active", "notice"]),
        a.audience.departmentIds.length ? inArray(employees.departmentId, a.audience.departmentIds) : undefined,
        a.audience.branchIds.length ? inArray(employees.branchId, a.audience.branchIds) : undefined,
      ),
    );
}

/** The first few lines of the body, for emails and previews. */
export const excerpt = (body: string, n = 400) => (body.length > n ? `${body.slice(0, n).replace(/\s+\S*$/, "")}…` : body);

/** Email an announcement to its audience, once. Urgent ones ignore people's email switches. */
export async function emailAnnouncement(db: Database, env: Env, a: Announcement) {
  // claim it first so two runs can't both send
  const [claimed] = await db.update(announcements).set({ emailedAt: new Date() }).where(and(eq(announcements.id, a.id), isNull(announcements.emailedAt))).returning({ id: announcements.id });
  if (!claimed || !a.emailEveryone) return 0;
  const people = await audienceOf(db, a);
  const urgent = a.category === "urgent";
  const ok = urgent ? new Set(people.map((p) => p.email)) : await allowedRecipients(db, a.tenantId, "announcements", people.map((p) => p.email));
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, a.tenantId));
  const mailer = mailerFor(env);
  const label = ANNOUNCEMENT_CATEGORY_LABEL[a.category as AnnouncementCategory] ?? "News";
  const queue = people.filter((p) => ok.has(p.email));
  let sent = 0;
  for (let i = 0; i < queue.length; i += 10) {
    await Promise.all(
      queue.slice(i, i + 10).map(async (p) => {
        try {
          const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: a.title, paragraphs: [`Hi ${p.first},`, ...excerpt(a.body, 1200).split(/\n{2,}/), ...(a.requireAck ? ["Please read it in self-service and confirm you have."] : [])], cta: { label: a.requireAck ? "Read and confirm" : "Read it in self-service", url: `${env.APP_URL}/me/announcements/${a.id}` } });
          await mailer.send({ to: p.email, subject: `${urgent ? "Urgent: " : label === "News" ? "" : `${label}: `}${a.title}`, html, text });
          sent++;
        } catch (e) {
          console.error("announcement email failed", e);
        }
      }),
    );
  }
  return sent;
}

/** Hourly: send the emails for scheduled announcements whose time has come. */
export async function sendScheduledAnnouncements(db: Database, env: Env, now = new Date()) {
  const due = await db.select().from(announcements).where(and(eq(announcements.status, "published"), lte(announcements.publishAt, now), isNull(announcements.emailedAt), eq(announcements.emailEveryone, true), sql`(${announcements.expiresAt} is null or ${announcements.expiresAt} >= ${now.toISOString().slice(0, 10)})`));
  let sent = 0;
  for (const a of due) sent += await emailAnnouncement(db, env, a);
  return { posts: due.length, sent };
}

export async function runHourly(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return;
  const db = createDb(url, { max: 2 });
  try {
    const r = await sendScheduledAnnouncements(db, env);
    if (r.posts) console.log(`announcements: ${r.posts} scheduled posts, ${r.sent} emails`);
  } catch (e) {
    console.error("scheduled announcements failed", e);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
