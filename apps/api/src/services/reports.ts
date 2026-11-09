import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import {
  attendanceRecords,
  branches,
  departments,
  designations,
  employees,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  paymentBatches,
  payments,
  payrollItems,
  payrollRuns,
  reimbursementCategories,
  reimbursementClaims,
  tenants,
  type Database,
} from "@hrms/db";
import { daysInMonth, fyOfMonth, minimumWageShortfall, ptSlabSummary, todayIST, WAGE_CATEGORY_LABELS, type Action, type Module } from "@hrms/shared";
import { contributionRow, LOCKED, type Item } from "../routes/compliance";
import { getTemplate, resolveStructure, structuresAsOf } from "./payroll";
import { fyMonths, QUARTERS } from "./tax";
import { rulesFor } from "./statutory";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export interface ReportFilters {
  /** "2026-10" (month), "2026-27:Q2" (quarter) or "2026-27" (financial year to date). */
  period?: string;
  branchId?: string;
  departmentId?: string;
  /** "all" (active + exited) or "active". */
  status?: "all" | "active";
}

export interface Period {
  months: string[];
  from: string;
  to: string;
  label: string;
}

const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return `${m}-${String(daysInMonth(y, mo)).padStart(2, "0")}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function resolvePeriod(period?: string): Period {
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const p = period || thisMonth;
  let months: string[];
  let label: string;
  if (/^\d{4}-\d{2}$/.test(p) && Number(p.slice(5)) >= 1 && Number(p.slice(5)) <= 12) {
    months = [p];
    label = mLabel(p);
  } else if (/^\d{4}-\d{2}:Q[1-4]$/.test(p)) {
    const [fy, q] = p.split(":") as [string, string];
    const all = fyMonths(fy);
    months = all.filter((m) => QUARTERS[q]!.includes(Number(m.slice(5, 7))));
    label = `${q} FY ${fy}`;
  } else if (/^\d{4}-\d{2}$/.test(p)) {
    months = fyMonths(p).filter((m) => m <= thisMonth);
    label = `FY ${p}${months.length < 12 ? " to date" : ""}`;
  } else {
    months = [thisMonth];
    label = mLabel(thisMonth);
  }
  if (!months.length) months = [thisMonth];
  const to = lastDay(months.at(-1)!);
  return { months, from: `${months[0]}-01`, to: to > today && months.includes(thisMonth) ? today : to, label };
}

/** Employees matching the branch / department / status filters. */
async function employeeScope(db: Database, tenantId: string, f: ReportFilters) {
  const conds: SQL[] = [eq(employees.tenantId, tenantId)];
  if (f.branchId) conds.push(eq(employees.branchId, f.branchId));
  if (f.departmentId) conds.push(eq(employees.departmentId, f.departmentId));
  if (f.status === "active") conds.push(notInArray(employees.status, ["exited", "inactive"]));
  return conds;
}
async function scopedIds(db: Database, tenantId: string, f: ReportFilters) {
  const rows = await db.select({ id: employees.id }).from(employees).where(and(...(await employeeScope(db, tenantId, f))));
  return rows.map((r) => r.id);
}
const inIds = (col: Parameters<typeof inArray>[0], ids: string[]) => inArray(col, ids.length ? ids : ["-"]);

async function lockedItems(db: Database, tenantId: string, months: string[], ids: string[]) {
  return db
    .select({ item: payrollItems, month: payrollRuns.month, run: payrollRuns })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tenantId), inArray(payrollRuns.status, LOCKED), inArray(payrollRuns.month, months), inIds(payrollItems.employeeId, ids)))
    .orderBy(asc(payrollRuns.month), asc(sql`${payrollItems.snapshot}->>'code'`));
}
const line = (lines: { code: string; amount: number }[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);
const hours = (min: number) => Math.round((min / 60) * 10) / 10;
const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "");

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export interface ReportResult {
  header: string[];
  rows: unknown[][];
  /** Extra sheets for the Excel file (e.g. a summary). */
  sheets?: { name: string; header: string[]; rows: unknown[][] }[];
  note?: string;
}
interface Ctx {
  db: Database;
  tenantId: string;
  f: ReportFilters;
  period: Period;
}
export interface ReportDef {
  key: string;
  name: string;
  group: string;
  description: string;
  module: Module;
  action?: Action;
  /** Whether the period filter applies. */
  usesPeriod: boolean;
  run: (ctx: Ctx) => Promise<ReportResult>;
}

const mgr = alias(employees, "mgr");

export const REPORTS: ReportDef[] = [
  {
    key: "employee-master",
    name: "Employee master",
    group: "People",
    description: "All employees with employment and statutory fields",
    module: "employees",
    usesPeriod: false,
    async run({ db, tenantId, f }) {
      const rows = await db
        .select({ e: employees, dept: departments.name, desig: designations.name, branch: branches.name, manager: mgr.fullName })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .leftJoin(branches, eq(branches.id, employees.branchId))
        .leftJoin(mgr, eq(mgr.id, employees.managerId))
        .where(and(...(await employeeScope(db, tenantId, f))))
        .orderBy(asc(employees.employeeCode));
      return {
        header: ["Employee ID", "Name", "Work email", "Phone", "Department", "Designation", "Branch", "Reporting manager", "Date of joining", "Employment type", "Status", "Last working day", "Gender", "Date of birth", "PAN", "UAN", "ESIC IP", "PF", "ESI", "PT", "Tax regime", "Bank", "Account", "IFSC", "Annual CTC"],
        rows: rows.map(({ e, dept, desig, branch, manager }) => [e.employeeCode, e.fullName, e.workEmail, e.phone, dept, desig, branch, manager, e.dateOfJoining, e.employmentType, e.status, e.lastWorkingDay, e.gender, e.dateOfBirth, e.pan, e.uan, e.esicIpNumber, e.pfApplicable ? "Yes" : "No", e.esiApplicable ? "Yes" : "No", e.ptApplicable ? "Yes" : "No", e.taxRegime, e.bankName, e.accountLast4 ? `····${e.accountLast4}` : "", e.ifsc, Number(e.annualCtc)]),
      };
    },
  },
  {
    key: "employee-attendance",
    name: "Employee attendance",
    group: "Attendance",
    description: "Daily punches with source and exceptions",
    module: "attendance",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const rows = await db
        .select({ r: attendanceRecords, code: employees.employeeCode, name: employees.fullName, dept: departments.name })
        .from(attendanceRecords)
        .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(and(eq(attendanceRecords.tenantId, tenantId), gte(attendanceRecords.date, period.from), lte(attendanceRecords.date, period.to), ...(await employeeScope(db, tenantId, f))))
        .orderBy(asc(attendanceRecords.date), asc(employees.employeeCode))
        .limit(100000);
      return {
        header: ["Date", "Employee ID", "Name", "Department", "Status", "In", "Out", "Work hours", "Late (min)", "Early out (min)", "Overtime (min)", "Source", "Manual", "Note"],
        rows: rows.map(({ r, code, name, dept }) => [r.date, code, name, dept, r.status, time(r.checkIn), time(r.checkOut), hours(r.workMinutes), r.lateMinutes, r.earlyMinutes, r.overtimeMinutes, r.source, r.isManual ? "Yes" : "", r.note]),
      };
    },
  },
  {
    key: "monthly-attendance",
    name: "Monthly attendance",
    group: "Attendance",
    description: "Paid days, LOP and overtime by employee",
    module: "attendance",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const ids = await scopedIds(db, tenantId, f);
      const agg = await db
        .select({
          employeeId: attendanceRecords.employeeId,
          month: sql<string>`to_char(${attendanceRecords.date}, 'YYYY-MM')`,
          present: sql<number>`count(*) filter (where ${attendanceRecords.status} in ('present','late','wfh'))::int`,
          wfh: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'wfh')::int`,
          half: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'half_day')::int`,
          absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'absent')::int`,
          leave: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'on_leave')::int`,
          late: sql<number>`count(*) filter (where ${attendanceRecords.lateMinutes} > 0)::int`,
          ot: sql<number>`coalesce(sum(${attendanceRecords.overtimeMinutes}),0)::int`,
        })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.tenantId, tenantId), gte(attendanceRecords.date, period.from), lte(attendanceRecords.date, period.to), inIds(attendanceRecords.employeeId, ids)))
        .groupBy(attendanceRecords.employeeId, sql`to_char(${attendanceRecords.date}, 'YYYY-MM')`);
      const items = await lockedItems(db, tenantId, period.months, ids);
      const pay = new Map(items.map((x) => [`${x.item.employeeId}|${x.month}`, x.item]));
      const emps = new Map((await db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName }).from(employees).where(inIds(employees.id, ids))).map((e) => [e.id, e]));
      const rows = agg
        .map((a) => {
          const e = emps.get(a.employeeId);
          const it = pay.get(`${a.employeeId}|${a.month}`);
          return [a.month, e?.code, e?.name, a.present, a.wfh, a.half, a.absent, a.leave, a.late, hours(a.ot), it ? Number(it.daysInMonth) : "", it ? Number(it.paidDays) : "", it ? Number(it.lopOverride ?? it.lopDays) : ""];
        })
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])));
      return { header: ["Month", "Employee ID", "Name", "Present", "of which WFH", "Half days", "Absent", "On leave", "Late marks", "Overtime hours", "Days in month", "Paid days (payroll)", "LOP (payroll)"], rows, note: "Paid days and LOP come from locked payroll; blank until the month is locked." };
    },
  },
  {
    key: "leave-register",
    name: "Leave register",
    group: "Leave",
    description: "Opening, accrued, availed and closing per leave type",
    module: "leave",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const year = Number(period.to.slice(0, 4));
      const rows = await db
        .select({ b: leaveBalances, code: employees.employeeCode, name: employees.fullName, type: leaveTypes.code, typeName: leaveTypes.name })
        .from(leaveBalances)
        .innerJoin(employees, eq(employees.id, leaveBalances.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
        .where(and(eq(leaveBalances.tenantId, tenantId), eq(leaveBalances.year, year), ...(await employeeScope(db, tenantId, f))))
        .orderBy(asc(employees.employeeCode), asc(leaveTypes.code));
      const pending = await db
        .select({ e: leaveRequests.employeeId, t: leaveRequests.leaveTypeId, d: sql<number>`coalesce(sum(${leaveRequests.days}),0)::float` })
        .from(leaveRequests)
        .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "pending"), sql`extract(year from ${leaveRequests.startDate}) = ${year}`))
        .groupBy(leaveRequests.employeeId, leaveRequests.leaveTypeId);
      const pend = new Map(pending.map((p) => [`${p.e}|${p.t}`, p.d]));
      return {
        header: ["Year", "Employee ID", "Name", "Leave type", "Opening", "Accrued", "Availed", "Adjusted", "Closing", "Pending approval"],
        rows: rows.map(({ b, code, name, type, typeName }) => [year, code, name, `${type} · ${typeName}`, Number(b.opening), Number(b.accrued), Number(b.used), Number(b.adjusted), Number(b.opening) + Number(b.accrued) + Number(b.adjusted) - Number(b.used), pend.get(`${b.employeeId}|${b.leaveTypeId}`) ?? 0]),
        note: `Calendar year ${year} balances.`,
      };
    },
  },
  {
    key: "salary-register",
    name: "Salary register",
    group: "Payroll",
    description: "Component-wise earnings and deductions",
    module: "payroll",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const labels = (k: "earnings" | "deductions" | "employer") => [...new Set(items.flatMap((x) => x.item[k].map((l) => l.label)))];
      const earn = labels("earnings");
      const ded = labels("deductions");
      const er = labels("employer");
      const amt = (ls: { label: string; amount: number }[], l: string) => ls.filter((x) => x.label === l).reduce((s, x) => s + x.amount, 0);
      return {
        header: ["Month", "Employee ID", "Name", "Department", "Branch", "Days", "Paid days", "LOP", ...earn, "Gross", ...ded, "Total deductions", "Reimbursements", "Net pay", ...er, "Employer cost", "On hold"],
        rows: items.map(({ item: i, month }) => [month, i.snapshot.code, i.snapshot.name, i.snapshot.department, i.snapshot.branch, Number(i.daysInMonth), Number(i.paidDays), Number(i.lopOverride ?? i.lopDays), ...earn.map((l) => amt(i.earnings, l)), Number(i.gross), ...ded.map((l) => amt(i.deductions, l)), Number(i.totalDeductions), Number(i.reimbursement), Number(i.net), ...er.map((l) => amt(i.employer, l)), Number(i.employerCost), i.onHold ? "Yes" : ""]),
      };
    },
  },
  {
    key: "payroll-summary",
    name: "Payroll summary",
    group: "Payroll",
    description: "Totals by department and branch",
    module: "payroll",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const groups = new Map<string, { month: string; dept: string; branch: string; n: number; gross: number; ded: number; net: number; er: number; tds: number; reimb: number }>();
      for (const { item: i, month } of items) {
        const k = `${month}|${i.snapshot.department ?? "—"}|${i.snapshot.branch ?? "—"}`;
        const g = groups.get(k) ?? { month, dept: i.snapshot.department ?? "—", branch: i.snapshot.branch ?? "—", n: 0, gross: 0, ded: 0, net: 0, er: 0, tds: 0, reimb: 0 };
        g.n++;
        g.gross += Number(i.gross);
        g.ded += Number(i.totalDeductions);
        g.net += Number(i.net);
        g.er += Number(i.employerCost);
        g.tds += Number(i.tds);
        g.reimb += Number(i.reimbursement);
        groups.set(k, g);
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      return {
        header: ["Month", "Department", "Branch", "Employees", "Gross", "Deductions", "of which TDS", "Reimbursements", "Net pay", "Employer contributions", "Cost to company"],
        rows: [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.dept.localeCompare(b.dept)).map((g) => [g.month, g.dept, g.branch, g.n, r2(g.gross), r2(g.ded), r2(g.tds), r2(g.reimb), r2(g.net), r2(g.er), r2(g.gross + g.er)]),
        note: "Departments and branches as they were when each payroll was locked.",
      };
    },
  },
  {
    key: "payslip-register",
    name: "Payslip register",
    group: "Payroll",
    description: "Generated payslips, publishing and payment status",
    module: "payroll",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const runIds = [...new Set(items.map((x) => x.run.id))];
      const pays = runIds.length
        ? await db
            .select({ runId: paymentBatches.payrollRunId, e: payments.employeeId, status: payments.status, utr: payments.utr, code: paymentBatches.code })
            .from(payments)
            .innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
            .where(and(inArray(paymentBatches.payrollRunId, runIds), sql`${paymentBatches.status} <> 'cancelled'`))
        : [];
      const pay = new Map(pays.map((p) => [`${p.runId}|${p.e}`, p]));
      return {
        header: ["Month", "Employee ID", "Name", "Net pay", "Payslip", "Published on", "Emailed to", "Payment batch", "Payment status", "UTR"],
        rows: items.map(({ item: i, month, run }) => {
          const p = pay.get(`${run.id}|${i.employeeId}`);
          return [month, i.snapshot.code, i.snapshot.name, Number(i.net), i.onHold ? "Held" : run.publishedAt ? "Published" : "Not published", run.publishedAt ? run.publishedAt.toISOString().slice(0, 10) : "", run.publishedAt && !i.onHold ? "Work email" : "", p?.code ?? (run.status === "paid" ? run.paymentReference : ""), p?.status ?? (run.status === "paid" && !i.onHold ? "paid" : i.onHold ? "held" : "pending"), p?.utr ?? ""];
        }),
      };
    },
  },
  {
    key: "min-wage-check",
    name: "Minimum wage check",
    group: "Compliance",
    description: "Current salaries against the state minimum wage",
    module: "compliance",
    usesPeriod: false,
    async run({ db, tenantId, f }) {
      const conds = await employeeScope(db, tenantId, { ...f, status: "active" });
      const today = todayIST();
      const emps = await db.select({ e: employees, state: branches.state }).from(employees).leftJoin(branches, eq(branches.id, employees.branchId)).where(and(...conds));
      const [t] = await db.select({ state: tenants.state, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
      const basis = (t?.settings as { minWageBasis?: "basic" | "gross" } | null)?.minWageBasis ?? "basic";
      const R = await rulesFor(db, today.slice(0, 7));
      const template = await getTemplate(db, tenantId);
      const structs = await structuresAsOf(db, tenantId, emps.map((x) => x.e.id), today);
      const configured = Object.keys(R.minWage);
      const rows: (string | number)[][] = [];
      for (const { e, state } of emps) {
        const st = state ?? t?.state ?? null;
        if (!st || !R.minWage[st]) continue;
        const s = resolveStructure(e, structs.get(e.id), template);
        const rule = R.minWage[st]!;
        const short = minimumWageShortfall(rule, { basic: s.components.basic, gross: s.gross }, { category: e.wageCategory, basis });
        const required = short?.required ?? ((e.wageCategory && rule.rates?.[e.wageCategory as keyof typeof rule.rates]) || rule.monthly);
        rows.push([e.employeeCode, e.fullName, st, e.wageCategory ? WAGE_CATEGORY_LABELS[e.wageCategory as keyof typeof WAGE_CATEGORY_LABELS] : (rule.skill ?? "Default rate"), s.components.basic, s.gross, required, short ? short.short : 0, short ? "Below minimum" : "OK"]);
      }
      rows.sort((a, b) => Number(b[7]) - Number(a[7]));
      return {
        header: ["Employee ID", "Name", "State", "Skill category", "Monthly basic", "Monthly gross", "Minimum wage", "Short by", "Result"],
        rows,
        note: configured.length
          ? `Compared on monthly ${basis} (minimum wages are notified for basic + DA). Rates come from the statutory master, for ${configured.join(", ")}.`
          : "No minimum wage is live in the statutory master yet. Publish your state's rates under Platform › Statutory master.",
      };
    },
  },
  {
    key: "pf-report",
    name: "PF report (ECR)",
    group: "Compliance",
    description: "UAN-wise wages and contributions",
    module: "compliance",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const t = await getTemplate(db, tenantId);
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const ceilings = new Map<string, number>();
      for (const m of period.months) ceilings.set(m, (await rulesFor(db, m)).pf.wageCeiling);
      const rows = items.map((x) => ({ month: x.month, r: contributionRow(x.item as Item, t.pfOnFullBasic, ceilings.get(x.month)) })).filter((x) => x.r.epfEe > 0);
      return {
        header: ["Month", "UAN", "Employee ID", "Name", "Gross wages", "EPF wages", "EPS wages", "EDLI wages", "EPF (employee)", "EPS (employer)", "EPF (employer)", "EDLI + admin", "NCP days"],
        rows: rows.map(({ month, r }) => [month, r.uan ?? "UAN missing", r.code, r.name, r.gross, r.pfWage, r.epsWage, r.edliWage, r.epfEe, r.eps, r.epfEr, r.edliAdmin, r.ncpDays]),
        note: "Download the ECR text file for upload from Statutory compliance.",
      };
    },
  },
  {
    key: "esi-report",
    name: "ESI report",
    group: "Compliance",
    description: "IP-wise wages, days and contributions",
    module: "compliance",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const rows = items.map((x) => ({ month: x.month, r: contributionRow(x.item as Item, false) })).filter((x) => x.r.esiEe > 0 || x.r.esiEr > 0);
      return {
        header: ["Month", "IP number", "Employee ID", "Name", "Days paid", "Wages", "ESI (employee)", "ESI (employer)", "Total", "Last working day"],
        rows: rows.map(({ month, r }) => [month, r.esicIpNumber ?? "IP missing", r.code, r.name, r.paidDays, r.gross, r.esiEe, r.esiEr, Math.round((r.esiEe + r.esiEr) * 100) / 100, r.lastWorkingDay]),
      };
    },
  },
  {
    key: "pt-report",
    name: "Professional Tax report",
    group: "Compliance",
    description: "State and slab-wise summary for the PT return",
    module: "compliance",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const byKey = new Map<string, { gross: number; pt: number }[]>();
      for (const { item: i, month } of items) {
        const pt = line(i.deductions, "pt");
        const k = `${month}|${i.snapshot.state ?? "—"}`;
        byKey.set(k, [...(byKey.get(k) ?? []), { gross: Number(i.gross), pt }]);
      }
      const rows: unknown[][] = [];
      for (const [k, list] of [...byKey.entries()].sort()) {
        const [month, state] = k.split("|") as [string, string];
        const slabs = ptSlabSummary(state, list, await rulesFor(db, month));
        if (!slabs.length) rows.push([month, state, "No PT in this state", "", list.length, 0]);
        for (const s of slabs) rows.push([month, state, `₹${s.from.toLocaleString("en-IN")} to ${Number.isFinite(s.upTo) ? "₹" + s.upTo.toLocaleString("en-IN") : "above"}`, s.rate, s.employees, s.amount]);
      }
      const detail = items.filter((x) => line(x.item.deductions, "pt") > 0).map(({ item: i, month }) => [month, i.snapshot.state, i.snapshot.code, i.snapshot.name, Number(i.gross), line(i.deductions, "pt")]);
      return { header: ["Month", "State", "Salary slab", "Rate", "Employees", "PT deducted"], rows, sheets: [{ name: "Employee-wise", header: ["Month", "State", "Employee ID", "Name", "Gross", "PT"], rows: detail }] };
    },
  },
  {
    key: "lwf-report",
    name: "LWF report",
    group: "Compliance",
    description: "Labour Welfare Fund contribution statement",
    module: "compliance",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const rows = items.filter((x) => line(x.item.deductions, "lwf") > 0 || line(x.item.employer, "lwf_er") > 0).map(({ item: i, month }) => [month, i.snapshot.state, i.snapshot.code, i.snapshot.name, line(i.deductions, "lwf"), line(i.employer, "lwf_er"), line(i.deductions, "lwf") + line(i.employer, "lwf_er")]);
      return { header: ["Month", "State", "Employee ID", "Name", "Employee share", "Employer share", "Total"], rows, note: rows.length ? undefined : "LWF is deducted in June and December (Gujarat, Maharashtra). Pick a period that includes those months." };
    },
  },
  {
    key: "tds-report",
    name: "TDS report",
    group: "Tax",
    description: "Monthly deduction per employee with PAN and regime",
    module: "tds",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const rows = items.filter((x) => Number(x.item.taxableGross) > 0).map(({ item: i, month, run }) => [month, i.snapshot.code, i.snapshot.name, i.snapshot.pan ?? "PAN missing", i.snapshot.regime, Number(i.taxableGross), Number(i.tds), Number((i.tax as { projectedAnnualGross?: number } | null)?.projectedAnnualGross ?? 0) || "", Number((i.tax as { total?: number } | null)?.total ?? 0) || "", run.payDate]);
      const fy = fyOfMonth(period.months[0]!);
      return { header: ["Month", "Employee ID", "Name", "PAN", "Regime", "Taxable salary", "TDS deducted", "Projected annual salary", "Projected annual tax", "Pay date"], rows, note: `24Q deductee annexure for FY ${fy} is in TDS & tax, Form 16.` };
    },
  },
  {
    key: "reimbursement-report",
    name: "Reimbursement report",
    group: "Expenses",
    description: "Claims by category, GST and status",
    module: "reimbursements",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const rows = await db
        .select({ c: reimbursementClaims, code: employees.employeeCode, name: employees.fullName, dept: departments.name, cat: reimbursementCategories.name })
        .from(reimbursementClaims)
        .innerJoin(employees, eq(employees.id, reimbursementClaims.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .innerJoin(reimbursementCategories, eq(reimbursementCategories.id, reimbursementClaims.categoryId))
        .where(and(eq(reimbursementClaims.tenantId, tenantId), gte(reimbursementClaims.expenseDate, period.from), lte(reimbursementClaims.expenseDate, period.to), ...(await employeeScope(db, tenantId, f))))
        .orderBy(asc(reimbursementClaims.expenseDate));
      const byCat = new Map<string, { n: number; amount: number; gst: number }>();
      for (const r of rows.filter((r) => ["approved", "paid"].includes(r.c.status))) {
        const g = byCat.get(r.cat) ?? { n: 0, amount: 0, gst: 0 };
        g.n++;
        g.amount += Number(r.c.amount);
        g.gst += Number(r.c.gstAmount ?? 0);
        byCat.set(r.cat, g);
      }
      return {
        header: ["Claim", "Expense date", "Employee ID", "Name", "Department", "Category", "Amount", "Vendor", "GSTIN", "GST amount", "Project / client", "Description", "Status", "Over limit", "Paid on"],
        rows: rows.map(({ c, code, name, dept, cat }) => [c.code, c.expenseDate, code, name, dept, cat, Number(c.amount), c.vendor, c.gstin, c.gstAmount === null ? "" : Number(c.gstAmount), c.project, c.description, c.status, c.overLimit ? "Yes" : "", c.paidAt ? c.paidAt.toISOString().slice(0, 10) : ""]),
        sheets: [{ name: "By category", header: ["Category", "Approved claims", "Amount", "GST input credit"], rows: [...byCat.entries()].map(([k, g]) => [k, g.n, Math.round(g.amount * 100) / 100, Math.round(g.gst * 100) / 100]) }],
      };
    },
  },
  {
    key: "bank-payment-report",
    name: "Bank payment report",
    group: "Payments",
    description: "Batch-wise disbursements and failures",
    module: "payments",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const rows = await db
        .select({ p: payments, b: paymentBatches, code: employees.employeeCode, name: employees.fullName })
        .from(payments)
        .innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId))
        .innerJoin(employees, eq(employees.id, payments.employeeId))
        .where(and(eq(payments.tenantId, tenantId), sql`${paymentBatches.status} <> 'cancelled'`, sql`${payments.status} <> 'cancelled'`, gte(paymentBatches.paymentDate, period.from), lte(paymentBatches.paymentDate, period.to), ...(await employeeScope(db, tenantId, f))))
        .orderBy(asc(paymentBatches.paymentDate), asc(payments.reference));
      const batches = new Map<string, { b: typeof paymentBatches.$inferSelect; n: number; amount: number; paid: number; failed: number; held: number }>();
      for (const r of rows) {
        const g = batches.get(r.b.id) ?? { b: r.b, n: 0, amount: 0, paid: 0, failed: 0, held: 0 };
        g.n++;
        g.amount += Number(r.p.amount);
        if (r.p.status === "paid") g.paid += Number(r.p.amount);
        if (r.p.status === "failed") g.failed++;
        if (r.p.status === "held") g.held++;
        batches.set(r.b.id, g);
      }
      return {
        header: ["Batch", "Type", "Payment date", "Batch status", "Count", "Amount", "Paid", "Failed", "Held"],
        rows: [...batches.values()].map((g) => [g.b.code, g.b.type, g.b.paymentDate, g.b.status, g.n, Math.round(g.amount * 100) / 100, Math.round(g.paid * 100) / 100, g.failed, g.held]),
        sheets: [{ name: "Payments", header: ["Batch", "Reference", "Employee ID", "Name", "Bank", "IFSC", "Account", "Amount", "Status", "UTR", "Reason"], rows: rows.map((r) => [r.b.code, r.p.reference, r.code, r.name, r.p.bankName, r.p.ifsc, r.p.accountLast4 ? `····${r.p.accountLast4}` : "", Number(r.p.amount), r.p.status, r.p.utr, r.p.failureReason]) }],
      };
    },
  },
  {
    key: "employee-cost-report",
    name: "Employee cost report",
    group: "Finance",
    description: "CTC, employer contributions and reimbursements",
    module: "payroll",
    usesPeriod: true,
    async run({ db, tenantId, f, period }) {
      const items = await lockedItems(db, tenantId, period.months, await scopedIds(db, tenantId, f));
      const by = new Map<string, { code: string; name: string; dept: string | null; months: number; gross: number; pf: number; esi: number; other: number; reimb: number }>();
      for (const { item: i } of items) {
        const g = by.get(i.employeeId) ?? { code: i.snapshot.code, name: i.snapshot.name, dept: i.snapshot.department, months: 0, gross: 0, pf: 0, esi: 0, other: 0, reimb: 0 };
        g.months++;
        g.gross += Number(i.gross);
        g.pf += line(i.employer, "epf_er", "eps", "edli", "pf_admin");
        g.esi += line(i.employer, "esi_er");
        g.other += Number(i.employerCost) - line(i.employer, "epf_er", "eps", "edli", "pf_admin", "esi_er");
        g.reimb += Number(i.reimbursement);
        by.set(i.employeeId, g);
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      return {
        header: ["Employee ID", "Name", "Department", "Months", "Gross salary", "Employer PF (incl. EPS, EDLI, admin)", "Employer ESI", "Other employer costs", "Cost to company", "Reimbursements", "Total cost"],
        rows: [...by.values()].sort((a, b) => a.code.localeCompare(b.code)).map((g) => [g.code, g.name, g.dept, g.months, r2(g.gross), r2(g.pf), r2(g.esi), r2(g.other), r2(g.gross + g.pf + g.esi + g.other), r2(g.reimb), r2(g.gross + g.pf + g.esi + g.other + g.reimb)]),
      };
    },
  },
  {
    key: "fnf-report",
    name: "Full & final settlement",
    group: "Exits",
    description: "Dues, recoveries, gratuity and leave encashment",
    module: "payroll",
    usesPeriod: false,
    async run({ db, tenantId, f }) {
      const conds = await employeeScope(db, tenantId, { ...f, status: "all" });
      const emps = await db
        .select()
        .from(employees)
        .where(and(...conds, sql`(${employees.status} in ('notice','exited','inactive') or ${employees.lastWorkingDay} is not null)`))
        .orderBy(asc(employees.lastWorkingDay));
      if (!emps.length) return { header: ["Employee ID"], rows: [], note: "No employees on notice or exited." };
      const ids = emps.map((e) => e.id);
      const template = await getTemplate(db, tenantId);
      const structs = await structuresAsOf(db, tenantId, ids, todayIST());
      const lastRuns = await db
        .select({ e: payrollItems.employeeId, month: sql<string>`max(${payrollRuns.month})` })
        .from(payrollItems)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
        .where(and(inArray(payrollItems.employeeId, ids), inArray(payrollRuns.status, LOCKED)))
        .groupBy(payrollItems.employeeId);
      const lastMonth = new Map(lastRuns.map((r) => [r.e, r.month]));
      const year = Number(todayIST().slice(0, 4));
      const encash = await db
        .select({ e: leaveBalances.employeeId, bal: sql<number>`coalesce(sum(${leaveBalances.opening} + ${leaveBalances.accrued} + ${leaveBalances.adjusted} - ${leaveBalances.used}),0)::float` })
        .from(leaveBalances)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
        .where(and(inArray(leaveBalances.employeeId, ids), eq(leaveBalances.year, year), eq(leaveTypes.encashable, true)))
        .groupBy(leaveBalances.employeeId);
      const leave = new Map(encash.map((r) => [r.e, r.bal]));
      const claims = await db
        .select({ e: reimbursementClaims.employeeId, s: sql<number>`coalesce(sum(${reimbursementClaims.amount}),0)::float` })
        .from(reimbursementClaims)
        .where(and(inArray(reimbursementClaims.employeeId, ids), inArray(reimbursementClaims.status, ["approved", "pending_manager", "pending_finance"])))
        .groupBy(reimbursementClaims.employeeId);
      const claim = new Map(claims.map((r) => [r.e, r.s]));
      const unpaid = await db
        .select({ e: payments.employeeId, s: sql<number>`coalesce(sum(${payments.amount}),0)::float` })
        .from(payments)
        .where(and(inArray(payments.employeeId, ids), inArray(payments.status, ["failed", "held", "pending"])))
        .groupBy(payments.employeeId);
      const owed = new Map(unpaid.map((r) => [r.e, r.s]));
      const rows = emps.map((e) => {
        const basic = resolveStructure(e, structs.get(e.id), template).components.basic;
        const end = e.lastWorkingDay ?? todayIST();
        const ms = (Date.parse(end) - Date.parse(e.dateOfJoining)) / (365.25 * 86400000);
        // completed years, with 6+ months counting as a full year
        const years = Math.floor(ms) + (ms - Math.floor(ms) >= 0.5 ? 1 : 0);
        const gratuity = ms >= 4.66 ? Math.min(2000000, Math.round((15 / 26) * basic * years)) : 0;
        const elDays = Math.max(0, leave.get(e.id) ?? 0);
        const encashment = Math.round((basic / 26) * elDays);
        const total = gratuity + encashment + (claim.get(e.id) ?? 0) + (owed.get(e.id) ?? 0);
        return [e.employeeCode, e.fullName, e.status, e.dateOfJoining, e.lastWorkingDay, e.resignationDate, Math.round(ms * 10) / 10, lastMonth.get(e.id) ?? "", owed.get(e.id) ?? 0, basic, elDays, encashment, gratuity, claim.get(e.id) ?? 0, total];
      });
      return {
        header: ["Employee ID", "Name", "Status", "Date of joining", "Last working day", "Resignation date", "Service (years)", "Last payroll month", "Unpaid salary / payments", "Monthly basic", "Encashable leave (days)", "Leave encashment", "Gratuity", "Open claims", "Estimated settlement"],
        rows,
        note: "Estimates. Gratuity after 4 years 240 days of service (15/26 × basic × completed years, ₹20 lakh cap); leave encashment at basic / 26 per day. Add notice-pay recovery and other deductions before settling.",
      };
    },
  },
];

export const reportByKey = new Map(REPORTS.map((r) => [r.key, r]));
export function runReport(db: Database, tenantId: string, def: ReportDef, f: ReportFilters) {
  return def.run({ db, tenantId, f, period: resolvePeriod(f.period) });
}
