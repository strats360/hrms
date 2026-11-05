import { ApiError, badRequest, notFound } from "../lib/errors";
import { countLeaveDays } from "@hrms/shared";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { employees, holidays, leaveBalances, leaveRequests, leaveTypes, tenants, type Database } from "@hrms/db";
import { accruedLeave, availableBalance, todayIST } from "@hrms/shared";

type Tx = Database;

/**
 * Make sure balance rows exist for an employee/year and refresh the accrued
 * amount from the leave type rules. Returns balances keyed by leave type.
 */
export async function ensureBalances(db: Tx, tenantId: string, employeeId: string, year: number, asOf = todayIST()) {
  const [emp] = await db.select({ doj: employees.dateOfJoining }).from(employees).where(eq(employees.id, employeeId));
  const types = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.active, true)));
  const existing = await db
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.tenantId, tenantId), eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.year, year)));
  const byType = new Map(existing.map((b) => [b.leaveTypeId, b]));

  for (const t of types) {
    const accrued = accruedLeave({ annualQuota: Number(t.annualQuota), accrual: t.accrual as "yearly" | "monthly" | "none" }, year, asOf, emp?.doj);
    const cur = byType.get(t.id);
    if (!cur) {
      const [row] = await db
        .insert(leaveBalances)
        .values({ tenantId, employeeId, leaveTypeId: t.id, year, accrued })
        .onConflictDoNothing()
        .returning();
      if (row) byType.set(t.id, row);
    } else if (Number(cur.accrued) !== accrued) {
      await db.update(leaveBalances).set({ accrued }).where(eq(leaveBalances.id, cur.id));
      byType.set(t.id, { ...cur, accrued });
    }
  }
  return { types, balances: byType };
}

export async function pendingDays(db: Tx, tenantId: string, employeeId: string, leaveTypeId: string, year: number) {
  const [r] = await db
    .select({ d: sql<number>`coalesce(sum(${leaveRequests.days}),0)::float` })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, tenantId),
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.leaveTypeId, leaveTypeId),
        eq(leaveRequests.status, "pending"),
        gte(leaveRequests.startDate, `${year}-01-01`),
        lte(leaveRequests.startDate, `${year}-12-31`),
      ),
    );
  return Number(r?.d ?? 0);
}

export async function holidaySet(db: Tx, tenantId: string, from: string, to: string, branchId?: string | null) {
  const rows = await db
    .select({ date: holidays.date, branchId: holidays.branchId })
    .from(holidays)
    .where(and(eq(holidays.tenantId, tenantId), gte(holidays.date, from), lte(holidays.date, to)));
  return new Set(rows.filter((h) => !h.branchId || h.branchId === branchId).map((h) => h.date));
}

export async function tenantWeeklyOffs(db: Tx, tenantId: string): Promise<number[]> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.settings?.weeklyOffs ?? [0, 6];
}

/** Next human-readable leave request code (LV-1001...). */
export async function nextLeaveCode(db: Tx, tenantId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(substring(${leaveRequests.code} from 4)::int), 1000)::int` })
    .from(leaveRequests)
    .where(eq(leaveRequests.tenantId, tenantId));
  return "LV-" + ((r?.n ?? 1000) + 1);
}

/** Adjust the `used` counter when a request is approved (+) or an approved one is cancelled (-). */
export async function applyUsage(db: Tx, tenantId: string, employeeId: string, leaveTypeId: string, year: number, delta: number) {
  await ensureBalances(db, tenantId, employeeId, year);
  await db
    .update(leaveBalances)
    .set({ used: sql`${leaveBalances.used} + ${delta}` })
    .where(
      and(
        eq(leaveBalances.tenantId, tenantId),
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year),
      ),
    );
}

export async function balanceSummary(db: Tx, tenantId: string, employeeId: string, year: number) {
  const { types, balances } = await ensureBalances(db, tenantId, employeeId, year);
  const pend = await db
    .select({ leaveTypeId: leaveRequests.leaveTypeId, d: sql<number>`sum(${leaveRequests.days})::float` })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, tenantId),
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.status, "pending"),
        inArray(
          leaveRequests.leaveTypeId,
          types.map((t) => t.id),
        ),
      ),
    )
    .groupBy(leaveRequests.leaveTypeId);
  const pendMap = new Map(pend.map((p) => [p.leaveTypeId, Number(p.d)]));
  return types.map((t) => {
    const b = balances.get(t.id);
    const bal = b
      ? { opening: Number(b.opening), accrued: Number(b.accrued), used: Number(b.used), adjusted: Number(b.adjusted) }
      : { opening: 0, accrued: 0, used: 0, adjusted: 0 };
    return {
      leaveTypeId: t.id,
      code: t.code,
      name: t.name,
      isPaid: t.isPaid,
      annualQuota: Number(t.annualQuota),
      ...bal,
      pending: pendMap.get(t.id) ?? 0,
      available: availableBalance(bal),
    };
  });
}

// ---------------------------------------------------------------------------
// Apply / decide / cancel
// ---------------------------------------------------------------------------

export async function applyLeave(
  db: Database,
  tenantId: string,
  input: { employeeId: string; leaveTypeId: string; startDate: string; endDate: string; halfDay: boolean; reason?: string | null },
  appliedByUserId: string,
) {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, tenantId)));
  if (!emp) throw notFound("Employee");
  const [type] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.tenantId, tenantId)));
  if (!type || !type.active) throw badRequest("Pick a valid leave type");
  if (input.halfDay && !type.allowHalfDay) throw badRequest(`${type.name} can't be taken as a half day`);
  if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) throw badRequest("Leave can't span two calendar years. Apply for each year separately.");
  if (input.startDate < emp.dateOfJoining) throw badRequest("Leave can't start before the date of joining");

  const offs = await tenantWeeklyOffs(db, tenantId);
  const hol = await holidaySet(db, tenantId, input.startDate, input.endDate, emp.branchId);
  const days = countLeaveDays(input.startDate, input.endDate, { halfDay: input.halfDay, weeklyOffs: offs, holidays: hol });
  if (days <= 0) throw badRequest("Those dates are all weekly offs or holidays");

  const [overlap] = await db
    .select({ code: leaveRequests.code })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, tenantId),
        eq(leaveRequests.employeeId, emp.id),
        inArray(leaveRequests.status, ["pending", "approved"]),
        lte(leaveRequests.startDate, input.endDate),
        gte(leaveRequests.endDate, input.startDate),
      ),
    );
  if (overlap) throw new ApiError(409, `These dates overlap request ${overlap.code}`, "conflict");

  const year = Number(input.startDate.slice(0, 4));
  if (type.isPaid && !type.allowNegative) {
    const summary = await balanceSummary(db, tenantId, emp.id, year);
    const bal = summary.find((s) => s.leaveTypeId === type.id);
    const free = (bal?.available ?? 0) - (bal?.pending ?? 0);
    if (days > free) throw badRequest(`Not enough ${type.name} balance: ${free} day(s) available, ${days} requested`);
  }

  const code = await nextLeaveCode(db, tenantId);
  const [row] = await db
    .insert(leaveRequests)
    .values({ tenantId, code, employeeId: emp.id, leaveTypeId: type.id, startDate: input.startDate, endDate: input.endDate, halfDay: input.halfDay, days, reason: input.reason ?? null, appliedByUserId })
    .returning();
  return { request: row!, employee: emp, type };
}

export async function decideLeave(db: Database, tenantId: string, id: string, decision: "approved" | "rejected", userId: string, note?: string | null) {
  const [req] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenantId)));
  if (!req) throw notFound("Leave request");
  if (req.status !== "pending") throw badRequest("This request has already been decided");
  if (decision === "rejected" && !note) throw badRequest("Add a reason for rejecting");
  return db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const [updated] = await t
      .update(leaveRequests)
      .set({ status: decision, approverUserId: userId, decidedAt: new Date(), decisionNote: note ?? null })
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.status, "pending")))
      .returning();
    if (!updated) throw badRequest("This request has already been decided");
    if (decision === "approved") await applyUsage(t, tenantId, req.employeeId, req.leaveTypeId, Number(req.startDate.slice(0, 4)), Number(req.days));
    return updated;
  });
}

export async function cancelLeave(db: Database, tenantId: string, id: string, userId: string) {
  const [req] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenantId)));
  if (!req) throw notFound("Leave request");
  if (req.status !== "pending" && req.status !== "approved") throw badRequest("Only pending or approved requests can be cancelled");
  return db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    await t.update(leaveRequests).set({ status: "cancelled", decidedAt: new Date(), approverUserId: userId }).where(eq(leaveRequests.id, id));
    if (req.status === "approved") await applyUsage(t, tenantId, req.employeeId, req.leaveTypeId, Number(req.startDate.slice(0, 4)), -Number(req.days));
    return req;
  });
}
