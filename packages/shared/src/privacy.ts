import { z } from "zod";

/**
 * DPDP Act 2023: employees can get a copy of their data and ask for it to be erased.
 * The company is the data fiduciary; we help it answer. Records that labour and tax law
 * make it keep (payroll, statutory returns, TDS, company letters) stay after erasure.
 */
export const PRIVACY_REQUEST_STATUSES = ["pending", "completed", "rejected", "cancelled"] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];
export const PRIVACY_STATUS_LABEL: Record<PrivacyRequestStatus, string> = { pending: "Waiting for HR", completed: "Erased", rejected: "Declined", cancelled: "Withdrawn" };

export interface PrivacySettings {
  /** Who employees contact about their data (the grievance officer under the Act). */
  officerName: string | null;
  officerEmail: string | null;
  /** HR should answer an erasure request within this many days. */
  responseDays: number;
}
export const DEFAULT_PRIVACY: PrivacySettings = { officerName: null, officerEmail: null, responseDays: 30 };

export const privacySettingsSchema = z.object({
  officerName: z.string().trim().max(120).nullable(),
  officerEmail: z.email().nullable(),
  responseDays: z.number().int().min(1).max(90),
});
export const erasureRequestSchema = z.object({ reason: z.string().trim().max(1000).default("") });
export const privacyDecisionSchema = z.object({ note: z.string().trim().min(3, "Say why, so the employee knows").max(1000) });
export const eraseSchema = z.object({ note: z.string().trim().max(1000).default("") });

/** What erasure removes and what it keeps, in plain words for both screens. */
export const ERASED_DATA = [
  "Contact details: personal email, phone, addresses (except the permanent address on tax forms), emergency contact",
  "Personal details: date of birth, marital status, blood group, Aadhaar last 4 digits",
  "Bank account details on the profile",
  "Profile photo, punch selfies and punch locations",
  "Uploaded documents such as ID proofs, resume and certificates",
  "Onboarding answers, and the sign-in for this company",
];
export const KEPT_DATA = [
  "Name, employee ID, PAN, UAN, ESIC number, joining and leaving dates, and job history",
  "Payslips, salary, attendance and leave totals that payroll used, PF, ESI, PT and TDS records",
  "Letters the company issued (offer, appointment, relieving) and the full and final settlement",
];
/** Documents the company issued; they stay as employment records. */
export const COMPANY_ISSUED_DOCS = ["offer_letter", "appointment_letter", "relieving_letter", "company_letter"];

/** Why the company can't erase someone yet, or null when it can. */
export function erasureBlocker(e: { status: string; lastWorkingDay: string | null; erasedAt?: Date | string | null }, today: string, openLoans = 0, fnfOpen = false) {
  if (e.erasedAt) return "Their personal data has already been erased";
  if (e.status !== "exited" && e.status !== "inactive") return "They still work here. Personal data is needed for their job until they leave";
  if (e.lastWorkingDay && e.lastWorkingDay > today) return "Their last working day hasn't passed yet";
  if (fnfOpen) return "Their full and final settlement isn't finished";
  if (openLoans > 0) return "They still have a loan or advance to recover";
  return null;
}

export function addDaysIso(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
