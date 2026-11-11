import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { announcementReads, announcements, employees } from "@hrms/db";
import { announcementSchema, inAudience, isLive, todayIST } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { deleteFile, getFile, putFile, safeName } from "../lib/storage";
import { imageType } from "./photos";
import { audienceOf, emailAnnouncement, excerpt, type Announcement } from "../services/announcements";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const MAX_ATTACHMENT = 10 * 1024 * 1024;

function statusOf(a: Announcement, now = new Date()) {
  if (a.status === "draft") return "draft";
  if (a.status === "archived") return "archived";
  if (a.publishAt && new Date(a.publishAt) > now) return "scheduled";
  if (a.expiresAt && a.expiresAt < todayIST()) return "expired";
  return "live";
}
const out = (a: Announcement) => {
  const { attachmentKey, ...rest } = a;
  return { ...rest, hasAttachment: !!attachmentKey, state: statusOf(a) };
};

/* ---------------- HR ---------------- */

export const announcementRoutes = new Hono<AppEnv>();
announcementRoutes.use("*", requirePerm("employees", "edit"));

announcementRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(announcements).where(and(eq(announcements.tenantId, tid(c)), sql`${announcements.status} <> 'archived' or ${announcements.updatedAt} > now() - interval '90 days'`)).orderBy(desc(announcements.pinned), desc(sql`coalesce(${announcements.publishAt}, ${announcements.createdAt})`)).limit(200);
  const stats = rows.length
    ? new Map((await db.select({ id: announcementReads.announcementId, read: sql<number>`count(*)::int`, acked: sql<number>`count(${announcementReads.acknowledgedAt})::int` }).from(announcementReads).where(inArray(announcementReads.announcementId, rows.map((r) => r.id))).groupBy(announcementReads.announcementId)).map((s) => [s.id, s]))
    : new Map();
  const out2 = [];
  for (const a of rows) out2.push({ ...out(a), audienceSize: (await audienceOf(db, a)).length, read: stats.get(a.id)?.read ?? 0, acknowledged: stats.get(a.id)?.acked ?? 0 });
  return c.json(out2);
});

async function load(c: Context<AppEnv>, id: string) {
  const [a] = await c.get("db").select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.tenantId, tid(c))));
  if (!a) throw notFound("Announcement");
  return a;
}

function fields(b: ReturnType<typeof announcementSchema.parse>) {
  if (b.publishAt && b.expiresAt && b.expiresAt < b.publishAt.slice(0, 10)) throw badRequest("It would expire before it's published");
  if (b.expiresAt && b.expiresAt < todayIST()) throw badRequest("The end date has already passed");
  return { title: b.title, body: b.body, category: b.category, audience: { departmentIds: b.departmentIds, branchIds: b.branchIds }, pinned: b.pinned, requireAck: b.requireAck, emailEveryone: b.emailEveryone, expiresAt: b.expiresAt, status: b.draft ? "draft" : "published", publishAt: b.draft ? (b.publishAt ? new Date(b.publishAt) : null) : b.publishAt ? new Date(b.publishAt) : new Date() };
}

async function afterSave(c: Context<AppEnv>, a: Announcement, verb: string) {
  let emailed = 0;
  // published now: email straight away; scheduled ones go out with the hourly job
  if (a.status === "published" && a.publishAt && new Date(a.publishAt) <= new Date() && !a.emailedAt) emailed = await emailAnnouncement(c.get("db"), c.env, a);
  await audit(c, { action: `announcement.${verb}`, entity: "announcement", entityId: a.id, summary: `${verb === "create" ? "Posted" : "Updated"} "${a.title}" (${statusOf(a)})${emailed ? `, emailed ${emailed}` : ""}` });
  return emailed;
}

announcementRoutes.post("/", v("json", announcementSchema), async (c) => {
  const s = c.get("session")!;
  const [a] = await c.get("db").insert(announcements).values({ ...fields(c.req.valid("json")), tenantId: tid(c), authorId: s.userId, authorName: s.name }).returning();
  const emailed = await afterSave(c, a!, "create");
  return c.json({ ...out(a!), emailed }, 201);
});

announcementRoutes.put("/:id", v("json", announcementSchema), async (c) => {
  const a = await load(c, c.req.param("id"));
  const f = fields(c.req.valid("json"));
  // already live: keep its original time so it doesn't jump to the top or email again
  const publishAt = a.status === "published" && a.publishAt && new Date(a.publishAt) <= new Date() && f.status === "published" ? a.publishAt : f.publishAt;
  const [row] = await c.get("db").update(announcements).set({ ...f, publishAt, updatedAt: new Date() }).where(eq(announcements.id, a.id)).returning();
  const emailed = await afterSave(c, row!, "update");
  return c.json({ ...out(row!), emailed });
});

announcementRoutes.post("/:id/archive", async (c) => {
  const a = await load(c, c.req.param("id"));
  await c.get("db").update(announcements).set({ status: "archived", pinned: false, updatedAt: new Date() }).where(eq(announcements.id, a.id));
  await audit(c, { action: "announcement.archive", entity: "announcement", entityId: a.id, summary: `Took down "${a.title}"` });
  return c.json({ ok: true });
});

announcementRoutes.delete("/:id", async (c) => {
  const a = await load(c, c.req.param("id"));
  if (a.status !== "draft") throw badRequest("Only drafts can be deleted. Take it down instead.");
  if (a.attachmentKey) await deleteFile(c.env, a.attachmentKey).catch(() => {});
  await c.get("db").delete(announcements).where(eq(announcements.id, a.id));
  return c.json({ ok: true });
});

announcementRoutes.post("/:id/attachment", async (c) => {
  const a = await load(c, c.req.param("id"));
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File) || !file.size) throw badRequest("Attach a file");
  if (file.size > MAX_ATTACHMENT) throw badRequest("Attachments must be 10 MB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "application/pdf" : imageType(bytes);
  if (!type) throw badRequest("Attach a PDF or an image");
  const key = `tenants/${tid(c)}/announcements/${a.id}/${crypto.randomUUID()}`;
  await putFile(c.env, key, bytes.buffer as ArrayBuffer, type);
  await c.get("db").update(announcements).set({ attachmentKey: key, attachmentName: safeName(file.name || "attachment"), attachmentType: type, attachmentSize: file.size, updatedAt: new Date() }).where(eq(announcements.id, a.id));
  if (a.attachmentKey) await deleteFile(c.env, a.attachmentKey).catch(() => {});
  return c.json({ ok: true });
});

/** Who has read it and, if asked, confirmed it. */
announcementRoutes.get("/:id/readers", async (c) => {
  const a = await load(c, c.req.param("id"));
  const db = c.get("db");
  const people = await audienceOf(db, a);
  const reads = new Map((await db.select().from(announcementReads).where(eq(announcementReads.announcementId, a.id))).map((r) => [r.employeeId, r]));
  const names = people.length ? new Map((await db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode }).from(employees).where(inArray(employees.id, people.map((p) => p.id)))).map((e) => [e.id, e])) : new Map();
  return c.json(people.map((p) => ({ employeeId: p.id, name: names.get(p.id)?.name, code: names.get(p.id)?.code, readAt: reads.get(p.id)?.readAt ?? null, acknowledgedAt: reads.get(p.id)?.acknowledgedAt ?? null })).sort((x, y) => Number(!!x.readAt) - Number(!!y.readAt) || (x.name ?? "").localeCompare(y.name ?? "")));
});

/* ---------------- self-service ---------------- */

export const essAnnouncementRoutes = new Hono<AppEnv>();
essAnnouncementRoutes.use("*", requireEmployee);

async function visible(c: Context<AppEnv>) {
  const db = c.get("db");
  const [me] = await db.select({ departmentId: employees.departmentId, branchId: employees.branchId }).from(employees).where(eq(employees.id, c.get("tenant").employeeId!));
  const rows = await db.select().from(announcements).where(and(eq(announcements.tenantId, tid(c)), eq(announcements.status, "published"))).orderBy(desc(announcements.pinned), desc(announcements.publishAt)).limit(300);
  const now = new Date();
  return rows.filter((a) => isLive(a, now, todayIST()) && me && inAudience(a.audience, me));
}

essAnnouncementRoutes.get("/", async (c) => {
  const list = await visible(c);
  const reads = list.length ? new Map((await c.get("db").select().from(announcementReads).where(and(eq(announcementReads.employeeId, c.get("tenant").employeeId!), inArray(announcementReads.announcementId, list.map((a) => a.id))))).map((r) => [r.announcementId, r])) : new Map();
  return c.json(list.map((a) => ({ id: a.id, title: a.title, excerpt: excerpt(a.body, 220), category: a.category, pinned: a.pinned, requireAck: a.requireAck, publishAt: a.publishAt, authorName: a.authorName, hasAttachment: !!a.attachmentKey, read: reads.has(a.id), acknowledged: !!reads.get(a.id)?.acknowledgedAt })));
});

async function mine(c: Context<AppEnv>, id: string) {
  const a = (await visible(c)).find((x) => x.id === id);
  if (!a) throw notFound("Announcement");
  return a;
}

/** Opening it marks it read. */
essAnnouncementRoutes.get("/:id", async (c) => {
  const a = await mine(c, c.req.param("id"));
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  await db.insert(announcementReads).values({ tenantId: tid(c), announcementId: a.id, employeeId: eid }).onConflictDoNothing();
  const [r] = await db.select().from(announcementReads).where(and(eq(announcementReads.announcementId, a.id), eq(announcementReads.employeeId, eid)));
  return c.json({ ...out(a), acknowledgedAt: r?.acknowledgedAt ?? null });
});

essAnnouncementRoutes.post("/:id/acknowledge", async (c) => {
  const a = await mine(c, c.req.param("id"));
  if (!a.requireAck) throw badRequest("This one doesn't need confirming");
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  await db.insert(announcementReads).values({ tenantId: tid(c), announcementId: a.id, employeeId: eid, acknowledgedAt: new Date() }).onConflictDoUpdate({ target: [announcementReads.announcementId, announcementReads.employeeId], set: { acknowledgedAt: sql`coalesce(${announcementReads.acknowledgedAt}, now())` } });
  await audit(c, { action: "announcement.acknowledge", entity: "announcement", entityId: a.id, summary: `Confirmed reading "${a.title}"` });
  return c.json({ ok: true });
});

essAnnouncementRoutes.get("/:id/attachment", async (c) => {
  const a = await mine(c, c.req.param("id"));
  if (!a.attachmentKey) throw notFound("Attachment");
  const f = await getFile(c.env, a.attachmentKey);
  if (!f) throw notFound("Attachment");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": a.attachmentType ?? f.type, "Content-Disposition": `inline; filename="${a.attachmentName ?? "attachment"}"`, "Cache-Control": "private, no-store" });
});
