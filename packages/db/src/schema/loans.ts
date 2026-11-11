import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/** Salary advances and employee loans, recovered from salary (see @hrms/shared loans). */
export const employeeLoans = pgTable(
  "employee_loans",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: text("type").notNull(), // advance | loan
    status: text("status").notNull(), // requested | approved | active | closed | rejected | cancelled | written_off
    amount: money("amount").notNull(),
    interestPct: numeric("interest_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    months: integer("months").notNull(),
    /** First month of recovery (YYYY-MM). */
    startMonth: text("start_month").notNull(),
    /** Months paused by HR; the schedule moves on past them. */
    skipMonths: jsonb("skip_months").$type<string[]>().notNull().default([]),
    reason: text("reason"),
    requestedBy: text("requested_by"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    paidOn: date("paid_on", { mode: "string" }),
    paidMethod: text("paid_method"),
    paidReference: text("paid_reference"),
    closedOn: date("closed_on", { mode: "string" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("employee_loans_code_uq").on(t.tenantId, t.code), index("employee_loans_emp_idx").on(t.employeeId)],
);

/** Repayments outside payroll: a lump sum paid back, or the balance taken in full and final. */
export const loanRepayments = pgTable(
  "loan_repayments",
  {
    id: id(),
    tenantId: tenantId(),
    loanId: text("loan_id")
      .notNull()
      .references(() => employeeLoans.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    source: text("source").notNull(), // manual | fnf | write_off
    note: text("note"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("loan_repayments_loan_idx").on(t.loanId)],
);
