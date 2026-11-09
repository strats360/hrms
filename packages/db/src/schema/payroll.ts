import { boolean, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { MonthlyComponents, PayLine } from "@hrms/shared";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/** Effective-dated salary per employee. Without a row, the template + employees.annual_ctc is used. */
export const salaryStructures = pgTable(
  "salary_structures",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    annualCtc: money("annual_ctc").notNull(),
    /** Custom monthly components; null means "derive from the template". */
    components: jsonb("components").$type<MonthlyComponents | null>(),
    reason: text("reason"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("salary_structures_emp_date_uq").on(t.tenantId, t.employeeId, t.effectiveFrom)],
);

export interface RunTotals {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  ctc: number;
  tds: number;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  lwf: number;
  onHold: number;
  reimbursement?: number;
  lopDays: number;
  withLop: number;
}

/** One payroll run per tenant per month. draft -> calculated -> approved (locked) -> paid. */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: id(),
    tenantId: tenantId(),
    month: text("month").notNull(), // YYYY-MM
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    payDate: date("pay_date", { mode: "string" }),
    status: text("status").notNull().default("draft"),
    totals: jsonb("totals").$type<RunTotals | null>(),
    preparedBy: text("prepared_by"),
    calculatedBy: text("calculated_by"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: text("paid_by"),
    paymentReference: text("payment_reference"),
    bankFileExportedAt: timestamp("bank_file_exported_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_runs_tenant_month_uq").on(t.tenantId, t.month)],
);

export interface ItemSnapshot {
  name: string;
  code: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  state: string | null;
  dateOfJoining: string;
  lastWorkingDay: string | null;
  pan: string | null;
  uan: string | null;
  esicIpNumber: string | null;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  regime: string;
  annualCtc: number;
}

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: id(),
    tenantId: tenantId(),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    snapshot: jsonb("snapshot").$type<ItemSnapshot>().notNull(),
    daysInMonth: numeric("days_in_month", { precision: 5, scale: 1, mode: "number" }).notNull(),
    paidDays: numeric("paid_days", { precision: 5, scale: 1, mode: "number" }).notNull(),
    lopDays: numeric("lop_days", { precision: 5, scale: 1, mode: "number" }).notNull().default(0),
    lopOverride: numeric("lop_override", { precision: 5, scale: 1, mode: "number" }),
    earnings: jsonb("earnings").$type<PayLine[]>().notNull().default([]),
    deductions: jsonb("deductions").$type<PayLine[]>().notNull().default([]),
    employer: jsonb("employer").$type<PayLine[]>().notNull().default([]),
    gross: money("gross").notNull().default(0),
    totalDeductions: money("total_deductions").notNull().default(0),
    net: money("net").notNull().default(0),
    employerCost: money("employer_cost").notNull().default(0),
    tds: money("tds").notNull().default(0),
    reimbursement: money("reimbursement").notNull().default(0),
    taxableGross: money("taxable_gross").notNull().default(0),
    employeePf: money("employee_pf").notNull().default(0),
    professionalTax: money("professional_tax").notNull().default(0),
    tax: jsonb("tax").$type<Record<string, unknown>>(),
    onHold: boolean("on_hold").notNull().default(false),
    /** When the payslip was emailed to the employee. */
    payslipEmailedAt: timestamp("payslip_emailed_at", { withTimezone: true }),
    holdReason: text("hold_reason"),
    warnings: text("warnings").array().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_items_run_emp_uq").on(t.runId, t.employeeId), index("payroll_items_tenant_emp_idx").on(t.tenantId, t.employeeId)],
);

/** One-time earnings/deductions for a run: incentives, arrears, recoveries. */
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: id(),
    tenantId: tenantId(),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // earning | deduction
    label: text("label").notNull(),
    amount: money("amount").notNull(),
    taxable: boolean("taxable").notNull().default(true),
    esiWage: boolean("esi_wage").notNull().default(true),
    /** manual | overtime | encashment. Overtime and encashment lines are managed by those screens. */
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("payroll_adj_run_idx").on(t.runId)],
);
