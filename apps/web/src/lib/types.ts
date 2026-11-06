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
