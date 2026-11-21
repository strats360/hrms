import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { dataBreaches, employees, privacyConsents, privacyNotices, tenants } from "@hrms/db";
import { breachDeadlines, breachSchema, consentSchema, CONSENT_PURPOSES, DEFAULT_PRIVACY_NOTICE, dueForErasure, privacyNoticeSchema, todayLocal, type ConsentPurpose } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { privacySettings } from "../services/privacy";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

async function currentNotice(c: Context<AppEnv>) {
  const [n] = await c.get("db").select().from(privacyNotices).where(eq(privacyNotices.tenantId, tid(c))).orderBy(desc(privacyNotices.version)).limit(1);
  return n ? { version: n.version, text: n.text, publishedAt: n.publishedAt } : { version: 0, text: DEFAULT_PRIVACY_NOTICE, publishedAt: null };
}

/** The latest row per employee and purpose: the current state of each consent. */
async function latestConsents(c: Context<AppEnv>, employeeIds?: string[]) {
  const rows = await c
    .get("db")
    .selectDistinctOn([privacyConsents.employeeId, privacyConsents.purpose], { employeeId: privacyConsents.employeeId, purpose: privacyConsents.purpose, granted: privacyConsents.granted, noticeVersion: privacyConsents.noticeVersion, at: privacyConsents.at })
    .from(privacyConsents)
    .where(and(eq(privacyConsents.tenantId, tid(c)), ...(employeeIds ? [inArray(privacyConsents.employeeId, employeeIds)] : [])))
    .orderBy(privacyConsents.employeeId, privacyConsents.purpose, desc(privacyConsents.at));
  return rows;
}

// ---------- the employee ----------
export const essDpdpRoutes = new Hono<AppEnv>();
essDpdpRoutes.use("*", requireEmployee);
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

essDpdpRoutes.get("/", async (c) => {
  const [notice, rows, settings] = await Promise.all([currentNotice(c), latestConsents(c, [me(c)]), privacySettings(c.get("db"), tid(c))]);
  const ack = rows.find((r) => r.purpose === "notice");
  return c.json({
    notice,
    acknowledged: ack ? { version: ack.noticeVersion, at: ack.at } : null,
    needsAcknowledgement: !ack || (ack.noticeVersion ?? 0) < notice.version,
    consents: Object.fromEntries(CONSENT_PURPOSES.map((p) => { const r = rows.find((x) => x.purpose === p); return [p, r ? { granted: r.granted, at: r.at } : null]; })),
    officer: { name: settings.officerName, email: settings.officerEmail },
  });
});

essDpdpRoutes.post("/acknowledge", v("json", z.object({ version: z.number().int().min(0) })), async (c) => {
  const notice = await currentNotice(c);
  if (c.req.valid("json").version !== notice.version) throw badRequest("The notice has changed; read the new one first");
  await c.get("db").insert(privacyConsents).values({ tenantId: tid(c), employeeId: me(c), purpose: "notice", granted: true, noticeVersion: notice.version });
  await audit(c, { action: "privacy.notice_ack", entity: "employee", entityId: me(c), summary: `Read and acknowledged privacy notice version ${notice.version}` });
  return c.json({ ok: true });
});

essDpdpRoutes.post("/consents", v("json", consentSchema), async (c) => {
  const b = c.req.valid("json");
  const notice = await currentNotice(c);
  await c.get("db").insert(privacyConsents).values({ tenantId: tid(c), employeeId: me(c), purpose: b.purpose, granted: b.granted, noticeVersion: notice.version });
  await audit(c, { action: b.granted ? "privacy.consent_give" : "privacy.consent_withdraw", entity: "employee", entityId: me(c), summary: `${b.granted ? "Gave" : "Withdrew"} consent: ${b.purpose.replace(/_/g, " ")}` });
  return c.json({ ok: true });
});

// ---------- HR ----------
export const dpdpAdminRoutes = new Hono<AppEnv>();
dpdpAdminRoutes.use("*", requirePerm("employees", "configure"));

dpdpAdminRoutes.get("/", async (c) => {
  const db = c.get("db");
  const today = todayLocal();
  const [notice, settings, consents, staff, [t], breaches] = await Promise.all([
    currentNotice(c),
    privacySettings(db, tid(c)),
    latestConsents(c),
    db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, status: employees.status, lwd: employees.lastWorkingDay, erasedAt: employees.erasedAt }).from(employees).where(eq(employees.tenantId, tid(c))),
    db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tid(c))),
    db.select().from(dataBreaches).where(eq(dataBreaches.tenantId, tid(c))).orderBy(desc(dataBreaches.discoveredAt)),
  ]);
  const current = staff.filter((e) => !["exited", "inactive"].includes(e.status) && !e.erasedAt);
  const ids = new Set(current.map((e) => e.id));
  const acked = consents.filter((r) => r.purpose === "notice" && ids.has(r.employeeId) && (r.noticeVersion ?? 0) >= notice.version).length;
  const byPurpose = Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, { granted: consents.filter((r) => r.purpose === p && r.granted && ids.has(r.employeeId)).length, withdrawn: consents.filter((r) => r.purpose === p && !r.granted && ids.has(r.employeeId)).length }]));
  // where a policy depends on a consent someone has withdrawn
  const punch = (t?.s as { punchPolicy?: { selfie?: string; location?: string } } | null)?.punchPolicy;
  const conflicts: string[] = [];
  if (punch?.selfie === "required" && byPurpose.selfie_punch!.withdrawn) conflicts.push(`Selfies are required on punches, but ${byPurpose.selfie_punch!.withdrawn} employees have withdrawn consent. Offer them another way to mark attendance.`);
  if (punch?.location && punch.location !== "off" && byPurpose.location_punch!.withdrawn) conflicts.push(`Location is checked on punches, but ${byPurpose.location_punch!.withdrawn} employees have withdrawn consent. Offer them another way to mark attendance.`);
  const years = settings.retentionYears ?? 8;
  const retention = staff
    .filter((e) => !e.erasedAt && ["exited", "inactive"].includes(e.status))
    .map((e) => ({ employeeId: e.id, code: e.code, name: e.name, lastWorkingDay: e.lwd, ...dueForErasure(e.lwd, years, today) }))
    .filter((r) => r.due);
  return c.json({
    notice,
    acknowledgements: { acknowledged: acked, employees: current.length },
    consents: byPurpose,
    conflicts,
    retention: { years, due: retention },
    breaches: breaches.map((b) => ({ ...b, ...breachDeadlines({ discoveredAt: b.discoveredAt.toISOString(), boardIntimatedAt: b.boardIntimatedAt?.toISOString(), boardReportAt: b.boardReportAt?.toISOString(), peopleNotifiedAt: b.peopleNotifiedAt?.toISOString() }) })),
  });
});

dpdpAdminRoutes.post("/notice", v("json", privacyNoticeSchema), async (c) => {
  const cur = await currentNotice(c);
  const version = cur.version + 1;
  await c.get("db").insert(privacyNotices).values({ tenantId: tid(c), version, text: c.req.valid("json").text, publishedBy: c.get("session")!.userId });
  await audit(c, { action: "privacy.notice_publish", entity: "tenant", entityId: tid(c), summary: `Published privacy notice version ${version}; employees are asked to read it` });
  return c.json({ version }, 201);
});

const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);
const breachValues = (b: z.infer<typeof breachSchema>) => ({ ...b, discoveredAt: new Date(b.discoveredAt), boardIntimatedAt: toDate(b.boardIntimatedAt), boardReportAt: toDate(b.boardReportAt), peopleNotifiedAt: toDate(b.peopleNotifiedAt) });

dpdpAdminRoutes.post("/breaches", v("json", breachSchema), async (c) => {
  const db = c.get("db");
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(dataBreaches).where(eq(dataBreaches.tenantId, tid(c)))) as [{ n: number }];
  const code = `BR-${String(n + 1).padStart(3, "0")}`;
  const [b] = await db.insert(dataBreaches).values({ tenantId: tid(c), code, ...breachValues(c.req.valid("json")), createdBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "privacy.breach_log", entity: "data_breach", entityId: b!.id, summary: `Logged data breach ${code} (${b!.affectedCount} people)` });
  return c.json(b, 201);
});

dpdpAdminRoutes.put("/breaches/:id", v("json", breachSchema), async (c) => {
  const [b] = await c.get("db").update(dataBreaches).set({ ...breachValues(c.req.valid("json")), updatedAt: new Date() }).where(and(eq(dataBreaches.id, c.req.param("id")), eq(dataBreaches.tenantId, tid(c)))).returning();
  if (!b) throw notFound("Breach");
  await audit(c, { action: "privacy.breach_update", entity: "data_breach", entityId: b.id, summary: `Updated data breach ${b.code}: ${b.status}` });
  return c.json(b);
});

/** One employee's consent history, for HR answering a question about it. */
dpdpAdminRoutes.get("/employees/:id/consents", async (c) => {
  const rows = await c.get("db").select().from(privacyConsents).where(and(eq(privacyConsents.tenantId, tid(c)), eq(privacyConsents.employeeId, c.req.param("id")))).orderBy(desc(privacyConsents.at));
  return c.json({ rows: rows.map((r) => ({ purpose: r.purpose as ConsentPurpose | "notice", granted: r.granted, noticeVersion: r.noticeVersion, at: r.at })) });
});
