import { Hono, type Context } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { employees, probationEvents, tenants } from "@hrms/db";
import { can, fmtDate, PROBATION_RECOMMENDATION_LABEL, probationConfirmSchema, probationEndDate, probationExtendSchema, probationReviewSchema, probationSettingsSchema, type ProbationRecommendation } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { teamScope } from "../services/scope";
import { onProbation, probationSettings } from "../services/probation";
import { sendNotification } from "../services/notifications";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const isHr = (c: Context<AppEnv>) => can(c.get("tenant").permissions, "employees", "edit") && can(c.get("tenant").permissions, "employees", "configure");

export const probationRoutes = new Hono<AppEnv>();

probationRoutes.get("/", requirePerm("employees", "view"), async (c) => {
  const scope = await teamScope(c, "employees");
  return c.json({ rows: await onProbation(c.get("db"), tid(c), scope), settings: await probationSettings(c.get("db"), tid(c)), canDecide: isHr(c) });
});

probationRoutes.put("/settings", requirePerm("employees", "configure"), v("json", probationSettingsSchema), async (c) => {
  const b = c.req.valid("json");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ probation: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "settings.probation", entity: "tenant", entityId: tid(c), summary: `Probation: ${b.defaultMonths} months by default, reminders ${b.reminderDays} days before it ends`, data: b });
  return c.json(b);
});

async function loadOnProbation(c: Context<AppEnv>, id: string) {
  const [e] = await c.get("db").select().from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  if (e.status !== "probation") throw badRequest(`${e.fullName} isn't on probation`);
  return e;
}

probationRoutes.get("/:employeeId/history", requirePerm("employees", "view"), async (c) => {
  const id = c.req.param("employeeId");
  const scope = await teamScope(c, "employees");
  if (scope && !scope.includes(id)) throw notFound("Employee");
  return c.json(await c.get("db").select().from(probationEvents).where(and(eq(probationEvents.employeeId, id), eq(probationEvents.tenantId, tid(c)))).orderBy(probationEvents.createdAt));
});

/** The manager (or HR) recommends what should happen. */
probationRoutes.post("/:employeeId/review", requirePerm("employees", "view"), v("json", probationReviewSchema), async (c) => {
  const e = await loadOnProbation(c, c.req.param("employeeId"));
  const t = c.get("tenant");
  if (!isHr(c) && e.managerId !== t.employeeId) throw forbidden("Only their manager or HR can review this");
  const b = c.req.valid("json");
  const s = c.get("session")!;
  await c.get("db").insert(probationEvents).values({ tenantId: tid(c), employeeId: e.id, kind: "review", recommendation: b.recommendation, note: b.note, byUserId: s.userId, byName: s.name });
  await audit(c, { action: "probation.review", entity: "employee", entityId: e.id, summary: `Recommended for ${e.fullName}: ${PROBATION_RECOMMENDATION_LABEL[b.recommendation as ProbationRecommendation]}` });
  return c.json({ ok: true }, 201);
});

async function tell(c: Context<AppEnv>, e: typeof employees.$inferSelect, subject: string, paragraphs: string[]) {
  try {
    const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: subject, paragraphs: [`Hi ${e.firstName},`, ...paragraphs], cta: { label: "Open self-service", url: `${c.env.APP_URL}/me/profile` } });
    await sendNotification(c, "probation_outcome", { to: e.workEmail, subject, html, text });
  } catch (err) {
    console.error("probation email failed", err);
  }
}

probationRoutes.post("/:employeeId/confirm", requirePerm("employees", "configure"), v("json", probationConfirmSchema), async (c) => {
  const e = await loadOnProbation(c, c.req.param("employeeId"));
  const b = c.req.valid("json");
  if (b.date < e.dateOfJoining) throw badRequest("The confirmation date can't be before they joined");
  const db = c.get("db");
  const s = c.get("session")!;
  await db.update(employees).set({ status: "active", confirmationDate: b.date }).where(eq(employees.id, e.id));
  await db.insert(probationEvents).values({ tenantId: tid(c), employeeId: e.id, kind: "confirmed", date: b.date, note: b.note ?? null, byUserId: s.userId, byName: s.name });
  await tell(c, e, "Your employment is confirmed", [`Congratulations. Your employment with us is confirmed from ${fmtDate(b.date)}, at the end of your probation.`, "HR may share a confirmation letter with you in self-service."]);
  await audit(c, { action: "probation.confirm", entity: "employee", entityId: e.id, summary: `Confirmed ${e.fullName} from ${fmtDate(b.date)}` });
  return c.json({ ok: true });
});

probationRoutes.post("/:employeeId/extend", requirePerm("employees", "configure"), v("json", probationExtendSchema), async (c) => {
  const e = await loadOnProbation(c, c.req.param("employeeId"));
  const b = c.req.valid("json");
  const settings = await probationSettings(c.get("db"), tid(c));
  const current = probationEndDate(e, settings.defaultMonths);
  if (b.until <= current) throw badRequest(`Pick a date after the current end of probation (${fmtDate(current)})`);
  const db = c.get("db");
  const s = c.get("session")!;
  // the confirmation date is the planned end of probation until they're confirmed
  await db.update(employees).set({ confirmationDate: b.until, probationRemindedFor: null }).where(eq(employees.id, e.id));
  await db.insert(probationEvents).values({ tenantId: tid(c), employeeId: e.id, kind: "extended", date: b.until, note: b.reason, byUserId: s.userId, byName: s.name });
  await tell(c, e, "Your probation has been extended", [`Your probation period has been extended until ${fmtDate(b.until)}.`, `Reason: ${b.reason}`, "Your manager will talk you through what's expected before then."]);
  await audit(c, { action: "probation.extend", entity: "employee", entityId: e.id, summary: `Extended ${e.fullName}'s probation from ${fmtDate(current)} to ${fmtDate(b.until)}: ${b.reason}` });
  return c.json({ ok: true, until: b.until });
});
