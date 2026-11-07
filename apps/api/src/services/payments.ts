import { and, asc, eq, inArray, isNull, like, ne, notInArray, sql } from "drizzle-orm";
import {
  companyBankAccounts,
  employees,
  paymentBatches,
  payments,
  payrollItems,
  payrollRuns,
  reimbursementClaims,
  type Database,
} from "@hrms/db";
import { BONUS, daysInMonth, decryptField, statutoryBonus, todayIST } from "@hrms/shared";
import { fyMonths } from "./tax";
import { getTemplate, resolveStructure, structuresAsOf } from "./payroll";

export type Batch = typeof paymentBatches.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentType = "salary" | "reimbursement" | "bonus" | "other";

export const TYPE_LETTER: Record<PaymentType, string> = { salary: "S", reimbursement: "R", bonus: "B", other: "O" };
const REF_PREFIX: Record<PaymentType, string> = { salary: "SAL", reimbursement: "RMB", bonus: "BON", other: "OTH" };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Payments still owed: these block a batch from completing. */
export const OPEN_PAYMENT = ["pending"] as const;

/** PB-2611-S, then PB-2611-S2 for a second batch of the same type in the month. */
export async function nextBatchCode(db: Database, tenantId: string, type: PaymentType, date: string) {
  const base = `PB-${date.slice(2, 4)}${date.slice(5, 7)}-${TYPE_LETTER[type]}`;
  const rows = await db.select({ code: paymentBatches.code }).from(paymentBatches).where(and(eq(paymentBatches.tenantId, tenantId), like(paymentBatches.code, `${base}%`)));
  if (!rows.length) return base;
  const n = Math.max(1, ...rows.map((r) => Number(r.code.slice(base.length) || 1))) + 1;
  return `${base}${n}`;
}

/** References like SAL-NOV26-0001, unique per company. The same reference is kept on retries. */
export async function referenceAllocator(db: Database, tenantId: string, type: PaymentType, date: string) {
  const prefix = `${REF_PREFIX[type]}-${MON[Number(date.slice(5, 7)) - 1]}${date.slice(2, 4)}-`;
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(substring(${payments.reference} from ${sql.raw(String(prefix.length + 1))})::int), 0)::int` })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), like(payments.reference, `${prefix}%`)));
  let n = r?.n ?? 0;
  return () => `${prefix}${String(++n).padStart(4, "0")}`;
}

export interface DraftLine {
  employeeId: string;
  amount: number;
  description: string | null;
  claimIds?: string[];
  /** Set when the line can't be paid yet (e.g. missing bank details). */
  heldReason?: string | null;
}

interface EmpBank {
  id: string;
  code: string;
  name: string;
  holder: string | null;
  bankName: string | null;
  ifsc: string | null;
  last4: string | null;
  hasAccount: boolean;
  status: string;
  paymentMethod: string;
}

export async function bankInfo(db: Database, tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, EmpBank>();
  const rows = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: employees.fullName,
      holder: employees.accountHolderName,
      bankName: employees.bankName,
      ifsc: employees.ifsc,
      last4: employees.accountLast4,
      enc: employees.accountNumberEnc,
      status: employees.status,
      paymentMethod: employees.paymentMethod,
    })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, ids)));
  return new Map(rows.map((r) => [r.id, { ...r, hasAccount: !!r.enc }]));
}

export const missingBank = (e: EmpBank | undefined) => (!e ? "Employee not found" : e.paymentMethod !== "bank_transfer" ? `Paid by ${e.paymentMethod.replace(/_/g, " ")}` : !e.hasAccount || !e.ifsc ? "Bank details missing" : null);

/** Salary lines from a locked run: net pay of everyone not on hold. */
export async function salaryLines(db: Database, tenantId: string, runId: string): Promise<DraftLine[]> {
  const items = await db.select().from(payrollItems).where(and(eq(payrollItems.tenantId, tenantId), eq(payrollItems.runId, runId))).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  return items.filter((i) => !i.onHold && Number(i.net) > 0).map((i) => ({ employeeId: i.employeeId, amount: Number(i.net), description: null }));
}

/** Approved claims not already going out with payroll or another batch, one line per employee. */
export async function reimbursementLines(db: Database, tenantId: string, claimIds?: string[]): Promise<DraftLine[]> {
  const rows = await db
    .select({ id: reimbursementClaims.id, employeeId: reimbursementClaims.employeeId, amount: reimbursementClaims.amount, code: reimbursementClaims.code })
    .from(reimbursementClaims)
    .where(and(eq(reimbursementClaims.tenantId, tenantId), eq(reimbursementClaims.status, "approved"), isNull(reimbursementClaims.payrollRunId), isNull(reimbursementClaims.paymentId), claimIds ? inArray(reimbursementClaims.id, claimIds.length ? claimIds : ["-"]) : undefined))
    .orderBy(asc(reimbursementClaims.code));
  const by = new Map<string, DraftLine>();
  for (const r of rows) {
    const l = by.get(r.employeeId) ?? { employeeId: r.employeeId, amount: 0, description: "", claimIds: [] };
    l.amount = Math.round((l.amount + Number(r.amount)) * 100) / 100;
    l.claimIds!.push(r.id);
    l.description = l.claimIds!.length === 1 ? `Claim ${r.code}` : `${l.claimIds!.length} claims`;
    by.set(r.employeeId, l);
  }
  return [...by.values()];
}

/**
 * Statutory bonus for a financial year. Uses locked payroll for months that have it
 * (basic as the wage, actual paid days) and the salary structure for the rest of the
 * months the employee was in service.
 */
export async function bonusLines(db: Database, tenantId: string, fy: string, percent: number) {
  const months = fyMonths(fy).filter((m) => m <= todayIST().slice(0, 7));
  const emps = await db.select().from(employees).where(and(eq(employees.tenantId, tenantId), notInArray(employees.status, ["onboarding"])));
  const items = await db
    .select({ employeeId: payrollItems.employeeId, month: payrollRuns.month, earnings: payrollItems.earnings, paidDays: payrollItems.paidDays })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tenantId), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, months)));
  const locked = new Map(items.map((i) => [`${i.employeeId}|${i.month}`, i]));
  const template = await getTemplate(db, tenantId);
  const structs = await structuresAsOf(db, tenantId, emps.map((e) => e.id), `${months.at(-1)}-28`);
  const lines: (DraftLine & { wageBase: number })[] = [];
  const skipped: { employeeId: string; reason: string }[] = [];
  for (const e of emps) {
    const struct = resolveStructure(e, structs.get(e.id), template);
    const rows: { wage: number; paidDays: number }[] = [];
    for (const m of months) {
      const it = locked.get(`${e.id}|${m}`);
      if (it) {
        rows.push({ wage: it.earnings.filter((l) => l.code === "basic").reduce((s, l) => s + l.amount, 0), paidDays: Number(it.paidDays) });
        continue;
      }
      const [y, mo] = m.split("-").map(Number) as [number, number];
      const end = `${m}-${String(daysInMonth(y, mo)).padStart(2, "0")}`;
      if (e.dateOfJoining > end || (e.lastWorkingDay && e.lastWorkingDay < `${m}-01`)) continue;
      rows.push({ wage: struct.components.basic, paidDays: daysInMonth(y, mo) });
    }
    const r = statutoryBonus(rows, percent);
    if (r.eligible) lines.push({ employeeId: e.id, amount: r.amount, description: `Statutory bonus FY ${fy} @ ${percent}%`, wageBase: r.wageBase });
    else if (rows.length) skipped.push({ employeeId: e.id, reason: r.reason });
  }
  return { lines, skipped, months: months.length, ceiling: BONUS.calculationCeiling };
}

/** Same account receiving the same amount twice in one file is almost always a mistake. */
export async function duplicateAccounts(db: Database, tenantId: string, lines: DraftLine[], key: string) {
  const ids = lines.map((l) => l.employeeId);
  if (!ids.length) return [];
  const rows = await db.select({ id: employees.id, code: employees.employeeCode, enc: employees.accountNumberEnc }).from(employees).where(and(eq(employees.tenantId, tenantId), inArray(employees.id, ids)));
  const acct = new Map<string, { code: string; acct: string | null }>();
  for (const r of rows) acct.set(r.id, { code: r.code, acct: await decryptField(r.enc, key) });
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const l of lines) {
    const a = acct.get(l.employeeId);
    if (!a?.acct) continue;
    const k = `${a.acct}|${l.amount}`;
    if (seen.has(k)) dups.push(`${seen.get(k)} and ${a.code} (account ending ${a.acct.slice(-4)})`);
    else seen.set(k, a.code);
  }
  return dups;
}

export async function loadAccount(db: Database, tenantId: string, id: string | null) {
  if (!id) return null;
  const [a] = await db.select().from(companyBankAccounts).where(and(eq(companyBankAccounts.id, id), eq(companyBankAccounts.tenantId, tenantId)));
  return a ?? null;
}

/** Recompute a batch's status after payment changes. Returns the batch and whether it just completed. */
export async function refreshBatch(db: Database, batchId: string) {
  const [b] = await db.select().from(paymentBatches).where(eq(paymentBatches.id, batchId));
  if (!b || b.status !== "processing") return { batch: b, completed: false };
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.batchId, batchId), inArray(payments.status, [...OPEN_PAYMENT])));
  if ((open?.n ?? 0) > 0) return { batch: b, completed: false };
  const [row] = await db.update(paymentBatches).set({ status: "completed", completedAt: new Date() }).where(and(eq(paymentBatches.id, batchId), eq(paymentBatches.status, "processing"))).returning();
  return { batch: row ?? b, completed: !!row };
}

/**
 * Side effects once payments are paid or cancelled:
 * salary paid -> that employee's claims in the run are paid;
 * reimbursement paid -> its claims are paid; cancelled -> its claims go back to the queue.
 */
export async function applyPaymentEffects(db: Database, batch: Batch, changed: Payment[]) {
  const paid = changed.filter((p) => p.status === "paid");
  const cancelled = changed.filter((p) => p.status === "cancelled");
  if (batch.type === "salary" && batch.payrollRunId && paid.length) {
    await db
      .update(reimbursementClaims)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(reimbursementClaims.payrollRunId, batch.payrollRunId), eq(reimbursementClaims.status, "approved"), inArray(reimbursementClaims.employeeId, paid.map((p) => p.employeeId))));
  }
  if (batch.type === "reimbursement") {
    if (paid.length) await db.update(reimbursementClaims).set({ status: "paid", paidAt: new Date() }).where(and(inArray(reimbursementClaims.paymentId, paid.map((p) => p.id)), eq(reimbursementClaims.status, "approved")));
    if (cancelled.length) await db.update(reimbursementClaims).set({ paymentId: null }).where(and(inArray(reimbursementClaims.paymentId, cancelled.map((p) => p.id)), eq(reimbursementClaims.status, "approved")));
  }
}

/** A salary batch that has no payments left pending marks its payroll run paid. */
export async function completeSalaryRun(db: Database, batch: Batch, userId: string | null) {
  if (batch.type !== "salary" || !batch.payrollRunId) return;
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, batch.payrollRunId));
  if (!run || run.status !== "approved") return;
  await db
    .update(payrollRuns)
    .set({ status: "paid", paidAt: new Date(batch.paymentDate + "T12:00:00+05:30"), paidBy: userId, paymentReference: batch.code, publishedAt: run.publishedAt ?? new Date() })
    .where(eq(payrollRuns.id, run.id));
  // salaries on hold in payroll release their claims to the next run
  const held = (await db.select({ e: payrollItems.employeeId }).from(payrollItems).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.onHold, true)))).map((r) => r.e);
  if (held.length) await db.update(reimbursementClaims).set({ payrollRunId: null }).where(and(eq(reimbursementClaims.payrollRunId, run.id), eq(reimbursementClaims.status, "approved"), inArray(reimbursementClaims.employeeId, held)));
}

/** Active (not cancelled) salary batch for a run, if any. */
export async function activeBatchForRun(db: Database, runId: string) {
  const [b] = await db.select().from(paymentBatches).where(and(eq(paymentBatches.payrollRunId, runId), ne(paymentBatches.status, "cancelled")));
  return b ?? null;
}

/** Which status changes are allowed for a payment, given its batch. */
export function canTransition(batch: Batch, from: string, to: string): string | null {
  if (from === to) return "Nothing to change";
  if (batch.status === "cancelled") return "This batch is cancelled";
  if (from === "paid") return "This payment is already paid";
  if (from === "cancelled") return "This payment is cancelled";
  if (to === "paid" || to === "failed") {
    if (from === "pending" && batch.status !== "processing" && batch.status !== "completed") return "Export the bank file before recording the bank's result";
    if (to === "failed" && from !== "pending") return "Only payments sent to the bank can fail";
    return null;
  }
  if (to === "pending") return from === "failed" || from === "held" ? null : "Only failed or held payments can be retried";
  if (to === "held") return from === "pending" || from === "failed" ? null : "Can't hold this payment";
  if (to === "cancelled") return batch.type === "salary" && from === "pending" && batch.status !== "draft" && batch.status !== "approved" ? "Mark it failed or held instead" : null;
  return "Not allowed";
}
