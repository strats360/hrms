import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { platformStaff, supportAccess, supportTickets, user, type Database } from "@hrms/db";

/** First-response targets: P1 1 hour, P2 4 hours, P3 one business day. */
export const SLA = { P1: { label: "Respond within 1 hour", hours: 1 }, P2: { label: "Respond within 4 hours", hours: 4 }, P3: { label: "Respond within 1 business day", hours: 24 } } as const;
export type Priority = keyof typeof SLA;

export function responseDue(priority: Priority, from = new Date()) {
  if (priority !== "P3") return new Date(from.getTime() + SLA[priority].hours * 3600_000);
  // next business day, same time (IST weekends skipped)
  const d = new Date(from.getTime() + 86400_000);
  const ist = (x: Date) => new Date(x.getTime() + 5.5 * 3600_000).getUTCDay();
  while (ist(d) === 0 || ist(d) === 6) d.setTime(d.getTime() + 86400_000);
  return d;
}

export async function nextTicketNumber(db: Database) {
  const [r] = await db.select({ n: sql<number>`coalesce(max(${supportTickets.number}), 4800)::int` }).from(supportTickets);
  return (r?.n ?? 4800) + 1;
}

export const OPEN_STATUSES = ["open", "in_progress", "waiting_on_customer"];

/** Read-only support sessions this staff member has running right now. */
export async function activeAccess(db: Database, staffUserId: string, tenantId?: string) {
  return db
    .select({ access: supportAccess, number: supportTickets.number, ticketStatus: supportTickets.status })
    .from(supportAccess)
    .innerJoin(supportTickets, eq(supportTickets.id, supportAccess.ticketId))
    .where(and(eq(supportAccess.staffUserId, staffUserId), isNull(supportAccess.endedAt), gt(supportAccess.expiresAt, new Date()), tenantId ? eq(supportAccess.tenantId, tenantId) : undefined));
}

/** Platform staff who should hear about new tickets. */
export async function supportInbox(db: Database) {
  return db
    .select({ email: user.email, name: user.name })
    .from(platformStaff)
    .innerJoin(user, eq(user.id, platformStaff.userId))
    .where(and(eq(platformStaff.status, "active"), sql`${platformStaff.role} in ('super_admin','support')`));
}
