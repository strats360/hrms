import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { attendanceRecords, tenants, type Database } from "@hrms/db";
import { DEFAULT_PUNCH_POLICY, todayIST, type PunchPolicy } from "@hrms/shared";
import type { Env } from "../env";
import { deleteFile } from "../lib/storage";

/**
 * Delete punch selfies older than each company's retention period (90 days unless set).
 * Runs daily; works through at most `limit` records per run so it stays inside Worker limits.
 */
export async function purgeOldSelfies(db: Database, env: Env, today = todayIST(), limit = 500) {
  const cutoffMin = new Date(`${today}T00:00:00Z`);
  cutoffMin.setUTCDate(cutoffMin.getUTCDate() - 7); // the shortest retention allowed
  const rows = await db
    .select({ id: attendanceRecords.id, tenantId: attendanceRecords.tenantId, date: attendanceRecords.date, inKey: attendanceRecords.checkInSelfieKey, outKey: attendanceRecords.checkOutSelfieKey, settings: tenants.settings })
    .from(attendanceRecords)
    .innerJoin(tenants, eq(tenants.id, attendanceRecords.tenantId))
    .where(and(lt(attendanceRecords.date, cutoffMin.toISOString().slice(0, 10)), or(isNotNull(attendanceRecords.checkInSelfieKey), isNotNull(attendanceRecords.checkOutSelfieKey))))
    .orderBy(attendanceRecords.date)
    .limit(limit);
  let removed = 0;
  for (const r of rows) {
    const days = ((r.settings as { punchPolicy?: Partial<PunchPolicy> } | null)?.punchPolicy?.selfieRetentionDays ?? DEFAULT_PUNCH_POLICY.selfieRetentionDays) as number;
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    if (r.date >= cutoff.toISOString().slice(0, 10)) continue;
    for (const k of [r.inKey, r.outKey]) if (k) await deleteFile(env, k).catch((e) => console.error("selfie delete failed", e));
    await db.update(attendanceRecords).set({ checkInSelfieKey: null, checkOutSelfieKey: null, updatedAt: sql`now()` }).where(eq(attendanceRecords.id, r.id));
    removed += [r.inKey, r.outKey].filter(Boolean).length;
  }
  return { removed };
}
