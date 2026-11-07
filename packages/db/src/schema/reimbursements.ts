import { bigint, boolean, date, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { payrollRuns } from "./payroll";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/** Expense category with its policy limit and approval chain. */
export const reimbursementCategories = pgTable(
  "reimbursement_categories",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    limitAmount: money("limit_amount"), // null = no limit ("per approval")
    limitPeriod: text("limit_period").notNull().default("claim"), // claim | day | month | trip | night | km
    ratePerKm: money("rate_per_km"), // for limitPeriod "km": amount = km x rate
    gstCapture: boolean("gst_capture").notNull().default(false),
    approval: text("approval").notNull().default("manager"), // manager | finance | manager_finance
    receiptRequiredAbove: money("receipt_required_above").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("reimb_cat_tenant_name_uq").on(t.tenantId, t.name)],
);

/**
 * A claim. Status flow: pending_manager -> pending_finance (when finance must sign off) ->
 * approved -> paid (with salary); or rejected / cancelled.
 */
export const reimbursementClaims = pgTable(
  "reimbursement_claims",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(), // RB-1001
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => reimbursementCategories.id),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    km: numeric("km", { precision: 8, scale: 1, mode: "number" }),
    vendor: text("vendor"),
    gstin: text("gstin"),
    gstAmount: money("gst_amount"),
    project: text("project"),
    description: text("description").notNull(),
    status: text("status").notNull().default("pending_finance"),
    overLimit: boolean("over_limit").notNull().default(false),
    managerApprovedBy: text("manager_approved_by"),
    managerApprovedAt: timestamp("manager_approved_at", { withTimezone: true }),
    financeApprovedBy: text("finance_approved_by"),
    financeApprovedAt: timestamp("finance_approved_at", { withTimezone: true }),
    rejectedBy: text("rejected_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    payrollRunId: text("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    /** Set when the claim is paid through a reimbursement payment batch instead of payroll. */
    paymentId: text("payment_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("reimb_claim_code_uq").on(t.tenantId, t.code),
    index("reimb_claim_tenant_status_idx").on(t.tenantId, t.status),
    index("reimb_claim_emp_idx").on(t.tenantId, t.employeeId),
  ],
);

export const claimReceipts = pgTable(
  "claim_receipts",
  {
    id: id(),
    tenantId: tenantId(),
    claimId: text("claim_id")
      .notNull()
      .references(() => reimbursementClaims.id, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    ...timestamps,
  },
  (t) => [index("claim_receipts_claim_idx").on(t.claimId)],
);

