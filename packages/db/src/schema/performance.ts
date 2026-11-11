import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** A review cycle, e.g. "Annual review 2026-27". */
export const reviewCycles = pgTable(
  "review_cycles",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    selfDue: date("self_due", { mode: "string" }).notNull(),
    managerDue: date("manager_due", { mode: "string" }).notNull(),
    status: text("status").notNull().default("draft"), // draft | active | closed
    competencies: jsonb("competencies").$type<string[]>().notNull().default([]),
    /** Who takes part, as chosen when the cycle was set up. */
    scope: jsonb("scope").$type<{ departmentIds: string[]; branchIds: string[]; joinedBy: string | null }>().notNull().default({ departmentIds: [], branchIds: [], joinedBy: null }),
    createdBy: text("created_by"),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("review_cycles_tenant_idx").on(t.tenantId, t.status)],
);

export interface ReviewPart {
  summary?: string;
  strengths?: string;
  improvements?: string;
  competencies?: Record<string, number | null>;
}

/** One person's review in a cycle. */
export const performanceReviews = pgTable(
  "performance_reviews",
  {
    id: id(),
    tenantId: tenantId(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => reviewCycles.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** The reviewing manager, fixed when the cycle launched (HR can change it). */
    managerId: text("manager_id"),
    stage: text("stage").notNull().default("self"), // self | manager | calibration | shared | acknowledged
    self: jsonb("self").$type<ReviewPart>().notNull().default({}),
    manager: jsonb("manager").$type<ReviewPart>().notNull().default({}),
    selfScore: numeric("self_score", { precision: 3, scale: 1, mode: "number" }),
    managerScore: numeric("manager_score", { precision: 3, scale: 1, mode: "number" }),
    finalRating: numeric("final_rating", { precision: 3, scale: 1, mode: "number" }),
    calibrationNote: text("calibration_note"),
    calibratedBy: text("calibrated_by"),
    employeeComment: text("employee_comment"),
    selfSubmittedAt: timestamp("self_submitted_at", { withTimezone: true }),
    managerSubmittedAt: timestamp("manager_submitted_at", { withTimezone: true }),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("performance_reviews_cycle_emp_uq").on(t.cycleId, t.employeeId), index("performance_reviews_emp_idx").on(t.tenantId, t.employeeId), index("performance_reviews_mgr_idx").on(t.tenantId, t.managerId)],
);

/** Weighted goals inside a review, each rated by the employee and the manager. */
export const reviewGoals = pgTable(
  "review_goals",
  {
    id: id(),
    tenantId: tenantId(),
    reviewId: text("review_id")
      .notNull()
      .references(() => performanceReviews.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    weight: integer("weight").notNull(),
    selfRating: integer("self_rating"),
    selfComment: text("self_comment"),
    managerRating: integer("manager_rating"),
    managerComment: text("manager_comment"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("review_goals_review_idx").on(t.reviewId)],
);
