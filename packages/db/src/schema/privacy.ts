import { date, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
