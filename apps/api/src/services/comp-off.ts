import { and, asc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { attendanceRecords, compOffRequests, employees, leaveBalances, leaveTypes, tenants, type Database } from "@hrms/db";
import { todayIST, weekday } from "@hrms/shared";
import { holidaySet, isDayOff, shiftFor } from "./attendance";
import { ensureBalances } from "./leave";

export type CompOff = typeof compOffRequests.$inferSelect;
export const COMP_OFF_DEFAULTS = { expiryDays: 60, claimWithinDays: 30 };

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export async function compOffSettings(db: Database, tenantId: string) {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...COMP_OFF_DEFAULTS, ...((t?.s as { compOff?: Partial<typeof COMP_OFF_DEFAULTS> } | undefined)?.compOff ?? {}) };
}

async function compOffType(db: Database, tenantId: string) {
  const [t] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.code, "CO")));
  return t ?? null;
}

/**
 * Was this day a weekly off or holiday for the employee, and did they work it? A full
 * shift's worth earns a day, half of it earns half a day.
 */
export async function eligibility(db: Database, tenantId: string, emp: typeof employees.$inferSelect, date: string) {
  const shift = await shiftFor(db, tenantId, emp.id, date);
  const holiday = (await holidaySet(db, tenantId, date, date, emp.branchId)).has(date);
  const off = isDayOff(shift, date);
  if (!holiday && !off) return { ok: false as const, reason: "That was a working day. Comp off is for work on a weekly off or holiday." };
  const [rec] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.employeeId, emp.id), eq(attendanceRecords.date, date)));
  const minutes = rec?.workMinutes ?? 0;
  const days = minutes >= shift.fullDayMinutes ? 1 : minutes >= shift.halfDayMinutes ? 0.5 : 0;
  if (!days) return { ok: false as const, reason: rec?.checkIn && !rec.checkOut ? "There's no check-out for that day yet" : `No work is recorded for that day${rec ? ` beyond ${Math.round(minutes / 6) / 10} h` : ""}. Ask for an attendance correction first.` };
  return { ok: true as const, dayType: holiday ? "holiday" : "weekly_off", workMinutes: minutes, days };
}

/** Off days the employee worked recently and hasn't claimed yet. */
export async function claimableDays(db: Database, tenantId: string, emp: typeof employees.$inferSelect) {
  const { claimWithinDays } = await compOffSettings(db, tenantId);
  const today = todayIST();
  const from = addDays(today, -claimWithinDays);
  const worked = await db
    .select({ date: attendanceRecords.date })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.employeeId, emp.id), gte(attendanceRecords.date, from), lte(attendanceRecords.date, today), sql`${attendanceRecords.workMinutes} > 0`))
    .orderBy(asc(attendanceRecords.date));
  const claimed = new Set((await db.select({ d: compOffRequests.workDate }).from(compOffRequests).where(and(eq(compOffRequests.employeeId, emp.id), inArray(compOffRequests.status, ["pending", "approved", "expired"])))).map((r) => r.d));
  const out: { date: string; dayType: string; days: number }[] = [];
  for (const { date } of worked) {
    if (claimed.has(date)) continue;
    const e = await eligibility(db, tenantId, emp, date);
    if (e.ok) out.push({ date, dayType: e.dayType, days: e.days });
  }
  return out;
}

export class CompOffError extends Error {}

export async function requestCompOff(db: Database, tenantId: string, emp: typeof employees.$inferSelect, b: { date: string; days?: number; reason: string }, userId: string) {
  if (!(await compOffType(db, tenantId))) throw new CompOffError("Comp off isn't set up: add a leave type with code CO under leave policies");
  const { claimWithinDays } = await compOffSettings(db, tenantId);
  const today = todayIST();
  if (b.date > today) throw new CompOffError("You can claim comp off only after you've worked the day");
  if (b.date < addDays(today, -claimWithinDays)) throw new CompOffError(`Comp off has to be claimed within ${claimWithinDays} days of the work`);
  const e = await eligibility(db, tenantId, emp, b.date);
  if (!e.ok) throw new CompOffError(e.reason);
  const days = Math.min(b.days ?? e.days, e.days);
  const [dup] = await db.select({ id: compOffRequests.id }).from(compOffRequests).where(and(eq(compOffRequests.employeeId, emp.id), eq(compOffRequests.workDate, b.date), inArray(compOffRequests.status, ["pending", "approved", "expired"])));
  if (dup) throw new CompOffError("Comp off for that day is already claimed");
  const [row] = await db.insert(compOffRequests).values({ tenantId, employeeId: emp.id, workDate: b.date, dayType: e.dayType, workMinutes: e.workMinutes, days, reason: b.reason, createdBy: userId }).returning();
  return row!;
}

/** Approve: credit the comp off balance, valid until the expiry date. */
export async function approveCompOff(db: Database, row: CompOff, userId: string, note: string | null) {
  const { expiryDays } = await compOffSettings(db, row.tenantId);
  const type = await compOffType(db, row.tenantId);
  if (!type) throw new CompOffError("There's no comp off (CO) leave type");
  const expiresOn = addDays(row.workDate, expiryDays);
  const [updated] = await db.update(compOffRequests).set({ status: "approved", decidedBy: userId, decidedAt: new Date(), decisionNote: note, expiresOn }).where(and(eq(compOffRequests.id, row.id), eq(compOffRequests.status, "pending"))).returning();
  if (!updated) throw new CompOffError("This request has already been decided");
  const year = Number(todayIST().slice(0, 4));
  await ensureBalances(db, row.tenantId, row.employeeId, year);
  await db.update(leaveBalances).set({ adjusted: sql`${leaveBalances.adjusted} + ${row.days}` }).where(and(eq(leaveBalances.employeeId, row.employeeId), eq(leaveBalances.leaveTypeId, type.id), eq(leaveBalances.year, year)));
  return updated;
}

/**
 * Lapse comp off that's past its expiry and wasn't used. Credits are used oldest first,
 * so what's left of a balance after setting aside the still-valid later credits is what
 * remains of the expired one.
 */
export async function expireCompOff(db: Database, tenantId?: string, today = todayIST()) {
  const due = await db
    .select()
    .from(compOffRequests)
    .where(and(eq(compOffRequests.status, "approved"), lt(compOffRequests.expiresOn, today), tenantId ? eq(compOffRequests.tenantId, tenantId) : undefined))
    .orderBy(asc(compOffRequests.expiresOn));
  let lapsed = 0;
  for (const c of due) {
    const type = await compOffType(db, c.tenantId);
    if (!type) continue;
    const year = Number(today.slice(0, 4));
    const [b] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, c.employeeId), eq(leaveBalances.leaveTypeId, type.id), eq(leaveBalances.year, year)));
    const available = b ? Number(b.opening) + Number(b.accrued) + Number(b.adjusted) - Number(b.used) : 0;
    const [later] = await db
      .select({ d: sql<number>`coalesce(sum(${compOffRequests.days}),0)::float` })
      .from(compOffRequests)
      .where(and(eq(compOffRequests.employeeId, c.employeeId), eq(compOffRequests.status, "approved"), gte(compOffRequests.expiresOn, today), ne(compOffRequests.id, c.id)));
    const unused = Math.max(0, Math.min(Number(c.days), available - Number(later?.d ?? 0)));
    const [row] = await db.update(compOffRequests).set({ status: "expired", lapsedDays: unused }).where(and(eq(compOffRequests.id, c.id), eq(compOffRequests.status, "approved"))).returning();
    if (row && unused > 0 && b) {
      await db.update(leaveBalances).set({ adjusted: sql`${leaveBalances.adjusted} - ${unused}` }).where(eq(leaveBalances.id, b.id));
      lapsed += unused;
    }
  }
  return { expired: due.length, lapsedDays: lapsed };
}
