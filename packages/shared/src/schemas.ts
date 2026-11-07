import { z } from "zod";
import {
  ATTENDANCE_STATUSES,
  DOCUMENT_TYPES,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  GENDERS,
  PAYMENT_METHODS,
  TAX_REGIMES,
} from "./constants";

// ---------- primitives ----------
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable();
const trimmed = (max = 200) => z.string().trim().max(max);

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F");
export const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must look like HDFC0001234");
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN");
export const tanSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{4}\d{5}[A-Z]$/, "Invalid TAN");
export const uanSchema = z.string().trim().regex(/^\d{12}$/, "UAN is 12 digits");
export const aadhaarLast4Schema = z.string().trim().regex(/^\d{4}$/, "Enter the last 4 digits only");
export const accountNumberSchema = z.string().trim().regex(/^\d{9,18}$/, "Account number is 9 to 18 digits");
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{10,16}$/, "Enter a valid phone number");

/** Empty strings from forms become null. */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
export const nullable = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blankToNull, s.nullable().optional());

// ---------- employees ----------
export const employeePersonalSchema = z.object({
  firstName: trimmed(80).min(1, "First name is required"),
  lastName: nullable(trimmed(80)),
  workEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  personalEmail: nullable(z.string().trim().toLowerCase().email()),
  phone: nullable(phoneSchema),
  dateOfBirth: nullable(isoDate),
  gender: nullable(z.enum(GENDERS)),
  maritalStatus: nullable(trimmed(30)),
  bloodGroup: nullable(trimmed(5)),
  currentAddress: nullable(trimmed(500)),
  permanentAddress: nullable(trimmed(500)),
  emergencyContactName: nullable(trimmed(120)),
  emergencyContactRelation: nullable(trimmed(40)),
  emergencyContactPhone: nullable(phoneSchema),
});

export const employeeEmploymentSchema = z.object({
  employeeCode: nullable(trimmed(30)),
  dateOfJoining: isoDate,
  departmentId: nullable(z.string()),
  designationId: nullable(z.string()),
  managerId: nullable(z.string()),
  branchId: nullable(z.string()),
  shiftId: nullable(z.string()),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  workLocation: nullable(trimmed(120)),
  status: z.enum(EMPLOYEE_STATUSES).default("probation"),
  probationMonths: z.coerce.number().int().min(0).max(24).default(6),
  confirmationDate: nullable(isoDate),
  resignationDate: nullable(isoDate),
  lastWorkingDay: nullable(isoDate),
  annualCtc: z.coerce.number().min(0).max(1e9).default(0),
});

export const employeeBankSchema = z.object({
  accountHolderName: nullable(trimmed(120)),
  bankName: nullable(trimmed(120)),
  accountNumber: nullable(accountNumberSchema),
  ifsc: nullable(ifscSchema),
  paymentMethod: z.enum(PAYMENT_METHODS).default("bank_transfer"),
});

export const employeeStatutorySchema = z.object({
  pan: nullable(panSchema),
  aadhaarLast4: nullable(aadhaarLast4Schema),
  uan: nullable(uanSchema),
  esicIpNumber: nullable(z.string().trim().regex(/^\d{10}$/, "ESIC IP number is 10 digits")),
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(false),
  ptApplicable: z.boolean().default(true),
  taxRegime: z.enum(TAX_REGIMES).default("new"),
});

export const employeeCreateSchema = employeePersonalSchema
  .merge(employeeEmploymentSchema)
  .merge(employeeBankSchema.partial())
  .merge(employeeStatutorySchema.partial())
  .extend({ sendInvite: z.boolean().default(true) });
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = employeePersonalSchema
  .merge(employeeEmploymentSchema)
  .merge(employeeBankSchema)
  .merge(employeeStatutorySchema)
  .partial();
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const employeeListQuery = z.object({
  q: z.string().optional(),
  departmentId: z.string().optional(),
  branchId: z.string().optional(),
  status: z.string().optional(), // comma separated
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(["name", "code", "doj", "ctc", "department", "status"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const documentUploadMeta = z.object({
  type: z.enum(DOCUMENT_TYPES),
  name: trimmed(200).optional(),
});

// ---------- org ----------
export const tenantProfileSchema = z.object({
  name: trimmed(160).min(2),
  legalName: trimmed(200).min(2),
  entityType: nullable(trimmed(60)),
  industry: nullable(trimmed(80)),
  gstin: nullable(gstinSchema),
  pan: nullable(panSchema),
  tan: nullable(tanSchema),
  llpinCin: nullable(trimmed(30)),
  registeredAddress: nullable(trimmed(500)),
  state: nullable(trimmed(60)),
  contactEmail: nullable(z.string().email()),
  contactPhone: nullable(phoneSchema),
});

export const tenantPayrollSettingsSchema = z.object({
  payrollCycle: z.enum(["calendar_month", "26_to_25"]).default("calendar_month"),
  payDay: z.enum(["last_working_day", "1st_next", "7th_next"]).default("last_working_day"),
  paidDaysBasis: z.enum(["calendar", "fixed_26", "working"]).default("calendar"),
  financialYearStartMonth: z.number().int().min(1).max(12).default(4),
  weeklyOffs: z.array(z.number().int().min(0).max(6)).default([0, 6]),
  salaryTemplate: z
    .object({
      basicPctOfGross: z.number().min(20).max(100),
      hraPctOfBasic: z.number().min(0).max(100),
      conveyance: z.number().min(0).max(100000),
      medical: z.number().min(0).max(100000),
      pfOnFullBasic: z.boolean(),
    })
    .optional(),
  employeeCodePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, "2 to 6 letters").default("EMP"),
});
export type TenantSettings = z.infer<typeof tenantPayrollSettingsSchema>;

export const branchSchema = z.object({
  name: trimmed(120).min(1),
  code: nullable(trimmed(20)),
  state: trimmed(60).min(1),
  city: nullable(trimmed(80)),
  address: nullable(trimmed(500)),
  isHeadOffice: z.boolean().default(false),
  esiSubCode: nullable(trimmed(40)),
  ptRegistration: nullable(trimmed(40)),
});
export const departmentSchema = z.object({ name: trimmed(120).min(1), code: nullable(trimmed(20)) });
export const designationSchema = z.object({ name: trimmed(120).min(1), grade: nullable(trimmed(20)) });

export const shiftSchema = z.object({
  name: trimmed(80).min(1),
  startTime: hhmm,
  endTime: hhmm,
  graceMinutes: z.coerce.number().int().min(0).max(240).default(15),
  halfDayMinutes: z.coerce.number().int().min(0).max(1440).default(240),
  fullDayMinutes: z.coerce.number().int().min(0).max(1440).default(480),
  weeklyOffs: z.array(z.number().int().min(0).max(6)).default([0, 6]),
  isDefault: z.boolean().default(false),
});

// ---------- access ----------
export const roleSchema = z.object({
  name: trimmed(60).min(1),
  description: nullable(trimmed(200)),
  permissions: z.record(z.string(), z.array(z.string())),
});
export const inviteAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: trimmed(120).min(1),
  roleId: z.string().min(1),
  scope: nullable(trimmed(200)),
});
export const updateMemberSchema = z.object({
  roleId: z.string().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  scope: nullable(trimmed(200)),
});

// ---------- attendance ----------
export const punchSchema = z.object({
  source: z.enum(["web", "mobile", "gps", "wfh"]).default("web"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  note: nullable(trimmed(200)),
});
export const manualAttendanceSchema = z.object({
  employeeId: z.string().min(1),
  date: isoDate,
  status: z.enum(ATTENDANCE_STATUSES),
  checkIn: nullable(hhmm),
  checkOut: nullable(hhmm),
  note: nullable(trimmed(200)),
});
export const correctionCreateSchema = z.object({
  date: isoDate,
  issue: trimmed(120).min(1),
  requestedCheckIn: nullable(hhmm),
  requestedCheckOut: nullable(hhmm),
  requestedStatus: nullable(z.enum(ATTENDANCE_STATUSES)),
  reason: nullable(trimmed(500)),
});
export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: nullable(trimmed(500)),
});
export const bulkDecisionSchema = decisionSchema.extend({ ids: z.array(z.string()).min(1).max(200) });

// ---------- leave ----------
export const leaveTypeSchema = z.object({
  code: trimmed(6).min(1).toUpperCase(),
  name: trimmed(60).min(1),
  isPaid: z.boolean().default(true),
  annualQuota: z.coerce.number().min(0).max(365).default(0),
  accrual: z.enum(["yearly", "monthly", "none"]).default("yearly"),
  carryForwardMax: z.coerce.number().min(0).max(365).default(0),
  encashable: z.boolean().default(false),
  allowHalfDay: z.boolean().default(true),
  allowNegative: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const leaveApplySchema = z
  .object({
    employeeId: z.string().optional(), // only when applying on behalf
    leaveTypeId: z.string().min(1),
    startDate: isoDate,
    endDate: isoDate,
    halfDay: z.boolean().default(false),
    reason: nullable(trimmed(500)),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date is before start date", path: ["endDate"] })
  .refine((v) => !v.halfDay || v.startDate === v.endDate, {
    message: "Half day leave must be a single day",
    path: ["halfDay"],
  });
export const leaveAdjustSchema = z.object({
  employeeId: z.string(),
  leaveTypeId: z.string(),
  year: z.number().int(),
  delta: z.number().min(-365).max(365),
  note: trimmed(200).min(1),
});
export const holidaySchema = z.object({
  date: isoDate,
  name: trimmed(120).min(1),
  type: z.enum(["national", "festival", "optional", "company"]).default("festival"),
  branchId: nullable(z.string()),
});

// ---------- onboarding ----------
export const companySignupSchema = z.object({
  adminName: trimmed(120).min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  phone: nullable(phoneSchema),
  role: nullable(trimmed(60)),
  companySize: nullable(trimmed(30)),
  companyName: trimmed(160).min(2),
  legalName: nullable(trimmed(200)),
  state: trimmed(60).min(2),
});

export const companySetupSchema = z.object({
  profile: tenantProfileSchema.partial().optional(),
  statutory: z
    .object({
      epf: z.object({ enabled: z.boolean(), registration: nullable(trimmed(40)) }).optional(),
      esi: z.object({ enabled: z.boolean(), registration: nullable(trimmed(40)) }).optional(),
      pt: z.object({ enabled: z.boolean(), registration: nullable(trimmed(40)) }).optional(),
      lwf: z.object({ enabled: z.boolean(), registration: nullable(trimmed(40)) }).optional(),
      tds: z.object({ enabled: z.boolean(), registration: nullable(trimmed(40)) }).optional(),
      bonus: z.object({ enabled: z.boolean(), registration: nullable(trimmed(40)) }).optional(),
    })
    .optional(),
  payroll: tenantPayrollSettingsSchema.partial().optional(),
  setupStep: z.number().int().min(0).max(6).optional(),
  completed: z.boolean().optional(),
});

export const onboardingAcceptSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(10, "Use at least 10 characters").max(128),
});

export const onboardingSaveSchema = z.object({
  step: z.enum(["personal", "address", "bank", "tax"]),
  data: z.record(z.string(), z.unknown()),
});

export const essProfileUpdateSchema = employeePersonalSchema
  .pick({
    personalEmail: true,
    phone: true,
    maritalStatus: true,
    bloodGroup: true,
    currentAddress: true,
    permanentAddress: true,
    emergencyContactName: true,
    emergencyContactRelation: true,
    emergencyContactPhone: true,
  })
  .partial();

// ---------- payroll ----------
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const amount = z.coerce.number().min(0).max(1e8);
export const salaryComponentsSchema = z.object({ basic: amount, hra: amount, conveyance: amount, medical: amount, special: amount });
export const structureRevisionSchema = z.object({
  effectiveFrom: isoDate,
  annualCtc: z.coerce.number().min(0).max(1e9),
  components: salaryComponentsSchema.nullable().optional(),
  reason: nullable(trimmed(200)),
});
export const payrollRunCreateSchema = z.object({ month: monthSchema, payDate: nullable(isoDate) });
export const payrollAdjustmentSchema = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(["earning", "deduction"]),
  label: trimmed(80).min(1, "Give it a name"),
  amount: z.coerce.number().positive("Amount must be more than zero").max(1e8),
  taxable: z.boolean().default(true),
  esiWage: z.boolean().default(true),
});
export const payrollItemPatchSchema = z.object({
  lopOverride: z.number().min(0).max(31).nullable().optional(),
  onHold: z.boolean().optional(),
  holdReason: nullable(trimmed(200)),
});
export const markPaidSchema = z.object({ paidOn: isoDate, reference: nullable(trimmed(80)) });
export const reopenSchema = z.object({ reason: trimmed(300).min(5, "Say why the payroll is being reopened") });

// ---------- compliance ----------
export const challanSchema = z.object({
  statute: z.enum(["epf", "esi", "pt", "lwf", "tds"]),
  period: monthSchema,
  jurisdiction: z.string().trim().max(60).default(""),
  amountPaid: z.coerce.number().min(0).max(1e10),
  reference: nullable(trimmed(60)),
  paidOn: isoDate,
  notes: nullable(trimmed(300)),
});

// ---------- reimbursements ----------
export const reimbursementCategorySchema = z.object({
  name: trimmed(60).min(1),
  limitAmount: z.coerce.number().min(0).max(1e8).nullable().optional(),
  limitPeriod: z.enum(["claim", "day", "month", "trip", "night", "km"]).default("claim"),
  ratePerKm: z.coerce.number().min(0).max(1000).nullable().optional(),
  gstCapture: z.boolean().default(false),
  approval: z.enum(["manager", "finance", "manager_finance"]).default("manager"),
  receiptRequiredAbove: z.coerce.number().min(0).max(1e8).default(0),
  active: z.boolean().default(true),
});
export const claimCreateSchema = z.object({
  employeeId: z.string().optional(), // HR filing on behalf
  categoryId: z.string().min(1, "Pick a category"),
  expenseDate: isoDate,
  amount: z.coerce.number().min(0).max(1e7).optional(),
  km: z.coerce.number().min(0).max(10000).optional(),
  vendor: nullable(trimmed(120)),
  gstin: nullable(gstinSchema),
  gstAmount: z.coerce.number().min(0).max(1e7).nullable().optional(),
  project: nullable(trimmed(120)),
  description: trimmed(300).min(3, "Say what the expense was for"),
});

// ---------- payments ----------
export const BANK_FILE_FORMATS = ["hdfc_enet", "icici_cib", "generic_csv"] as const;
export const bankAccountSchema = z.object({
  label: trimmed(60).min(1, "Give the account a name"),
  bankName: trimmed(80).min(2, "Enter the bank name"),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Account number should be 6 to 20 digits").optional(),
  ifsc: ifscSchema,
  fileFormat: z.enum(BANK_FILE_FORMATS).default("generic_csv"),
  clientCode: nullable(trimmed(40)),
  isDefault: z.boolean().default(false),
  balance: z.coerce.number().min(0).max(1e12).nullable().optional(),
  balanceAsOf: nullable(isoDate),
  active: z.boolean().default(true),
});
export const PAYMENT_TYPES = ["salary", "reimbursement", "bonus", "other"] as const;
export const paymentLineSchema = z.object({
  /** Either the id or the employee code (from a pasted sheet). */
  employeeId: z.string().min(1).optional(),
  employeeCode: z.string().trim().max(30).optional(),
  amount: z.coerce.number().positive("Amount must be more than zero").max(1e8),
  description: nullable(trimmed(120)),
});
export const batchCreateSchema = z.object({
  type: z.enum(PAYMENT_TYPES),
  payrollRunId: z.string().optional(),
  bankAccountId: z.string().min(1, "Pick the debit account"),
  fileFormat: z.enum(BANK_FILE_FORMATS).optional(),
  paymentDate: isoDate,
  label: nullable(trimmed(80)),
  notes: nullable(trimmed(300)),
  /** Bonus/other: the lines. Bonus can instead be generated with `bonus`. */
  lines: z.array(paymentLineSchema).max(5000).optional(),
  /** Reimbursement: pay only these claims (default: every approved, unpaid claim). */
  claimIds: z.array(z.string()).max(5000).optional(),
  bonus: z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/), percent: z.coerce.number().min(8.33).max(20) }).optional(),
});
export const paymentUpdateSchema = z.object({
  status: z.enum(["paid", "failed", "held", "pending", "cancelled"]),
  utr: nullable(trimmed(40)),
  reason: nullable(trimmed(200)),
  paidOn: nullable(isoDate),
});
export const bulkPaymentUpdateSchema = paymentUpdateSchema.extend({ ids: z.array(z.string()).min(1).max(5000) });

// ---------- SaaS billing ----------
export const planSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,30}$/, "Use lowercase letters, numbers and underscores"),
  name: trimmed(40).min(1),
  pricePerEmployee: z.coerce.number().min(0).max(100000).nullable().optional(),
  minSeats: z.coerce.number().int().min(0).max(100000).default(0),
  maxEmployees: z.coerce.number().int().min(1).max(1000000).nullable().optional(),
  includedAdmins: z.coerce.number().int().min(1).max(10000).nullable().optional(),
  description: nullable(trimmed(200)),
  features: z.array(trimmed(80)).max(20).default([]),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});
export const invoicingEntitySchema = z.object({
  legalName: trimmed(120).min(2),
  gstin: nullable(gstinSchema),
  pan: nullable(z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN")),
  address: nullable(trimmed(300)),
  state: nullable(trimmed(60)),
  sac: trimmed(10).default("998314"),
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{2,12}$/, "Use capitals, digits and dashes").default("INV-P-"),
  dueDays: z.coerce.number().int().min(0).max(90).default(7),
  bankDetails: nullable(trimmed(300)),
  upiId: nullable(trimmed(80)),
  email: nullable(z.string().trim().email()),
});
export const billingRunSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), tenantIds: z.array(z.string()).max(5000).optional() });
export const invoicePaymentSchema = z.object({
  paidOn: isoDate,
  method: z.enum(["upi", "neft", "rtgs", "card", "cheque", "other"]),
  reference: nullable(trimmed(80)),
});
export const tenantBillingSchema = z.object({
  plan: z.string().trim().min(2).max(30).optional(),
  customPrice: z.coerce.number().min(0).max(100000).nullable().optional(),
  billingEmail: nullable(z.string().trim().email()),
  paymentMethod: nullable(trimmed(80)),
});

// ---------- feature flags ----------
export const featureFlagSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,60}$/, "Use lowercase letters, digits, dots and dashes"),
  name: trimmed(80).min(1),
  description: nullable(trimmed(300)),
  enabled: z.boolean().default(true),
  rollout: z.enum(["all", "plans", "tenants", "percent"]).default("all"),
  plans: z.array(z.string().max(30)).max(20).default([]),
  tenantIds: z.array(z.string()).max(5000).default([]),
  excludedTenantIds: z.array(z.string()).max(5000).default([]),
  percent: z.coerce.number().int().min(0).max(100).default(100),
});
