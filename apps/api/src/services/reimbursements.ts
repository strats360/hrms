import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { employees, reimbursementCategories, reimbursementClaims, type Database } from "@hrms/db";
import { can, type PermissionMatrix } from "@hrms/shared";

export type Category = typeof reimbursementCategories.$inferSelect;
export type Claim = typeof reimbursementClaims.$inferSelect;

export const OPEN = ["pending_manager", "pending_finance"] as const;
const COUNTED = ["pending_manager", "pending_finance", "approved", "paid"];

export async function nextClaimCode(db: Database, tenantId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(substring(${reimbursementClaims.code} from 4)::int), 1000)::int` })
    .from(reimbursementClaims)
    .where(eq(reimbursementClaims.tenantId, tenantId));
  return "RB-" + ((r?.n ?? 1000) + 1);
}

/** Amount for a claim: km x rate for per-km categories, otherwise what was entered. */
export function claimAmount(cat: Category, input: { amount?: number; km?: number }) {
  if (cat.limitPeriod === "km") return Math.round((input.km ?? 0) * Number(cat.ratePerKm ?? 0) * 100) / 100;
  return Math.round((input.amount ?? 0) * 100) / 100;
}

/**
 * Policy check. Day and month limits add up the employee's other claims in the
 * same category; claim, trip and night limits apply to this claim alone.
 */
export async function overLimit(db: Database, tenantId: string, cat: Category, employeeId: string, expenseDate: string, amount: number, excludeId?: string) {
  if (cat.limitAmount === null || cat.limitAmount === undefined || cat.limitPeriod === "km") return { over: false, used: 0, limit: null as number | null };
  const limit = Number(cat.limitAmount);
  let used = 0;
  if (cat.limitPeriod === "day" || cat.limitPeriod === "month") {
    const conds = [
      eq(reimbursementClaims.tenantId, tenantId),
      eq(reimbursementClaims.employeeId, employeeId),
      eq(reimbursementClaims.categoryId, cat.id),
      inArray(reimbursementClaims.status, COUNTED),
      cat.limitPeriod === "day" ? eq(reimbursementClaims.expenseDate, expenseDate) : sql`to_char(${reimbursementClaims.expenseDate}, 'YYYY-MM') = ${expenseDate.slice(0, 7)}`,
    ];
    if (excludeId) conds.push(ne(reimbursementClaims.id, excludeId));
    const [r] = await db.select({ s: sql<number>`coalesce(sum(${reimbursementClaims.amount}),0)::float` }).from(reimbursementClaims).where(and(...conds));
    used = Number(r?.s ?? 0);
  }
  return { over: used + amount > limit, used, limit };
}

const needsManager = (cat: Category) => cat.approval === "manager" || cat.approval === "manager_finance";
const needsFinance = (cat: Category, over: boolean) => cat.approval === "finance" || cat.approval === "manager_finance" || over;

/** First stage for a new claim. Without a reporting manager it goes straight to finance. */
export function initialStatus(cat: Category, hasManager: boolean) {
  if (needsManager(cat) && hasManager) return "pending_manager";
  return "pending_finance";
}

/** Status after approval at the current stage. */
export function nextStatus(claim: Claim, cat: Category) {
  if (claim.status === "pending_manager" && !needsFinance(cat, claim.overLimit)) return "approved";
  if (claim.status === "pending_manager") return "pending_finance";
  return "approved";
}

/** Finance stage: approve rights plus payments approval (finance) or org-wide reimbursement rights (admin). */
export const isFinance = (p: PermissionMatrix) => can(p, "reimbursements", "approve") && (can(p, "payments", "approve") || can(p, "reimbursements", "configure"));
/** Who sees every claim: admins, finance, and read-only roles (HR, payroll, auditors). Approvers without finance rights are managers and see their team. */
export const isOrgWide = (p: PermissionMatrix) => can(p, "reimbursements", "configure") || isFinance(p) || !can(p, "reimbursements", "approve");

/** Can this user act on the claim at its current stage? Returns a reason when not. */
export async function canDecide(db: Database, claim: Claim, actor: { employeeId: string | null; permissions: PermissionMatrix }) {
  if (!can(actor.permissions, "reimbursements", "approve")) return "You don't have approval rights for claims";
  if (claim.employeeId === actor.employeeId) return "You can't approve your own claim";
  if (claim.status === "pending_manager") {
    if (can(actor.permissions, "reimbursements", "configure")) return null;
    const [e] = await db.select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, claim.employeeId));
    if (e?.managerId && e.managerId === actor.employeeId) return null;
    return "Only the employee's reporting manager can approve this stage";
  }
  if (claim.status === "pending_finance") return isFinance(actor.permissions) ? null : "This claim is waiting for finance approval";
  return "This claim has already been decided";
}

/** Approved claims ready for a payroll month (final approval on or before the period end, not yet in a run). */
export async function claimsForRun(db: Database, tenantId: string, runId: string, periodEnd: string, employeeIds: string[]) {
  // release claims an earlier calculation of this run picked up, then pick again
  await db.update(reimbursementClaims).set({ payrollRunId: null }).where(and(eq(reimbursementClaims.payrollRunId, runId), eq(reimbursementClaims.status, "approved")));
  if (!employeeIds.length) return new Map<string, number>();
  const approvedOn = sql`coalesce(${reimbursementClaims.financeApprovedAt}, ${reimbursementClaims.managerApprovedAt})`;
  const rows = await db
    .select({ id: reimbursementClaims.id, employeeId: reimbursementClaims.employeeId, amount: reimbursementClaims.amount })
    .from(reimbursementClaims)
    .where(
      and(
        eq(reimbursementClaims.tenantId, tenantId),
        eq(reimbursementClaims.status, "approved"),
        isNull(reimbursementClaims.payrollRunId),
        isNull(reimbursementClaims.paymentId),
        inArray(reimbursementClaims.employeeId, employeeIds),
        sql`(${approvedOn} at time zone 'Asia/Kolkata')::date <= ${periodEnd}::date`,
      ),
    );
  if (rows.length) await db.update(reimbursementClaims).set({ payrollRunId: runId }).where(inArray(reimbursementClaims.id, rows.map((r) => r.id)));
  const byEmp = new Map<string, number>();
  for (const r of rows) byEmp.set(r.employeeId, (byEmp.get(r.employeeId) ?? 0) + Number(r.amount));
  return byEmp;
}

/** When a run is paid: its claims are paid, except held salaries (released to the next run). */
export async function settleClaims(db: Database, runId: string, heldEmployeeIds: string[]) {
  const paid = db
    .update(reimbursementClaims)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(reimbursementClaims.payrollRunId, runId), eq(reimbursementClaims.status, "approved"), heldEmployeeIds.length ? notInArray(reimbursementClaims.employeeId, heldEmployeeIds) : undefined));
  await paid;
  if (heldEmployeeIds.length)
    await db
      .update(reimbursementClaims)
      .set({ payrollRunId: null })
      .where(and(eq(reimbursementClaims.payrollRunId, runId), eq(reimbursementClaims.status, "approved"), inArray(reimbursementClaims.employeeId, heldEmployeeIds)));
}

