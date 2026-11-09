import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ApprovalRecord } from "@hrms/shared";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

const employeeId = () =>
  text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" });

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: employeeId(),
    date: date("date", { mode: "string" }).notNull(),
    checkIn: timestamp("check_in", { withTimezone: true }),
    checkOut: timestamp("check_out", { withTimezone: true }),
    source: text("source").notNull().default("web"),
    status: text("status").notNull(),
    workMinutes: integer("work_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyMinutes: integer("early_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    ip: text("ip"),
    note: text("note"),
    isManual: boolean("is_manual").notNull().default(false),
    /** Punch checks that didn't pass (away from the office, not on its network). */
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    distanceM: integer("distance_m"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("attendance_emp_date_uq").on(t.tenantId, t.employeeId, t.date),
    index("attendance_tenant_date_idx").on(t.tenantId, t.date),
  ],
);

export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: employeeId(),
    date: date("date", { mode: "string" }).notNull(),
    issue: text("issue").notNull(),
    requestedCheckIn: text("requested_check_in"),
    requestedCheckOut: text("requested_check_out"),
    requestedStatus: text("requested_status"),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    reviewerUserId: text("reviewer_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    /** Approvals so far along the approval chain. */
    approvals: jsonb("approvals").$type<ApprovalRecord[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("corrections_tenant_status_idx").on(t.tenantId, t.status)],
);

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    tenantId: tenantId(),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("festival"),
    branchId: text("branch_id"), // null = all branches
    ...timestamps,
  },
  (t) => [index("holidays_tenant_date_idx").on(t.tenantId, t.date)],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isPaid: boolean("is_paid").notNull().default(true),
    annualQuota: numeric("annual_quota", { precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    accrual: text("accrual").notNull().default("yearly"),
    carryForwardMax: numeric("carry_forward_max", { precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    encashable: boolean("encashable").notNull().default(false),
    allowHalfDay: boolean("allow_half_day").notNull().default(true),
    allowNegative: boolean("allow_negative").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("leave_types_tenant_code_uq").on(t.tenantId, t.code)],
);

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: employeeId(),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    opening: numeric("opening", { precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    accrued: numeric("accrued", { precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    used: numeric("used", { precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    adjusted: numeric("adjusted", { precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("leave_balances_uq").on(t.tenantId, t.employeeId, t.leaveTypeId, t.year)],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(), // LV-2311
    employeeId: employeeId(),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    days: numeric("days", { precision: 5, scale: 1, mode: "number" }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    appliedByUserId: text("applied_by_user_id"),
    approverUserId: text("approver_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Approvals so far along the approval chain. */
    approvals: jsonb("approvals").$type<ApprovalRecord[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    index("leave_requests_tenant_status_idx").on(t.tenantId, t.status),
    index("leave_requests_emp_idx").on(t.tenantId, t.employeeId),
    uniqueIndex("leave_requests_code_uq").on(t.tenantId, t.code),
  ],
);

/**
 * Biometric or face-recognition terminals that push punches to the API. Each has its
 * own key (stored as a SHA-256 hash; shown once when created or rotated).
 */
export const attendanceDevices = pgTable(
  "attendance_devices",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    serialNumber: text("serial_number"),
    branchId: text("branch_id"),
    keyHash: text("key_hash").notNull(),
    keyHint: text("key_hint").notNull(), // last 4 characters, to tell keys apart
    active: boolean("active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastPunchAt: timestamp("last_punch_at", { withTimezone: true }),
    punchCount: integer("punch_count").notNull().default(0),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("attendance_devices_tenant_idx").on(t.tenantId)],
);

/** Raw punches from devices, kept so a day can be worked out again and audited. */
export const attendancePunches = pgTable(
  "attendance_punches",
  {
    id: id(),
    tenantId: tenantId(),
    deviceId: text("device_id").references(() => attendanceDevices.id, { onDelete: "set null" }),
    employeeId: employeeId(),
    punchedAt: timestamp("punched_at", { withTimezone: true }).notNull(),
    date: date("date", { mode: "string" }).notNull(), // IST date
    direction: text("direction"), // in | out, when the device says
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("attendance_punches_uq").on(t.tenantId, t.employeeId, t.punchedAt), index("attendance_punches_day_idx").on(t.tenantId, t.employeeId, t.date)],
);

/**
 * Leave turned into pay: on request while in service, or days above the carry-forward
 * limit at year end. Paid as a one-time earning in a payroll run.
 */
export const leaveEncashments = pgTable(
  "leave_encashments",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: employeeId(),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    days: numeric("days", { precision: 6, scale: 1, mode: "number" }).notNull(),
    perDay: numeric("per_day", { precision: 14, scale: 2, mode: "number" }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    reason: text("reason").notNull().default("request"), // request | year_end
    note: text("note"),
    status: text("status").notNull().default("pending"), // pending | in_payroll | cancelled
    runId: text("run_id"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [
    index("leave_encashments_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("leave_encashments_year_end_uq").on(t.employeeId, t.leaveTypeId, t.year).where(sql`reason = 'year_end'`),
  ],
);

/**
 * Comp off earned by working on a weekly off or holiday. Once approved it's credited to
 * the "CO" leave balance, and whatever's unused lapses on `expiresOn`.
 */
export const compOffRequests = pgTable(
  "comp_off_requests",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: employeeId(),
    workDate: date("work_date", { mode: "string" }).notNull(),
    /** weekly_off | holiday */
    dayType: text("day_type").notNull(),
    workMinutes: integer("work_minutes").notNull().default(0),
    days: numeric("days", { precision: 3, scale: 1, mode: "number" }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | cancelled | expired
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    expiresOn: date("expires_on", { mode: "string" }),
    lapsedDays: numeric("lapsed_days", { precision: 3, scale: 1, mode: "number" }).notNull().default(0),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("comp_off_emp_date_uq").on(t.employeeId, t.workDate).where(sql`status in ('pending', 'approved', 'expired')`),
    index("comp_off_tenant_status_idx").on(t.tenantId, t.status),
  ],
);
