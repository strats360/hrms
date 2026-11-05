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
