import { z } from "zod";

/** Company announcements: news, policies, holidays and events, for everyone or some teams. */
export const ANNOUNCEMENT_CATEGORIES = ["general", "policy", "holiday", "event", "celebration", "urgent"] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
export const ANNOUNCEMENT_CATEGORY_LABEL: Record<AnnouncementCategory, string> = { general: "News", policy: "Policy", holiday: "Holiday", event: "Event", celebration: "Celebration", urgent: "Urgent" };

export interface Audience {
  departmentIds: string[];
  branchIds: string[];
}
/** Does this person see an announcement for this audience? Empty lists mean everyone. */
export function inAudience(a: Audience, e: { departmentId: string | null; branchId: string | null }) {
  if (a.departmentIds.length && !(e.departmentId && a.departmentIds.includes(e.departmentId))) return false;
  if (a.branchIds.length && !(e.branchId && a.branchIds.includes(e.branchId))) return false;
  return true;
}

/** Live: published, start time passed, not expired. */
export function isLive(a: { status: string; publishAt: Date | string | null; expiresAt?: string | null }, now = new Date(), today = now.toISOString().slice(0, 10)) {
  if (a.status !== "published" || !a.publishAt) return false;
  if (new Date(a.publishAt) > now) return false;
  return !a.expiresAt || a.expiresAt >= today;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const announcementSchema = z.object({
  title: z.string().trim().min(3, "Give it a title").max(150),
  body: z.string().trim().min(3, "Write the announcement").max(20000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default("general"),
  departmentIds: z.array(z.string()).default([]),
  branchIds: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  requireAck: z.boolean().default(false),
  emailEveryone: z.boolean().default(true),
  /** null publishes now; a time in the future schedules it. */
  publishAt: z.iso.datetime({ offset: true }).nullable().default(null),
  expiresAt: isoDate.nullable().default(null),
  /** Save as a draft instead of publishing. */
  draft: z.boolean().default(false),
});
