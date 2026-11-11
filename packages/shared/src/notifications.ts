/**
 * Emails people can switch off. HR can turn each one off for the whole company, and each
 * person can turn off the ones they don't want. Sign-in, security, invitations, billing and
 * anything HR sends on purpose (payslip PDFs, tax reminders) always go out.
 */
export const NOTIFICATION_KEYS = [
  "leave_decision",
  "comp_off_decision",
  "claim_decision",
  "payslip_published",
  "payment_returned",
  "exit_updates",
  "loan_updates",
  "probation_outcome",
  "leave_to_approve",
  "comp_off_to_approve",
  "resignation_submitted",
  "probation_due",
  "privacy_requests",
] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export interface NotificationDef {
  key: NotificationKey;
  /** "self" is about your own requests and pay; "approver" is for managers and HR. */
  group: "self" | "approver";
  label: string;
  description: string;
}

export const NOTIFICATIONS: NotificationDef[] = [
  { key: "leave_decision", group: "self", label: "Leave approved or rejected", description: "When a leave request of yours is decided." },
  { key: "comp_off_decision", group: "self", label: "Comp off approved or rejected", description: "When a comp off claim of yours is decided." },
  { key: "claim_decision", group: "self", label: "Expense claim updates", description: "When an expense claim of yours is approved or rejected." },
  { key: "payslip_published", group: "self", label: "Payslip ready", description: "When your monthly payslip is published." },
  { key: "payment_returned", group: "self", label: "Salary payment returned", description: "When the bank returns a payment to you, usually because of wrong account details." },
  { key: "exit_updates", group: "self", label: "Resignation updates", description: "When HR accepts or closes your resignation." },
  { key: "loan_updates", group: "self", label: "Loan and advance updates", description: "When a loan or advance you asked for is approved, rejected or paid out." },
  { key: "probation_outcome", group: "self", label: "Probation confirmed or extended", description: "When HR confirms your employment or extends your probation." },
  { key: "leave_to_approve", group: "approver", label: "Leave waiting for me", description: "When a leave request reaches your step in the approval chain." },
  { key: "comp_off_to_approve", group: "approver", label: "Comp off waiting for me", description: "When someone on your team claims comp off." },
  { key: "probation_due", group: "approver", label: "Probation reviews due", description: "Before probation ends for someone on your team, or anyone if you're HR." },
  { key: "privacy_requests", group: "approver", label: "Data erasure requests", description: "When an employee asks the company to erase their personal data (HR only)." },
  { key: "resignation_submitted", group: "approver", label: "Resignations", description: "When someone on your team, or anyone if you're HR, resigns." },
];

/** Emails that always go out, shown so people know what to expect. */
export const ALWAYS_SENT = [
  "Password resets, two-factor changes and other sign-in security emails",
  "Invitations to join a company or the admin console",
  "Payslip PDFs and tax declaration reminders that HR sends you directly",
  "Invoices, payment receipts and autopay notices, to your company's billing contact",
];

export type NotificationPrefs = Partial<Record<NotificationKey, boolean>>;

/** Is this email on? Off if the company or the person has turned it off. */
export const notificationOn = (key: NotificationKey, company: NotificationPrefs | null | undefined, personal?: NotificationPrefs | null) => company?.[key] !== false && personal?.[key] !== false;
