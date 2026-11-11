import { bigint, boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

export const helpdeskTickets = pgTable(
  "helpdesk_tickets",
  {
    id: id(),
    tenantId: tenantId(),
    number: text("number").notNull(), // HD-0001
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    categoryKey: text("category_key").notNull(),
    categoryLabel: text("category_label").notNull(),
    team: text("team").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    confidential: boolean("confidential").notNull().default(false),
    assigneeId: text("assignee_id").references(() => employees.id, { onDelete: "set null" }),
    responseDueAt: timestamp("response_due_at", { withTimezone: true }).notNull(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    rating: integer("rating"),
    ratingComment: text("rating_comment"),
    ...timestamps,
  },
  (t) => [uniqueIndex("helpdesk_number_uq").on(t.tenantId, t.number), index("helpdesk_tenant_status_idx").on(t.tenantId, t.status, t.team), index("helpdesk_emp_idx").on(t.tenantId, t.employeeId)],
);

export const helpdeskMessages = pgTable(
  "helpdesk_messages",
  {
    id: id(),
    tenantId: tenantId(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => helpdeskTickets.id, { onDelete: "cascade" }),
    authorId: text("author_id"),
    authorName: text("author_name").notNull(),
    fromTeam: boolean("from_team").notNull().default(false),
    /** A note for the team only. */
    internal: boolean("internal").notNull().default(false),
    body: text("body").notNull(),
    attachmentKey: text("attachment_key"),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type"),
    attachmentSize: bigint("attachment_size", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("helpdesk_messages_ticket_idx").on(t.ticketId)],
);
