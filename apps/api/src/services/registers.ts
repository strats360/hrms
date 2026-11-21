import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { branches, committeeCases, contractWorkers, designations, employeeExits, employees, leaveRequests, leaveTypes, payrollAdjustments, payrollItems, payrollRuns, type Database } from "@hrms/db";
import { dateRange, EMPLOYMENT_TYPE_LABELS, WAGE_CATEGORY_LABELS } from "@hrms/shared";
import type { Sheet } from "../lib/xlsx";
import { buildCalendar } from "./attendance";
import { balanceSummary } from "./leave";

/**
 * The five unified registers (Ease of Compliance to Maintain Registers Rules 2017, which the Labour
 * Code rules carry forward): A employees, B wages, C deductions and recoveries, D attendance, and
 * E leave. Each is built from what Saralix already keeps.
 */
export const REGISTER_FORMS = {
  A: "Register of employees",
  B: "Register of wages",
  C: "Register of deductions and recoveries",
  D: "Register of attendance (muster roll)",
  E: "Register of leave",
} as const;
export type RegisterForm = keyof typeof REGISTER_FORMS;

const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function staff(db: Database, tenantId: string, from: string, to: string, entityId?: string | null) {
  return db
    .select({ e: employees, branch: branches.name, designation: designations.name })
    .from(employees)
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(and(eq(employees.tenantId, tenantId), lte(employees.dateOfJoining, to), sql`(${employees.lastWorkingDay} is null or ${employees.lastWorkingDay} >= ${from})`, ...(entityId ? [eq(employees.entityId, entityId)] : [])))
    .orderBy(asc(employees.employeeCode));
}

async function regularRunsIn(db: Database, tenantId: string, month: string, entityId?: string | null) {
  return db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.month, month), inArray(payrollRuns.status, ["approved", "paid"]), ...(entityId ? [eq(payrollRuns.entityId, entityId)] : [])));
}

export async function buildRegister(db: Database, tenantId: string, form: RegisterForm, month: string, entityId?: string | null): Promise<Sheet> {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const name = `Form ${form}`;
  if (form === "A") {
    const rows = await staff(db, tenantId, from, to, entityId);
    const exits = rows.length ? await db.select({ e: employeeExits.employeeId, type: employeeExits.type }).from(employeeExits).where(inArray(employeeExits.employeeId, rows.map((r) => r.e.id))) : [];
    return {
      name,
      header: ["Sl", "Employee ID", "Name", "Gender", "Date of birth", "Nationality", "Date of joining", "Designation", "Skill category", "Type of employment", "Mobile", "UAN", "PAN", "ESIC IP number", "Aadhaar (last 4)", "Bank account (last 4)", "IFSC", "Branch", "Present address", "Permanent address", "Date of exit", "Reason for exit"],
      rows: rows.map((r, i) => [i + 1, r.e.employeeCode, r.e.fullName, r.e.gender, r.e.dateOfBirth, r.e.nationality ?? "IN", r.e.dateOfJoining, r.designation, r.e.wageCategory ? WAGE_CATEGORY_LABELS[r.e.wageCategory as keyof typeof WAGE_CATEGORY_LABELS] : "", EMPLOYMENT_TYPE_LABELS[r.e.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? r.e.employmentType, r.e.phone, r.e.uan, r.e.pan, r.e.esicIpNumber, r.e.aadhaarLast4, r.e.accountLast4, r.e.ifsc, r.branch, r.e.currentAddress, r.e.permanentAddress, r.e.lastWorkingDay, exits.find((x) => x.e === r.e.id)?.type?.replace(/_/g, " ") ?? ""]),
    };
  }
  if (form === "B" || form === "C") {
    const runs = await regularRunsIn(db, tenantId, month, entityId);
    const ids = runs.map((r) => r.id);
    if (form === "B") {
      const items = ids.length ? await db.select().from(payrollItems).where(inArray(payrollItems.runId, ids)).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`)) : [];
      const sumOf = (lines: { code: string; amount: number }[], codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);
      const paidOn = new Map(runs.map((r) => [r.id, r.paidAt ? r.paidAt.toISOString().slice(0, 10) : (r.payDate ?? "")]));
      return {
        name,
        header: ["Sl", "Employee ID", "Name", "Designation", "Monthly CTC", "Days paid", "LOP days", "Basic", "HRA", "Overtime", "Other allowances", "Gross", "PF", "ESI", "Professional tax", "LWF", "TDS", "Other deductions", "Total deductions", "Net pay", "Paid on", "Bank account (last 4)"],
        rows: items.map((it, i) => {
          const basic = sumOf(it.earnings, ["basic"]);
          const hra = sumOf(it.earnings, ["hra"]);
          const ot = it.earnings.filter((l) => /overtime/i.test(l.label)).reduce((s, l) => s + l.amount, 0);
          const stat = ["pf", "vpf", "esi", "pt", "lwf", "tds"];
          return [i + 1, it.snapshot.code, it.snapshot.name, it.snapshot.designation, Math.round((it.snapshot.annualCtc ?? 0) / 12), Number(it.paidDays), Number(it.lopOverride ?? it.lopDays), basic, hra, ot, Number(it.gross) - basic - hra - ot, Number(it.gross), sumOf(it.deductions, ["pf", "vpf"]), sumOf(it.deductions, ["esi"]), sumOf(it.deductions, ["pt"]), sumOf(it.deductions, ["lwf"]), sumOf(it.deductions, ["tds"]), it.deductions.filter((d) => !stat.includes(d.code)).reduce((s, d) => s + d.amount, 0), Number(it.totalDeductions), Number(it.net), it.onHold ? "On hold" : paidOn.get(it.runId), it.snapshot.accountLast4];
        }),
      };
    }
    const adj = ids.length ? await db.select({ a: payrollAdjustments, code: employees.employeeCode, nm: employees.fullName }).from(payrollAdjustments).innerJoin(employees, eq(employees.id, payrollAdjustments.employeeId)).where(and(inArray(payrollAdjustments.runId, ids), eq(payrollAdjustments.kind, "deduction"))).orderBy(asc(employees.employeeCode)) : [];
    return {
      name,
      header: ["Sl", "Employee ID", "Name", "Kind", "Particulars", "Month", "Amount recovered"],
      rows: adj.map((r, i) => [i + 1, r.code, r.nm, r.a.source === "loan" ? "Loan or advance" : r.a.source === "manual" ? "Other deduction" : r.a.source, r.a.label, month, Number(r.a.amount)]),
    };
  }
  if (form === "D") {
    const rows = await staff(db, tenantId, from, to, entityId);
    const days = dateRange(from, to);
    const cal = await buildCalendar(db, tenantId, rows.map((r) => ({ id: r.e.id, shiftId: r.e.shiftId, branchId: r.e.branchId, dateOfJoining: r.e.dateOfJoining, lastWorkingDay: r.e.lastWorkingDay, entityId: r.e.entityId })), from, to);
    const mark: Record<string, string> = { present: "P", late: "P", wfh: "P", half_day: "HD", absent: "A", on_leave: "L", holiday: "H", weekly_off: "WO", not_marked: "" };
    return {
      name,
      header: ["Employee ID", "Name", ...days.map((d) => d.slice(8)), "Present", "Half days", "Leave", "Absent", "Holidays and weekly offs"],
      rows: rows.map((r) => {
        const st = days.map((d) => cal.status({ id: r.e.id, shiftId: r.e.shiftId, branchId: r.e.branchId, dateOfJoining: r.e.dateOfJoining, lastWorkingDay: r.e.lastWorkingDay, entityId: r.e.entityId }, d));
        const n = (k: string[]) => st.filter((s) => s && k.includes(s)).length;
        return [r.e.employeeCode, r.e.fullName, ...st.map((s) => (s ? (mark[s] ?? s) : "")), n(["present", "late", "wfh"]), n(["half_day"]), n(["on_leave"]), n(["absent"]), n(["holiday", "weekly_off"])];
      }),
    };
  }
  // E: the year's leave to the end of the month, by type
  const year = Number(month.slice(0, 4));
  const rows = await staff(db, tenantId, `${year}-01-01`, to, entityId);
  const types = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.active, true))).orderBy(asc(leaveTypes.code));
  const out: unknown[][] = [];
  for (const r of rows) {
    const bal = await balanceSummary(db, tenantId, r.e.id, year);
    for (const t of types) {
      const b = bal.find((x) => x.leaveTypeId === t.id);
      if (!b || (!b.opening && !b.accrued && !b.used && !b.adjusted)) continue;
      out.push([r.e.employeeCode, r.e.fullName, t.name, b.opening, b.accrued, b.adjusted, b.used, b.available]);
    }
  }
  return { name, header: ["Employee ID", "Name", "Leave type", "Opening", "Credited", "Adjusted", "Taken", "Balance"], rows: out };
}

/** The figures the unified annual return asks for, for a calendar year. */
export async function annualReturnFigures(db: Database, tenantId: string, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await staff(db, tenantId, from, to);
  const onDate = (d: string) => rows.filter((r) => r.e.dateOfJoining <= d && (!r.e.lastWorkingDay || r.e.lastWorkingDay >= d));
  const yearEnd = onDate(to > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : to);
  const g = (list: typeof rows, k: string) => list.filter((r) => r.e.gender === k).length;
  const [pay] = await db
    .select({ gross: sql<number>`coalesce(sum(${payrollItems.gross}),0)::float`, days: sql<number>`coalesce(sum(${payrollItems.paidDays}),0)::float`, pf: sql<number>`coalesce(sum(${payrollItems.employeePf}),0)::float`, tds: sql<number>`coalesce(sum(${payrollItems.tds}),0)::float` })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tenantId), inArray(payrollRuns.status, ["approved", "paid"]), gte(payrollRuns.month, `${year}-01`), lte(payrollRuns.month, `${year}-12`)));
  const monthly = Array.from({ length: 12 }, (_, i) => onDate(monthEnd(`${year}-${String(i + 1).padStart(2, "0")}`)).length);
  const [mat] = await db.select({ n: sql<number>`count(*)::int` }).from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId)).where(and(eq(leaveRequests.tenantId, tenantId), inArray(leaveTypes.code, ["ML", "MLE"]), eq(leaveRequests.status, "approved"), gte(leaveRequests.startDate, from), lte(leaveRequests.startDate, to)));
  const [posh] = await db.select({ n: sql<number>`count(*)::int` }).from(committeeCases).where(and(eq(committeeCases.tenantId, tenantId), eq(committeeCases.kind, "posh_ic"), gte(committeeCases.filedOn, from), lte(committeeCases.filedOn, to)));
  const [cw] = await db.select({ n: sql<number>`count(*)::int` }).from(contractWorkers).where(and(eq(contractWorkers.tenantId, tenantId), lte(contractWorkers.joinedOn, to), sql`(${contractWorkers.leftOn} is null or ${contractWorkers.leftOn} >= ${from})`));
  return {
    year,
    employees: { atYearEnd: yearEnd.length, women: g(yearEnd, "female"), men: g(yearEnd, "male"), other: yearEnd.length - g(yearEnd, "female") - g(yearEnd, "male"), averageForYear: Math.round(monthly.reduce((s, n) => s + n, 0) / 12), joined: rows.filter((r) => r.e.dateOfJoining >= from).length, left: rows.filter((r) => r.e.lastWorkingDay && r.e.lastWorkingDay <= to).length },
    manDaysPaid: Math.round(Number(pay?.days ?? 0)),
    wagesPaid: Math.round(Number(pay?.gross ?? 0)),
    employeePf: Math.round(Number(pay?.pf ?? 0)),
    tds: Math.round(Number(pay?.tds ?? 0)),
    maternityCases: Number(mat?.n ?? 0),
    poshComplaints: Number(posh?.n ?? 0),
    contractWorkers: Number(cw?.n ?? 0),
  };
}
