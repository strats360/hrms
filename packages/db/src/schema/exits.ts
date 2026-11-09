import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { payments } from "./payments";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

export interface ClearanceItem {
  key: string;
  label: string;
  done: boolean;
  doneBy?: string | null;
  doneAt?: string | null;
  note?: string | null;
}

/**
 * An employee's exit: resignation or termination, notice period, clearance and the
 * full and final settlement. One open exit per employee.
 */
export const employeeExits = pgTable(
  "employee_exits",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(), // EX-0001
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    type: text("type").notNull(), // resignation | termination | retirement | contract_end | death | absconding
    status: text("status").notNull().default("notice"), // requested | notice | settlement | approved | settled | cancelled
    /** The employee's status before the exit, restored if it's withdrawn. */
    previousStatus: text("previous_status"),
    reason: text("reason"),
    resignationDate: date("resignation_date", { mode: "string" }).notNull(),
    lastWorkingDay: date("last_working_day", { mode: "string" }).notNull(),
    noticeDays: integer("notice_days").notNull().default(30),
    noticeWaived: boolean("notice_waived").notNull().default(false),
    payInLieu: boolean("pay_in_lieu").notNull().default(false),
    clearance: jsonb("clearance").$type<ClearanceItem[]>().notNull().default([]),
    /** Settlement inputs HR controls, and the computed statement once drafted. */
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    settlement: jsonb("settlement").$type<Record<string, unknown> | null>(),
    netAmount: money("net_amount"),
    preparedBy: text("prepared_by"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paymentId: text("payment_id").references(() => payments.id, { onDelete: "set null" }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledOn: date("settled_on", { mode: "string" }),
    settlementMethod: text("settlement_method"),
    settlementReference: text("settlement_reference"),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("employee_exits_code_uq").on(t.tenantId, t.code),
    uniqueIndex("employee_exits_open_uq").on(t.employeeId).where(sql`status not in ('settled', 'cancelled')`),
    index("employee_exits_tenant_status_idx").on(t.tenantId, t.status),
  ],
);
