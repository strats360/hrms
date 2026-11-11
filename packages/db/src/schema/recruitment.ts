import { bigint, boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

export const jobOpenings = pgTable(
  "job_openings",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(), // JOB-0007
    title: text("title").notNull(),
    departmentId: text("department_id"),
    designationId: text("designation_id"),
    branchId: text("branch_id"),
    location: text("location"),
    employmentType: text("employment_type").notNull().default("full_time"),
    openings: integer("openings").notNull().default(1),
    minExperience: numeric("min_experience", { precision: 4, scale: 1, mode: "number" }),
    maxExperience: numeric("max_experience", { precision: 4, scale: 1, mode: "number" }),
    minCtc: money("min_ctc"),
    maxCtc: money("max_ctc"),
    description: text("description").notNull().default(""),
    hiringManagerId: text("hiring_manager_id"),
    status: text("status").notNull().default("draft"), // draft | open | on_hold | closed
    published: boolean("published").notNull().default(false),
    createdBy: text("created_by"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("job_openings_code_uq").on(t.tenantId, t.code), index("job_openings_tenant_idx").on(t.tenantId, t.status)],
);

export const candidates = pgTable(
  "candidates",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    currentCompany: text("current_company"),
    currentTitle: text("current_title"),
    experienceYears: numeric("experience_years", { precision: 4, scale: 1, mode: "number" }),
    currentCtc: money("current_ctc"),
    expectedCtc: money("expected_ctc"),
    noticeDays: integer("notice_days"),
    location: text("location"),
    source: text("source").notNull().default("other"),
    referredById: text("referred_by_id"),
    notes: text("notes"),
    resumeKey: text("resume_key"),
    resumeName: text("resume_name"),
    resumeType: text("resume_type"),
    resumeSize: bigint("resume_size", { mode: "number" }),
    /** The employee record they became, once hired. */
    employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("candidates_email_uq").on(t.tenantId, t.email), index("candidates_tenant_idx").on(t.tenantId)],
);

/** A candidate in a job's pipeline. */
export const applications = pgTable(
  "applications",
  {
    id: id(),
    tenantId: tenantId(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobOpenings.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("applied"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    rejectReason: text("reject_reason"),
    offeredCtc: money("offered_ctc"),
    joiningDate: date("joining_date", { mode: "string" }),
    offerDesignationId: text("offer_designation_id"),
    /** Where a careers-page application came from, to slow down floods. */
    ip: text("ip"),
    ...timestamps,
  },
  (t) => [uniqueIndex("applications_job_candidate_uq").on(t.jobId, t.candidateId), index("applications_tenant_stage_idx").on(t.tenantId, t.stage), index("applications_candidate_idx").on(t.candidateId)],
);

/** Stage moves and notes, the application's history. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: id(),
    tenantId: tenantId(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // created | moved | note | interview | offer | hired
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    note: text("note"),
    byName: text("by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId)],
);

export const interviews = pgTable(
  "interviews",
  {
    id: id(),
    tenantId: tenantId(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    round: text("round").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(45),
    mode: text("mode").notNull().default("video"),
    location: text("location"),
    status: text("status").notNull().default("scheduled"), // scheduled | done | cancelled
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("interviews_app_idx").on(t.applicationId), index("interviews_tenant_time_idx").on(t.tenantId, t.scheduledAt)],
);

/** One row per interviewer; feedback fills in after the interview. */
export const interviewPanel = pgTable(
  "interview_panel",
  {
    id: id(),
    tenantId: tenantId(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    rating: integer("rating"),
    recommendation: text("recommendation"),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("interview_panel_uq").on(t.interviewId, t.employeeId), index("interview_panel_emp_idx").on(t.tenantId, t.employeeId)],
);
