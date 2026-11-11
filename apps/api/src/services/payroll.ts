import { and, desc, eq, gte, inArray, lt, lte, or, isNull, sql } from "drizzle-orm";
import {
  branches,
  departments,
  designations,
  employees,
  leaveRequests,
  leaveTypes,
  payrollAdjustments,
  payrollItems,
  payrollRuns,
  salaryStructures,
  tenants,
  type Database,
  type ItemSnapshot,
  type RunTotals,
} from "@hrms/db";
import {
  computePayslip,
  dateRange,
  daysInMonth,
  DEFAULT_SALARY_TEMPLATE,
  fyOfMonth,
  structureFromComponents,
  structureFromCtc,
  weekday,
  type MonthlyComponents,
  type Regime,
  type SalaryTemplate,
  type NamedTemplate,
  type TemplateBook,
  templateFor,
  minimumWageShortfall,
  type Structure,
} from "@hrms/shared";
import { badRequest, notFound } from "../lib/errors";
import { buildCalendar } from "./attendance";
import { declarationsFor } from "./tax";
import { claimsForRun } from "./reimbursements";
import { rulesFor } from "./statutory";
import { syncLoanRecoveries } from "./loans";

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = daysInMonth(y, m);
  const end = `${month}-${String(days).padStart(2, "0")}`;
  return { start: `${month}-01`, end, days, y, m };
}

/** Last weekday of the month (default pay date). */
export function defaultPayDate(month: string) {
  const { end } = monthBounds(month);
  const d = new Date(end + "T00:00:00Z");
  while ([0, 6].includes(weekday(d.toISOString().slice(0, 10)))) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The company's default salary template, carrying its other templates so that
 * resolveStructure can pick each employee's own.
 */
const inrPlain = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export async function getTemplate(db: Database, tenantId: string): Promise<TemplateBook> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const s = (t?.settings ?? {}) as { salaryTemplate?: Partial<SalaryTemplate>; salaryTemplates?: NamedTemplate[] };
  return { ...DEFAULT_SALARY_TEMPLATE, ...(s.salaryTemplate ?? {}), templates: (s.salaryTemplates ?? []).map((x) => ({ ...DEFAULT_SALARY_TEMPLATE, ...x })) };
}

/** Latest structure row per employee effective on or before `asOf`. */
export async function structuresAsOf(db: Database, tenantId: string, employeeIds: string[], asOf: string) {
  if (!employeeIds.length) return new Map<string, typeof salaryStructures.$inferSelect>();
  const rows = await db
    .select()
    .from(salaryStructures)
    .where(and(eq(salaryStructures.tenantId, tenantId), inArray(salaryStructures.employeeId, employeeIds), lte(salaryStructures.effectiveFrom, asOf)))
    .orderBy(desc(salaryStructures.effectiveFrom));
  const map = new Map<string, typeof salaryStructures.$inferSelect>();
  for (const r of rows) if (!map.has(r.employeeId)) map.set(r.employeeId, r);
  return map;
}

export function resolveStructure(
  emp: { annualCtc: number; pfApplicable: boolean; esiApplicable: boolean; salaryTemplateId?: string | null },
  row: { annualCtc: number; components: MonthlyComponents | null } | undefined,
  book: TemplateBook,
): Structure {
  const template = templateFor(book, emp.salaryTemplateId);
  const opts = { pfApplicable: emp.pfApplicable, esiApplicable: emp.esiApplicable };
  if (row?.components) return structureFromComponents(row.components, template, opts);
  return structureFromCtc(row ? Number(row.annualCtc) : Number(emp.annualCtc), template, opts);
}

/** Employees payable in a period: joined by the end, not left before the start, not still onboarding. */
export async function payableEmployees(db: Database, tenantId: string, start: string, end: string) {
  return db
    .select({
      e: employees,
      department: departments.name,
      designation: designations.name,
      branch: branches.name,
      branchState: branches.state,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(
      and(
        eq(employees.tenantId, tenantId),
        lte(employees.dateOfJoining, end),
        sql`${employees.status} <> 'onboarding'`,
        or(gte(employees.lastWorkingDay, start), and(isNull(employees.lastWorkingDay), sql`${employees.status} not in ('exited','inactive')`)),
      ),
    );
}

/** Year-to-date figures (approved/paid runs earlier in the same FY). */
export async function yearToDate(db: Database, tenantId: string, month: string) {
  const fy = fyOfMonth(month);
  const fyStart = `${fy.slice(0, 4)}-04`;
  const rows = await db
    .select({
      employeeId: payrollItems.employeeId,
      taxableGross: sql<number>`sum(${payrollItems.taxableGross})::float`,
      tds: sql<number>`sum(${payrollItems.tds})::float`,
      employeePf: sql<number>`sum(${payrollItems.employeePf})::float`,
      professionalTax: sql<number>`sum(${payrollItems.professionalTax})::float`,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollRuns.tenantId, tenantId), gte(payrollRuns.month, fyStart), lt(payrollRuns.month, month), inArray(payrollRuns.status, ["approved", "paid"])))
    .groupBy(payrollItems.employeeId);
  const [anyRun] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), gte(payrollRuns.month, fyStart), lt(payrollRuns.month, month), inArray(payrollRuns.status, ["approved", "paid"])));
  return { byEmployee: new Map(rows.map((r) => [r.employeeId, r])), hasHistory: (anyRun?.n ?? 0) > 0 };
}

/** Unpaid-leave days per employee in the period: map employeeId -> Map(date -> 1 | 0.5). */
async function unpaidLeaveDays(db: Database, tenantId: string, start: string, end: string) {
  const rows = await db
    .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, halfDay: leaveRequests.halfDay })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "approved"), eq(leaveTypes.isPaid, false), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)));
  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = map.get(r.employeeId) ?? new Map<string, number>();
    for (const d of dateRange(r.startDate < start ? start : r.startDate, r.endDate > end ? end : r.endDate)) m.set(d, r.halfDay ? 0.5 : 1);
    map.set(r.employeeId, m);
  }
  return map;
}

export function emptyTotals(): RunTotals {
  return { employees: 0, gross: 0, deductions: 0, net: 0, employerCost: 0, ctc: 0, tds: 0, reimbursement: 0, pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, pt: 0, lwf: 0, onHold: 0, lopDays: 0, withLop: 0 };
}

export function totalsOf(items: (typeof payrollItems.$inferSelect)[]): RunTotals {
  const t = emptyTotals();
  const line = (lines: { code: string; amount: number }[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);
  for (const i of items) {
    t.employees++;
    t.gross += Number(i.gross);
    t.deductions += Number(i.totalDeductions);
    t.net += Number(i.net);
    t.employerCost += Number(i.employerCost);
    t.tds += Number(i.tds);
    t.reimbursement = (t.reimbursement ?? 0) + Number(i.reimbursement ?? 0);
    t.pfEmployee += line(i.deductions, "pf");
    t.pfEmployer += line(i.employer, "epf_er", "eps");
    t.esiEmployee += line(i.deductions, "esi");
    t.esiEmployer += line(i.employer, "esi_er");
    t.pt += line(i.deductions, "pt");
    t.lwf += line(i.deductions, "lwf");
    if (i.onHold) t.onHold++;
    const lop = Number(i.lopOverride ?? i.lopDays);
    t.lopDays += lop;
    if (lop > 0) t.withLop++;
  }
  t.ctc = t.gross + t.employerCost;
  return t;
}

/**
 * (Re)calculate every payslip in a run. Keeps LOP overrides and holds from a previous
 * calculation. `assumePresent` ignores attendance (used for back-filled history).
 */
export async function calculateRun(db: Database, tenantId: string, runId: string, userId: string | null, opts: { assumePresent?: boolean } = {}) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.tenantId, tenantId)));
  if (!run) throw notFound("Payroll run");
  if (run.status !== "draft" && run.status !== "calculated") throw badRequest("This payroll is locked. Reopen it to recalculate.");

  const { start, end, days } = monthBounds(run.month);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const template = await getTemplate(db, tenantId);
  const statutory = tenant?.statutory ?? {};
  const emps = await payableEmployees(db, tenantId, start, end);
  const ids = emps.map((x) => x.e.id);
  // this month's loan and advance instalments, as deduction lines
  await syncLoanRecoveries(db, { id: run.id, tenantId, month: run.month }, ids);
  const [structs, ytd, unpaid, adjustments, existing, decls] = await Promise.all([
    structuresAsOf(db, tenantId, ids, end),
    yearToDate(db, tenantId, run.month),
    unpaidLeaveDays(db, tenantId, start, end),
    db.select().from(payrollAdjustments).where(eq(payrollAdjustments.runId, runId)),
    db.select().from(payrollItems).where(eq(payrollItems.runId, runId)),
    declarationsFor(db, tenantId, fyOfMonth(run.month), ids),
  ]);
  const claims = await claimsForRun(db, tenantId, runId, end, ids);
  const rules = await rulesFor(db, run.month);
  const prev = new Map(existing.map((i) => [i.employeeId, i]));
  const cal = opts.assumePresent ? null : await buildCalendar(db, tenantId, emps.map((x) => ({ id: x.e.id, shiftId: x.e.shiftId, branchId: x.e.branchId, dateOfJoining: x.e.dateOfJoining, lastWorkingDay: x.e.lastWorkingDay })), start, end);
  const statOn = (k: string) => statutory[k as keyof typeof statutory]?.enabled ?? true;

  const rows: (typeof payrollItems.$inferInsert)[] = [];
  for (const { e, department, designation, branch, branchState } of emps) {
    const from = e.dateOfJoining > start ? e.dateOfJoining : start;
    const to = e.lastWorkingDay && e.lastWorkingDay < end ? e.lastWorkingDay : end;
    const employed = from <= to ? dateRange(from, to) : [];
    const unpaidDays = unpaid.get(e.id);
    let lop = 0;
    for (const d of employed) {
      const st = cal?.status({ id: e.id, shiftId: e.shiftId, branchId: e.branchId, dateOfJoining: e.dateOfJoining, lastWorkingDay: e.lastWorkingDay }, d);
      if (st === "on_leave" && unpaidDays?.has(d)) lop += unpaidDays.get(d)!;
      else if (st === "absent") lop += 1;
      else if (st === "half_day") lop += 0.5;
    }
    const before = prev.get(e.id);
    const lopUsed = before?.lopOverride ?? lop;
    const paidDays = Math.max(0, employed.length - Number(lopUsed));
    const structure = resolveStructure(e, structs.get(e.id), template);
    const y = ytd.byEmployee.get(e.id);
    const slip = computePayslip({
      rules,
      month: run.month,
      structure,
      template: templateFor(template, e.salaryTemplateId),
      daysInMonth: days,
      paidDays,
      adjustments: adjustments
        .filter((a) => a.employeeId === e.id)
        .map((a) => ({ label: a.label, kind: a.kind as "earning" | "deduction", amount: Number(a.amount), taxable: a.taxable, esiWage: a.esiWage })),
      pfApplicable: e.pfApplicable && statOn("epf"),
      esiApplicable: e.esiApplicable && statOn("esi"),
      ptApplicable: e.ptApplicable && statOn("pt"),
      state: branchState ?? tenant?.state ?? null,
      gender: e.gender,
      regime: ((decls.get(e.id)?.regime ?? e.taxRegime) as Regime) ?? "new",
      reimbursement: claims.get(e.id) ?? 0,
      taxProfile: decls.get(e.id) ? { declaration: decls.get(e.id)!.data, verified: decls.get(e.id)!.verified } : undefined,
      ytd: y ? { taxableGross: y.taxableGross, tds: y.tds, employeePf: y.employeePf, professionalTax: y.professionalTax } : ytd.hasHistory ? { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 } : undefined,
    });
    const warnings = [...slip.warnings];
    if (!e.accountLast4 || !e.ifsc) warnings.push("No bank account on file");
    if (!e.pan) warnings.push("PAN missing: TDS should be at least 20% (s.206AA)");
    if (e.lastWorkingDay && e.lastWorkingDay <= end) warnings.push("Leaving this month: settle full and final separately");
    if (e.dateOfJoining >= start) warnings.push("Joined this month: pay prorated from joining date");
    // minimum wage, on the full month's pay (LOP doesn't make a salary non-compliant)
    const mwState = branchState ?? tenant?.state ?? null;
    const mw = mwState ? minimumWageShortfall(rules.minWage[mwState], { basic: structure.components.basic, gross: structure.gross }, { category: e.wageCategory, basis: (tenant?.settings as { minWageBasis?: "basic" | "gross" } | null)?.minWageBasis }) : null;
    if (mw) warnings.push(`Below the ${mwState} minimum wage${mw.label ? ` (${mw.label})` : ""}: ${mw.basis} ${inrPlain(mw.paid)} against ${inrPlain(mw.required)}`);
    // non-taxable one-time pay and non-taxable allowances
    const nonTaxable = slip.nonTaxable;
    const snapshot: ItemSnapshot = {
      name: e.fullName,
      code: e.employeeCode,
      department,
      designation,
      branch,
      state: branchState ?? tenant?.state ?? null,
      dateOfJoining: e.dateOfJoining,
      lastWorkingDay: e.lastWorkingDay,
      pan: e.pan,
      uan: e.uan,
      esicIpNumber: e.esicIpNumber,
      bankName: e.bankName,
      accountLast4: e.accountLast4,
      ifsc: e.ifsc,
      regime: e.taxRegime,
      annualCtc: structure.annualCtc,
    };
    rows.push({
      tenantId,
      runId,
      employeeId: e.id,
      snapshot,
      daysInMonth: days,
      paidDays,
      lopDays: lop,
      lopOverride: before?.lopOverride ?? null,
      earnings: slip.earnings,
      deductions: slip.deductions,
      employer: slip.employer,
      gross: slip.gross,
      totalDeductions: slip.totalDeductions,
      net: slip.net,
      employerCost: slip.employerCost,
      tds: slip.tds,
      reimbursement: slip.reimbursement,
      taxableGross: slip.gross - nonTaxable,
      employeePf: slip.deductions.find((d) => d.code === "pf")?.amount ?? 0,
      professionalTax: slip.deductions.find((d) => d.code === "pt")?.amount ?? 0,
      tax: slip.tax as unknown as Record<string, unknown>,
      onHold: before?.onHold ?? false,
      holdReason: before?.holdReason ?? null,
      warnings,
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(payrollItems).where(eq(payrollItems.runId, runId));
    for (let i = 0; i < rows.length; i += 200) await tx.insert(payrollItems).values(rows.slice(i, i + 200));
    const saved = await tx.select().from(payrollItems).where(eq(payrollItems.runId, runId));
    await tx
      .update(payrollRuns)
      .set({ status: "calculated", totals: totalsOf(saved), calculatedAt: new Date(), calculatedBy: userId })
      .where(eq(payrollRuns.id, runId));
  });
  return rows.length;
}

/** Recompute run totals after holds/overrides change without a full recalculation. */
export async function refreshTotals(db: Database, runId: string) {
  const items = await db.select().from(payrollItems).where(eq(payrollItems.runId, runId));
  await db.update(payrollRuns).set({ totals: totalsOf(items) }).where(eq(payrollRuns.id, runId));
}
