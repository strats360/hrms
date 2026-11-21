import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** Requests under the DPDP Act: an employee asking for erasure, or HR erasing after exit. */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("erasure"),
    /** employee: they asked. hr: HR erased without a request, after the person left. */
    source: text("source").notNull().default("employee"),
    status: text("status").notNull().default("pending"), // pending | completed | rejected | cancelled
    reason: text("reason"),
    dueDate: date("due_date", { mode: "string" }),
    decisionNote: text("decision_note"),
    decidedBy: text("decided_by"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** What was removed, counted, for the record. */
    summary: jsonb("summary").$type<Record<string, number>>(),
    ...timestamps,
  },
  (t) => [index("privacy_requests_tenant_idx").on(t.tenantId, t.status), index("privacy_requests_emp_idx").on(t.employeeId)],
);

/** Each published version of the company's privacy notice. */
export const privacyNotices = pgTable(
  "privacy_notices",
  {
    id: id(),
    tenantId: tenantId(),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("privacy_notices_version_uq").on(t.tenantId, t.version)],
);

/**
 * The consent log: every acknowledgement of a notice and every consent given or withdrawn, never
 * edited. The latest row for a purpose is the current state.
 */
export const privacyConsents = pgTable(
  "privacy_consents",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** notice (an acknowledgement) or a consent purpose. */
    purpose: text("purpose").notNull(),
    granted: boolean("granted").notNull(),
    noticeVersion: integer("notice_version"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("privacy_consents_emp_idx").on(t.employeeId, t.purpose, t.at)],
);

/** Personal data breaches and what was done about them (DPDP Rules 2025, rule 7). */
export const dataBreaches = pgTable(
  "data_breaches",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
    description: text("description").notNull(),
    dataAffected: text("data_affected").notNull().default(""),
    affectedCount: integer("affected_count").notNull().default(0),
    status: text("status").notNull().default("open"),
    boardIntimatedAt: timestamp("board_intimated_at", { withTimezone: true }),
    boardReportAt: timestamp("board_report_at", { withTimezone: true }),
    peopleNotifiedAt: timestamp("people_notified_at", { withTimezone: true }),
    actions: text("actions").notNull().default(""),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("data_breaches_code_uq").on(t.tenantId, t.code)],
);
