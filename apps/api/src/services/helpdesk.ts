import { and, eq, lt, sql } from "drizzle-orm";
import { createDb, helpdeskMessages, helpdeskTickets, tenants, type Database } from "@hrms/db";
import { DEFAULT_HELPDESK, type HelpdeskSettings } from "@hrms/shared";
import type { Env } from "../env";

export async function helpdeskSettings(db: Database, tenantId: string): Promise<HelpdeskSettings> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const s = (t?.settings as { helpdesk?: Partial<HelpdeskSettings> } | null)?.helpdesk ?? {};
  return { categories: s.categories?.length ? s.categories : DEFAULT_HELPDESK.categories, teams: { ...DEFAULT_HELPDESK.teams, ...(s.teams ?? {}) }, autoCloseDays: s.autoCloseDays ?? DEFAULT_HELPDESK.autoCloseDays };
}

export async function nextTicketNumber(db: Database, tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(helpdeskTickets).where(eq(helpdeskTickets.tenantId, tenantId));
  return `HD-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Daily: resolved tickets nobody reopened close themselves. */
export async function autoCloseTickets(db: Database, now = new Date()) {
  const ts = await db.select({ id: tenants.id }).from(tenants);
  let closed = 0;
  for (const t of ts) {
    const s = await helpdeskSettings(db, t.id);
    const cutoff = new Date(now.getTime() - s.autoCloseDays * 86_400_000);
    const rows = await db
      .update(helpdeskTickets)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(and(eq(helpdeskTickets.tenantId, t.id), eq(helpdeskTickets.status, "resolved"), lt(helpdeskTickets.resolvedAt, cutoff)))
      .returning({ id: helpdeskTickets.id });
    for (const r of rows) await db.insert(helpdeskMessages).values({ tenantId: t.id, ticketId: r.id, authorName: "Helpdesk", fromTeam: true, internal: true, body: `Closed automatically ${s.autoCloseDays} days after it was resolved.` });
    closed += rows.length;
  }
  return closed;
}

export async function runHelpdeskAutoClose(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return 0;
  const db = createDb(url, { max: 2 });
  try {
    return await autoCloseTickets(db);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
