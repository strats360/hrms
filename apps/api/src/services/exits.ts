import { and, eq, inArray, sql } from "drizzle-orm";
import { loansToRecover, settleLoansInFnf } from "./loans";
import { employeeExits, employees, leaveBalances, leaveTypes, payments, payrollItems, payrollRuns, reimbursementClaims, tenants, type Database } from "@hrms/db";
import { codeWages, fmtMoney, packFor, DEFAULT_CLEARANCE, type ExitType, type FnfResult, type ManualLine, toLocalDate } from "@hrms/shared";
import { balanceSummary } from "./leave";
import { entityOf } from "./entities";
import { getTemplate, resolveStructure, structuresAsOf } from "./payroll";
import { monthLabel } from "../lib/months";

export type Exit = typeof employeeExits.$inferSelect;
type Employee = typeof employees.$inferSelect;

export interface SettlementInputs {
  manual?: ManualLine[];
  tds?: number;
  encashDays?: Record<string, number>;
  notes?: string | null;
}

/** EX-0001, EX-0002... per tenant. */
export async function nextExitCode(db: Database, tenantId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(substring(${employeeExits.code} from 4)::int), 0)` })
    .from(employeeExits)
    .where(eq(employeeExits.tenantId, tenantId));
  return `EX-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

export const defaultClearance = () => DEFAULT_CLEARANCE.map((c) => ({ key: c.key, label: c.label, done: false, doneBy: null, doneAt: null, note: null }));

export async function noticeSettings(db: Database, tenantId: string) {
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { noticeDays: t?.s?.noticeDays, probationNoticeDays: t?.s?.probationNoticeDays };
}

/** Everything the settlement is computed from, read fresh from salary, leave and payments. */
export async function settlementFor(db: Database, exit: Exit, emp: Employee) {
  const tenantId = exit.tenantId;
  const inputs = (exit.inputs ?? {}) as SettlementInputs;
  const template = await getTemplate(db, tenantId);
  const structs = await structuresAsOf(db, tenantId, [emp.id], exit.lastWorkingDay);
  const entity = await entityOf(db, tenantId, emp.entityId);
  const india = entity.country === "IN";
  const s = resolveStructure(india ? emp : { ...emp, pfApplicable: false, esiApplicable: false }, structs.get(emp.id), template, packFor(entity.country).payroll.salaryTemplate);
  const money = (n: number) => fmtMoney(n, { currency: entity.currency });
  const year = Number(exit.lastWorkingDay.slice(0, 4));
  const encashable = new Set((await db.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.encashable, true)))).map((r) => r.id));
  const balances = (await balanceSummary(db, tenantId, emp.id, year)).filter((b) => encashable.has(b.leaveTypeId));
  const leave = balances.map((b) => {
    const available = Math.max(0, b.available - b.pending);
    const override = inputs.encashDays?.[b.leaveTypeId];
    return { leaveTypeId: b.leaveTypeId, name: b.name, days: override === undefined ? available : Math.min(override, available), available };
  });
  const result = packFor(entity.country).settlement({
    type: exit.type as ExitType,
    profile: { nationality: emp.nationality, region: entity.state },
    dateOfJoining: emp.dateOfJoining,
    resignationDate: exit.resignationDate,
    lastWorkingDay: exit.lastWorkingDay,
    monthlyBasic: s.components.basic,
    monthlyGross: s.gross,
    monthlyWages: codeWages(s.components),
    fixedTerm: emp.employmentType === "fixed_term",
    noticeDays: exit.noticeDays,
    noticeWaived: exit.noticeWaived,
    payInLieu: exit.payInLieu,
    leave,
    manual: inputs.manual ?? [],
    tds: inputs.tds ?? 0,
    // loans and advances still owed come off the settlement
    recoveries: await loansToRecover(db, tenantId, emp.id),
  });

  // what else is still open for this employee, so nothing is paid twice or forgotten
  const month = exit.lastWorkingDay.slice(0, 7);
  const [finalRun] = await db
    .select({ month: payrollRuns.month, status: payrollRuns.status, net: payrollItems.net, onHold: payrollItems.onHold })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.employeeId, emp.id), eq(payrollRuns.month, month)));
  const [claims] = await db
    .select({ n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${reimbursementClaims.amount}),0)::float` })
    .from(reimbursementClaims)
    .where(and(eq(reimbursementClaims.employeeId, emp.id), inArray(reimbursementClaims.status, ["approved", "pending_manager", "pending_finance"])));
  const [owed] = await db
    .select({ n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${payments.amount}),0)::float` })
    .from(payments)
    .where(and(eq(payments.employeeId, emp.id), inArray(payments.status, ["failed", "held", "pending"]), sql`${payments.id} is distinct from ${exit.paymentId}`));

  const warnings: string[] = [];
  if (!finalRun) warnings.push(`The last month's salary (${monthLabel(month)}) hasn't been calculated yet. It's paid through payroll, prorated to the last working day.`);
  else if (finalRun.status !== "approved" && finalRun.status !== "paid") warnings.push(`The ${monthLabel(month)} payroll isn't approved yet. Lock it before approving the settlement.`);
  if (claims?.n) warnings.push(`${claims.n} reimbursement claim${claims.n === 1 ? " is" : "s are"} still open (${money(claims.s)}). Pay or reject ${claims.n === 1 ? "it" : "them"} through reimbursements.`);
  if (owed?.n) warnings.push(`${owed.n} payment${owed.n === 1 ? " is" : "s are"} pending, failed or held (${money(owed.s)}). Clear ${owed.n === 1 ? "it" : "them"} under Payments.`);
  if (india && !result.gratuityEligible && result.service.days >= 4 * 365 + 240) warnings.push("Close to gratuity eligibility (5 years). Some courts count 4 years and 240 days as five: check the service dates with your advisor.");
  if (india && result.gratuityEligible) warnings.push(`Gratuity must be paid within 30 days of becoming payable, so by ${addDaysIso(exit.lastWorkingDay, 30)}.`);
  if (india) warnings.push(`Wages due must be paid within 2 working days of the last day, so by ${addWorkingDays(exit.lastWorkingDay, 2)}.`);
  if (india && result.taxable > 0 && !(inputs.tds ?? 0)) warnings.push(`${money(result.taxable)} of the settlement is taxable. Enter the TDS from the employee's tax computation.`);

  return {
    result,
    structure: { basic: s.components.basic, gross: s.gross },
    leave,
    finalPayroll: finalRun ? { month: finalRun.month, status: finalRun.status, net: Number(finalRun.net), onHold: finalRun.onHold } : null,
    openClaims: { count: claims?.n ?? 0, amount: claims?.s ?? 0 },
    openPayments: { count: owed?.n ?? 0, amount: owed?.s ?? 0 },
    warnings,
  };
}

export type SettlementSnapshot = FnfResult & { leave: { leaveTypeId: string; name: string; days: number }[]; structure: { basic: number; gross: number }; computedAt: string };

/**
 * Close the exit: the employee leaves, and the encashed leave comes off their balance
 * so it can't be encashed or taken again.
 */
export async function markSettled(db: Database, exit: Exit, s: { on: string; method: string; reference: string | null }) {
  const [row] = await db
    .update(employeeExits)
    .set({ status: "settled", settledAt: new Date(), settledOn: s.on, settlementMethod: s.method, settlementReference: s.reference })
    .where(and(eq(employeeExits.id, exit.id), eq(employeeExits.status, "approved")))
    .returning();
  if (!row) return null;
  await db.update(employees).set({ status: "exited" }).where(eq(employees.id, exit.employeeId));
  const snap = exit.settlement as SettlementSnapshot | null;
  await settleLoansInFnf(db, exit.tenantId, (snap?.lines ?? []).filter((l) => l.kind === "deduction"), s.on, null);
  const year = Number(exit.lastWorkingDay.slice(0, 4));
  for (const l of snap?.leave ?? []) {
    if (l.days > 0) await db.update(leaveBalances).set({ adjusted: sql`${leaveBalances.adjusted} - ${l.days}` }).where(and(eq(leaveBalances.employeeId, exit.employeeId), eq(leaveBalances.leaveTypeId, l.leaveTypeId), eq(leaveBalances.year, year)));
  }
  return row;
}

/** Payment batch hook: a settlement paid through a batch closes the exit; a cancelled one frees it to be paid again. */
export async function exitPaymentEffects(db: Database, paid: { id: string; utr: string | null; reference: string; paidAt: Date | null }[], cancelled: string[]) {
  if (paid.length) {
    const rows = await db.select().from(employeeExits).where(and(inArray(employeeExits.paymentId, paid.map((p) => p.id)), eq(employeeExits.status, "approved")));
    for (const e of rows) {
      const p = paid.find((x) => x.id === e.paymentId)!;
      const on = toLocalDate(p.paidAt ?? new Date());
      await markSettled(db, e, { on, method: "bank_transfer", reference: p.utr ?? p.reference });
    }
  }
  if (cancelled.length) await db.update(employeeExits).set({ paymentId: null }).where(and(inArray(employeeExits.paymentId, cancelled), eq(employeeExits.status, "approved")));
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Working days after a date, skipping Saturdays and Sundays. */
function addWorkingDays(d: string, n: number) {
  let x = d;
  while (n > 0) {
    x = addDaysIso(x, 1);
    const wd = new Date(`${x}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) n--;
  }
  return x;
}
