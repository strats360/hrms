import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { employees, payrollItems, payrollRuns, statutoryChallans, taxDeclarations, tdsReturns, tenants, type Database } from "@hrms/db";
import {
  compareRegimes,
  computeTaxStatement,
  daysInMonth,
  fyOfMonth,
  professionalTax,
  STATUTORY,
  todayIST,
  type Regime,
  type TaxDeclarationData,
  type Verified,
} from "@hrms/shared";
import { getTemplate, resolveStructure, structuresAsOf } from "./payroll";

export const fyMonths = (fy: string) => {
  const y = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    return `${m >= 4 ? y : y + 1}-${String(m).padStart(2, "0")}`;
  });
};
export const currentFy = () => fyOfMonth(todayIST().slice(0, 7));
export const QUARTERS: Record<string, number[]> = { Q1: [4, 5, 6], Q2: [7, 8, 9], Q3: [10, 11, 12], Q4: [1, 2, 3] };
export const quarterOf = (month: string) => Object.entries(QUARTERS).find(([, ms]) => ms.includes(Number(month.slice(5, 7))))![0];

/** Declarations for many employees in one FY (for the payroll run). */
export async function declarationsFor(db: Database, tenantId: string, fy: string, employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, typeof taxDeclarations.$inferSelect>();
  const rows = await db
    .select()
    .from(taxDeclarations)
    .where(and(eq(taxDeclarations.tenantId, tenantId), eq(taxDeclarations.fy, fy), inArray(taxDeclarations.employeeId, employeeIds)));
  return new Map(rows.map((r) => [r.employeeId, r]));
}

const line = (lines: { code: string; amount: number }[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);

export interface MonthRow {
  month: string;
  status: "locked" | "projected";
  gross: number;
  basic: number;
  hra: number;
  pf: number;
  pt: number;
  tds: number;
}

/**
 * Everything about one employee's tax for a FY: month-wise actuals from locked payroll,
 * projected months from the current structure, statements for both regimes, and TDS so far.
 * `actualOnly` (Form 16) leaves out projected months.
 */
export async function employeeTax(db: Database, tenantId: string, employeeId: string, fy: string, opts: { actualOnly?: boolean } = {}) {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!emp) return null;
  const months = fyMonths(fy);
  const items = await db
    .select({ item: payrollItems, month: payrollRuns.month, payDate: payrollRuns.payDate })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tenantId), eq(payrollItems.employeeId, employeeId), inArray(payrollRuns.status, ["approved", "paid"]), inArray(payrollRuns.month, months)))
    .orderBy(asc(payrollRuns.month));
  const [decl] = await db.select().from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, fy)));
  const template = await getTemplate(db, tenantId);
  const struct = resolveStructure(emp, (await structuresAsOf(db, tenantId, [emp.id], months[11] + "-28")).get(emp.id), template);
  const [t] = await db.select({ state: tenants.state }).from(tenants).where(eq(tenants.id, tenantId));

  const locked = new Map(items.map((x) => [x.month, x]));
  const rows: MonthRow[] = [];
  for (const m of months) {
    const it = locked.get(m);
    if (it) {
      rows.push({
        month: m,
        status: "locked",
        gross: Number(it.item.taxableGross),
        basic: line(it.item.earnings, "basic"),
        hra: line(it.item.earnings, "hra"),
        pf: Number(it.item.employeePf),
        pt: Number(it.item.professionalTax),
        tds: Number(it.item.tds),
      });
      continue;
    }
    if (opts.actualOnly) continue;
    // project only months after the last locked month that the employee is in service for
    const lastLocked = items.at(-1)?.month ?? "";
    const [y, mo] = m.split("-").map(Number) as [number, number];
    const end = `${m}-${String(daysInMonth(y, mo)).padStart(2, "0")}`;
    if (m <= lastLocked || emp.dateOfJoining > end || (emp.lastWorkingDay && emp.lastWorkingDay < `${m}-01`) || emp.status === "exited") continue;
    const pf = emp.pfApplicable ? Math.round(Math.min(struct.components.basic, template.pfOnFullBasic ? Infinity : STATUTORY.pf.wageCeiling) * STATUTORY.pf.employeeRate) : 0;
    rows.push({
      month: m,
      status: "projected",
      gross: struct.gross,
      basic: struct.components.basic,
      hra: struct.components.hra,
      pf,
      pt: emp.ptApplicable ? professionalTax(t?.state ?? null, struct.gross, mo, emp.gender).amount : 0,
      tds: 0,
    });
  }
  const sum = (k: keyof MonthRow, status?: MonthRow["status"]) => rows.filter((r) => !status || r.status === status).reduce((s, r) => s + (r[k] as number), 0);
  const base = {
    financialYear: fy,
    salary: { gross: sum("gross"), basic: sum("basic"), hra: sum("hra") },
    employeePf: sum("pf"),
    professionalTax: sum("pt"),
    declaration: (decl?.data ?? {}) as TaxDeclarationData,
    verified: (decl?.verified ?? {}) as Verified,
  };
  const regime = (decl?.regime ?? emp.taxRegime ?? "new") as Regime;
  const comparison = compareRegimes(base);
  const statement = computeTaxStatement({ ...base, regime });
  const deducted = sum("tds", "locked");
  const projectedMonths = rows.filter((r) => r.status === "projected").length;
  const remaining = Math.max(0, statement.tax.total - statement.previousEmployerTds - deducted);
  return {
    employee: { id: emp.id, name: emp.fullName, code: emp.employeeCode, pan: emp.pan, dateOfJoining: emp.dateOfJoining, regime },
    declaration: decl ?? null,
    months: rows,
    statement,
    comparison: { new: comparison.new.tax.total, old: comparison.old.tax.total, better: comparison.better, saving: comparison.saving },
    deducted,
    remaining,
    monthlyEstimate: projectedMonths ? Math.round(remaining / projectedMonths) : 0,
    projectedMonths,
    payDates: Object.fromEntries(items.map((x) => [x.month, x.payDate])),
  };
}

/** Form 16 Part A summary (quarter-wise) and Part B (statement on actual salary). */
export async function form16(db: Database, tenantId: string, employeeId: string, fy: string) {
  const tax = await employeeTax(db, tenantId, employeeId, fy, { actualOnly: true });
  if (!tax) return null;
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const months = fyMonths(fy);
  const challans = await db
    .select()
    .from(statutoryChallans)
    .where(and(eq(statutoryChallans.tenantId, tenantId), eq(statutoryChallans.statute, "tds"), gte(statutoryChallans.period, months[0]!), lte(statutoryChallans.period, months[11]!)));
  const returns = await db.select().from(tdsReturns).where(and(eq(tdsReturns.tenantId, tenantId), eq(tdsReturns.fy, fy)));
  const quarters = Object.keys(QUARTERS).map((q) => {
    const rows = tax.months.filter((m) => quarterOf(m.month) === q);
    const deposited = rows.filter((m) => challans.some((c) => c.period === m.month)).reduce((s, m) => s + m.tds, 0);
    const ret = returns.find((r) => r.quarter === q);
    return { quarter: q, amountPaid: rows.reduce((s, m) => s + m.gross, 0), tdsDeducted: rows.reduce((s, m) => s + m.tds, 0), tdsDeposited: deposited, receipt: ret?.acknowledgement ?? null };
  });
  const closed = tax.months.some((m) => m.month === months[11]);
  return {
    fy,
    assessmentYear: `${Number(fy.slice(0, 4)) + 1}-${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, "0")}`,
    provisional: !closed,
    employer: { name: t?.legalName ?? t?.name, address: t?.registeredAddress, pan: t?.pan, tan: t?.tan },
    employee: tax.employee,
    period: { from: tax.months[0]?.month ?? null, to: tax.months.at(-1)?.month ?? null },
    quarters,
    statement: tax.statement,
    tdsDeducted: tax.deducted,
    challans: challans.map((c) => ({ period: c.period, reference: c.reference, paidOn: c.paidOn, amount: c.amountPaid })),
  };
}

