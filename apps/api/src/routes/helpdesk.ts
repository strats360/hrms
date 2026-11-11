import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { employees, helpdeskMessages, helpdeskTickets, memberships, roles, tenants } from "@hrms/db";
import {
  AGENT_STATUS_LABEL,
  can,
  helpdeskSettingsSchema,
  OPEN_STATUSES,
  PRIORITY_LABEL,
  rateSchema,
  replySchema,
  responseDue,
  TEAM_LABEL,
  ticketSchema,
  ticketUpdateSchema,
  type HelpdeskTeam,
  type Priority,
  type TicketStatus,
} from "@hrms/shared";
import type { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { getFile, putFile, safeName } from "../lib/storage";
import { imageType } from "./photos";
import { allowedRecipients } from "../services/notifications";
import { helpdeskSettings, nextTicketNumber } from "../services/helpdesk";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId ?? null;
const lead = (c: Context<AppEnv>) => can(c.get("tenant").permissions, "helpdesk", "configure");
type Ticket = typeof helpdeskTickets.$inferSelect;
const MAX_FILE = 10 * 1024 * 1024;

/** JSON, or multipart with a `data` JSON field and an optional `file`. */
async function readBody<T extends z.ZodTypeAny>(c: Context<AppEnv>, schema: T): Promise<{ data: z.infer<T>; file: { bytes: Uint8Array; type: string; name: string } | null }> {
  const multipart = (c.req.header("content-type") ?? "").includes("multipart/form-data");
  const form = multipart ? await c.req.formData() : null;
  const parsed = schema.safeParse(form ? JSON.parse(String(form.get("data") ?? "{}")) : await c.req.json());
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the details");
  const f = form?.get("file");
  if (!(f instanceof File) || !f.size) return { data: parsed.data, file: null };
  if (f.size > MAX_FILE) throw badRequest("Attachments must be 10 MB or smaller");
  const bytes = new Uint8Array(await f.arrayBuffer());
  const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "application/pdf" : imageType(bytes);
  if (!type) throw badRequest("Attach a PDF or an image (a screenshot works)");
  return { data: parsed.data, file: { bytes, type, name: safeName(f.name || "attachment") } };
}
async function storeFile(c: Context<AppEnv>, ticketId: string, f: { bytes: Uint8Array; type: string; name: string } | null) {
  if (!f) return {};
  const key = `tenants/${tid(c)}/helpdesk/${ticketId}/${crypto.randomUUID()}`;
  await putFile(c.env, key, f.bytes.buffer as ArrayBuffer, f.type);
  return { attachmentKey: key, attachmentName: f.name, attachmentType: f.type, attachmentSize: f.bytes.length };
}

async function mail(c: Context<AppEnv>, key: "helpdesk_updates" | "helpdesk_queue", to: string[], subject: string, paragraphs: string[], url: string) {
  try {
    const ok = await allowedRecipients(c.get("db"), tid(c), key, to);
    if (!ok.size) return;
    const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: subject, paragraphs, cta: { label: "Open the ticket", url } });
    for (const addr of ok) await c.get("mailer").send({ to: addr, subject, html, text });
  } catch (e) {
    console.error("helpdesk email failed", e);
  }
}
/** Who works a team's queue: the people listed for it, or the helpdesk leads when nobody is. */
async function teamEmails(c: Context<AppEnv>, team: HelpdeskTeam, confidential: boolean) {
  const db = c.get("db");
  const s = await helpdeskSettings(db, tid(c));
  const ids = confidential ? [] : s.teams[team];
  if (ids.length) return (await db.select({ email: employees.workEmail }).from(employees).where(inArray(employees.id, ids))).map((e) => e.email);
  const leads = await db
    .select({ perms: roles.permissions, email: employees.workEmail })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(employees, eq(employees.id, memberships.employeeId))
    .where(and(eq(memberships.tenantId, tid(c)), eq(memberships.status, "active")));
  return leads.filter((l) => (l.perms as Record<string, string[]>)?.helpdesk?.includes("configure")).map((l) => l.email);
}
const empEmail = async (c: Context<AppEnv>, id: string) => (await c.get("db").select({ email: employees.workEmail, first: employees.firstName, name: employees.fullName }).from(employees).where(eq(employees.id, id)))[0];

/* ================= self-service ================= */

export const essHelpdeskRoutes = new Hono<AppEnv>();
essHelpdeskRoutes.use("*", requireEmployee);

essHelpdeskRoutes.get("/", async (c) => {
  const db = c.get("db");
  const s = await helpdeskSettings(db, tid(c));
  const rows = await db.select().from(helpdeskTickets).where(and(eq(helpdeskTickets.tenantId, tid(c)), eq(helpdeskTickets.employeeId, me(c)!))).orderBy(desc(helpdeskTickets.lastActivityAt)).limit(100);
  return c.json({ categories: s.categories.map((x) => ({ key: x.key, label: x.label, team: x.team, teamLabel: TEAM_LABEL[x.team] })), tickets: rows.map((t) => ({ id: t.id, number: t.number, subject: t.subject, categoryLabel: t.categoryLabel, team: t.team, status: t.status, priority: t.priority, lastActivityAt: t.lastActivityAt, createdAt: t.createdAt, rating: t.rating })) });
});

essHelpdeskRoutes.post("/", async (c) => {
  const { data: b, file } = await readBody(c, ticketSchema);
  const db = c.get("db");
  const s = await helpdeskSettings(db, tid(c));
  const cat = s.categories.find((x) => x.key === b.categoryKey);
  if (!cat) throw badRequest("Pick what it's about");
  const now = new Date();
  // confidential matters go to HR leads, whatever the category
  const team: HelpdeskTeam = b.confidential ? "hr" : cat.team;
  const [t] = await db
    .insert(helpdeskTickets)
    .values({ tenantId: tid(c), number: await nextTicketNumber(db, tid(c)), employeeId: me(c)!, categoryKey: cat.key, categoryLabel: cat.label, team, subject: b.subject, priority: b.priority, confidential: b.confidential, responseDueAt: responseDue(now, cat.slaHours, b.priority as Priority) })
    .returning();
  await db.insert(helpdeskMessages).values({ tenantId: tid(c), ticketId: t!.id, authorId: me(c), authorName: c.get("session")!.name, body: b.body, ...(await storeFile(c, t!.id, file)) });
  await audit(c, { action: "helpdesk.create", entity: "helpdesk_ticket", entityId: t!.id, summary: `Raised ${t!.number}${b.confidential ? " (confidential)" : `: ${b.subject}`}` });
  await mail(c, "helpdesk_queue", await teamEmails(c, team, b.confidential), `${t!.number} ${b.confidential ? "Confidential ticket" : b.subject}`, [`${c.get("session")!.name} raised a ${b.confidential ? "confidential " : ""}ticket for ${TEAM_LABEL[team]}: ${cat.label}.`, ...(b.confidential ? [] : [b.body.slice(0, 600)]), `Please reply by ${t!.responseDueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`], `${c.env.APP_URL}/helpdesk/${t!.id}`);
  return c.json({ id: t!.id, number: t!.number }, 201);
});

async function ownTicket(c: Context<AppEnv>, id: string) {
  const [t] = await c.get("db").select().from(helpdeskTickets).where(and(eq(helpdeskTickets.id, id), eq(helpdeskTickets.tenantId, tid(c)), eq(helpdeskTickets.employeeId, me(c)!)));
  if (!t) throw notFound("Ticket");
  return t;
}
async function thread(c: Context<AppEnv>, t: Ticket, internalToo: boolean) {
  const msgs = await c.get("db").select().from(helpdeskMessages).where(and(eq(helpdeskMessages.ticketId, t.id), internalToo ? undefined : eq(helpdeskMessages.internal, false))).orderBy(asc(helpdeskMessages.createdAt));
  return msgs.map(({ attachmentKey, ...m }) => ({ ...m, hasAttachment: !!attachmentKey }));
}

essHelpdeskRoutes.get("/:id", async (c) => {
  const t = await ownTicket(c, c.req.param("id"));
  const [a] = t.assigneeId ? await c.get("db").select({ name: employees.fullName }).from(employees).where(eq(employees.id, t.assigneeId)) : [];
  return c.json({ ...t, teamLabel: TEAM_LABEL[t.team as HelpdeskTeam], assignee: a?.name ?? null, messages: await thread(c, t, false) });
});

essHelpdeskRoutes.post("/:id/reply", async (c) => {
  const t = await ownTicket(c, c.req.param("id"));
  if (t.status === "closed") throw badRequest("This ticket is closed. Raise a new one if you still need help.");
  const { data: b, file } = await readBody(c, replySchema);
  const db = c.get("db");
  await db.insert(helpdeskMessages).values({ tenantId: tid(c), ticketId: t.id, authorId: me(c), authorName: c.get("session")!.name, body: b.body, ...(await storeFile(c, t.id, file)) });
  // a reply reopens a resolved ticket and hands it back to the team
  const status = t.status === "waiting" || t.status === "resolved" ? (t.firstResponseAt ? "in_progress" : "open") : t.status;
  await db.update(helpdeskTickets).set({ status, resolvedAt: status === t.status ? t.resolvedAt : null, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(helpdeskTickets.id, t.id));
  const to = t.assigneeId ? [(await empEmail(c, t.assigneeId))?.email].filter(Boolean) as string[] : await teamEmails(c, t.team as HelpdeskTeam, t.confidential);
  await mail(c, "helpdesk_queue", to, `${t.number} new reply`, [`${c.get("session")!.name} replied on ${t.number}${t.confidential ? "" : `: ${t.subject}`}.`, ...(t.confidential ? [] : [b.body.slice(0, 600)])], `${c.env.APP_URL}/helpdesk/${t.id}`);
  return c.json({ ok: true, status });
});

essHelpdeskRoutes.post("/:id/rate", async (c) => {
  const t = await ownTicket(c, c.req.param("id"));
  if (t.status !== "resolved" && t.status !== "closed") throw badRequest("You can rate it once it's resolved");
  const parsed = rateSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest("Pick a rating");
  await c.get("db").update(helpdeskTickets).set({ rating: parsed.data.rating, ratingComment: parsed.data.comment || null, status: "closed", closedAt: t.closedAt ?? new Date(), updatedAt: new Date() }).where(eq(helpdeskTickets.id, t.id));
  return c.json({ ok: true });
});

essHelpdeskRoutes.get("/:id/messages/:mid/file", async (c) => {
  const t = await ownTicket(c, c.req.param("id"));
  const [m] = await c.get("db").select().from(helpdeskMessages).where(and(eq(helpdeskMessages.id, c.req.param("mid")), eq(helpdeskMessages.ticketId, t.id), eq(helpdeskMessages.internal, false)));
  return fileOf(c, m);
});
async function fileOf(c: Context<AppEnv>, m: typeof helpdeskMessages.$inferSelect | undefined) {
  if (!m?.attachmentKey) throw notFound("Attachment");
  const f = await getFile(c.env, m.attachmentKey);
  if (!f) throw notFound("Attachment");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": m.attachmentType ?? f.type, "Content-Disposition": `inline; filename="${m.attachmentName ?? "attachment"}"`, "Cache-Control": "private, no-store" });
}

/* ================= helpdesk teams ================= */

export const helpdeskRoutes = new Hono<AppEnv>();
helpdeskRoutes.use("*", requirePerm("helpdesk", "view"));

/** Tickets this person may work: leads see everything; others their teams' and their own assignments, never confidential unless assigned. */
async function scopeWhere(c: Context<AppEnv>) {
  if (lead(c)) return eq(helpdeskTickets.tenantId, tid(c));
  const s = await helpdeskSettings(c.get("db"), tid(c));
  const mine = (Object.keys(s.teams) as HelpdeskTeam[]).filter((k) => me(c) && s.teams[k].includes(me(c)!));
  return and(eq(helpdeskTickets.tenantId, tid(c)), or(and(mine.length ? inArray(helpdeskTickets.team, mine) : sql`false`, eq(helpdeskTickets.confidential, false)), me(c) ? eq(helpdeskTickets.assigneeId, me(c)!) : sql`false`));
}
async function agentTicket(c: Context<AppEnv>, id: string) {
  const [t] = await c.get("db").select().from(helpdeskTickets).where(and(eq(helpdeskTickets.id, id), await scopeWhere(c)));
  if (!t) throw notFound("Ticket");
  return t;
}

helpdeskRoutes.get("/", async (c) => {
  const db = c.get("db");
  const raiser = alias(employees, "raiser");
  const assignee = alias(employees, "assignee");
  const status = c.req.query("status") ?? "open";
  const team = c.req.query("team");
  const mineOnly = c.req.query("mine") === "1";
  const rows = await db
    .select({ t: helpdeskTickets, raiser: raiser.fullName, raiserCode: raiser.employeeCode, assignee: assignee.fullName })
    .from(helpdeskTickets)
    .innerJoin(raiser, eq(raiser.id, helpdeskTickets.employeeId))
    .leftJoin(assignee, eq(assignee.id, helpdeskTickets.assigneeId))
    .where(and(await scopeWhere(c), status === "open" ? inArray(helpdeskTickets.status, OPEN_STATUSES) : status === "all" ? undefined : eq(helpdeskTickets.status, status), team ? eq(helpdeskTickets.team, team) : undefined, mineOnly ? eq(helpdeskTickets.assigneeId, me(c) ?? "") : undefined))
    .orderBy(sql`case ${helpdeskTickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(helpdeskTickets.responseDueAt))
    .limit(500);
  const now = new Date();
  const [stats] = await db
    .select({
      open: sql<number>`count(*) filter (where ${helpdeskTickets.status} in ('open','in_progress','waiting'))::int`,
      unassigned: sql<number>`count(*) filter (where ${helpdeskTickets.status} in ('open','in_progress') and ${helpdeskTickets.assigneeId} is null)::int`,
      overdue: sql<number>`count(*) filter (where ${helpdeskTickets.status} = 'open' and ${helpdeskTickets.firstResponseAt} is null and ${helpdeskTickets.responseDueAt} < now())::int`,
      avgFirstHours: sql<number | null>`round((avg(extract(epoch from ${helpdeskTickets.firstResponseAt} - ${helpdeskTickets.createdAt})) filter (where ${helpdeskTickets.createdAt} > now() - interval '30 days')) / 3600)::float`,
      onTime: sql<number | null>`round(100.0 * count(*) filter (where ${helpdeskTickets.firstResponseAt} <= ${helpdeskTickets.responseDueAt} and ${helpdeskTickets.createdAt} > now() - interval '30 days') / nullif(count(${helpdeskTickets.firstResponseAt}) filter (where ${helpdeskTickets.createdAt} > now() - interval '30 days'), 0))::float`,
      rating: sql<number | null>`round(avg(${helpdeskTickets.rating}) filter (where ${helpdeskTickets.createdAt} > now() - interval '90 days'), 1)::float`,
    })
    .from(helpdeskTickets)
    .where(await scopeWhere(c));
  return c.json({
    rows: rows.map(({ t, raiser: r, raiserCode, assignee: a }) => ({ id: t.id, number: t.number, subject: t.confidential && !lead(c) && t.assigneeId !== me(c) ? "Confidential" : t.subject, categoryLabel: t.categoryLabel, team: t.team, status: t.status, priority: t.priority, confidential: t.confidential, raiser: { id: t.employeeId, name: r, code: raiserCode }, assignee: a ? { id: t.assigneeId, name: a } : null, responseDueAt: t.responseDueAt, overdue: !t.firstResponseAt && t.status === "open" && t.responseDueAt < now, firstResponseAt: t.firstResponseAt, lastActivityAt: t.lastActivityAt, createdAt: t.createdAt, rating: t.rating })),
    stats,
    isLead: lead(c),
  });
});

helpdeskRoutes.get("/settings", async (c) => {
  const db = c.get("db");
  const s = await helpdeskSettings(db, tid(c));
  // people who can be on a team: anyone with a login whose role includes the helpdesk
  const agents = await db
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, perms: roles.permissions })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(employees, eq(employees.id, memberships.employeeId))
    .where(and(eq(memberships.tenantId, tid(c)), eq(memberships.status, "active")));
  return c.json({ settings: s, agents: agents.filter((a) => (a.perms as Record<string, string[]>)?.helpdesk?.includes("view")).map(({ perms: _p, ...a }) => a), teams: TEAM_LABEL });
});

helpdeskRoutes.put("/settings", requirePerm("helpdesk", "configure"), async (c) => {
  const parsed = helpdeskSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the settings");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ helpdesk: parsed.data })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "settings.helpdesk", entity: "tenant", entityId: tid(c), summary: `Helpdesk: ${parsed.data.categories.length} categories`, data: parsed.data });
  return c.json(parsed.data);
});

helpdeskRoutes.get("/:id", async (c) => {
  const t = await agentTicket(c, c.req.param("id"));
  const db = c.get("db");
  const [r] = await db.select({ name: employees.fullName, code: employees.employeeCode, email: employees.workEmail }).from(employees).where(eq(employees.id, t.employeeId));
  const s = await helpdeskSettings(db, tid(c));
  // the raiser's other recent tickets, for context
  const history = await db.select({ id: helpdeskTickets.id, number: helpdeskTickets.number, subject: helpdeskTickets.subject, status: helpdeskTickets.status, createdAt: helpdeskTickets.createdAt }).from(helpdeskTickets).where(and(await scopeWhere(c), eq(helpdeskTickets.employeeId, t.employeeId), sql`${helpdeskTickets.id} <> ${t.id}`)).orderBy(desc(helpdeskTickets.createdAt)).limit(5);
  return c.json({ ...t, raiser: { id: t.employeeId, ...r }, teamLabel: TEAM_LABEL[t.team as HelpdeskTeam], messages: await thread(c, t, true), categories: s.categories, teamMembers: s.teams[t.team as HelpdeskTeam], history });
});

helpdeskRoutes.post("/:id/reply", requirePerm("helpdesk", "edit"), async (c) => {
  const t = await agentTicket(c, c.req.param("id"));
  if (t.status === "closed") throw badRequest("This ticket is closed");
  const { data: b, file } = await readBody(c, replySchema);
  if (t.employeeId === me(c) && !b.internal) throw forbidden("Someone else on the team should answer your own ticket");
  const db = c.get("db");
  const now = new Date();
  await db.insert(helpdeskMessages).values({ tenantId: tid(c), ticketId: t.id, authorId: me(c), authorName: c.get("session")!.name, fromTeam: true, internal: b.internal, body: b.body, ...(await storeFile(c, t.id, file)) });
  const status: TicketStatus = b.internal ? (b.status ?? t.status as TicketStatus) : (b.status ?? (t.status === "open" ? "in_progress" : (t.status as TicketStatus)));
  await db
    .update(helpdeskTickets)
    .set({
      status,
      firstResponseAt: !b.internal && !t.firstResponseAt ? now : t.firstResponseAt,
      assigneeId: t.assigneeId ?? (b.internal ? null : me(c)),
      resolvedAt: status === "resolved" ? now : null,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(helpdeskTickets.id, t.id));
  if (!b.internal) {
    const e = await empEmail(c, t.employeeId);
    if (e) await mail(c, "helpdesk_updates", [e.email], status === "resolved" ? `${t.number} resolved: ${t.subject}` : `${t.number} reply: ${t.subject}`, [`Hi ${e.first},`, `${c.get("session")!.name} from ${TEAM_LABEL[t.team as HelpdeskTeam]} ${status === "resolved" ? "has resolved your ticket" : "replied to your ticket"}:`, b.body.slice(0, 1500), ...(status === "resolved" ? ["If it isn't sorted, just reply and it reopens."] : status === "waiting" ? ["They need something from you to carry on."] : [])], `${c.env.APP_URL}/me/helpdesk/${t.id}`);
  }
  await audit(c, { action: b.internal ? "helpdesk.note" : "helpdesk.reply", entity: "helpdesk_ticket", entityId: t.id, summary: `${b.internal ? "Note on" : "Replied to"} ${t.number}${status !== t.status ? `; now ${AGENT_STATUS_LABEL[status].toLowerCase()}` : ""}` });
  return c.json({ ok: true, status });
});

helpdeskRoutes.patch("/:id", requirePerm("helpdesk", "edit"), async (c) => {
  const t = await agentTicket(c, c.req.param("id"));
  const parsed = ticketUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest("Check the details");
  const b = parsed.data;
  const db = c.get("db");
  const set: Partial<Ticket> = { updatedAt: new Date(), lastActivityAt: new Date() };
  const changes: string[] = [];
  if (b.status && b.status !== t.status) {
    set.status = b.status;
    set.resolvedAt = b.status === "resolved" ? new Date() : b.status === "closed" ? t.resolvedAt : null;
    set.closedAt = b.status === "closed" ? new Date() : null;
    changes.push(`status ${AGENT_STATUS_LABEL[b.status].toLowerCase()}`);
  }
  if (b.priority && b.priority !== t.priority) {
    set.priority = b.priority;
    changes.push(`priority ${PRIORITY_LABEL[b.priority].toLowerCase()}`);
  }
  if (b.assigneeId !== undefined && b.assigneeId !== t.assigneeId) {
    if (b.assigneeId) {
      const [a] = await db.select({ id: employees.id, name: employees.fullName, email: employees.workEmail, first: employees.firstName }).from(employees).where(and(eq(employees.id, b.assigneeId), eq(employees.tenantId, tid(c))));
      if (!a) throw notFound("Employee");
      if (a.id === t.employeeId) throw badRequest("Someone can't handle their own ticket");
      changes.push(`assigned to ${a.name}`);
      if (a.id !== me(c)) await mail(c, "helpdesk_queue", [a.email], `${t.number} assigned to you`, [`Hi ${a.first},`, `${c.get("session")!.name} assigned ${t.number}${t.confidential ? " (confidential)" : `: ${t.subject}`} to you.`], `${c.env.APP_URL}/helpdesk/${t.id}`);
    } else changes.push("unassigned");
    set.assigneeId = b.assigneeId;
  }
  if (b.categoryKey && b.categoryKey !== t.categoryKey) {
    const cat = (await helpdeskSettings(db, tid(c))).categories.find((x) => x.key === b.categoryKey);
    if (!cat) throw badRequest("Unknown category");
    set.categoryKey = cat.key;
    set.categoryLabel = cat.label;
    if (!t.confidential) set.team = cat.team;
    changes.push(`moved to ${cat.label} (${TEAM_LABEL[cat.team]})`);
  }
  if (!changes.length) return c.json({ ok: true });
  await db.update(helpdeskTickets).set(set).where(eq(helpdeskTickets.id, t.id));
  await db.insert(helpdeskMessages).values({ tenantId: tid(c), ticketId: t.id, authorId: me(c), authorName: c.get("session")!.name, fromTeam: true, internal: true, body: `Changed ${changes.join(", ")}.` });
  await audit(c, { action: "helpdesk.update", entity: "helpdesk_ticket", entityId: t.id, summary: `${t.number}: ${changes.join(", ")}` });
  return c.json({ ok: true });
});

helpdeskRoutes.get("/:id/messages/:mid/file", async (c) => {
  const t = await agentTicket(c, c.req.param("id"));
  const [m] = await c.get("db").select().from(helpdeskMessages).where(and(eq(helpdeskMessages.id, c.req.param("mid")), eq(helpdeskMessages.ticketId, t.id)));
  return fileOf(c, m);
});
