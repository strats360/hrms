import { bigint, boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull().default("general"),
    audience: jsonb("audience").$type<{ departmentIds: string[]; branchIds: string[] }>().notNull().default({ departmentIds: [], branchIds: [] }),
    pinned: boolean("pinned").notNull().default(false),
    requireAck: boolean("require_ack").notNull().default(false),
    emailEveryone: boolean("email_everyone").notNull().default(true),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: date("expires_at", { mode: "string" }),
    /** Set once the emails have gone, so a scheduled post emails once. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    attachmentKey: text("attachment_key"),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type"),
    attachmentSize: bigint("attachment_size", { mode: "number" }),
    authorId: text("author_id"),
    authorName: text("author_name"),
    ...timestamps,
  },
  (t) => [index("announcements_tenant_idx").on(t.tenantId, t.status, t.publishAt)],
);

export const announcementReads = pgTable(
  "announcement_reads",
  {
    id: id(),
    tenantId: tenantId(),
    announcementId: text("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("announcement_reads_uq").on(t.announcementId, t.employeeId), index("announcement_reads_emp_idx").on(t.tenantId, t.employeeId)],
);
