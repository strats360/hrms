import { date, index, pgTable, text } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** Probation history: manager reviews, and HR's confirmations and extensions. */
export const probationEvents = pgTable(
  "probation_events",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // review | confirmed | extended
    recommendation: text("recommendation"), // confirm | extend | not_confirm (reviews)
    note: text("note"),
    /** Confirmed: the confirmation date. Extended: the new end of probation. */
    date: date("date", { mode: "string" }),
    byUserId: text("by_user_id"),
    byName: text("by_name"),
    ...timestamps,
  },
  (t) => [index("probation_events_emp_idx").on(t.employeeId)],
);
