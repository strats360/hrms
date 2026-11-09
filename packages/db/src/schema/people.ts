import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { id, timestamps } from "./_helpers";

export const employees = pgTable(
  "employees",
  {
    id: id(),
    tenantId: tenantId(),
    employeeCode: text("employee_code").notNull(),
    userId: text("user_id"),
    // personal
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    fullName: text("full_name").notNull(),
    workEmail: text("work_email").notNull(),
    personalEmail: text("personal_email"),
    phone: text("phone"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    bloodGroup: text("blood_group"),
    currentAddress: text("current_address"),
    permanentAddress: text("permanent_address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactRelation: text("emergency_contact_relation"),
    emergencyContactPhone: text("emergency_contact_phone"),
    photoKey: text("photo_key"),
    // employment
    dateOfJoining: date("date_of_joining", { mode: "string" }).notNull(),
    departmentId: text("department_id"),
    designationId: text("designation_id"),
    managerId: text("manager_id"),
    branchId: text("branch_id"),
    shiftId: text("shift_id"),
    /** The employee's enrolment number on biometric devices, if it isn't their employee ID. */
    biometricId: text("biometric_id"),
    employmentType: text("employment_type").notNull().default("full_time"),
    workLocation: text("work_location"),
    status: text("status").notNull().default("probation"),
    probationMonths: integer("probation_months").notNull().default(6),
    confirmationDate: date("confirmation_date", { mode: "string" }),
    resignationDate: date("resignation_date", { mode: "string" }),
    lastWorkingDay: date("last_working_day", { mode: "string" }),
    annualCtc: numeric("annual_ctc", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    // bank (account number encrypted at rest, last4 kept for display/search)
    accountHolderName: text("account_holder_name"),
    bankName: text("bank_name"),
    accountNumberEnc: text("account_number_enc"),
    accountLast4: text("account_last4"),
    ifsc: text("ifsc"),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    bankVerified: boolean("bank_verified").notNull().default(false),
    // statutory
    pan: text("pan"),
    aadhaarLast4: text("aadhaar_last4"),
    uan: text("uan"),
    esicIpNumber: text("esic_ip_number"),
    pfApplicable: boolean("pf_applicable").notNull().default(true),
    esiApplicable: boolean("esi_applicable").notNull().default(false),
    ptApplicable: boolean("pt_applicable").notNull().default(true),
    taxRegime: text("tax_regime").notNull().default("new"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("employees_tenant_code_uq").on(t.tenantId, t.employeeCode),
    uniqueIndex("employees_tenant_email_uq").on(t.tenantId, t.workEmail),
    index("employees_tenant_status_idx").on(t.tenantId, t.status),
    index("employees_tenant_manager_idx").on(t.tenantId, t.managerId),
    uniqueIndex("employees_tenant_biometric_uq").on(t.tenantId, t.biometricId),
  ],
);

export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    fileKey: text("file_key").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    status: text("status").notNull().default("pending"), // pending | verified | rejected
    uploadedBy: text("uploaded_by"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("employee_documents_emp_idx").on(t.tenantId, t.employeeId)],
);

/** Email-based self-onboarding for new joiners. */
export const onboardingInvites = pgTable(
  "onboarding_invites",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("invited"), // invited | opened | in_progress | submitted | verified | expired
    progress: integer("progress").notNull().default(0),
    completedSteps: text("completed_steps").array().notNull().default([]),
    draft: jsonb("draft").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("onboarding_token_uq").on(t.tokenHash), index("onboarding_tenant_idx").on(t.tenantId)],
);
