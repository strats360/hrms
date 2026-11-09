import { and, between, eq, inArray, sql } from "drizzle-orm";
import { attendanceRecords, employees, leaveBalances, leaveEncashments, leaveTypes, payrollAdjustments, payrollItems, payrollRuns, tenants, type Database } from "@hrms/db";
import { accruedLeave, DEFAULT_OVERTIME, encashmentPerDay, overtimePay, todayIST, type OvertimeSettings } from "@hrms/shared";
import { balanceSummary, ensureBalances } from "./leave";
import { getTemplate, resolveStructure, structuresAsOf } from "./payroll";

type Run = typeof payrollRuns.$inferSelect;

export async function overtimeSettings(db: Database, tenantId: string): Promise<OvertimeSettings> {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...DEFAULT_OVERTIME, ...((t?.s as { overtime?: Partial<OvertimeSettings> } | undefined)?.overtime ?? {}) };
}

async function monthlyPay(db: Database, tenantId: string, ids: string[], asOf: string) {
  if (!ids.length) return new Map<string, { basic: number; gross: number }>();
  const template = await getTemplate(db, tenantId);
  const structs = await structuresAsOf(db, tenantId, ids, asOf);
  const emps = await db.select().from(employees).where(inArray(employees.id, ids));
  return new Map(emps.map((e) => {
    const s = resolveStructure(e, structs.get(e.id), template);
    return [e.id, { basic: s.components.basic, gross: s.gross }];
  }));
}

/** Overtime worked in the run's period, from attendance, priced at the overtime rate. */
export async function overtimeForRun(db: Database, run: Run) {
  const settings = await overtimeSettings(db, run.tenantId);
  const inRun = await db.select({ e: payrollItems.employeeId, code: employees.employeeCode, name: employees.fullName }).from(payrollItems).innerJoin(employees, eq(employees.id, payrollItems.employeeId)).where(eq(payrollItems.runId, run.id));
  const ids = inRun.map((r) => r.e);
  const worked = ids.length
    ? await db
        .select({ e: attendanceRecords.employeeId, m: sql<number>`coalesce(sum(${attendanceRecords.overtimeMinutes}),0)::int`, days: sql<number>`count(*) filter (where ${attendanceRecords.overtimeMinutes} > 0)::int` })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.tenantId, run.tenantId), inArray(attendanceRecords.employeeId, ids), between(attendanceRecords.date, run.periodStart, run.periodEnd)))
        .groupBy(attendanceRecords.employeeId)
    : [];
  const byEmp = new Map(worked.map((w) => [w.e, w]));
  const current = await db.select().from(payrollAdjustments).where(and(eq(payrollAdjustments.runId, run.id), eq(payrollAdjustments.source, "overtime")));
  const pay = await monthlyPay(db, run.tenantId, ids, run.periodEnd);
  const rows = inRun
    .map((r) => {
      const w = byEmp.get(r.e);
      const hours = Math.round(((w?.m ?? 0) / 60) * 100) / 100;
      const p = overtimePay(hours, pay.get(r.e) ?? { basic: 0, gross: 0 }, settings);
      const cur = current.find((a) => a.employeeId === r.e);
      return { employeeId: r.e, employeeCode: r.code, name: r.name, days: w?.days ?? 0, hours, ratePerHour: p.ratePerHour, amount: p.amount, overLimit: p.overLimit, paid: cur ? { hours: Number(cur.sourceRef ?? 0), amount: Number(cur.amount) } : null };
    })
    .filter((r) => r.hours > 0 || r.paid)
    .sort((a, b) => b.hours - a.hours);
  return { settings, rows };
}

/** Replace the run's overtime lines with these approved hours. */
export async function setOvertime(db: Database, run: Run, hours: { employeeId: string; hours: number }[], userId: string) {
  const settings = await overtimeSettings(db, run.tenantId);
  const inRun = new Set((await db.select({ e: payrollItems.employeeId }).from(payrollItems).where(eq(payrollItems.runId, run.id))).map((r) => r.e));
  const list = hours.filter((h) => h.hours > 0 && inRun.has(h.employeeId));
  const pay = await monthlyPay(db, run.tenantId, list.map((h) => h.employeeId), run.periodEnd);
  await db.delete(payrollAdjustments).where(and(eq(payrollAdjustments.runId, run.id), eq(payrollAdjustments.source, "overtime")));
  let total = 0;
  for (const h of list) {
    const p = overtimePay(h.hours, pay.get(h.employeeId) ?? { basic: 0, gross: 0 }, settings);
    if (p.amount <= 0) continue;
    total += p.amount;
    // OT is taxable and counts as ESI wages, but isn't PF wages (adjustments never are)
    await db.insert(payrollAdjustments).values({ tenantId: run.tenantId, runId: run.id, employeeId: h.employeeId, kind: "earning", label: `Overtime (${h.hours} h × ₹${p.ratePerHour.toLocaleString("en-IN")})`, amount: p.amount, taxable: true, esiWage: true, source: "overtime", sourceRef: String(h.hours), createdBy: userId });
  }
  return { employees: list.length, total };
}

// ---------------------------------------------------------------------------
// Leave encashment
// ---------------------------------------------------------------------------
export async function createEncashment(db: Database, tenantId: string, b: { employeeId: string; leaveTypeId: string; days: number; note?: string | null }, userId: string) {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tenantId)));
  if (!emp) throw new Error("Employee not found");
  if (emp.status === "exited" || emp.status === "inactive") throw new Error(`${emp.fullName} has left. Leave is encashed in their full and final settlement.`);
  const [type] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, b.leaveTypeId), eq(leaveTypes.tenantId, tenantId)));
  if (!type) throw new Error("Leave type not found");
  if (!type.encashable) throw new Error(`${type.name} can't be encashed. Turn on encashment for it under leave policies.`);
  const year = Number(todayIST().slice(0, 4));
  const bal = (await balanceSummary(db, tenantId, emp.id, year)).find((x) => x.leaveTypeId === type.id);
  const free = Math.max(0, (bal?.available ?? 0) - (bal?.pending ?? 0));
  if (b.days > free) throw new Error(`Only ${free} day${free === 1 ? "" : "s"} of ${type.name} can be encashed`);
  const pay = (await monthlyPay(db, tenantId, [emp.id], todayIST())).get(emp.id)!;
  const perDay = encashmentPerDay(pay.basic);
  const [row] = await db.insert(leaveEncashments).values({ tenantId, employeeId: emp.id, leaveTypeId: type.id, year, days: b.days, perDay, amount: Math.round(perDay * b.days), reason: "request", note: b.note ?? null, createdBy: userId }).returning();
  // the days come off the balance now, so they can't be taken as leave as well
  await db.update(leaveBalances).set({ adjusted: sql`${leaveBalances.adjusted} - ${b.days}` }).where(and(eq(leaveBalances.employeeId, emp.id), eq(leaveBalances.leaveTypeId, type.id), eq(leaveBalances.year, year)));
  return { row: row!, employee: emp, type };
}

export async function cancelEncashment(db: Database, tenantId: string, id: string) {
  const [row] = await db.update(leaveEncashments).set({ status: "cancelled" }).where(and(eq(leaveEncashments.id, id), eq(leaveEncashments.tenantId, tenantId), eq(leaveEncashments.status, "pending"))).returning();
  if (!row) return null;
  if (row.reason === "request") await db.update(leaveBalances).set({ adjusted: sql`${leaveBalances.adjusted} + ${row.days}` }).where(and(eq(leaveBalances.employeeId, row.employeeId), eq(leaveBalances.leaveTypeId, row.leaveTypeId), eq(leaveBalances.year, row.year)));
  return row;
}

/** Put pending encashments for employees in this run onto it as one-time earnings. */
export async function addEncashmentsToRun(db: Database, run: Run, userId: string) {
  const inRun = (await db.select({ e: payrollItems.employeeId }).from(payrollItems).where(eq(payrollItems.runId, run.id))).map((r) => r.e);
  if (!inRun.length) return { added: 0, total: 0 };
  const pending = await db
    .select({ x: leaveEncashments, type: leaveTypes.name })
    .from(leaveEncashments)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEncashments.leaveTypeId))
    .where(and(eq(leaveEncashments.tenantId, run.tenantId), eq(leaveEncashments.status, "pending"), inArray(leaveEncashments.employeeId, inRun)));
  let total = 0;
  for (const { x, type } of pending) {
    const [claimed] = await db.update(leaveEncashments).set({ status: "in_payroll", runId: run.id }).where(and(eq(leaveEncashments.id, x.id), eq(leaveEncashments.status, "pending"))).returning();
    if (!claimed) continue;
    // taxable salary; not ESI wages (leave encashment is excluded), and never PF wages
    await db.insert(payrollAdjustments).values({ tenantId: run.tenantId, runId: run.id, employeeId: x.employeeId, kind: "earning", label: `${type} encashment (${x.days} day${x.days === 1 ? "" : "s"}${x.reason === "year_end" ? `, ${x.year}` : ""})`, amount: x.amount, taxable: true, esiWage: false, source: "encashment", sourceRef: x.id, createdBy: userId });
    total += Number(x.amount);
  }
  return { added: pending.length, total };
}

/** An encashment line removed from a run goes back to waiting for the next one. */
export async function releaseEncashment(db: Database, adjustment: typeof payrollAdjustments.$inferSelect) {
  if (adjustment.source === "encashment" && adjustment.sourceRef) await db.update(leaveEncashments).set({ status: "pending", runId: null }).where(and(eq(leaveEncashments.id, adjustment.sourceRef), eq(leaveEncashments.status, "in_payroll")));
}

// ---------------------------------------------------------------------------
// Closing a leave year
// ---------------------------------------------------------------------------
/**
 * Carry leave into the next year: each type's unused balance, up to its carry-forward
 * limit, becomes next year's opening balance. The rest lapses, and for encashable types
 * it can be paid out instead. Safe to run again (for late approvals): it recomputes from
 * the closed year and leaves encashments already in payroll alone.
 */
async function existingBalances(db: Database, employeeId: string, year: number) {
  const rows = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.year, year)));
  return { balances: new Map(rows.map((r) => [r.leaveTypeId, r])) };
}

/** Whether the system has leave data for a year (so closing it means something). */
export async function hasLeaveYear(db: Database, tenantId: string, year: number) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(leaveBalances).where(and(eq(leaveBalances.tenantId, tenantId), eq(leaveBalances.year, year)));
  return (r?.n ?? 0) > 0;
}

export async function closeLeaveYear(db: Database, tenantId: string, year: number, opts: { encashLapsed: boolean; dryRun: boolean }, userId: string) {
  const end = `${year}-12-31`;
  const emps = await db
    .select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, lwd: employees.lastWorkingDay, status: employees.status, doj: employees.dateOfJoining })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, tenantId),
        sql`${employees.dateOfJoining} <= ${end}`,
        sql`(${employees.lastWorkingDay} is null or ${employees.lastWorkingDay} > ${end})`,
        sql`${employees.status} not in ('exited','inactive')`,
        // only people whose leave was tracked here that year: a company that started mid-way
        // shouldn't carry a full year of "unused" leave that was really taken before
        sql`exists (select 1 from ${leaveBalances} b where b.employee_id = ${employees.id} and b.year = ${year})`,
      ),
    );
  const types = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.active, true)));
  const pay = opts.encashLapsed ? await monthlyPay(db, tenantId, emps.map((e) => e.id), end) : new Map();
  const rows: { employeeCode: string; name: string; type: string; left: number; carried: number; lapsed: number; encashed: number }[] = [];
  let carried = 0;
  let lapsed = 0;
  let encashDays = 0;
  let encashAmount = 0;
  for (const e of emps) {
    // accrue the full year (monthly accrual stops at the date it was last read)
    const { balances } = opts.dryRun ? await existingBalances(db, e.id, year) : await ensureBalances(db, tenantId, e.id, year, end);
    for (const t of types) {
      const b = balances.get(t.id);
      if (!b || !t.isPaid) continue;
      const accrued = opts.dryRun ? accruedLeave({ annualQuota: Number(t.annualQuota), accrual: t.accrual as "yearly" | "monthly" | "none" }, year, end, e.doj) : Number(b.accrued);
      const left = Math.max(0, Number(b.opening) + accrued + Number(b.adjusted) - Number(b.used));
      const carry = Math.min(left, Number(t.carryForwardMax));
      const lapse = Math.round((left - carry) * 10) / 10;
      const encash = opts.encashLapsed && t.encashable ? lapse : 0;
      if (left === 0 && carry === 0) continue;
      rows.push({ employeeCode: e.code, name: e.name, type: t.name, left, carried: carry, lapsed: lapse - encash, encashed: encash });
      carried += carry;
      lapsed += lapse - encash;
      encashDays += encash;
      if (opts.dryRun) {
        if (encash > 0) encashAmount += Math.round(encashmentPerDay(pay.get(e.id)?.basic ?? 0) * encash);
        continue;
      }
      await ensureBalances(db, tenantId, e.id, year + 1, `${year + 1}-01-01`);
      await db.update(leaveBalances).set({ opening: carry }).where(and(eq(leaveBalances.employeeId, e.id), eq(leaveBalances.leaveTypeId, t.id), eq(leaveBalances.year, year + 1)));
      if (encash > 0) {
        const perDay = encashmentPerDay(pay.get(e.id)?.basic ?? 0);
        const amount = Math.round(perDay * encash);
        encashAmount += amount;
        await db
          .insert(leaveEncashments)
          .values({ tenantId, employeeId: e.id, leaveTypeId: t.id, year, days: encash, perDay, amount, reason: "year_end", createdBy: userId })
          .onConflictDoUpdate({ target: [leaveEncashments.employeeId, leaveEncashments.leaveTypeId, leaveEncashments.year], targetWhere: sql`reason = 'year_end'`, set: { days: encash, perDay, amount, updatedAt: new Date() }, setWhere: sql`${leaveEncashments.status} = 'pending'` });
      }
    }
  }
  if (!opts.dryRun) {
    await db.update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ leaveYearClosed: year })}::jsonb` }).where(eq(tenants.id, tenantId));
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { year, employees: emps.length, carriedDays: r1(carried), lapsedDays: r1(lapsed), encashDays: r1(encashDays), encashAmount, rows: rows.slice(0, 1000) };
}
