import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** A POSH Internal Committee or a Grievance Redressal Committee. See shared committees.ts. */
export const committees = pgTable(
  "committees",
  {
    id: id(),
    tenantId: tenantId(),
    entityId: text("entity_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    constitutedOn: date("constituted_on", { mode: "string" }).notNull(),
    termEndsOn: date("term_ends_on", { mode: "string" }),
    members: jsonb("members").$type<{ employeeId?: string | null; name?: string | null; organisation?: string | null; role: string; gender: string; side?: string | null }[]>().notNull().default([]),
    workshops: jsonb("workshops").$type<{ date: string; title: string }[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("committees_tenant_idx").on(t.tenantId)],
);

/**
 * A complaint or grievance. Only the committee's members and the person who filed it can read it;
 * the description and notes are encrypted.
 */
export const committeeCases = pgTable(
  "committee_cases",
  {
    id: id(),
    tenantId: tenantId(),
    committeeId: text("committee_id")
      .notNull()
      .references(() => committees.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    complainantId: text("complainant_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    respondentId: text("respondent_id"),
    respondentName: text("respondent_name"),
    subject: text("subject").notNull(),
    descriptionEnc: text("description_enc").notNull(),
    incidentDate: date("incident_date", { mode: "string" }),
    filedOn: date("filed_on", { mode: "string" }).notNull(),
    status: text("status").notNull().default("received"),
    reportOn: date("report_on", { mode: "string" }),
    closedOn: date("closed_on", { mode: "string" }),
    outcomeEnc: text("outcome_enc"),
    ...timestamps,
  },
  (t) => [uniqueIndex("committee_cases_code_uq").on(t.tenantId, t.code), index("committee_cases_committee_idx").on(t.committeeId)],
);

/** The case's history: status changes and notes from the committee, in order. */
export const committeeCaseNotes = pgTable(
  "committee_case_notes",
  {
    id: id(),
    tenantId: tenantId(),
    caseId: text("case_id")
      .notNull()
      .references(() => committeeCases.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id"),
    authorName: text("author_name"),
    /** note, status or message (from the person who filed). */
    kind: text("kind").notNull().default("note"),
    status: text("status"),
    bodyEnc: text("body_enc"),
    /** Committee only, or shared with the person who filed. */
    visibleToComplainant: boolean("visible_to_complainant").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("committee_case_notes_case_idx").on(t.caseId)],
);
