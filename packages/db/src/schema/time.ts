import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
