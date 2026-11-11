import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { employees, memberships, privacyRequests, roles, tenants, user } from "@hrms/db";
import { addDaysIso, ERASED_DATA, erasureBlocker, erasureRequestSchema, eraseSchema, fmtDate, KEPT_DATA, privacyDecisionSchema, privacySettingsSchema, todayIST } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { sendNotification } from "../services/notifications";
import { eraseEmployee, erasureState, exportEmployeeData, privacySettings } from "../services/privacy";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const zipResponse = (c: Context<AppEnv>, zip: Uint8Array, filename: string) =>
  c.body(zip as unknown as ArrayBuffer, 200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" });

async function companyName(c: Context<AppEnv>) {
  const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  return t?.name ?? "Strats360 People";
}

async function blockerFor(c: Context<AppEnv>, e: typeof employees.$inferSelect) {
  const s = await erasureState(c.get("db"), tid(c), e.id);
  return erasureBlocker(e, todayIST(), s.openLoans, s.fnfOpen);
}

/* ---------------- self-service ---------------- */

export const essPrivacyRoutes = new Hono<AppEnv>();
essPrivacyRoutes.use("*", requireEmployee);

essPrivacyRoutes.get("/", async (c) => {
  const eid = c.get("tenant").employeeId!;
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(eq(employees.id, eid));
  const settings = await privacySettings(db, tid(c));
  const requests = await db.select().from(privacyRequests).where(and(eq(privacyRequests.employeeId, eid), eq(privacyRequests.tenantId, tid(c)))).orderBy(desc(privacyRequests.createdAt));
  return c.json({
    officer: { name: settings.officerName, email: settings.officerEmail },
    responseDays: settings.responseDays,
    erased: ERASED_DATA,
    kept: KEPT_DATA,
    // why HR can't erase yet, so the employee knows before asking
    blocker: e ? await blockerFor(c, e) : null,
    requests: requests.map((r) => ({ id: r.id, status: r.status, reason: r.reason, dueDate: r.dueDate, decisionNote: r.decisionNote, decidedAt: r.decidedAt, createdAt: r.createdAt })),
  });
});

essPrivacyRoutes.get("/export", async (c) => {
  const out = await exportEmployeeData(c.get("db"), c.env, tid(c), c.get("tenant").employeeId!);
  if (!out) throw notFound("Employee");
  await audit(c, { action: "privacy.export", entity: "employee", entityId: out.employee.id, summary: `${out.employee.fullName} downloaded a copy of their data` });
  return zipResponse(c, out.zip, out.filename);
});

essPrivacyRoutes.post("/erasure", v("json", erasureRequestSchema), async (c) => {
  const eid = c.get("tenant").employeeId!;
  const db = c.get("db");
  const [open] = await db.select({ id: privacyRequests.id }).from(privacyRequests).where(and(eq(privacyRequests.employeeId, eid), eq(privacyRequests.status, "pending")));
  if (open) throw badRequest("You already have a request with HR");
  const [e] = await db.select().from(employees).where(eq(employees.id, eid));
  if (!e || e.erasedAt) throw badRequest("Your personal data has already been erased");
  const settings = await privacySettings(db, tid(c));
  const due = addDaysIso(todayIST(), settings.responseDays);
  const { reason } = c.req.valid("json");
  const [r] = await db.insert(privacyRequests).values({ tenantId: tid(c), employeeId: eid, reason: reason || null, dueDate: due }).returning();
  await audit(c, { action: "privacy.request", entity: "employee", entityId: eid, summary: `${e.fullName} asked for their personal data to be erased` });

  try {
    const hr = await db
      .select({ email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, tid(c)), eq(memberships.status, "active"), inArray(roles.key, ["super_admin", "hr_admin"])));
    const company = await companyName(c);
    const subject = `Data erasure request: ${e.fullName}`;
    const { html, text } = layout({
      company,
      heading: subject,
      paragraphs: [
        `${e.fullName} (${e.employeeCode}) has asked for their personal data to be erased under the DPDP Act.`,
        ...(reason ? [`Their reason: ${reason}`] : []),
        `Please answer by ${fmtDate(due)}. Payroll, tax and statutory records stay; the rest is removed once they've left and their full and final settlement is done.`,
      ],
      cta: { label: "Review the request", url: `${c.env.APP_URL}/employees/data-requests` },
    });
    for (const to of [...new Set(hr.map((h) => h.email))]) await sendNotification(c, "privacy_requests", { to, subject, html, text });
  } catch (err) {
    console.error("privacy request email failed", err);
  }
  return c.json(r, 201);
});

essPrivacyRoutes.post("/erasure/:id/cancel", async (c) => {
  const db = c.get("db");
  const [r] = await db
    .update(privacyRequests)
    .set({ status: "cancelled", decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(privacyRequests.id, c.req.param("id")), eq(privacyRequests.employeeId, c.get("tenant").employeeId!), eq(privacyRequests.status, "pending")))
    .returning();
  if (!r) throw notFound("Request");
  await audit(c, { action: "privacy.cancel", entity: "employee", entityId: r.employeeId, summary: "Withdrew their data erasure request" });
  return c.json({ ok: true });
});

/* ---------------- HR ---------------- */

export const privacyRoutes = new Hono<AppEnv>();
privacyRoutes.use("*", requirePerm("employees", "configure"));

privacyRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ r: privacyRequests, e: employees })
    .from(privacyRequests)
    .innerJoin(employees, eq(employees.id, privacyRequests.employeeId))
    .where(eq(privacyRequests.tenantId, tid(c)))
    .orderBy(sql`${privacyRequests.status} = 'pending' desc`, desc(privacyRequests.createdAt))
    .limit(500);
  const today = todayIST();
  const out = [];
  for (const { r, e } of rows) {
    out.push({
      id: r.id,
      employeeId: e.id,
      name: e.fullName,
      code: e.employeeCode,
      status: r.status,
      source: r.source,
      reason: r.reason,
      dueDate: r.dueDate,
      overdue: r.status === "pending" && !!r.dueDate && r.dueDate < today,
      decisionNote: r.decisionNote,
      decidedByName: r.decidedByName,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
      summary: r.summary,
      blocker: r.status === "pending" ? await blockerFor(c, e) : null,
    });
  }
  return c.json({ rows: out, settings: await privacySettings(db, tid(c)), erased: ERASED_DATA, kept: KEPT_DATA });
});

privacyRoutes.put("/settings", v("json", privacySettingsSchema), async (c) => {
  const b = c.req.valid("json");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ privacy: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "settings.privacy", entity: "tenant", entityId: tid(c), summary: `Data requests: answer within ${b.responseDays} days${b.officerName ? `, grievance officer ${b.officerName}` : ""}`, data: b });
  return c.json(b);
});

async function loadEmployee(c: Context<AppEnv>, id: string) {
  const [e] = await c.get("db").select().from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  return e;
}

/** For the employee profile: can HR erase this person, and has it happened. */
privacyRoutes.get("/employees/:id", async (c) => {
  const e = await loadEmployee(c, c.req.param("id"));
  return c.json({ erasedAt: e.erasedAt, blocker: await blockerFor(c, e), erased: ERASED_DATA, kept: KEPT_DATA });
});

/** HR downloads the same copy the employee would get, e.g. to answer a request by email. */
privacyRoutes.get("/employees/:id/export", async (c) => {
  const out = await exportEmployeeData(c.get("db"), c.env, tid(c), c.req.param("id"));
  if (!out) throw notFound("Employee");
  await audit(c, { action: "privacy.export", entity: "employee", entityId: out.employee.id, summary: `Downloaded a copy of ${out.employee.fullName}'s data` });
  return zipResponse(c, out.zip, out.filename);
});

async function erase(c: Context<AppEnv>, e: typeof employees.$inferSelect, note: string, requestId: string | null) {
  const blocker = await blockerFor(c, e);
  if (blocker) throw badRequest(blocker);
  const db = c.get("db");
  const s = c.get("session")!;
  // tell them before the contact details go
  const to = e.personalEmail;
  const { summary } = await eraseEmployee(db, c.env, tid(c), e.id);
  const decided = { status: "completed", decisionNote: note || null, decidedBy: s.userId, decidedByName: s.name, decidedAt: new Date(), summary, updatedAt: new Date() };
  if (requestId) await db.update(privacyRequests).set(decided).where(eq(privacyRequests.id, requestId));
  else await db.insert(privacyRequests).values({ tenantId: tid(c), employeeId: e.id, source: "hr", ...decided });
  await audit(c, { action: "privacy.erase", entity: "employee", entityId: e.id, summary: `Erased ${e.fullName}'s personal data`, data: summary });
  if (to) {
    try {
      const company = await companyName(c);
      const subject = "Your personal data has been erased";
      const { html, text } = layout({
        company,
        heading: subject,
        paragraphs: [
          `Hi ${e.firstName},`,
          `${company} has erased your personal data: contact and personal details, bank details, photo, punch selfies and locations, and the documents you uploaded. Your sign-in has been removed.`,
          "Records the law requires us to keep, such as payslips, PF, ESI and TDS records and letters we issued, stay for the period the law sets.",
          ...(note ? [note] : []),
        ],
      });
      await c.get("mailer").send({ to, subject, html, text });
    } catch (err) {
      console.error("erasure email failed", err);
    }
  }
  return summary;
}

privacyRoutes.post("/requests/:id/erase", v("json", eraseSchema), async (c) => {
  const [r] = await c.get("db").select().from(privacyRequests).where(and(eq(privacyRequests.id, c.req.param("id")), eq(privacyRequests.tenantId, tid(c))));
  if (!r) throw notFound("Request");
  if (r.status !== "pending") throw badRequest("This request has already been answered");
  const e = await loadEmployee(c, r.employeeId);
  return c.json({ summary: await erase(c, e, c.req.valid("json").note, r.id) });
});

privacyRoutes.post("/employees/:id/erase", v("json", eraseSchema), async (c) => {
  const e = await loadEmployee(c, c.req.param("id"));
  const db = c.get("db");
  const [open] = await db.select({ id: privacyRequests.id }).from(privacyRequests).where(and(eq(privacyRequests.employeeId, e.id), eq(privacyRequests.status, "pending")));
  return c.json({ summary: await erase(c, e, c.req.valid("json").note, open?.id ?? null) });
});

privacyRoutes.post("/requests/:id/reject", v("json", privacyDecisionSchema), async (c) => {
  const db = c.get("db");
  const s = c.get("session")!;
  const { note } = c.req.valid("json");
  const [r] = await db
    .update(privacyRequests)
    .set({ status: "rejected", decisionNote: note, decidedBy: s.userId, decidedByName: s.name, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(privacyRequests.id, c.req.param("id")), eq(privacyRequests.tenantId, tid(c)), eq(privacyRequests.status, "pending")))
    .returning();
  if (!r) throw notFound("Request");
  const e = await loadEmployee(c, r.employeeId);
  await audit(c, { action: "privacy.reject", entity: "employee", entityId: e.id, summary: `Declined ${e.fullName}'s data erasure request: ${note}` });
  try {
    const company = await companyName(c);
    const subject = "About your data erasure request";
    const { html, text } = layout({
      company,
      heading: subject,
      paragraphs: [`Hi ${e.firstName},`, "HR can't erase your personal data yet.", note, "You can ask again later, or contact the company's grievance officer if you disagree."],
      cta: { label: "Open your account", url: `${c.env.APP_URL}/account/security` },
    });
    await c.get("mailer").send({ to: e.workEmail, subject, html, text });
  } catch (err) {
    console.error("privacy reject email failed", err);
  }
  return c.json({ ok: true });
});
