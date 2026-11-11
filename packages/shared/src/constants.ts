export const EMPLOYEE_STATUSES = ["onboarding", "probation", "active", "notice", "inactive", "exited"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  onboarding: "Onboarding",
  probation: "Probation",
  active: "Active",
  notice: "Notice period",
  inactive: "Inactive",
  exited: "Exited",
};

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant"] as const;
export const EMPLOYMENT_TYPE_LABELS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
};

export const GENDERS = ["male", "female", "other", "undisclosed"] as const;
export const TAX_REGIMES = ["new", "old"] as const;
export const PAYMENT_METHODS = ["bank_transfer", "cheque", "cash"] as const;

export const ATTENDANCE_STATUSES = [
  "present",
  "late",
  "half_day",
  "absent",
  "on_leave",
  "holiday",
  "weekly_off",
  "wfh",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  half_day: "Half day",
  absent: "Absent",
  on_leave: "On leave",
  holiday: "Holiday",
  weekly_off: "Weekly off",
  wfh: "WFH",
};
/** One-letter codes for the monthly register grid. */
export const ATTENDANCE_CODES: Record<AttendanceStatus, string> = {
  present: "P",
  late: "L",
  half_day: "H",
  absent: "A",
  on_leave: "LV",
  holiday: "HO",
  weekly_off: "WO",
  wfh: "W",
};

export const ATTENDANCE_SOURCES = ["web", "mobile", "biometric", "gps", "ip", "wfh", "manual", "import"] as const;
export const REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DOCUMENT_TYPES = [
  "resume",
  "aadhaar",
  "pan",
  "bank_proof",
  "education",
  "employment",
  "offer_letter",
  "appointment_letter",
  "relieving_letter",
  "photo",
  "company_letter",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  resume: "Resume",
  aadhaar: "Aadhaar card",
  pan: "PAN card",
  bank_proof: "Bank proof (cancelled cheque)",
  education: "Education certificates",
  employment: "Employment documents",
  offer_letter: "Offer letter",
  appointment_letter: "Appointment letter",
  relieving_letter: "Previous employment: relieving letter",
  photo: "Profile photo",
  company_letter: "Letter from the company",
  other: "Other",
};

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

export const ONBOARDING_STEPS = ["account", "personal", "address", "bank", "tax", "documents", "review"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  account: "Account",
  personal: "Personal details",
  address: "Address & nominee",
  bank: "Bank account",
  tax: "PAN, UAN & tax",
  documents: "Documents",
  review: "Review & submit",
};
