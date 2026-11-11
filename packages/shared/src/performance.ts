import { z } from "zod";

/**
 * Performance reviews. HR runs a cycle; each person sets weighted goals and rates
 * themselves, their manager rates them, HR calibrates the final rating and shares it,
 * and the employee acknowledges.
 */
export const RATING_LABEL: Record<number, string> = { 1: "Needs improvement", 2: "Partly meets expectations", 3: "Meets expectations", 4: "Exceeds expectations", 5: "Outstanding" };
export const RATINGS = [1, 2, 3, 4, 5] as const;

export const CYCLE_STATUSES = ["draft", "active", "closed"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = { draft: "Draft", active: "In progress", closed: "Closed" };

export const REVIEW_STAGES = ["self", "manager", "calibration", "shared", "acknowledged"] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];
export const REVIEW_STAGE_LABEL: Record<ReviewStage, string> = {
  self: "Self review",
  manager: "Manager review",
  calibration: "HR calibration",
  shared: "Shared",
  acknowledged: "Acknowledged",
};

export const DEFAULT_COMPETENCIES = ["Quality of work", "Ownership", "Communication", "Teamwork"];
export const MAX_GOALS = 10;

export interface GoalRatings {
  weight: number;
  selfRating?: number | null;
  managerRating?: number | null;
}

/** Weighted average of goal ratings on the 1 to 5 scale, to one decimal. Null until every goal is rated. */
export function weightedScore(goals: GoalRatings[], by: "self" | "manager") {
  if (!goals.length) return null;
  const key = by === "self" ? "selfRating" : "managerRating";
  if (goals.some((g) => !g[key])) return null;
  const total = goals.reduce((a, g) => a + g.weight, 0);
  if (!total) return null;
  return Math.round((goals.reduce((a, g) => a + g.weight * (g[key] as number), 0) / total) * 10) / 10;
}

/** The label for a score: 3.4 is "Meets expectations", 3.5 rounds up to "Exceeds expectations". */
export const ratingLabel = (score: number | null | undefined) => (score == null ? "" : RATING_LABEL[Math.min(5, Math.max(1, Math.round(score)))]!);

/** What stops goals being submitted, or null. */
export function goalProblem(goals: { title: string; weight: number }[]) {
  if (!goals.length) return "Add at least one goal";
  if (goals.length > MAX_GOALS) return `Keep it to ${MAX_GOALS} goals or fewer`;
  if (goals.some((g) => !g.title.trim())) return "Every goal needs a title";
  if (goals.some((g) => g.weight <= 0)) return "Every goal needs a weight above 0";
  const sum = goals.reduce((a, g) => a + g.weight, 0);
  if (sum !== 100) return `Goal weights add up to ${sum}%. They need to add up to 100%`;
  return null;
}

/** How many reviews fall in each rating band (1 to 5), for the calibration view. */
export function ratingDistribution(scores: (number | null | undefined)[]) {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of scores) if (s != null) out[Math.min(5, Math.max(1, Math.round(s)))]!++;
  return out;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const rating = z.number().int().min(1).max(5);

export const cycleSchema = z
  .object({
    name: z.string().trim().min(3, "Give the cycle a name").max(80),
    periodStart: isoDate,
    periodEnd: isoDate,
    selfDue: isoDate,
    managerDue: isoDate,
    competencies: z.array(z.string().trim().min(2).max(60)).max(10),
    /** Who takes part: everyone current, or narrowed by department / branch. Joined on or before this date. */
    departmentIds: z.array(z.string()).default([]),
    branchIds: z.array(z.string()).default([]),
    joinedBy: isoDate.nullable().default(null),
  })
  .refine((c) => c.periodEnd > c.periodStart, { message: "The period must end after it starts", path: ["periodEnd"] })
  .refine((c) => c.managerDue >= c.selfDue, { message: "Manager reviews are due after self reviews", path: ["managerDue"] });

export const goalSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().max(200),
  description: z.string().trim().max(2000).default(""),
  weight: z.number().int().min(0).max(100),
});
export const goalsSchema = z.object({ goals: z.array(goalSchema).max(MAX_GOALS) });

export const selfReviewSchema = z.object({
  goals: z.array(z.object({ id: z.string(), rating: rating.nullable(), comment: z.string().trim().max(2000).default("") })),
  competencies: z.record(z.string(), rating.nullable()).default({}),
  summary: z.string().trim().max(4000).default(""),
  submit: z.boolean().default(false),
});
export const managerReviewSchema = selfReviewSchema.extend({
  strengths: z.string().trim().max(4000).default(""),
  improvements: z.string().trim().max(4000).default(""),
});
export const calibrateSchema = z.object({ finalRating: z.number().min(1).max(5).multipleOf(0.1), note: z.string().trim().max(1000).default("") });
export const acknowledgeSchema = z.object({ comment: z.string().trim().max(2000).default("") });
