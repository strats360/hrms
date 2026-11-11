import type { Context } from "hono";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { employees, performanceReviews, reviewCycles, reviewGoals, tenants, type Database } from "@hrms/db";
import type { NotificationKey } from "@hrms/shared";
import type { AppEnv } from "../env";
import { layout } from "../lib/email";
import { allowedRecipients } from "./notifications";

export type Cycle = typeof reviewCycles.$inferSelect;
export type Review = typeof performanceReviews.$inferSelect;
export type Goal = typeof reviewGoals.$inferSelect;

/** Who a cycle covers: current staff, narrowed by department / branch / joining date. */
export async function eligibleEmployees(db: Database, tenantId: string, cycle: Pick<Cycle, "scope" | "periodEnd">) {
  const s = cycle.scope;
  return db
    .select({ id: employees.id, managerId: employees.managerId, fullName: employees.fullName })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, tenantId),
        inArray(employees.status, ["probation", "active", "notice"]),
        lte(employees.dateOfJoining, s.joinedBy ?? cycle.periodEnd),
        s.departmentIds.length ? inArray(employees.departmentId, s.departmentIds) : undefined,
        s.branchIds.length ? inArray(employees.branchId, s.branchIds) : undefined,
      ),
    )
    .orderBy(asc(employees.fullName));
}

export const goalsOf = (db: Database, reviewId: string) => db.select().from(reviewGoals).where(eq(reviewGoals.reviewId, reviewId)).orderBy(asc(reviewGoals.sortOrder), asc(reviewGoals.createdAt));

/** Replace a review's goals with this list, keeping ratings on goals that stay. */
export async function saveGoals(db: Database, tenantId: string, reviewId: string, goals: { id?: string; title: string; description?: string; weight: number }[]) {
  const existing = await goalsOf(db, reviewId);
  const keep = new Set(goals.map((g) => g.id).filter(Boolean));
  const gone = existing.filter((g) => !keep.has(g.id)).map((g) => g.id);
  if (gone.length) await db.delete(reviewGoals).where(inArray(reviewGoals.id, gone));
  for (const [i, g] of goals.entries()) {
    const row = { title: g.title, description: g.description || null, weight: g.weight, sortOrder: i, updatedAt: new Date() };
    if (g.id && existing.some((x) => x.id === g.id)) await db.update(reviewGoals).set(row).where(eq(reviewGoals.id, g.id));
    else await db.insert(reviewGoals).values({ tenantId, reviewId, ...row });
  }
  return goalsOf(db, reviewId);
}

/** Send one email each, in small parallel batches, to the people who haven't turned this off. */
export async function notifyMany(c: Context<AppEnv>, key: NotificationKey | null, list: { to: string; subject: string; heading: string; paragraphs: string[]; cta: { label: string; url: string } }[]) {
  if (!list.length) return 0;
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid));
  const allowed = key ? await allowedRecipients(db, tid, key, list.map((m) => m.to)) : new Set(list.map((m) => m.to));
  const queue = list.filter((m) => allowed.has(m.to));
  let sent = 0;
  for (let i = 0; i < queue.length; i += 10) {
    await Promise.all(
      queue.slice(i, i + 10).map(async (m) => {
        try {
          const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: m.heading, paragraphs: m.paragraphs, cta: m.cta });
          await c.get("mailer").send({ to: m.to, subject: m.subject, html, text });
          sent++;
        } catch (e) {
          console.error("review email failed", e);
        }
      }),
    );
  }
  return sent;
}

/** Counts per stage for each cycle. */
export async function stageCounts(db: Database, cycleIds: string[]) {
  if (!cycleIds.length) return new Map<string, Record<string, number>>();
  const rows = await db
    .select({ cycleId: performanceReviews.cycleId, stage: performanceReviews.stage, n: sql<number>`count(*)::int` })
    .from(performanceReviews)
    .where(inArray(performanceReviews.cycleId, cycleIds))
    .groupBy(performanceReviews.cycleId, performanceReviews.stage);
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) out.set(r.cycleId, { ...(out.get(r.cycleId) ?? {}), [r.stage]: r.n });
  return out;
}

/** Reviews for one employee or a manager's team, for the self-service list. */
export function reviewsWhere(tenantId: string, opts: { employeeId?: string; managerId?: string }) {
  return and(eq(performanceReviews.tenantId, tenantId), or(opts.employeeId ? eq(performanceReviews.employeeId, opts.employeeId) : undefined, opts.managerId ? eq(performanceReviews.managerId, opts.managerId) : undefined));
}
