import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { departments, designations, employees, performanceReviews, reviewCycles, reviewGoals } from "@hrms/db";
import {
  acknowledgeSchema,
  calibrateSchema,
  can,
  cycleSchema,
  fmtDate,
  goalProblem,
  goalsSchema,
  managerReviewSchema,
  ratingDistribution,
  ratingLabel,
  REVIEW_STAGE_LABEL,
  selfReviewSchema,
  weightedScore,
  type ReviewStage,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toXlsx, XLSX_MIME } from "../lib/xlsx";
import { eligibleEmployees, goalsOf, notifyMany, saveGoals, stageCounts, type Cycle, type Goal, type Review } from "../services/performance";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const isHr = (c: Context<AppEnv>) => can(c.get("tenant").permissions, "employees", "configure");
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId ?? null;

async function loadCycle(c: Context<AppEnv>, id: string) {
  const [cy] = await c.get("db").select().from(reviewCycles).where(and(eq(reviewCycles.id, id), eq(reviewCycles.tenantId, tid(c))));
  if (!cy) throw notFound("Review cycle");
  return cy;
}
async function loadReview(c: Context<AppEnv>, id: string) {
  const db = c.get("db");
  const [r] = await db.select().from(performanceReviews).where(and(eq(performanceReviews.id, id), eq(performanceReviews.tenantId, tid(c))));
  if (!r) throw notFound("Review");
  const cycle = await loadCycle(c, r.cycleId);
  return { r, cycle };
}
const activeOnly = (cy: Cycle) => {
  if (cy.status !== "active") throw badRequest(cy.status === "closed" ? "This cycle is closed" : "This cycle hasn't started yet");
};

function goalOut(g: Goal, showManager: boolean) {
  return { id: g.id, title: g.title, description: g.description, weight: g.weight, selfRating: g.selfRating, selfComment: g.selfComment, ...(showManager ? { managerRating: g.managerRating, managerComment: g.managerComment } : {}) };
}

async function people(c: Context<AppEnv>, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; code: string; email: string; first: string; department: string | null; designation: string | null }>();
  const rows = await c
    .get("db")
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, email: employees.workEmail, first: employees.firstName, department: departments.name, designation: designations.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(inArray(employees.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The full review, shaped for who's looking. */
async function reviewOut(c: Context<AppEnv>, r: Review, cycle: Cycle, as: "employee" | "reviewer") {
  const goals = await goalsOf(c.get("db"), r.id);
  const p = await people(c, [r.employeeId, ...(r.managerId ? [r.managerId] : [])]);
  const shared = r.stage === "shared" || r.stage === "acknowledged";
  const showManager = as === "reviewer" || shared;
  const showSelf = as === "employee" || r.stage !== "self";
  return {
    id: r.id,
    cycle: { id: cycle.id, name: cycle.name, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, selfDue: cycle.selfDue, managerDue: cycle.managerDue, status: cycle.status, competencies: cycle.competencies },
    employee: { id: r.employeeId, ...p.get(r.employeeId) },
    manager: r.managerId ? { id: r.managerId, name: p.get(r.managerId)?.name ?? "" } : null,
    stage: r.stage,
    goals: goals.map((g) => ({ ...goalOut(g, showManager), ...(showSelf ? {} : { selfRating: null, selfComment: null }) })),
    self: showSelf ? r.self : {},
    selfScore: showSelf ? r.selfScore : null,
    selfSubmittedAt: r.selfSubmittedAt,
    managerPart: showManager ? r.manager : {},
    managerScore: showManager ? r.managerScore : null,
    managerSubmittedAt: r.managerSubmittedAt,
    finalRating: as === "reviewer" || shared ? r.finalRating : null,
    finalLabel: as === "reviewer" || shared ? ratingLabel(r.finalRating) : "",
    calibrationNote: as === "reviewer" ? r.calibrationNote : null,
    employeeComment: r.employeeComment,
    sharedAt: r.sharedAt,
    acknowledgedAt: r.acknowledgedAt,
  };
}

/** Ratings from a self or manager form onto the goals. */
async function rateGoals(c: Context<AppEnv>, r: Review, by: "self" | "manager", rows: { id: string; rating: number | null; comment: string }[]) {
  const db = c.get("db");
  const goals = await goalsOf(db, r.id);
  for (const g of rows) {
    if (!goals.some((x) => x.id === g.id)) throw badRequest("That goal isn't part of this review");
    await db
      .update(reviewGoals)
      .set(by === "self" ? { selfRating: g.rating, selfComment: g.comment || null, updatedAt: new Date() } : { managerRating: g.rating, managerComment: g.comment || null, updatedAt: new Date() })
      .where(eq(reviewGoals.id, g.id));
  }
  return goalsOf(db, r.id);
}

function submitProblem(goals: Goal[], key: "selfRating" | "managerRating", competencies: string[], given: Record<string, number | null>) {
  const p = goalProblem(goals);
  if (p) return p;
  if (goals.some((g) => !g[key])) return "Rate every goal before you submit";
  if (competencies.some((k) => !given[k])) return "Rate every competency before you submit";
  return null;
}

/* ================= HR and managers ================= */

export const performanceRoutes = new Hono<AppEnv>();

performanceRoutes.get("/cycles", requirePerm("employees", "view"), async (c) => {
  const db = c.get("db");
  const hr = isHr(c);
  const rows = await db.select().from(reviewCycles).where(eq(reviewCycles.tenantId, tid(c))).orderBy(desc(reviewCycles.periodEnd), desc(reviewCycles.createdAt));
  // managers only see cycles their team is in
  let visible = rows.filter((r) => hr || r.status !== "draft");
  if (!hr) {
    const mine = await db.select({ cycleId: performanceReviews.cycleId }).from(performanceReviews).where(and(eq(performanceReviews.tenantId, tid(c)), eq(performanceReviews.managerId, me(c) ?? "")));
    const ids = new Set(mine.map((m) => m.cycleId));
    visible = visible.filter((r) => ids.has(r.id));
  }
  const counts = await stageCounts(db, visible.map((r) => r.id));
  return c.json({ rows: visible.map((r) => ({ ...r, counts: counts.get(r.id) ?? {} })), canManage: hr });
});

performanceRoutes.post("/cycles", requirePerm("employees", "configure"), v("json", cycleSchema), async (c) => {
  const b = c.req.valid("json");
  const [cy] = await c
    .get("db")
    .insert(reviewCycles)
    .values({ tenantId: tid(c), name: b.name, periodStart: b.periodStart, periodEnd: b.periodEnd, selfDue: b.selfDue, managerDue: b.managerDue, competencies: b.competencies, scope: { departmentIds: b.departmentIds, branchIds: b.branchIds, joinedBy: b.joinedBy }, createdBy: c.get("session")!.userId })
    .returning();
  await audit(c, { action: "performance.cycle_create", entity: "review_cycle", entityId: cy!.id, summary: `Set up review cycle ${b.name}` });
  return c.json(cy, 201);
});

performanceRoutes.put("/cycles/:id", requirePerm("employees", "configure"), v("json", cycleSchema), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  if (cy.status === "closed") throw badRequest("This cycle is closed");
  const b = c.req.valid("json");
  // once launched, only the name, due dates and competencies can change; the people are fixed
  const set =
    cy.status === "draft"
      ? { name: b.name, periodStart: b.periodStart, periodEnd: b.periodEnd, selfDue: b.selfDue, managerDue: b.managerDue, competencies: b.competencies, scope: { departmentIds: b.departmentIds, branchIds: b.branchIds, joinedBy: b.joinedBy } }
      : { name: b.name, selfDue: b.selfDue, managerDue: b.managerDue, competencies: b.competencies };
  const [out] = await c.get("db").update(reviewCycles).set({ ...set, updatedAt: new Date() }).where(eq(reviewCycles.id, cy.id)).returning();
  await audit(c, { action: "performance.cycle_update", entity: "review_cycle", entityId: cy.id, summary: `Updated review cycle ${b.name}` });
  return c.json(out);
});

performanceRoutes.delete("/cycles/:id", requirePerm("employees", "configure"), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  if (cy.status !== "draft") throw badRequest("Only a draft cycle can be deleted");
  await c.get("db").delete(reviewCycles).where(eq(reviewCycles.id, cy.id));
  await audit(c, { action: "performance.cycle_delete", entity: "review_cycle", entityId: cy.id, summary: `Deleted draft review cycle ${cy.name}` });
  return c.json({ ok: true });
});

performanceRoutes.get("/cycles/:id", requirePerm("employees", "view"), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  const db = c.get("db");
  const hr = isHr(c);
  if (!hr && cy.status === "draft") throw notFound("Review cycle");
  if (cy.status === "draft") {
    const list = await eligibleEmployees(db, tid(c), cy);
    const p = await people(c, list.map((e) => e.id));
    const noManager = list.filter((e) => !e.managerId).length;
    return c.json({ cycle: cy, canManage: hr, eligible: list.map((e) => ({ employeeId: e.id, ...p.get(e.id) })), noManager, rows: [], distribution: ratingDistribution([]) });
  }
  const mgr = alias(employees, "mgr");
  const rows = await db
    .select({ r: performanceReviews, name: employees.fullName, code: employees.employeeCode, departmentId: employees.departmentId, manager: mgr.fullName })
    .from(performanceReviews)
    .innerJoin(employees, eq(employees.id, performanceReviews.employeeId))
    .leftJoin(mgr, eq(mgr.id, performanceReviews.managerId))
    .where(and(eq(performanceReviews.cycleId, cy.id), hr ? undefined : eq(performanceReviews.managerId, me(c) ?? "")))
    .orderBy(asc(employees.fullName));
  const depts = new Map((await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.tenantId, tid(c)))).map((d) => [d.id, d.name]));
  return c.json({
    cycle: cy,
    canManage: hr,
    rows: rows.map(({ r, name, code, departmentId, manager }) => ({
      id: r.id,
      employeeId: r.employeeId,
      name,
      code,
      department: departmentId ? (depts.get(departmentId) ?? null) : null,
      manager,
      managerId: r.managerId,
      stage: r.stage,
      selfScore: r.stage === "self" ? null : r.selfScore,
      managerScore: r.managerScore,
      finalRating: r.finalRating,
      mine: r.employeeId === me(c),
    })),
    // calibration works off the final rating where HR has set one, else the manager's score
    distribution: ratingDistribution(rows.filter(({ r }) => r.employeeId !== me(c) || hr).map(({ r }) => r.finalRating ?? r.managerScore)),
  });
});

performanceRoutes.post("/cycles/:id/launch", requirePerm("employees", "configure"), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  if (cy.status !== "draft") throw badRequest("This cycle has already started");
  const db = c.get("db");
  const list = await eligibleEmployees(db, tid(c), cy);
  if (!list.length) throw badRequest("Nobody matches who this cycle is for");
  await db.insert(performanceReviews).values(list.map((e) => ({ tenantId: tid(c), cycleId: cy.id, employeeId: e.id, managerId: e.managerId })));
  await db.update(reviewCycles).set({ status: "active", launchedAt: new Date(), updatedAt: new Date() }).where(eq(reviewCycles.id, cy.id));
  const p = await people(c, list.map((e) => e.id));
  const emailed = await notifyMany(
    c,
    "review_updates",
    list.map((e) => ({
      to: p.get(e.id)!.email,
      subject: `${cy.name}: your self review is open`,
      heading: "Your self review is open",
      paragraphs: [`Hi ${p.get(e.id)!.first},`, `${cy.name} has started. It covers ${fmtDate(cy.periodStart)} to ${fmtDate(cy.periodEnd)}.`, `Add your goals for the period, rate how each went, and submit by ${fmtDate(cy.selfDue)}. Your manager reviews it next.`],
      cta: { label: "Start my review", url: `${c.env.APP_URL}/me/reviews` },
    })),
  );
  await audit(c, { action: "performance.launch", entity: "review_cycle", entityId: cy.id, summary: `Started ${cy.name} for ${list.length} people (${emailed} emailed)` });
  return c.json({ reviews: list.length, emailed });
});

performanceRoutes.post("/cycles/:id/remind", requirePerm("employees", "configure"), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  activeOnly(cy);
  const db = c.get("db");
  const open = await db.select().from(performanceReviews).where(and(eq(performanceReviews.cycleId, cy.id), inArray(performanceReviews.stage, ["self", "manager"])));
  const p = await people(c, open.flatMap((r) => [r.employeeId, ...(r.managerId ? [r.managerId] : [])]));
  const self = open.filter((r) => r.stage === "self");
  // one email per manager, listing everyone waiting on them
  const byManager = new Map<string, string[]>();
  for (const r of open.filter((r) => r.stage === "manager" && r.managerId)) byManager.set(r.managerId!, [...(byManager.get(r.managerId!) ?? []), p.get(r.employeeId)?.name ?? ""]);
  const a = await notifyMany(
    c,
    "review_updates",
    self.map((r) => ({
      to: p.get(r.employeeId)!.email,
      subject: `Reminder: your self review for ${cy.name}`,
      heading: "Your self review is waiting",
      paragraphs: [`Hi ${p.get(r.employeeId)!.first},`, `Please finish your self review for ${cy.name} by ${fmtDate(cy.selfDue)}.`],
      cta: { label: "Open my review", url: `${c.env.APP_URL}/me/reviews` },
    })),
  );
  const b = await notifyMany(
    c,
    "reviews_to_complete",
    [...byManager].filter(([id]) => p.get(id)).map(([id, names]) => ({
      to: p.get(id)!.email,
      subject: `Reminder: ${names.length} review${names.length === 1 ? "" : "s"} to complete`,
      heading: `${names.length} review${names.length === 1 ? "" : "s"} waiting for you`,
      paragraphs: [`Hi ${p.get(id)!.first},`, `These people on your team are waiting for your review in ${cy.name}: ${names.join(", ")}.`, `Please finish by ${fmtDate(cy.managerDue)}.`],
      cta: { label: "Open reviews", url: `${c.env.APP_URL}/performance/${cy.id}` },
    })),
  );
  await audit(c, { action: "performance.remind", entity: "review_cycle", entityId: cy.id, summary: `Sent review reminders for ${cy.name}: ${self.length} self, ${byManager.size} managers` });
  return c.json({ self: self.length, managers: byManager.size, emailed: a + b });
});

/** Share every calibrated review. The final rating defaults to the manager's score. */
performanceRoutes.post("/cycles/:id/share", requirePerm("employees", "configure"), v("json", z.object({ reviewIds: z.array(z.string()).optional() })), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  activeOnly(cy);
  const db = c.get("db");
  const { reviewIds } = c.req.valid("json");
  const ready = await db.select().from(performanceReviews).where(and(eq(performanceReviews.cycleId, cy.id), eq(performanceReviews.stage, "calibration"), reviewIds ? inArray(performanceReviews.id, reviewIds.length ? reviewIds : [""]) : undefined));
  if (!ready.length) throw badRequest("No reviews are ready to share. Managers finish their reviews first.");
  for (const r of ready) {
    await db
      .update(performanceReviews)
      .set({ stage: "shared", finalRating: r.finalRating ?? r.managerScore, sharedAt: new Date(), updatedAt: new Date() })
      .where(eq(performanceReviews.id, r.id));
  }
  const p = await people(c, ready.map((r) => r.employeeId));
  const emailed = await notifyMany(
    c,
    "review_updates",
    ready.map((r) => ({
      to: p.get(r.employeeId)!.email,
      subject: `${cy.name}: your review is ready`,
      heading: "Your review is ready",
      paragraphs: [`Hi ${p.get(r.employeeId)!.first},`, `Your manager's review for ${cy.name} has been shared with you. Read it, add a comment if you like, and acknowledge it.`],
      cta: { label: "Read my review", url: `${c.env.APP_URL}/me/reviews` },
    })),
  );
  await audit(c, { action: "performance.share", entity: "review_cycle", entityId: cy.id, summary: `Shared ${ready.length} reviews in ${cy.name}` });
  return c.json({ shared: ready.length, emailed });
});

performanceRoutes.post("/cycles/:id/close", requirePerm("employees", "configure"), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  activeOnly(cy);
  await c.get("db").update(reviewCycles).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(reviewCycles.id, cy.id));
  await audit(c, { action: "performance.close", entity: "review_cycle", entityId: cy.id, summary: `Closed ${cy.name}` });
  return c.json({ ok: true });
});

performanceRoutes.get("/cycles/:id/export.xlsx", requirePerm("employees", "configure"), async (c) => {
  const cy = await loadCycle(c, c.req.param("id"));
  const db = c.get("db");
  const reviews = await db.select().from(performanceReviews).where(eq(performanceReviews.cycleId, cy.id));
  const p = await people(c, reviews.flatMap((r) => [r.employeeId, ...(r.managerId ? [r.managerId] : [])]));
  const goals = reviews.length ? await db.select().from(reviewGoals).where(inArray(reviewGoals.reviewId, reviews.map((r) => r.id))).orderBy(asc(reviewGoals.sortOrder)) : [];
  const sorted = [...reviews].sort((a, b) => (p.get(a.employeeId)?.name ?? "").localeCompare(p.get(b.employeeId)?.name ?? ""));
  const file = toXlsx([
    {
      name: "Ratings",
      header: ["Employee ID", "Name", "Department", "Designation", "Manager", "Stage", "Self score", "Manager score", "Final rating", "Rating", ...cy.competencies.map((k) => `${k} (manager)`), "Strengths", "To improve", "Employee comment"],
      rows: sorted.map((r) => {
        const e = p.get(r.employeeId);
        return [e?.code, e?.name, e?.department, e?.designation, r.managerId ? p.get(r.managerId)?.name : "", REVIEW_STAGE_LABEL[r.stage as ReviewStage], r.selfScore, r.managerScore, r.finalRating, ratingLabel(r.finalRating), ...cy.competencies.map((k) => r.manager.competencies?.[k] ?? null), r.manager.strengths ?? "", r.manager.improvements ?? "", r.employeeComment ?? ""];
      }),
    },
    {
      name: "Goals",
      header: ["Employee ID", "Name", "Goal", "Weight %", "Self rating", "Manager rating", "Manager comment"],
      rows: goals.map((g) => {
        const r = reviews.find((x) => x.id === g.reviewId)!;
        const e = p.get(r.employeeId);
        return [e?.code, e?.name, g.title, g.weight, g.selfRating, g.managerRating, g.managerComment ?? ""];
      }),
    },
  ]);
  await audit(c, { action: "performance.export", entity: "review_cycle", entityId: cy.id, summary: `Exported ${cy.name} ratings` });
  return c.body(file as unknown as ArrayBuffer, 200, { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${cy.name.replace(/[^\w.-]+/g, "-")}.xlsx"` });
});

/** Can this person act as reviewer on this review? Their manager, or HR (but nobody on their own). */
function reviewer(c: Context<AppEnv>, r: Review) {
  if (r.employeeId === me(c)) return false;
  return isHr(c) || (!!me(c) && r.managerId === me(c));
}

performanceRoutes.get("/reviews/:id", requirePerm("employees", "view"), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  if (!reviewer(c, r)) throw notFound("Review");
  return c.json({ ...(await reviewOut(c, r, cycle, "reviewer")), canCalibrate: isHr(c) });
});

performanceRoutes.put("/reviews/:id/goals", requirePerm("employees", "view"), v("json", goalsSchema), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  if (!reviewer(c, r)) throw forbidden("Only their manager or HR can change these goals");
  activeOnly(cycle);
  if (r.stage !== "self" && r.stage !== "manager") throw badRequest("Goals can't change once the manager review is in");
  await saveGoals(c.get("db"), tid(c), r.id, c.req.valid("json").goals);
  return c.json(await reviewOut(c, r, cycle, "reviewer"));
});

performanceRoutes.put("/reviews/:id/manager", requirePerm("employees", "view"), v("json", managerReviewSchema), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  if (!reviewer(c, r)) throw forbidden("Only their manager or HR can review this");
  activeOnly(cycle);
  if (r.stage === "self") throw badRequest("Waiting for their self review. HR can move it on if they can't do one.");
  if (r.stage !== "manager") throw badRequest("The manager review is already in");
  const b = c.req.valid("json");
  const db = c.get("db");
  const goals = await rateGoals(c, r, "manager", b.goals);
  const part = { summary: b.summary, strengths: b.strengths, improvements: b.improvements, competencies: b.competencies };
  const score = weightedScore(goals, "manager");
  if (b.submit) {
    const problem = submitProblem(goals, "managerRating", cycle.competencies, b.competencies);
    if (problem) throw badRequest(problem);
    if (!b.summary.trim()) throw badRequest("Add an overall comment before you submit");
  }
  const [out] = await db
    .update(performanceReviews)
    .set({ manager: part, managerScore: score, ...(b.submit ? { stage: "calibration", managerSubmittedAt: new Date() } : {}), updatedAt: new Date() })
    .where(eq(performanceReviews.id, r.id))
    .returning();
  if (b.submit) {
    const p = await people(c, [r.employeeId]);
    await audit(c, { action: "performance.manager_submit", entity: "performance_review", entityId: r.id, summary: `Submitted the manager review for ${p.get(r.employeeId)?.name} in ${cycle.name}: ${score} (${ratingLabel(score)})` });
  }
  return c.json(await reviewOut(c, out!, cycle, "reviewer"));
});

/** HR moves a review on when the employee can't do a self review (long leave, new joiner). */
performanceRoutes.post("/reviews/:id/skip-self", requirePerm("employees", "configure"), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  activeOnly(cycle);
  if (r.stage !== "self") throw badRequest("The self review is already done");
  await c.get("db").update(performanceReviews).set({ stage: "manager", updatedAt: new Date() }).where(eq(performanceReviews.id, r.id));
  await audit(c, { action: "performance.skip_self", entity: "performance_review", entityId: r.id, summary: `Moved a review in ${cycle.name} to the manager without a self review` });
  return c.json({ ok: true });
});

/** HR sends a review back to the manager to change it. */
performanceRoutes.post("/reviews/:id/reopen", requirePerm("employees", "configure"), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  activeOnly(cycle);
  if (r.stage !== "calibration") throw badRequest("Only a review waiting for calibration can go back to the manager");
  await c.get("db").update(performanceReviews).set({ stage: "manager", managerSubmittedAt: null, updatedAt: new Date() }).where(eq(performanceReviews.id, r.id));
  await audit(c, { action: "performance.reopen", entity: "performance_review", entityId: r.id, summary: `Sent a review in ${cycle.name} back to the manager` });
  return c.json({ ok: true });
});

performanceRoutes.post("/reviews/:id/calibrate", requirePerm("employees", "configure"), v("json", calibrateSchema), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  activeOnly(cycle);
  if (r.employeeId === me(c)) throw forbidden("Someone else in HR needs to calibrate your own review");
  if (r.stage !== "calibration") throw badRequest(r.stage === "shared" || r.stage === "acknowledged" ? "This review is already shared" : "The manager review isn't in yet");
  const b = c.req.valid("json");
  if (r.managerScore != null && Math.abs(b.finalRating - r.managerScore) >= 0.05 && !b.note) throw badRequest("Say why the final rating differs from the manager's");
  await c.get("db").update(performanceReviews).set({ finalRating: b.finalRating, calibrationNote: b.note || null, calibratedBy: c.get("session")!.userId, updatedAt: new Date() }).where(eq(performanceReviews.id, r.id));
  await audit(c, { action: "performance.calibrate", entity: "performance_review", entityId: r.id, summary: `Final rating ${b.finalRating} (${ratingLabel(b.finalRating)}) in ${cycle.name}${b.note ? `: ${b.note}` : ""}` });
  return c.json({ ok: true });
});

performanceRoutes.patch("/reviews/:id/reviewer", requirePerm("employees", "configure"), v("json", z.object({ managerId: z.string() })), async (c) => {
  const { r, cycle } = await loadReview(c, c.req.param("id"));
  if (cycle.status === "closed") throw badRequest("This cycle is closed");
  const { managerId } = c.req.valid("json");
  if (managerId === r.employeeId) throw badRequest("Someone can't review themselves");
  const [m] = await c.get("db").select({ id: employees.id, name: employees.fullName }).from(employees).where(and(eq(employees.id, managerId), eq(employees.tenantId, tid(c))));
  if (!m) throw notFound("Employee");
  await c.get("db").update(performanceReviews).set({ managerId, updatedAt: new Date() }).where(eq(performanceReviews.id, r.id));
  await audit(c, { action: "performance.reviewer", entity: "performance_review", entityId: r.id, summary: `${m.name} now reviews this in ${cycle.name}` });
  return c.json({ ok: true });
});

/* ================= self-service ================= */

export const essPerformanceRoutes = new Hono<AppEnv>();
essPerformanceRoutes.use("*", requireEmployee);

async function mine(c: Context<AppEnv>, id: string) {
  const { r, cycle } = await loadReview(c, id);
  if (r.employeeId !== me(c)) throw notFound("Review");
  if (cycle.status === "draft") throw notFound("Review");
  return { r, cycle };
}

essPerformanceRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ r: performanceReviews, cycle: reviewCycles })
    .from(performanceReviews)
    .innerJoin(reviewCycles, eq(reviewCycles.id, performanceReviews.cycleId))
    .where(and(eq(performanceReviews.tenantId, tid(c)), eq(performanceReviews.employeeId, me(c)!)))
    .orderBy(desc(reviewCycles.periodEnd));
  return c.json(
    rows.map(({ r, cycle }) => {
      const shared = r.stage === "shared" || r.stage === "acknowledged";
      return { id: r.id, cycle: cycle.name, cycleStatus: cycle.status, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, selfDue: cycle.selfDue, stage: r.stage, finalRating: shared ? r.finalRating : null, finalLabel: shared ? ratingLabel(r.finalRating) : "" };
    }),
  );
});

essPerformanceRoutes.get("/:id", async (c) => {
  const { r, cycle } = await mine(c, c.req.param("id"));
  return c.json(await reviewOut(c, r, cycle, "employee"));
});

essPerformanceRoutes.put("/:id/goals", v("json", goalsSchema), async (c) => {
  const { r, cycle } = await mine(c, c.req.param("id"));
  activeOnly(cycle);
  if (r.stage !== "self") throw badRequest("Your self review is already submitted. Ask your manager to change goals.");
  await saveGoals(c.get("db"), tid(c), r.id, c.req.valid("json").goals);
  return c.json(await reviewOut(c, r, cycle, "employee"));
});

essPerformanceRoutes.put("/:id/self", v("json", selfReviewSchema), async (c) => {
  const { r, cycle } = await mine(c, c.req.param("id"));
  activeOnly(cycle);
  if (r.stage !== "self") throw badRequest("Your self review is already submitted");
  const b = c.req.valid("json");
  const db = c.get("db");
  const goals = await rateGoals(c, r, "self", b.goals);
  if (b.submit) {
    const problem = submitProblem(goals, "selfRating", cycle.competencies, b.competencies);
    if (problem) throw badRequest(problem);
  }
  const score = weightedScore(goals, "self");
  const [out] = await db
    .update(performanceReviews)
    .set({ self: { summary: b.summary, competencies: b.competencies }, selfScore: score, ...(b.submit ? { stage: "manager", selfSubmittedAt: new Date() } : {}), updatedAt: new Date() })
    .where(eq(performanceReviews.id, r.id))
    .returning();
  if (b.submit) {
    const p = await people(c, [r.employeeId, ...(r.managerId ? [r.managerId] : [])]);
    const e = p.get(r.employeeId)!;
    await audit(c, { action: "performance.self_submit", entity: "performance_review", entityId: r.id, summary: `${e.name} submitted their self review for ${cycle.name}` });
    const m = r.managerId ? p.get(r.managerId) : null;
    if (m)
      await notifyMany(c, "reviews_to_complete", [
        {
          to: m.email,
          subject: `Review ${e.name}: self review is in`,
          heading: `${e.name} has submitted their self review`,
          paragraphs: [`Hi ${m.first},`, `${e.name} has finished their self review for ${cycle.name}. Please add your review by ${fmtDate(cycle.managerDue)}.`],
          cta: { label: "Review now", url: `${c.env.APP_URL}/performance/reviews/${r.id}` },
        },
      ]);
  }
  return c.json(await reviewOut(c, out!, cycle, "employee"));
});

essPerformanceRoutes.post("/:id/acknowledge", v("json", acknowledgeSchema), async (c) => {
  const { r, cycle } = await mine(c, c.req.param("id"));
  if (r.stage !== "shared") throw badRequest(r.stage === "acknowledged" ? "You've already acknowledged this review" : "Your review hasn't been shared yet");
  const { comment } = c.req.valid("json");
  await c.get("db").update(performanceReviews).set({ stage: "acknowledged", acknowledgedAt: new Date(), employeeComment: comment || null, updatedAt: new Date() }).where(eq(performanceReviews.id, r.id));
  await audit(c, { action: "performance.acknowledge", entity: "performance_review", entityId: r.id, summary: `Acknowledged their review for ${cycle.name}` });
  return c.json({ ok: true });
});
