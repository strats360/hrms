import { and, desc, eq, inArray, like } from "drizzle-orm";
import { employeeLoans, loanRepayments, payrollAdjustments, payrollRuns, tenants, type Database } from "@hrms/db";
import { DEFAULT_LOAN_POLICY, emiFor, LOAN_TYPE_LABEL, loanSchedule, todayIST, totalPayable, type LoanPolicy, type LoanType } from "@hrms/shared";

export type Loan = typeof employeeLoans.$inferSelect;
const LOCKED = ["approved", "paid"];
const OPEN = ["draft", "calculated"];

export async function loanPolicy(db: Database, tenantId: string): Promise<LoanPolicy> {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...DEFAULT_LOAN_POLICY, ...((t?.s as { loanPolicy?: Partial<LoanPolicy> } | null)?.loanPolicy ?? {}) };
}

export async function nextLoanCode(db: Database, tenantId: string, type: LoanType) {
  const prefix = type === "advance" ? "ADV" : "LN";
  const [last] = await db
    .select({ code: employeeLoans.code })
    .from(employeeLoans)
    .where(and(eq(employeeLoans.tenantId, tenantId), like(employeeLoans.code, `${prefix}-%`)))
    .orderBy(desc(employeeLoans.code))
    .limit(1);
  const n = last ? Number(last.code.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/** What's been recovered (locked payroll and repayments) and what's in payroll still open. */
export async function recoveredFor(db: Database, loanIds: string[]) {
  const out = new Map<string, { recovered: number; pending: number; payroll: { month: string; amount: number; locked: boolean }[]; repayments: (typeof loanRepayments.$inferSelect)[] }>();
  for (const id of loanIds) out.set(id, { recovered: 0, pending: 0, payroll: [], repayments: [] });
  if (!loanIds.length) return out;
  const runs = await db
    .select({ loanId: payrollAdjustments.sourceRef, amount: payrollAdjustments.amount, month: payrollRuns.month, status: payrollRuns.status })
    .from(payrollAdjustments)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollAdjustments.runId))
    .where(and(eq(payrollAdjustments.source, "loan"), inArray(payrollAdjustments.sourceRef, loanIds)));
  for (const r of runs) {
    const o = out.get(r.loanId!)!;
    const locked = LOCKED.includes(r.status);
    if (locked) o.recovered += Number(r.amount);
    else if (OPEN.includes(r.status)) o.pending += Number(r.amount);
    o.payroll.push({ month: r.month, amount: Number(r.amount), locked });
  }
  const reps = await db.select().from(loanRepayments).where(inArray(loanRepayments.loanId, loanIds)).orderBy(loanRepayments.paidOn);
  for (const r of reps) {
    const o = out.get(r.loanId)!;
    o.recovered += Number(r.amount);
    o.repayments.push(r);
  }
  for (const o of out.values()) o.payroll.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

/** The schedule and balances for a loan. */
export function loanSummary(loan: Loan, rec: { recovered: number; pending: number }) {
  const schedule = loanSchedule(Number(loan.amount), Number(loan.interestPct), loan.months, loan.startMonth, loan.skipMonths ?? []);
  const payable = totalPayable(schedule);
  const outstanding = Math.max(0, Math.round(payable - rec.recovered));
  return { schedule, payable, emi: emiFor(Number(loan.amount), Number(loan.interestPct), loan.months), recovered: Math.round(rec.recovered), pending: Math.round(rec.pending), outstanding, afterOpenPayroll: Math.max(0, outstanding - Math.round(rec.pending)) };
}

/**
 * Put this month's loan recoveries into a payroll run, as deduction lines. Called on every
 * calculation, so changes to a loan (paused month, repayment, write-off) are picked up.
 */
export async function syncLoanRecoveries(db: Database, run: { id: string; tenantId: string; month: string }, employeeIds: string[]) {
  await db.delete(payrollAdjustments).where(and(eq(payrollAdjustments.runId, run.id), eq(payrollAdjustments.source, "loan")));
  if (!employeeIds.length) return 0;
  const loans = await db
    .select()
    .from(employeeLoans)
    .where(and(eq(employeeLoans.tenantId, run.tenantId), eq(employeeLoans.status, "active"), inArray(employeeLoans.employeeId, employeeIds)));
  const due = loans.filter((l) => l.startMonth <= run.month && !(l.skipMonths ?? []).includes(run.month));
  if (!due.length) return 0;
  const rec = await recoveredFor(db, due.map((l) => l.id));
  let n = 0;
  for (const l of due) {
    const r = rec.get(l.id)!;
    const s = loanSummary(l, r);
    // anything already in another open run counts against what's left
    const left = s.afterOpenPayroll;
    if (left <= 0) continue;
    const row = s.schedule.find((x) => x.month === run.month);
    const amount = Math.min(row?.emi ?? s.emi, left);
    const nth = row?.n ?? s.schedule.length;
    await db.insert(payrollAdjustments).values({ tenantId: run.tenantId, runId: run.id, employeeId: l.employeeId, kind: "deduction", label: `${LOAN_TYPE_LABEL[l.type as LoanType]} recovery ${l.code} (${nth} of ${s.schedule.length})`, amount, taxable: false, esiWage: false, source: "loan", sourceRef: l.id });
    n++;
  }
  return n;
}

/** Mark loans repaid once nothing is left (after a payroll is locked, or a repayment). */
export async function closeRepaidLoans(db: Database, tenantId: string, loanIds?: string[]) {
  const loans = await db
    .select()
    .from(employeeLoans)
    .where(and(eq(employeeLoans.tenantId, tenantId), eq(employeeLoans.status, "active"), ...(loanIds?.length ? [inArray(employeeLoans.id, loanIds)] : [])));
  if (!loans.length) return 0;
  const rec = await recoveredFor(db, loans.map((l) => l.id));
  let closed = 0;
  for (const l of loans) {
    if (loanSummary(l, rec.get(l.id)!).outstanding <= 0) {
      await db.update(employeeLoans).set({ status: "closed", closedOn: todayIST() }).where(eq(employeeLoans.id, l.id));
      closed++;
    }
  }
  return closed;
}

/** Loans still owed by an employee, for full and final: what's left after payroll already open. */
export async function loansToRecover(db: Database, tenantId: string, employeeId: string) {
  const loans = await db.select().from(employeeLoans).where(and(eq(employeeLoans.tenantId, tenantId), eq(employeeLoans.employeeId, employeeId), eq(employeeLoans.status, "active")));
  const rec = await recoveredFor(db, loans.map((l) => l.id));
  return loans
    .map((l) => ({ loan: l, left: loanSummary(l, rec.get(l.id)!).afterOpenPayroll }))
    .filter((x) => x.left > 0)
    .map((x) => ({ key: `loan:${x.loan.id}`, label: `${LOAN_TYPE_LABEL[x.loan.type as LoanType]} ${x.loan.code} balance`, amount: x.left }));
}

/** Take the balance in full and final: records the repayment and closes the loan. */
export async function settleLoansInFnf(db: Database, tenantId: string, lines: { key: string; amount: number }[], on: string, userId: string | null) {
  for (const l of lines.filter((x) => x.key.startsWith("loan:"))) {
    const id = l.key.slice(5);
    await db.insert(loanRepayments).values({ tenantId, loanId: id, amount: l.amount, paidOn: on, source: "fnf", note: "Recovered in full and final settlement", createdBy: userId });
  }
  await closeRepaidLoans(db, tenantId);
}

