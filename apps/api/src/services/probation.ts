import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createDb, departments, designations, employees, memberships, probationEvents, roles, tenants, user, type Database } from "@hrms/db";
import { daysUntil, DEFAULT_PROBATION, fmtDate, probationEndDate, todayIST, type ProbationSettings } from "@hrms/shared";
import type { Env } from "../env";
import { mailerFor } from "../lib/context";
import { layout } from "../lib/email";
import { allowedRecipients } from "./notifications";

export async function probationSettings(db: Database, tenantId: string): Promise<ProbationSettings> {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...DEFAULT_PROBATION, ...((t?.s as { probation?: Partial<ProbationSettings> } | null)?.probation ?? {}) };
}

/** Everyone on probation (optionally only some employees), with their end date and latest review. */
export async function onProbation(db: Database, tenantId: string, only?: string[] | null) {
  if (only && !only.length) return [];
  const settings = await probationSettings(db, tenantId);
  const mgr = alias(employees, "mgr");
  const rows = await db
    .select({ e: employees, department: departments.name, designation: designations.name, manager: mgr.fullName, managerId: mgr.id })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .where(and(eq(employees.tenantId, tenantId), eq(employees.status, "probation"), ...(only ? [inArray(employees.id, only)] : [])));
  const events = rows.length ? await db.select().from(probationEvents).where(inArray(probationEvents.employeeId, rows.map((r) => r.e.id))).orderBy(probationEvents.createdAt) : [];
  const today = todayIST();
  return rows
    .map((r) => {
      const mine = events.filter((x) => x.employeeId === r.e.id);
      const review = [...mine].reverse().find((x) => x.kind === "review");
      const endDate = probationEndDate(r.e, settings.defaultMonths);
      return {
        employeeId: r.e.id,
        name: r.e.fullName,
        code: r.e.employeeCode,
        department: r.department,
        designation: r.designation,
        manager: r.manager,
        managerId: r.managerId,
        dateOfJoining: r.e.dateOfJoining,
        endDate,
        daysLeft: daysUntil(endDate, today),
        due: daysUntil(endDate, today) <= settings.reminderDays,
        extensions: mine.filter((x) => x.kind === "extended").length,
        review: review ? { recommendation: review.recommendation, note: review.note, by: review.byName, at: review.createdAt } : null,
      };
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

/**
 * Daily: email the manager and HR once when someone's probation is about to end (or has
 * ended without a decision). Re-arms automatically when probation is extended.
 */
export async function probationReminders(db: Database, env: Env, today = todayIST()) {
  const ts = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.status, ["active", "trial", "past_due"]));
  const mailer = mailerFor(env);
  let sent = 0;
  for (const t of ts) {
    const list = (await onProbation(db, t.id)).filter((p) => p.due);
    if (!list.length) continue;
    const already = await db.select({ id: employees.id, at: employees.probationRemindedFor }).from(employees).where(inArray(employees.id, list.map((p) => p.employeeId)));
    const remindedFor = new Map(already.map((r) => [r.id, r.at]));
    const todo = list.filter((p) => remindedFor.get(p.employeeId) !== p.endDate);
    if (!todo.length) continue;
    const hr = await db
      .select({ email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, t.id), eq(memberships.status, "active"), inArray(roles.key, ["super_admin", "hr_admin"])));
    const managerEmails = new Map((await db.select({ id: employees.id, email: employees.workEmail }).from(employees).where(inArray(employees.id, todo.map((p) => p.managerId).filter(Boolean) as string[]))).map((m) => [m.id, m.email]));
    for (const p of todo) {
      const to = [...new Set([...(p.managerId && managerEmails.get(p.managerId) ? [managerEmails.get(p.managerId)!] : []), ...hr.map((h) => h.email)])];
      const allowed = await allowedRecipients(db, t.id, "probation_due", to);
      const when = p.daysLeft < 0 ? `ended on ${fmtDate(p.endDate)}, ${-p.daysLeft} day${p.daysLeft === -1 ? "" : "s"} ago` : p.daysLeft === 0 ? "ends today" : `ends on ${fmtDate(p.endDate)}, in ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}`;
      const { html, text } = layout({
        company: t.name,
        heading: `Probation review: ${p.name}`,
        paragraphs: [`${p.name} (${p.code}${p.designation ? `, ${p.designation}` : ""}) joined on ${fmtDate(p.dateOfJoining)}. Their probation ${when}.`, p.review ? `${p.review.by} has recommended: ${p.review.recommendation?.replace("_", " ")}.` : "Their manager hasn't given a recommendation yet.", "Review it and confirm or extend their probation under Employees › Probation."],
        cta: { label: "Review probation", url: `${env.APP_URL}/employees/probation` },
      });
      for (const addr of allowed) {
        await mailer.send({ to: addr, subject: `Probation review: ${p.name}`, html, text }).catch((e) => console.error("probation reminder failed", e));
        sent++;
      }
      await db.update(employees).set({ probationRemindedFor: p.endDate }).where(eq(employees.id, p.employeeId));
    }
  }
  return { sent };
}

export async function runProbationReminders(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return { sent: 0 };
  const db = createDb(url, { max: 2 });
  try {
    return await probationReminders(db, env);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
