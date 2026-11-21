import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { committeeCaseNotes, committeeCases, committees, employees, tenants } from "@hrms/db";
import {
  caseDeadlines,
  caseFileSchema,
  CASE_STATUSES,
  COMMITTEE_LABELS,
  committeeProblems,
  committeeSchema,
  decryptField,
  encryptField,
  poshAnnualReport,
  todayLocal,
  type CaseStatus,
  type CommitteeKind,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
type Committee = typeof committees.$inferSelect;
type Case = typeof committeeCases.$inferSelect;
const memberIds = (k: Committee) => k.members.map((m) => m.employeeId).filter((x): x is string => !!x);

async function committeeView(c: Context<AppEnv>, k: Committee) {
  const ids = memberIds(k);
  const names = ids.length ? await c.get("db").select({ id: employees.id, name: employees.fullName, code: employees.employeeCode }).from(employees).where(inArray(employees.id, ids)) : [];
  return {
    ...k,
    label: COMMITTEE_LABELS[k.kind as CommitteeKind],
    members: k.members.map((m) => ({ ...m, employeeName: names.find((n) => n.id === m.employeeId)?.name ?? null, employeeCode: names.find((n) => n.id === m.employeeId)?.code ?? null })),
    problems: committeeProblems({ kind: k.kind as CommitteeKind, members: k.members as never, constitutedOn: k.constitutedOn, termEndsOn: k.termEndsOn }, { today: todayLocal() }),
  };
}

async function checkMembers(c: Context<AppEnv>, members: { employeeId?: string | null }[]) {
  const ids = [...new Set(members.map((m) => m.employeeId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const found = await c.get("db").select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, ids)));
  if (found.length !== ids.length) throw badRequest("A member isn't one of your employees");
}

// ---------- HR: set up committees; counts only, never case details ----------
export const committeeAdminRoutes = new Hono<AppEnv>();

committeeAdminRoutes.get("/", requirePerm("compliance", "view"), async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(committees).where(eq(committees.tenantId, tid(c))).orderBy(asc(committees.kind), desc(committees.constitutedOn));
  const counts = rows.length
    ? await db
        .select({ id: committeeCases.committeeId, open: sql<number>`count(*) filter (where ${committeeCases.status} not in ('closed','withdrawn'))::int`, total: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${committeeCases.status} not in ('closed','withdrawn') and ${committeeCases.filedOn} < current_date - (case when ${committeeCases.kind} = 'posh_ic' then 90 else 30 end))::int` })
        .from(committeeCases)
        .where(inArray(committeeCases.committeeId, rows.map((r) => r.id)))
        .groupBy(committeeCases.committeeId)
    : [];
  return c.json({ rows: await Promise.all(rows.map(async (k) => ({ ...(await committeeView(c, k)), cases: counts.find((x) => x.id === k.id) ?? { open: 0, total: 0, overdue: 0 } }))) });
});

committeeAdminRoutes.post("/", requirePerm("compliance", "configure"), v("json", committeeSchema), async (c) => {
  const b = c.req.valid("json");
  await checkMembers(c, b.members);
  const [k] = await c.get("db").insert(committees).values({ ...b, tenantId: tid(c), entityId: b.entityId ?? null, termEndsOn: b.termEndsOn ?? null }).returning();
  await audit(c, { action: "committee.create", entity: "committee", entityId: k!.id, summary: `Constituted the ${b.name} (${COMMITTEE_LABELS[b.kind]}) with ${b.members.length} members` });
  return c.json(await committeeView(c, k!), 201);
});

committeeAdminRoutes.put("/:id", requirePerm("compliance", "configure"), v("json", committeeSchema), async (c) => {
  const b = c.req.valid("json");
  await checkMembers(c, b.members);
  const db = c.get("db");
  const [cur] = await db.select().from(committees).where(and(eq(committees.id, c.req.param("id")), eq(committees.tenantId, tid(c))));
  if (!cur) throw notFound("Committee");
  if (b.kind !== cur.kind) throw badRequest("A committee can't change kind; set up a new one");
  const [k] = await db.update(committees).set({ ...b, entityId: b.entityId ?? null, termEndsOn: b.termEndsOn ?? null, updatedAt: new Date() }).where(eq(committees.id, cur.id)).returning();
  await audit(c, { action: "committee.update", entity: "committee", entityId: cur.id, summary: `Updated the ${b.name}: ${b.members.length} members, ${b.workshops.length} awareness sessions` });
  return c.json(await committeeView(c, k!));
});

/** The POSH annual report for a calendar year: counts only, as the District Officer gets them. */
committeeAdminRoutes.get("/:id/annual-report", requirePerm("compliance", "view"), v("query", z.object({ year: z.coerce.number().int().min(2013).max(2100) })), async (c) => {
  const db = c.get("db");
  const [k] = await db.select().from(committees).where(and(eq(committees.id, c.req.param("id")), eq(committees.tenantId, tid(c))));
  if (!k) throw notFound("Committee");
  if (k.kind !== "posh_ic") throw badRequest("The annual report is for the POSH Internal Committee");
  const cases = await db.select({ filedOn: committeeCases.filedOn, status: committeeCases.status, closedOn: committeeCases.closedOn }).from(committeeCases).where(eq(committeeCases.committeeId, k.id));
  return c.json(poshAnnualReport(c.req.valid("query").year, cases.map((x) => ({ ...x, status: x.status as CaseStatus })), k.workshops));
});

// ---------- employees: file a case, and committee members work them ----------
export const essCommitteeRoutes = new Hono<AppEnv>();
essCommitteeRoutes.use("*", requireEmployee);
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

/** The committees you can bring a case to: the newest of each kind for your entity (or company wide). */
async function committeesFor(c: Context<AppEnv>) {
  const db = c.get("db");
  const [e] = await db.select({ entityId: employees.entityId }).from(employees).where(eq(employees.id, me(c)));
  const rows = await db.select().from(committees).where(eq(committees.tenantId, tid(c))).orderBy(desc(committees.constitutedOn));
  const out = new Map<string, Committee>();
  for (const k of rows) if ((!k.entityId || k.entityId === e?.entityId) && !out.has(k.kind)) out.set(k.kind, k);
  return out;
}

const isMember = (k: Committee, eid: string) => memberIds(k).includes(eid);

async function caseView(c: Context<AppEnv>, x: Case, k: Committee, asMember: boolean) {
  const db = c.get("db");
  const key = c.env.ENCRYPTION_KEY!;
  const notes = await db.select().from(committeeCaseNotes).where(eq(committeeCaseNotes.caseId, x.id)).orderBy(asc(committeeCaseNotes.at));
  const people = await db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode }).from(employees).where(inArray(employees.id, [x.complainantId, ...(x.respondentId ? [x.respondentId] : [])]));
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  return {
    id: x.id,
    code: x.code,
    kind: x.kind,
    committee: { id: k.id, name: k.name },
    subject: x.subject,
    description: await decryptField(x.descriptionEnc, key),
    incidentDate: x.incidentDate,
    filedOn: x.filedOn,
    status: x.status,
    reportOn: x.reportOn,
    closedOn: x.closedOn,
    outcome: x.outcomeEnc ? await decryptField(x.outcomeEnc, key) : null,
    complainant: name(x.complainantId),
    respondent: name(x.respondentId) ?? x.respondentName,
    deadlines: caseDeadlines(x.kind as CommitteeKind, x),
    mine: x.complainantId === me(c),
    asMember,
    notes: await Promise.all(
      notes
        .filter((n) => asMember || n.visibleToComplainant || n.kind === "message")
        .map(async (n) => ({ id: n.id, kind: n.kind, status: n.status, body: n.bodyEnc ? await decryptField(n.bodyEnc, key) : null, author: n.authorName, at: n.at, shared: n.visibleToComplainant })),
    ),
  };
}

async function loadCase(c: Context<AppEnv>, id: string) {
  const db = c.get("db");
  const [row] = await db.select({ x: committeeCases, k: committees }).from(committeeCases).innerJoin(committees, eq(committees.id, committeeCases.committeeId)).where(and(eq(committeeCases.id, id), eq(committeeCases.tenantId, tid(c))));
  if (!row) throw notFound("Case");
  const member = isMember(row.k, me(c)) && row.x.complainantId !== me(c) && row.x.respondentId !== me(c);
  // nobody else may know it exists: answer as if it weren't there
  if (!member && row.x.complainantId !== me(c)) throw notFound("Case");
  return { ...row, member };
}

async function notifyMembers(c: Context<AppEnv>, k: Committee, x: Case, subject: string, line: string, skip: string[]) {
  try {
    const ids = memberIds(k).filter((id) => !skip.includes(id));
    if (!ids.length) return;
    const to = await c.get("db").select({ email: employees.workEmail }).from(employees).where(inArray(employees.id, ids));
    const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    // no names or details in the email: they stay behind the sign in
    const { html, text } = layout({ company: t?.name ?? "Saralix", heading: subject, paragraphs: [line, "Details are in Saralix. Keep them confidential."], cta: { label: `Open ${x.code}`, url: `${c.env.APP_URL}/me/committees/${x.id}` } });
    for (const r of to) if (r.email) await c.get("mailer").send({ to: r.email, subject, html, text });
  } catch (e) {
    console.error("committee email failed", e);
  }
}

essCommitteeRoutes.get("/", async (c) => {
  const db = c.get("db");
  const avail = await committeesFor(c);
  const mine = await db.select({ x: committeeCases }).from(committeeCases).where(and(eq(committeeCases.tenantId, tid(c)), eq(committeeCases.complainantId, me(c)))).orderBy(desc(committeeCases.filedOn));
  // cases before the committees you sit on, except ones about you
  const all = await db.select().from(committees).where(eq(committees.tenantId, tid(c)));
  const mineToWork = all.filter((k) => isMember(k, me(c)));
  const assigned = mineToWork.length
    ? (await db.select().from(committeeCases).where(inArray(committeeCases.committeeId, mineToWork.map((k) => k.id))).orderBy(desc(committeeCases.filedOn))).filter((x) => x.complainantId !== me(c) && x.respondentId !== me(c))
    : [];
  const brief = (x: Case) => ({ id: x.id, code: x.code, kind: x.kind, subject: x.subject, filedOn: x.filedOn, status: x.status, deadlines: caseDeadlines(x.kind as CommitteeKind, x) });
  return c.json({
    committees: [...avail.values()].map((k) => ({ id: k.id, kind: k.kind, name: k.name, label: COMMITTEE_LABELS[k.kind as CommitteeKind] })),
    mine: mine.map((r) => brief(r.x)),
    assigned: assigned.map(brief),
  });
});

essCommitteeRoutes.post("/cases", v("json", caseFileSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const k = (await committeesFor(c)).get(b.kind);
  if (!k) throw badRequest(`Your company hasn't set up a ${COMMITTEE_LABELS[b.kind]} yet. Speak to HR.`);
  if (b.respondentEmployeeId === me(c)) throw badRequest("You can't name yourself");
  const today = todayLocal();
  if (b.incidentDate && b.incidentDate > today) throw badRequest("The date of the incident can't be in the future");
  const prefix = b.kind === "posh_ic" ? "POSH" : "GRV";
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(committeeCases).where(and(eq(committeeCases.tenantId, tid(c)), eq(committeeCases.kind, b.kind)))) as [{ n: number }];
  const code = `${prefix}-${String(n + 1).padStart(4, "0")}`;
  const key = c.env.ENCRYPTION_KEY!;
  const [x] = await db
    .insert(committeeCases)
    .values({ tenantId: tid(c), committeeId: k.id, kind: b.kind, code, complainantId: me(c), respondentId: b.respondentEmployeeId ?? null, respondentName: b.respondentName ?? null, subject: b.subject, descriptionEnc: await encryptField(b.description, key), incidentDate: b.incidentDate ?? null, filedOn: today })
    .returning();
  await db.insert(committeeCaseNotes).values({ tenantId: tid(c), caseId: x!.id, kind: "status", status: "received", visibleToComplainant: true, authorName: "Saralix" });
  // the audit log records that a case exists, never what it says or who it's about
  await audit(c, { action: "committee.case_file", entity: "committee_case", entityId: x!.id, summary: `${code} filed with the ${k.name}` });
  await notifyMembers(c, k, x!, `New case ${code} for the ${k.name}`, `A new case was filed on ${today}. ${b.kind === "posh_ic" ? "The inquiry must finish within 90 days." : "The committee must decide within 30 days."}`, [me(c), ...(b.respondentEmployeeId ? [b.respondentEmployeeId] : [])]);
  const d = caseDeadlines(b.kind, x!);
  return c.json({ id: x!.id, code, deadlines: d }, 201);
});

essCommitteeRoutes.get("/cases/:id", async (c) => {
  const { x, k, member } = await loadCase(c, c.req.param("id"));
  return c.json(await caseView(c, x, k, member));
});

const noteSchema = z.object({
  body: z.string().trim().max(8000).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  /** Committee only: share this note with the person who filed. */
  share: z.boolean().default(false),
  reportOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outcome: z.string().trim().max(8000).optional(),
});

essCommitteeRoutes.post("/cases/:id/notes", v("json", noteSchema), async (c) => {
  const b = c.req.valid("json");
  const { x, k, member } = await loadCase(c, c.req.param("id"));
  const db = c.get("db");
  const key = c.env.ENCRYPTION_KEY!;
  const [who] = await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, me(c)));
  if (!member) {
    // the person who filed can write to the committee, or withdraw
    if (b.status && b.status !== "withdrawn") throw forbidden("Only the committee can change the status");
    if (["closed", "withdrawn"].includes(x.status)) throw badRequest("This case is closed");
    if (!b.body && !b.status) throw badRequest("Write a message");
  } else if (!b.body && !b.status && !b.outcome) throw badRequest("Write a note or change the status");
  const patch: Partial<Case> = { updatedAt: new Date() };
  if (b.status && b.status !== x.status) {
    patch.status = b.status;
    if (b.status === "report") patch.reportOn = b.reportOn ?? todayLocal();
    if (b.status === "closed" || b.status === "withdrawn") patch.closedOn = todayLocal();
  }
  if (member && b.outcome) patch.outcomeEnc = await encryptField(b.outcome, key);
  if (patch.status === "closed" && !patch.outcomeEnc && !x.outcomeEnc) throw badRequest("Record the outcome and the action taken before you close the case");
  await db.update(committeeCases).set(patch).where(eq(committeeCases.id, x.id));
  await db.insert(committeeCaseNotes).values({
    tenantId: tid(c),
    caseId: x.id,
    authorUserId: c.get("session")!.userId,
    authorName: who?.name ?? null,
    kind: member ? (patch.status ? "status" : "note") : "message",
    status: patch.status ?? null,
    bodyEnc: b.body ? await encryptField(b.body, key) : null,
    // status changes are always shared; notes only when the committee says so
    visibleToComplainant: !member || !!patch.status || b.share,
  });
  await audit(c, { action: "committee.case_update", entity: "committee_case", entityId: x.id, summary: `${x.code}: ${patch.status ? `moved to ${patch.status}` : member ? "committee note" : "message from the person who filed"}` });
  if (!member) await notifyMembers(c, k, x, `${x.code}: ${b.status === "withdrawn" ? "withdrawn" : "new message"}`, b.status === "withdrawn" ? "The person who filed has withdrawn the case." : "The person who filed sent the committee a message.", [me(c)]);
  return c.json({ ok: true, status: patch.status ?? x.status });
});
