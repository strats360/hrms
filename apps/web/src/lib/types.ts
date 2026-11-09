/** API response shapes used across pages. */
export interface Lookups {
  branches: { id: string; name: string; state: string; city: string | null; isHeadOffice: boolean }[];
  departments: { id: string; name: string }[];
  designations: { id: string; name: string }[];
  shifts: { id: string; name: string; startTime: string; endTime: string; isDefault: boolean }[];
  employees: { id: string; name: string; code: string }[];
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  phone: string | null;
  status: string;
  employmentType: string;
  dateOfJoining: string;
  annualCtc: number | null;
  department: string | null;
  designation: string | null;
  branch: string | null;
  manager: string | null;
}

export interface EmployeeDocument {
  id: string;
  type: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  createdAt: string;
}

export interface EmployeeDetail {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  workEmail: string;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  bloodGroup: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  dateOfJoining: string;
  departmentId: string | null;
  designationId: string | null;
  managerId: string | null;
  branchId: string | null;
  shiftId: string | null;
  employmentType: string;
  workLocation: string | null;
  status: string;
  probationMonths: number;
  confirmationDate: string | null;
  resignationDate: string | null;
  lastWorkingDay: string | null;
  annualCtc: number | null;
  accountHolderName: string | null;
  bankName: string | null;
  accountLast4: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  paymentMethod: string;
  bankVerified: boolean;
  pan: string | null;
  aadhaarLast4: string | null;
  uan: string | null;
  esicIpNumber: string | null;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  branchState: string | null;
  manager: string | null;
  shift: string | null;
  hasLogin: boolean;
  invite: { status: string; progress: number; sentAt: string; expiresAt: string; submittedAt: string | null } | null;
  documents: EmployeeDocument[];
}

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  annualQuota: number;
  opening: number;
  accrued: number;
  used: number;
  adjusted: number;
  pending: number;
  available: number;
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  annualQuota: number;
  accrual: "yearly" | "monthly" | "none";
  carryForwardMax: number;
  encashable: boolean;
  allowHalfDay: boolean;
  allowNegative: boolean;
  active: boolean;
}

export interface LeaveRequest {
  id: string;
  code: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  createdAt: string;
  employeeName?: string;
  employeeCode?: string;
  department?: string | null;
  typeName?: string;
  typeCode?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: string;
  branchId: string | null;
}

// ---------- payroll ----------
export interface PayLine {
  code: string;
  label: string;
  amount: number;
}
export interface RunTotals {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  ctc: number;
  tds: number;
  reimbursement?: number;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  lwf: number;
  onHold: number;
  lopDays: number;
  withLop: number;
}
export type RunStatus = "draft" | "calculated" | "approved" | "paid";
export interface PayrollRun {
  id: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  status: RunStatus;
  totals: RunTotals | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  bankFileExportedAt: string | null;
  calculatedBy: string | null;
  calculatedByName?: string | null;
  approvedByName?: string | null;
  paidByName?: string | null;
  preparedByName?: string | null;
  previous?: { id: string; month: string; status: RunStatus; totals: RunTotals | null; approvedAt: string | null } | null;
  paymentBatch?: { id: string; code: string; status: BatchStatus } | null;
}
export interface PayrollInputs {
  employees: number;
  joiners: { id: string; name: string; date: string }[];
  exits: { id: string; name: string; date: string | null }[];
  structuresRevised: number;
  missingBank: { id: string; name: string }[];
  missingPan: { id: string; name: string }[];
  pendingCorrections: number;
  pendingLeave: number;
  adjustments: { count: number; net: number };
}
export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  kind: "earning" | "deduction";
  label: string;
  amount: number;
  taxable: boolean;
  esiWage: boolean;
}
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
export interface PayrollItem {
  id: string;
  runId: string;
  employeeId: string;
  snapshot: ItemSnapshot;
  daysInMonth: number;
  paidDays: number;
  lopDays: number;
  lopOverride: number | null;
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  tds: number;
  /** Approved expense claims paid with this salary (not part of gross or TDS). */
  reimbursement: number;
  onHold: boolean;
  holdReason: string | null;
  warnings: string[];
  previousNet: number | null;
  adjustments: PayrollAdjustment[];
}
export interface PayslipView {
  company: { name: string; legalName: string | null; address: string | null; pan: string | null; tan: string | null; gstin: string | null };
  run: { id: string; month: string; periodStart: string; periodEnd: string; payDate: string | null; status: RunStatus };
  employee: ItemSnapshot & { id: string };
  daysInMonth: number;
  paidDays: number;
  lopDays: number;
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  reimbursement: number;
  employerCost: number;
  tax: { taxableIncome: number; total: number; projectedAnnualGross: number; annualised?: boolean } | null;
  onHold: boolean;
  warnings: string[];
}
export interface SalaryTemplate {
  basicPctOfGross: number;
  hraPctOfBasic: number;
  conveyance: number;
  medical: number;
  pfOnFullBasic: boolean;
}
export interface Structure {
  annualCtc: number;
  monthlyCtc: number;
  gross: number;
  components: { basic: number; hra: number; conveyance: number; medical: number; special: number };
  employer: { pf: number; esi: number };
  esiApplicable: boolean;
}

// ---------- compliance ----------
export type Statute = "epf" | "esi" | "pt" | "lwf" | "tds";
export interface Challan {
  id: string;
  statute: Statute;
  period: string;
  jurisdiction: string;
  amountDue: number;
  amountPaid: number;
  reference: string | null;
  paidOn: string;
  receiptName: string | null;
  notes: string | null;
}
export interface Obligation {
  key: string;
  statute: Statute;
  label: string;
  period: string;
  jurisdiction: string;
  amount: number;
  breakup: { label: string; amount: number }[];
  employees: number;
  dueDate: string;
  daysLeft: number;
  status: "paid" | "overdue" | "due_soon" | "upcoming";
  challan: Challan | null;
}
export interface ComplianceOverview {
  latestMonth: string | null;
  cards: Obligation[];
  overdue: number;
  dueSoon: number;
  calendar: { date: string; title: string; amount: number | null; daysLeft: number; kind: "payment" | "return" }[];
  tracked: { gratuityEligible: number; gratuityProvision: number; overtimeHours: number; edliMembers: number };
}
export interface ContributionRow {
  employeeId: string;
  name: string;
  code: string;
  uan: string | null;
  esicIpNumber: string | null;
  pan: string | null;
  state: string | null;
  gross: number;
  paidDays: number;
  ncpDays: number;
  pfWage: number;
  epfEe: number;
  eps: number;
  epfEr: number;
  edliAdmin: number;
  esiEe: number;
  esiEr: number;
  pt: number;
  lwf: number;
  tds: number;
}

// ---------- TDS ----------
import type { TaxDeclarationData, TaxStatement, Verified } from "@hrms/shared";
export type { TaxDeclarationData, TaxStatement, Verified };
export interface TaxMonth {
  month: string;
  status: "locked" | "projected";
  gross: number;
  basic: number;
  hra: number;
  pf: number;
  pt: number;
  tds: number;
}
export interface TaxDeclaration {
  id: string;
  employeeId: string;
  fy: string;
  regime: "new" | "old";
  data: TaxDeclarationData;
  verified: Verified;
  status: "draft" | "submitted" | "verified";
  submittedAt: string | null;
  verifiedAt: string | null;
}
export interface TaxProof {
  id: string;
  section: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: "pending" | "accepted" | "rejected";
  note: string | null;
  createdAt: string;
}
export interface EmployeeTax {
  employee: { id: string; name: string; code: string; pan: string | null; dateOfJoining: string; regime: "new" | "old" };
  declaration: TaxDeclaration | null;
  months: TaxMonth[];
  statement: TaxStatement;
  comparison: { new: number; old: number; better: "new" | "old"; saving: number };
  deducted: number;
  remaining: number;
  excess: number;
  monthlyEstimate: number;
  projectedMonths: number;
}
export interface Form16Data {
  fy: string;
  assessmentYear: string;
  provisional: boolean;
  employer: { name: string | null; address: string | null; pan: string | null; tan: string | null };
  employee: { id: string; name: string; code: string; pan: string | null; regime: "new" | "old" };
  period: { from: string | null; to: string | null };
  projectedMonths: number;
  quarters: { quarter: string; amountPaid: number; tdsDeducted: number; tdsDeposited: number; receipt: string | null }[];
  statement: TaxStatement;
  tdsDeducted: number;
  challans: { period: string; reference: string | null; paidOn: string; amount: number }[];
}

// ---------------------------------------------------------------------------
// Reimbursements
// ---------------------------------------------------------------------------
export type LimitPeriod = "claim" | "day" | "month" | "trip" | "night" | "km";
export type ClaimApproval = "manager" | "finance" | "manager_finance";
export type ClaimStatus = "pending_manager" | "pending_finance" | "approved" | "paid" | "rejected" | "cancelled";
export interface ExpenseCategory {
  id: string;
  name: string;
  limitAmount: number | null;
  limitPeriod: LimitPeriod;
  ratePerKm: number | null;
  gstCapture: boolean;
  approval: ClaimApproval;
  receiptRequiredAbove: number;
  active: boolean;
}
export interface Claim {
  id: string;
  code: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  managerName: string | null;
  department: string | null;
  categoryId: string;
  category: string;
  approval: ClaimApproval;
  expenseDate: string;
  amount: number;
  km: number | null;
  vendor: string | null;
  gstin: string | null;
  gstAmount: number | null;
  project: string | null;
  description: string;
  status: ClaimStatus;
  statusLabel: string;
  overLimit: boolean;
  managerApprovedAt: string | null;
  financeApprovedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  payment: string | null;
  receipts: number;
  createdAt: string;
}
export interface ClaimReceipt {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}
export interface ClaimDetail extends Claim {
  receiptFiles: ClaimReceipt[];
  canDecide?: boolean;
  blockedReason?: string | null;
}
export interface ClaimSummary {
  pending: { amount: number; count: number };
  withManager: number;
  withFinance: number;
  approvedUnpaid: { amount: number; count: number };
  paidThisMonth: { amount: number; count: number };
  gstCredit: number;
  overLimit: number;
}
export interface MyClaims {
  claims: Claim[];
  categories: ExpenseCategory[];
  usage: { categoryId: string; name: string; limit: number; used: number }[];
  month: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export type BankFileFormat = "hdfc_enet" | "icici_cib" | "generic_csv";
export type PaymentType = "salary" | "reimbursement" | "bonus" | "other";
export type BatchStatus = "draft" | "approved" | "processing" | "completed" | "cancelled";
export type PaymentStatus = "pending" | "paid" | "failed" | "held" | "cancelled";
export interface DebitAccount {
  id: string;
  label: string;
  bankName: string;
  accountLast4: string;
  ifsc: string;
  fileFormat: BankFileFormat;
  formatLabel: string;
  clientCode: string | null;
  isDefault: boolean;
  balance: number | null;
  balanceAsOf: string | null;
  active: boolean;
}
export interface PaymentBatch {
  id: string;
  code: string;
  type: PaymentType;
  label: string;
  payrollRunId: string | null;
  bankAccountId: string | null;
  fileFormat: BankFileFormat;
  formatLabel: string;
  paymentDate: string;
  status: BatchStatus;
  notes: string | null;
  createdBy: string | null;
  approvedAt: string | null;
  exportedAt: string | null;
  exportCount: number;
  completedAt: string | null;
  createdAt: string;
  bank: string | null;
  count: number;
  amount: number;
  paid: number;
  paidAmount: number;
  failed: number;
  held: number;
  pending: number;
}
export interface Payment {
  id: string;
  batchId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  batchCode: string;
  batchType: PaymentType;
  batchLabel: string;
  reference: string;
  amount: number;
  description: string | null;
  beneficiaryName: string | null;
  bankName: string | null;
  ifsc: string | null;
  accountLast4: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  utr: string | null;
  paidAt: string | null;
  attempts: number;
  note: string | null;
}
export interface BatchDetail extends PaymentBatch {
  payments: Payment[];
  canApprove: boolean;
  approveBlocked: string | null;
}
export interface PaymentsSummary {
  readySalary: { runId: string; month: string; label: string; net: number; employees: number }[];
  claimsUnpaid: { amount: number; claims: number; employees: number };
  attention: { count: number; amount: number };
  account: DebitAccount | null;
}
export interface BatchPreview {
  label: string;
  summary: { count: number; amount: number; missingBank: number; missingBankAmount: number };
  warnings: string[];
  duplicates: number;
  skipped: number;
  lines: { employeeId: string; employeeCode?: string; employeeName?: string; amount: number; description: string | null; heldReason?: string | null }[];
}

// ---------------------------------------------------------------------------
// SaaS billing
// ---------------------------------------------------------------------------
export interface Plan {
  id: string;
  key: string;
  name: string;
  pricePerEmployee: number | null;
  minSeats: number;
  maxEmployees: number | null;
  includedAdmins: number | null;
  description: string | null;
  features: string[];
  active: boolean;
  sortOrder: number;
  tenants?: number;
}
export interface InvoiceParty {
  name: string;
  legalName?: string | null;
  gstin: string | null;
  address: string | null;
  state: string | null;
  stateCode: string | null;
}
export type InvoiceStatus = "issued" | "paid" | "void" | "overdue";
export interface Invoice {
  id: string;
  tenantId: string;
  tenantName: string;
  number: string;
  period: string;
  periodLabel: string;
  issuedOn: string;
  dueOn: string;
  planKey: string;
  planName: string;
  seats: number;
  rate: number;
  lines: { description: string; sac: string; quantity: number; rate: number; amount: number }[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  status: "issued" | "paid" | "void";
  displayStatus: InvoiceStatus;
  paidOn: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  remindersSent: number;
  voidReason: string | null;
}
export interface InvoicingEntity {
  legalName: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  state: string | null;
  sac: string;
  invoicePrefix: string;
  dueDays: number;
  bankDetails: string | null;
  upiId: string | null;
  email: string | null;
}
export interface OnlinePayment {
  id: string;
  orderId: string;
  amount: number;
  status: "created" | "paid" | "failed" | "dropped" | "expired" | "cancelled";
  gateway?: string;
  scheduledFor?: string | null;
  retryAt?: string | null;
  method: string | null;
  gatewayPaymentId: string | null;
  bankReference: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}
export interface InvoiceDetail extends Invoice {
  entity: InvoicingEntity;
  onlinePayments?: OnlinePayment[];
  payOnline?: boolean;
}
export interface TenantBilling {
  status: string;
  trialEndsAt: string | null;
  plan: { key: string; name: string; price: number; custom: boolean; maxEmployees: number | null; includedAdmins: number | null; minSeats: number; features: string[] };
  seats: { active: number; billable: number };
  admins: number;
  nextInvoice: { period: string; periodLabel: string; date: string; subtotal: number; gst: number; total: number; note: string | null } | null;
  usage: { payslips: number; bankFiles: number };
  billing: { legalName: string; gstin: string | null; state: string | null; address: string | null; billingEmail: string | null; paymentMethod: string | null };
  invoices: Invoice[];
  overdue: number;
  payOnline: boolean;
  contactPhone: string | null;
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------
export type TicketStatus = "open" | "in_progress" | "waiting_on_customer" | "resolved" | "closed";
export interface Ticket {
  id: string;
  number: number;
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  tenantPlan: string;
  raisedBy: string;
  raisedByName: string | null;
  raisedByEmail: string | null;
  subject: string;
  category: string;
  priority: "P1" | "P2" | "P3";
  status: TicketStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  allowAccess: boolean;
  responseDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  messages: number;
  sla: string;
  slaState: "met" | "breached" | "pending" | "n/a";
}
export interface TicketMessage {
  id: string;
  authorName: string;
  authorKind: "tenant" | "platform" | "system";
  body: string;
  internal: boolean;
  attachments: { name: string; type: string; size: number }[];
  createdAt: string;
}
export interface TicketAccess {
  id: string;
  staffName: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
}
export interface TicketDetail extends Ticket {
  thread: TicketMessage[];
  accessLog: TicketAccess[];
  staff?: { id: string; name: string; role: string }[];
  myAccess?: { id: string; expiresAt: string } | null;
}
