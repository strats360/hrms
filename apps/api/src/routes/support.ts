import { Hono, type Context } from "hono";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { platformStaff, supportAccess, supportTickets, tenants, ticketMessages, user, type TicketAttachment } from "@hrms/db";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAdmin, requirePlatform } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { ALLOWED_TYPES, getFile, MAX_UPLOAD_BYTES, putFile, safeName } from "../lib/storage";
import { activeAccess, nextTicketNumber, OPEN_STATUSES, responseDue, SLA, supportInbox, type Priority } from "../services/support";

const CATEGORIES = ["payroll", "attendance", "leave", "compliance", "tax", "payments", "billing", "access", "bug", "other"] as const;
const PRIORITIES = ["P1", "P2", "P3"] as const;
const STATUSES = ["open", "in_progress", "waiting_on_customer", "resolved", "closed"] as const;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;
const uname = (c: Context<AppEnv>) => c.get("session")!.name;

const raiser = alias(user, "raiser");
const assignee = alias(user, "assignee");
const ticketRow = {
  t: supportTickets,
  tenantName: tenants.name,
  tenantCode: tenants.code,
  tenantPlan: tenants.plan,
  raisedByName: raiser.name,
  raisedByEmail: raiser.email,
  assigneeName: assignee.name,
  messages: sql<number>`(select count(*)::int from ticket_messages m where m.ticket_id = "support_tickets"."id" and not m.internal)`,
};
type Row = { t: typeof supportTickets.$inferSelect; tenantName: string; tenantCode: string; tenantPlan: string; raisedByName: string | null; raisedByEmail: string | null; assigneeName: string | null; messages: number };
const shape = (r: Row) => {
  const now = Date.now();
  const breached = !r.t.firstResponseAt && OPEN_STATUSES.includes(r.t.status) && r.t.responseDueAt.getTime() < now;
  return {
    ...r.t,
    tenantName: r.tenantName,
    tenantCode: r.tenantCode,
    tenantPlan: r.tenantPlan,
    raisedByName: r.raisedByName,
    raisedByEmail: r.raisedByEmail,
    assigneeName: r.assigneeName,
    messages: r.messages,
    sla: SLA[r.t.priority as Priority]?.label ?? "",
    slaState: r.t.firstResponseAt ? "met" : breached ? "breached" : OPEN_STATUSES.includes(r.t.status) ? "pending" : "n/a",
  };
};
const ticketQuery = (c: Context<AppEnv>, conds: SQL[]) =>
  c
    .get("db")
    .select(ticketRow)
    .from(supportTickets)
    .innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
    .leftJoin(raiser, eq(raiser.id, supportTickets.raisedBy))
    .leftJoin(assignee, eq(assignee.id, supportTickets.assigneeId))
    .where(conds.length ? and(...conds) : undefined);

/** Attachments from a multipart form ("files"), stored under the tenant. */
async function saveFiles(c: Context<AppEnv>, tenantId: string, ticketId: string, form: FormData): Promise<TicketAttachment[]> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 3) throw badRequest("Attach up to 3 files");
  const out: TicketAttachment[] = [];
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) throw badRequest("Files must be 10 MB or smaller");
    if (!ALLOWED_TYPES.includes(f.type)) throw badRequest("Attach PDF, PNG, JPG or WebP files");
    const key = `tenants/${tenantId}/support/${ticketId}/${crypto.randomUUID()}-${safeName(f.name)}`;
    await putFile(c.env, key, await f.arrayBuffer(), f.type);
    out.push({ key, name: f.name, type: f.type, size: f.size });
  }
  return out;
}

function parseForm<T extends z.ZodTypeAny>(form: FormData, schema: T): z.infer<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("data") ?? "{}"));
  } catch {
    throw badRequest("Invalid form data");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw badRequest(i ? i.message : "Check the form");
  }
  return r.data;
}

async function sendFile(c: Context<AppEnv>, messageId: string, index: number, conds: SQL[]) {
  const [m] = await c.get("db").select({ m: ticketMessages }).from(ticketMessages).innerJoin(supportTickets, eq(supportTickets.id, ticketMessages.ticketId)).where(and(eq(ticketMessages.id, messageId), ...conds));
  const a = m?.m.attachments[index];
  if (!a) throw notFound("Attachment");
  const file = await getFile(c.env, a.key);
  if (!file) throw notFound("File");
  return new Response(file.body as BodyInit, { headers: { "Content-Type": a.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

async function mail(c: Context<AppEnv>, to: string | null | undefined, subject: string, heading: string, paragraphs: string[], url: string) {
  if (!to) return;
  try {
    const { html, text } = layout({ company: "Strats360 People support", heading, paragraphs, cta: { label: "Open ticket", url } });
    await c.get("mailer").send({ to, subject, html, text });
  } catch (err) {
    console.error("support email failed", err);
  }
}

// ===========================================================================
// Tenant admins: Help & support
// ===========================================================================
export const tenantSupportRoutes = new Hono<AppEnv>();
tenantSupportRoutes.use("*", requireAdmin);
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

tenantSupportRoutes.get("/", async (c) => {
  const rows = (await ticketQuery(c, [eq(supportTickets.tenantId, tid(c))]).orderBy(desc(supportTickets.lastActivityAt))) as Row[];
  return c.json(rows.map(shape));
});

const createSchema = z.object({
  subject: z.string().trim().min(5, "Add a short subject").max(140),
  category: z.enum(CATEGORIES).default("other"),
  priority: z.enum(PRIORITIES).default("P3"),
  body: z.string().trim().min(10, "Describe the problem").max(5000),
  allowAccess: z.boolean().default(false),
});

tenantSupportRoutes.post("/", async (c) => {
  if (c.get("tenant").readOnly) throw forbidden("Read-only support view");
  const form = await c.req.formData();
  const b = parseForm(form, createSchema);
  const db = c.get("db");
  const now = new Date();
  const [t] = await db
    .insert(supportTickets)
    .values({ number: await nextTicketNumber(db), tenantId: tid(c), raisedBy: uid(c), subject: b.subject, category: b.category, priority: b.priority, allowAccess: b.allowAccess, responseDueAt: responseDue(b.priority, now), lastActivityAt: now })
    .returning();
  const attachments = await saveFiles(c, tid(c), t!.id, form);
  await db.insert(ticketMessages).values({ ticketId: t!.id, authorId: uid(c), authorName: uname(c), authorKind: "tenant", body: b.body, attachments });
  await audit(c, { action: "support.ticket_create", entity: "support_ticket", entityId: t!.id, summary: `Raised support ticket #${t!.number}: ${b.subject}${b.allowAccess ? " (read-only access allowed)" : ""}` });
  const [co] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  for (const s of await supportInbox(db)) await mail(c, s.email, `[${b.priority}] #${t!.number} ${b.subject}`, `New ${b.priority} ticket from ${co?.name}`, [`${uname(c)}: ${b.body.slice(0, 400)}`, SLA[b.priority].label + "."], `${c.env.APP_URL}/platform/tickets/${t!.id}`);
  return c.json(t, 201);
});

tenantSupportRoutes.get("/:id", async (c) => {
  const [r] = (await ticketQuery(c, [eq(supportTickets.id, c.req.param("id")), eq(supportTickets.tenantId, tid(c))])) as Row[];
  if (!r) throw notFound("Ticket");
  const messages = await c.get("db").select().from(ticketMessages).where(and(eq(ticketMessages.ticketId, r.t.id), eq(ticketMessages.internal, false))).orderBy(asc(ticketMessages.createdAt));
  const access = await c.get("db").select({ a: supportAccess, name: user.name }).from(supportAccess).innerJoin(user, eq(user.id, supportAccess.staffUserId)).where(eq(supportAccess.ticketId, r.t.id)).orderBy(desc(supportAccess.startedAt));
  return c.json({ ...shape(r), thread: messages, accessLog: access.map((x) => ({ ...x.a, staffName: x.name })) });
});

tenantSupportRoutes.post("/:id/messages", async (c) => {
  if (c.get("tenant").readOnly) throw forbidden("Read-only support view");
  const db = c.get("db");
  const [t] = await db.select().from(supportTickets).where(and(eq(supportTickets.id, c.req.param("id")), eq(supportTickets.tenantId, tid(c))));
  if (!t) throw notFound("Ticket");
  if (t.status === "closed") throw badRequest("This ticket is closed. Raise a new one.");
  const form = await c.req.formData();
  const b = parseForm(form, z.object({ body: z.string().trim().min(1, "Write a reply").max(5000) }));
  const attachments = await saveFiles(c, tid(c), t.id, form);
  const [m] = await db.insert(ticketMessages).values({ ticketId: t.id, authorId: uid(c), authorName: uname(c), authorKind: "tenant", body: b.body, attachments }).returning();
  // a reply from the customer puts the ticket back in the support queue
  await db.update(supportTickets).set({ lastActivityAt: new Date(), status: t.status === "waiting_on_customer" || t.status === "resolved" ? "open" : t.status, resolvedAt: t.status === "resolved" ? null : t.resolvedAt }).where(eq(supportTickets.id, t.id));
  if (t.assigneeId) {
    const [a] = await db.select({ email: user.email }).from(user).where(eq(user.id, t.assigneeId));
    await mail(c, a?.email, `#${t.number} customer replied`, `New reply on #${t.number}`, [`${uname(c)}: ${b.body.slice(0, 400)}`], `${c.env.APP_URL}/platform/tickets/${t.id}`);
  }
  return c.json(m, 201);
});

tenantSupportRoutes.patch("/:id", v("json", z.object({ allowAccess: z.boolean().optional(), status: z.enum(["resolved", "closed"]).optional() })), async (c) => {
  if (c.get("tenant").readOnly) throw forbidden("Read-only support view");
  const b = c.req.valid("json");
  const db = c.get("db");
  const [t] = await db
    .update(supportTickets)
    .set({ ...b, ...(b.status ? { resolvedAt: new Date() } : {}), lastActivityAt: new Date() })
    .where(and(eq(supportTickets.id, c.req.param("id")), eq(supportTickets.tenantId, tid(c))))
    .returning();
  if (!t) throw notFound("Ticket");
  // withdrawing consent (or closing) ends any running support session at once
  if (b.allowAccess === false || b.status) await db.update(supportAccess).set({ endedAt: new Date() }).where(and(eq(supportAccess.ticketId, t.id), isNull(supportAccess.endedAt)));
  await audit(c, { action: "support.ticket_update", entity: "support_ticket", entityId: t.id, summary: `#${t.number}: ${b.allowAccess === true ? "allowed read-only support access" : b.allowAccess === false ? "withdrew support access" : `marked ${b.status}`}` });
  return c.json(t);
});

tenantSupportRoutes.get("/attachments/:messageId/:index", (c) => sendFile(c, c.req.param("messageId"), Number(c.req.param("index")), [eq(supportTickets.tenantId, tid(c)), eq(ticketMessages.internal, false)]));

// ===========================================================================
// Platform: support queue
// ===========================================================================
export const platformSupportRoutes = new Hono<AppEnv>();
platformSupportRoutes.use("*", requirePlatform("super_admin", "support"));

platformSupportRoutes.get("/summary", async (c) => {
  const rows = (await ticketQuery(c, [inArray(supportTickets.status, OPEN_STATUSES)])) as Row[];
  const s = rows.map(shape);
  return c.json({ open: s.length, p1: s.filter((x) => x.priority === "P1").length, p2: s.filter((x) => x.priority === "P2").length, breached: s.filter((x) => x.slaState === "breached").length, unassigned: s.filter((x) => !x.assigneeId).length });
});

platformSupportRoutes.get("/tickets", v("query", z.object({ status: z.string().optional(), priority: z.string().optional(), q: z.string().optional(), mine: z.enum(["1"]).optional(), tenantId: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const conds: SQL[] = [];
  if (q.status === "open") conds.push(inArray(supportTickets.status, OPEN_STATUSES));
  else if (q.status) conds.push(inArray(supportTickets.status, q.status.split(",")));
  if (q.priority) conds.push(eq(supportTickets.priority, q.priority));
  if (q.mine) conds.push(eq(supportTickets.assigneeId, uid(c)));
  if (q.tenantId) conds.push(eq(supportTickets.tenantId, q.tenantId));
  if (q.q) conds.push(or(ilike(supportTickets.subject, `%${q.q}%`), ilike(tenants.name, `%${q.q}%`), sql`${supportTickets.number}::text = ${q.q.replace(/^#/, "")}`)!);
  const rows = (await ticketQuery(c, conds).orderBy(sql`case ${supportTickets.priority} when 'P1' then 1 when 'P2' then 2 else 3 end`, desc(supportTickets.lastActivityAt)).limit(1000)) as Row[];
  return c.json(rows.map(shape));
});

platformSupportRoutes.get("/tickets/:id", async (c) => {
  const [r] = (await ticketQuery(c, [eq(supportTickets.id, c.req.param("id"))])) as Row[];
  if (!r) throw notFound("Ticket");
  const db = c.get("db");
  const messages = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, r.t.id)).orderBy(asc(ticketMessages.createdAt));
  const access = await db.select({ a: supportAccess, name: user.name }).from(supportAccess).innerJoin(user, eq(user.id, supportAccess.staffUserId)).where(eq(supportAccess.ticketId, r.t.id)).orderBy(desc(supportAccess.startedAt));
  const staff = await db.select({ id: user.id, name: user.name, role: platformStaff.role }).from(platformStaff).innerJoin(user, eq(user.id, platformStaff.userId)).where(eq(platformStaff.status, "active"));
  const mine = (await activeAccess(db, uid(c), r.t.tenantId)).find((x) => x.access.ticketId === r.t.id);
  return c.json({ ...shape(r), thread: messages, accessLog: access.map((x) => ({ ...x.a, staffName: x.name })), staff, myAccess: mine?.access ?? null });
});

platformSupportRoutes.post("/tickets/:id/messages", async (c) => {
  const db = c.get("db");
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, c.req.param("id")));
  if (!t) throw notFound("Ticket");
  const form = await c.req.formData();
  const b = parseForm(form, z.object({ body: z.string().trim().min(1, "Write a reply").max(5000), internal: z.boolean().default(false), status: z.enum(STATUSES).optional() }));
  const attachments = await saveFiles(c, t.tenantId, t.id, form);
  const [m] = await db.insert(ticketMessages).values({ ticketId: t.id, authorId: uid(c), authorName: uname(c), authorKind: "platform", body: b.body, internal: b.internal, attachments }).returning();
  const now = new Date();
  const status = b.status ?? (b.internal ? t.status : t.status === "open" ? "waiting_on_customer" : t.status);
  await db
    .update(supportTickets)
    .set({ lastActivityAt: now, status, firstResponseAt: !b.internal && !t.firstResponseAt ? now : t.firstResponseAt, assigneeId: t.assigneeId ?? uid(c), resolvedAt: status === "resolved" || status === "closed" ? now : null })
    .where(eq(supportTickets.id, t.id));
  if (!b.internal) {
    const [r] = await db.select({ email: user.email }).from(user).where(eq(user.id, t.raisedBy));
    await mail(c, r?.email, `Re: #${t.number} ${t.subject}`, `Support replied on #${t.number}`, [`${uname(c)}: ${b.body.slice(0, 800)}`], `${c.env.APP_URL}/support?ticket=${t.id}`);
  }
  if (b.status === "resolved" || b.status === "closed") await db.update(supportAccess).set({ endedAt: now }).where(and(eq(supportAccess.ticketId, t.id), isNull(supportAccess.endedAt)));
  return c.json(m, 201);
});

platformSupportRoutes.patch("/tickets/:id", v("json", z.object({ status: z.enum(STATUSES).optional(), priority: z.enum(PRIORITIES).optional(), assigneeId: z.string().nullable().optional() })), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [cur] = await db.select().from(supportTickets).where(eq(supportTickets.id, c.req.param("id")));
  if (!cur) throw notFound("Ticket");
  const patch: Partial<typeof supportTickets.$inferInsert> = { ...b, lastActivityAt: new Date() };
  if (b.priority && b.priority !== cur.priority && !cur.firstResponseAt) patch.responseDueAt = responseDue(b.priority, cur.createdAt);
  if (b.status === "resolved" || b.status === "closed") patch.resolvedAt = new Date();
  const [t] = await db.update(supportTickets).set(patch).where(eq(supportTickets.id, cur.id)).returning();
  if (b.status === "resolved" || b.status === "closed") await db.update(supportAccess).set({ endedAt: new Date() }).where(and(eq(supportAccess.ticketId, cur.id), isNull(supportAccess.endedAt)));
  const what = [b.status && `status ${b.status.replace(/_/g, " ")}`, b.priority && `priority ${b.priority}`, b.assigneeId !== undefined && "assignee changed"].filter(Boolean).join(", ");
  await audit(c, { tenantId: null, action: "platform.ticket_update", entity: "support_ticket", entityId: cur.id, summary: `#${cur.number}: ${what}` });
  return c.json(t);
});

/** Start a read-only session into the tenant, for this ticket, for 60 minutes. */
platformSupportRoutes.post("/tickets/:id/access", async (c) => {
  const db = c.get("db");
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, c.req.param("id")));
  if (!t) throw notFound("Ticket");
  if (!t.allowAccess) throw forbidden("The customer hasn't allowed read-only access on this ticket. Ask them to switch it on.");
  if (!OPEN_STATUSES.includes(t.status)) throw badRequest("Access is only available while the ticket is open");
  const existing = (await activeAccess(db, uid(c), t.tenantId)).find((x) => x.access.ticketId === t.id);
  if (existing) return c.json(existing.access);
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const [a] = await db.insert(supportAccess).values({ ticketId: t.id, tenantId: t.tenantId, staffUserId: uid(c), expiresAt }).returning();
  const until = expiresAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) + " IST";
  await db.insert(ticketMessages).values({ ticketId: t.id, authorId: null, authorName: "System", authorKind: "system", body: `${uname(c)} (support) opened read-only access to your account until ${until}.` });
  await audit(c, { tenantId: t.tenantId, action: "support.access_start", entity: "support_ticket", entityId: t.id, summary: `Support (${uname(c)}) started read-only access for ticket #${t.number}, until ${until}` });
  return c.json(a, 201);
});

platformSupportRoutes.post("/access/:id/end", async (c) => {
  const [a] = await c.get("db").update(supportAccess).set({ endedAt: new Date() }).where(and(eq(supportAccess.id, c.req.param("id")), eq(supportAccess.staffUserId, uid(c)), isNull(supportAccess.endedAt))).returning();
  if (!a) throw notFound("Support session");
  await audit(c, { tenantId: a.tenantId, action: "support.access_end", entity: "support_ticket", entityId: a.ticketId, summary: `Support (${uname(c)}) ended read-only access` });
  return c.json(a);
});

platformSupportRoutes.get("/attachments/:messageId/:index", (c) => sendFile(c, c.req.param("messageId"), Number(c.req.param("index")), []));
