import { z } from "zod";

/**
 * More of the Digital Personal Data Protection Act 2023 and the DPDP Rules 2025.
 *
 * Running employment (pay, attendance, statutory filings) is a "legitimate use" under section 7(i),
 * so it doesn't need consent; the employee still gets a notice saying what's collected and why.
 * Optional uses need consent that can be withdrawn as easily as it was given.
 */
export const CONSENT_PURPOSES = ["selfie_punch", "location_punch", "directory"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, { title: string; detail: string }> = {
  selfie_punch: { title: "Selfie when you punch", detail: "A photo taken when you mark attendance on your phone, to confirm it's you. Deleted after the retention period set by HR." },
  location_punch: { title: "Location when you punch", detail: "Where you are when you mark attendance on your phone, checked against your office." },
  directory: { title: "Photo and birthday for colleagues", detail: "Your photo in the directory and org chart, and your birthday in announcements." },
};

export const privacyNoticeSchema = z.object({
  text: z.string().trim().min(50, "Write the notice in full").max(20000),
});
export const consentSchema = z.object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean() });

/** A short, plain starting notice HR can edit. */
export const DEFAULT_PRIVACY_NOTICE = `What we collect: your name, contact details, date of birth, ID numbers (PAN, Aadhaar last four digits, UAN, ESIC), bank account, salary, attendance, leave and the documents you or HR upload.

Why: to employ and pay you, keep attendance, file PF, ESI, professional tax and income tax returns, and meet labour law. This is a legitimate use under the DPDP Act, so it doesn't need your consent.

Optional: a selfie and your location when you punch, and showing your photo and birthday to colleagues. These need your consent, which you can give or withdraw at any time from Your data.

Who sees it: HR and payroll, your manager for what they need, and the government bodies we file with. We don't sell your data.

How long: while you work here and for the years the law requires after you leave. Then we erase it, and tell you 48 hours before.

Your rights: see and download your data, correct it, ask us to erase it once you've left, and complain to our grievance officer or the Data Protection Board of India.`;

export const BREACH_STATUSES = ["open", "contained", "closed"] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];
export const breachSchema = z.object({
  discoveredAt: z.string().datetime({ offset: true }),
  description: z.string().trim().min(10).max(5000),
  dataAffected: z.string().trim().max(500).default(""),
  affectedCount: z.coerce.number().int().min(0).max(10_000_000).default(0),
  status: z.enum(BREACH_STATUSES).default("open"),
  boardIntimatedAt: z.string().datetime({ offset: true }).nullable().optional(),
  boardReportAt: z.string().datetime({ offset: true }).nullable().optional(),
  peopleNotifiedAt: z.string().datetime({ offset: true }).nullable().optional(),
  actions: z.string().trim().max(5000).default(""),
});

/**
 * DPDP Rules 2025, rule 7: tell the Data Protection Board without delay, send it a full report
 * within 72 hours of becoming aware, and tell each person affected without delay.
 */
export function breachDeadlines(b: { discoveredAt: string; boardIntimatedAt?: string | null; boardReportAt?: string | null; peopleNotifiedAt?: string | null }, now = new Date()) {
  const reportDue = new Date(new Date(b.discoveredAt).getTime() + 72 * 3600_000);
  const open: string[] = [];
  if (!b.boardIntimatedAt) open.push("Tell the Data Protection Board now");
  if (!b.boardReportAt) open.push(now > reportDue ? "The full report to the Board is overdue" : "Send the Board the full report");
  if (!b.peopleNotifiedAt) open.push("Tell the people affected");
  return { reportDue: reportDue.toISOString(), overdue: !b.boardReportAt && now > reportDue, open };
}

/** Former employees whose data has been kept past the retention period. */
export function dueForErasure(lastWorkingDay: string | null, retentionYears: number, today: string) {
  if (!lastWorkingDay || lastWorkingDay > today) return { due: false, from: null as string | null };
  const from = `${Number(lastWorkingDay.slice(0, 4)) + retentionYears}${lastWorkingDay.slice(4)}`;
  return { due: from <= today, from };
}
