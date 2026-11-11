import { z } from "zod";

/** Employee helpdesk: questions and requests to HR, IT, Finance and Admin inside the company. */
export const HELPDESK_TEAMS = ["hr", "it", "finance", "admin"] as const;
export type HelpdeskTeam = (typeof HELPDESK_TEAMS)[number];
export const TEAM_LABEL: Record<HelpdeskTeam, string> = { hr: "HR", it: "IT", finance: "Finance", admin: "Admin and facilities" };

export const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", in_progress: "In progress", waiting: "Waiting for you", resolved: "Resolved", closed: "Closed" };
/** The same statuses, worded for the team working the ticket. */
export const AGENT_STATUS_LABEL: Record<TicketStatus, string> = { ...TICKET_STATUS_LABEL, waiting: "Waiting for employee" };
export const OPEN_STATUSES: TicketStatus[] = ["open", "in_progress", "waiting"];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export interface HelpdeskCategory {
  key: string;
  label: string;
  team: HelpdeskTeam;
  /** Hours to the first response. */
  slaHours: number;
}
export const DEFAULT_CATEGORIES: HelpdeskCategory[] = [
  { key: "payroll", label: "Salary or payslip question", team: "hr", slaHours: 24 },
  { key: "leave", label: "Leave or attendance", team: "hr", slaHours: 24 },
  { key: "letters", label: "Letters and documents", team: "hr", slaHours: 48 },
  { key: "policy", label: "Policy question", team: "hr", slaHours: 48 },
  { key: "grievance", label: "Concern or complaint", team: "hr", slaHours: 24 },
  { key: "equipment", label: "Laptop or equipment", team: "it", slaHours: 8 },
  { key: "access", label: "Email, accounts or access", team: "it", slaHours: 8 },
  { key: "claims", label: "Expense claim or advance", team: "finance", slaHours: 48 },
  { key: "facilities", label: "Office and facilities", team: "admin", slaHours: 24 },
];

export interface HelpdeskSettings {
  categories: HelpdeskCategory[];
  /** Employees who work each team's queue. */
  teams: Record<HelpdeskTeam, string[]>;
  /** Resolved tickets close by themselves after this many days. */
  autoCloseDays: number;
}
export const DEFAULT_HELPDESK: HelpdeskSettings = { categories: DEFAULT_CATEGORIES, teams: { hr: [], it: [], finance: [], admin: [] }, autoCloseDays: 7 };

/** Urgent tickets get a quarter of the time, high half, low double. */
const PRIORITY_FACTOR: Record<Priority, number> = { urgent: 0.25, high: 0.5, normal: 1, low: 2 };
export function responseDue(createdAt: Date, slaHours: number, priority: Priority) {
  return new Date(createdAt.getTime() + Math.max(1, slaHours * PRIORITY_FACTOR[priority]) * 3_600_000);
}

export const ticketSchema = z.object({
  categoryKey: z.string().min(1, "Pick what it's about"),
  subject: z.string().trim().min(4, "Sum it up in a few words").max(150),
  body: z.string().trim().min(10, "Tell us a bit more").max(10000),
  priority: z.enum(PRIORITIES).default("normal"),
  /** Only HR leads see it; for personal or sensitive matters. */
  confidential: z.boolean().default(false),
});
export const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply").max(10000),
  /** Agents only: a note the employee doesn't see. */
  internal: z.boolean().default(false),
  /** Agents only: change the status with the reply. */
  status: z.enum(["in_progress", "waiting", "resolved"]).optional(),
});
export const ticketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  categoryKey: z.string().optional(),
});
export const rateSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default("") });
export const helpdeskSettingsSchema = z.object({
  categories: z
    .array(z.object({ key: z.string().trim().regex(/^[a-z0-9_]{2,30}$/), label: z.string().trim().min(2).max(80), team: z.enum(HELPDESK_TEAMS), slaHours: z.number().min(1).max(720) }))
    .min(1, "Keep at least one category")
    .max(40)
    .refine((l) => new Set(l.map((c) => c.key)).size === l.length, "Each category needs its own key"),
  teams: z.object({ hr: z.array(z.string()), it: z.array(z.string()), finance: z.array(z.string()), admin: z.array(z.string()) }),
  autoCloseDays: z.number().int().min(1).max(60),
});
