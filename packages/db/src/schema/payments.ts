import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, boolean, date } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { payrollRuns } from "./payroll";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/** Company debit accounts used for bulk payments. Account number encrypted at rest. */
export const companyBankAccounts = pgTable("company_bank_accounts", {
  id: id(),
  tenantId: tenantId(),
  label: text("label").notNull(), // "Payroll", "Operations"
  bankName: text("bank_name").notNull(),
  accountNumberEnc: text("account_number_enc").notNull(),
  accountLast4: text("account_last4").notNull(),
  ifsc: text("ifsc").notNull(),
  /** Bulk upload layout: hdfc_enet | icici_cib | generic_csv */
  fileFormat: text("file_format").notNull().default("generic_csv"),
  /** Corporate client / customer code some bank formats need. */
  clientCode: text("client_code"),
  isDefault: boolean("is_default").notNull().default(false),
  /** Balance as last entered by finance (we don't read it from the bank). */
  balance: money("balance"),
  balanceAsOf: date("balance_as_of", { mode: "string" }),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

/**
 * A batch of payments sent to the bank in one file.
 * Status: draft -> approved -> processing (file exported) -> completed; or cancelled.
 */
export const paymentBatches = pgTable(
  "payment_batches",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(), // PB-2611-S
    type: text("type").notNull(), // salary | reimbursement | bonus | other
    label: text("label").notNull(),
    payrollRunId: text("payroll_run_id").references(() => payrollRuns.id, { onDelete: "restrict" }),
    bankAccountId: text("bank_account_id").references(() => companyBankAccounts.id),
    fileFormat: text("file_format").notNull().default("generic_csv"),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    exportCount: integer("export_count").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("payment_batches_code_uq").on(t.tenantId, t.code), index("payment_batches_tenant_idx").on(t.tenantId, t.type, t.status)],
);

/**
 * One payment to one employee. The reference stays the same across retries so
 * the bank can reject a duplicate. Status: pending | paid | failed | held | cancelled.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    tenantId: tenantId(),
    batchId: text("batch_id")
      .notNull()
      .references(() => paymentBatches.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    reference: text("reference").notNull(), // SAL-NOV26-0001
    amount: money("amount").notNull(),
    description: text("description"),
    /** Bank details at the time the file was built (refreshed on retry). */
    beneficiaryName: text("beneficiary_name"),
    bankName: text("bank_name"),
    ifsc: text("ifsc"),
    accountLast4: text("account_last4"),
    status: text("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    utr: text("utr"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastExportedAt: timestamp("last_exported_at", { withTimezone: true }),
    note: text("note"),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payments_reference_uq").on(t.tenantId, t.reference),
    uniqueIndex("payments_batch_emp_uq").on(t.batchId, t.employeeId),
    index("payments_tenant_status_idx").on(t.tenantId, t.status),
    index("payments_emp_idx").on(t.tenantId, t.employeeId),
  ],
);
