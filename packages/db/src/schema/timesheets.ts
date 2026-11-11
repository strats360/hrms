import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

export const projects = pgTable(
  "projects",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    client: text("client"),
    billable: boolean("billable").notNull().default(true),
    status: text("status").notNull().default("active"), // active | archived
    ...timestamps,
  },
  (t) => [uniqueIndex("projects_code_uq").on(t.tenantId, t.code)],
);

/** One week (Monday to Sunday) for one person. */
export const timesheets = pgTable(
  "timesheets",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: text("status").notNull().default("draft"), // draft | submitted | approved | rejected
    totalMinutes: integer("total_minutes").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    ...timestamps,
  },
  (t) => [uniqueIndex("timesheets_emp_week_uq").on(t.employeeId, t.weekStart), index("timesheets_tenant_week_idx").on(t.tenantId, t.weekStart, t.status)],
);

export const timesheetEntries = pgTable(
  "timesheet_entries",
  {
    id: id(),
    tenantId: tenantId(),
    timesheetId: text("timesheet_id")
      .notNull()
      .references(() => timesheets.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note").notNull().default(""),
    billable: boolean("billable").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("timesheet_entries_sheet_idx").on(t.timesheetId), index("timesheet_entries_project_idx").on(t.tenantId, t.projectId, t.date)],
);
