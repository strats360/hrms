import { entityOf } from "./entities";
import { and, desc, eq, gte, inArray, lt, lte, or, isNull, sql } from "drizzle-orm";
import {
  branches,
  departments,
  designations,
  employeeIdentities,
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
  packFor,
  periodContaining,
  periodIndex,
  PERIODS_PER_YEAR,
  type PayFrequency,
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
  type CountryCode,
  fbpMonthlyCredit,
  sumFbp,
  type FbpAllocations,
} from "@hrms/shared";
import { badRequest, notFound } from "../lib/errors";
import { buildCalendar } from "./attendance";
import { declarationsFor } from "./tax";
import { claimsForRun } from "./reimbursements";
import { approvedPlans, claimedSoFar, creditedSoFar, fbpSettings } from "./fbp";
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
  /** A country's own salary split (the UK's single salary line) in place of the company template. */
  countryTemplate?: SalaryTemplate,
): Structure {
  const template = countryTemplate ?? templateFor(book, emp.salaryTemplateId);
  const opts = { pfApplicable: emp.pfApplicable, esiApplicable: emp.esiApplicable };
  if (row?.components) return structureFromComponents(row.components, template, opts);
  return structureFromCtc(row ? Number(row.annualCtc) : Number(emp.annualCtc), template, opts);
}

/** Employees payable in a period: joined by the end, not left before the start, not still onboarding. */
export async function payableEmployees(db: Database, tenantId: string, start: string, end: string, entity?: { id: string; isDefault: boolean }) {
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
        // employees without an entity belong to the default one
        entity ? (entity.isDefault ? or(eq(employees.entityId, entity.id), isNull(employees.entityId)) : eq(employees.entityId, entity.id)) : undefined,
        lte(employees.dateOfJoining, end),
        sql`${employees.status} <> 'onboarding'`,
        or(gte(employees.lastWorkingDay, start), and(isNull(employees.lastWorkingDay), sql`${employees.status} not in ('exited','inactive')`)),
      ),
    );
}

/** When each employee was first insured with GOSI (the issue date on their GOSI number), for Saudi payroll. */
export async function insuredSince(db: Database, tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ e: employeeIdentities.employeeId, on: employeeIdentities.issuedOn })
    .from(employeeIdentities)
    .where(and(eq(employeeIdentities.tenantId, tenantId), eq(employeeIdentities.type, "gosi"), inArray(employeeIdentities.employeeId, ids)));
  return new Map(rows.filter((r) => r.on).map((r) => [r.e, r.on!]));
}

/** Year-to-date figures (approved/paid runs earlier in the same tax year, which starts in `startMonth`: April unless the country says otherwise). */
export async function yearToDate(db: Database, tenantId: string, month: string, startMonth = 4, beforeStart = `${month}-01`) {
  const y = Number(month.slice(0, 4));
  const fyStart = `${Number(month.slice(5, 7)) >= startMonth ? y : y - 1}-${String(startMonth).padStart(2, "0")}`;
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
    .where(and(eq(payrollRuns.tenantId, tenantId), gte(payrollRuns.month, fyStart), lt(payrollRuns.periodStart, beforeStart), inArray(payrollRuns.status, ["approved", "paid"])))
    .groupBy(payrollItems.employeeId);
  const [anyRun] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), gte(payrollRuns.month, fyStart), lt(payrollRuns.periodStart, beforeStart), inArray(payrollRuns.status, ["approved", "paid"])));
  return { byEmployee: new Map(rows.map((r) => [r.employeeId, r])), hasHistory: (anyRun?.n ?? 0) > 0 };
}

/**
 * India: employees who had ESI taken earlier in this contribution period (April to September or
 * October to March). ESI continues for them to the end of the period even if their wages go up.
 */
export async function esiCoveredThisPeriod(db: Database, tenantId: string, month: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const from = m >= 4 && m <= 9 ? `${y}-04` : m >= 10 ? `${y}-10` : `${y - 1}-10`;
  const rows = await db
    .selectDistinct({ e: payrollItems.employeeId })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(
      and(
        eq(payrollRuns.tenantId, tenantId),
        gte(payrollRuns.month, from),
        lt(payrollRuns.month, month),
        inArray(payrollItems.employeeId, ids),
        sql`exists (select 1 from jsonb_array_elements(${payrollItems.deductions}) d where d->>'code' = 'esi' and (d->>'amount')::numeric > 0)`,
      ),
    );
  return new Set(rows.map((r) => r.e));
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

  // the run's own period: a month, or a shorter pay period
  const start = run.periodStart;
  const end = run.periodEnd;
  const days = dateRange(start, end).length;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const template = await getTemplate(db, tenantId);
  const statutory = tenant?.statutory ?? {};
  // a run pays one legal entity: its country pack, currency and schemes apply to everyone in it
  const ent = await entityOf(db, tenantId, run.entityId);
  // an off-cycle run pays only the people it has lines for
  const offCycle = run.kind === "off_cycle";
  const offCycleIds = offCycle ? [...new Set((await db.select({ e: payrollAdjustments.employeeId }).from(payrollAdjustments).where(eq(payrollAdjustments.runId, runId))).map((r) => r.e))] : [];
  const emps = offCycle ? (await payableEmployees(db, tenantId, `${run.month.slice(0, 4)}-01-01`, end, ent)).filter((x) => offCycleIds.includes(x.e.id)) : await payableEmployees(db, tenantId, start, end, ent);
  const ids = emps.map((x) => x.e.id);
  // this month's loan and advance instalments, as deduction lines
  // monthly loan instalments come out once a month: in the first pay of the month when pay is more often
  const [earlierThisMonth] = run.frequency === "monthly" ? [] : await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.entityId, run.entityId), eq(payrollRuns.kind, "regular"), eq(payrollRuns.month, run.month), lt(payrollRuns.periodStart, run.periodStart))).limit(1);
  // loans come out of the regular pay, never an off-cycle one
  await syncLoanRecoveries(db, { id: run.id, tenantId, month: run.month }, earlierThisMonth || offCycle ? [] : ids);
  const [structs, ytd, unpaid, adjustments, existing, decls] = await Promise.all([
    structuresAsOf(db, tenantId, ids, end),
    yearToDate(db, tenantId, run.month, packFor(ent.country).payroll.taxYearStartMonth, run.periodStart),
    unpaidLeaveDays(db, tenantId, start, end),
    db.select().from(payrollAdjustments).where(eq(payrollAdjustments.runId, runId)),
    db.select().from(payrollItems).where(eq(payrollItems.runId, runId)),
    declarationsFor(db, tenantId, fyOfMonth(run.month), ids),
  ]);
  const claims = offCycle ? new Map<string, number>() : await claimsForRun(db, tenantId, runId, end, ids);
  // flexible benefits: held back from the special allowance, claimed against bills, and whatever is
  // left paid as taxable salary in the year's last pay (or the last pay before someone leaves)
  const fy = fyOfMonth(run.month);
  const fbp = ent.country === "IN" && !offCycle ? await fbpSettings(db, tenantId) : null;
  const [plans, credited, claimedFbp] = fbp ? await Promise.all([approvedPlans(db, tenantId, fy, ids), creditedSoFar(db, tenantId, fy, ids, runId), claimedSoFar(db, tenantId, fy, ids, { approvedOnly: true })]) : [new Map(), new Map(), new Map()];
  const dayAfterEnd = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const lastPayOfYear = fyOfMonth(dayAfterEnd.slice(0, 7)) !== fy;
  const prev = new Map(existing.map((i) => [i.employeeId, i]));
  const cal = opts.assumePresent || offCycle ? null : await buildCalendar(db, tenantId, emps.map((x) => ({ id: x.e.id, shiftId: x.e.shiftId, branchId: x.e.branchId, dateOfJoining: x.e.dateOfJoining, lastWorkingDay: x.e.lastWorkingDay })), start, end);
  const rules = await rulesFor(db, run.month, ent.country);
  const insured = ent.country === "SA" ? await insuredSince(db, tenantId, ids) : new Map<string, string>();
  const india = ent.country === "IN";
  const esiCovered = india ? await esiCoveredThisPeriod(db, tenantId, run.month, ids) : new Set<string>();
  const pack = packFor(ent.country);
  const statOn = (entity: { statutory: Record<string, { enabled?: boolean }> }, k: string) => entity.statutory?.[k]?.enabled ?? statutory[k as keyof typeof statutory]?.enabled ?? true;

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
    // PF and ESI are Indian schemes: outside India they don't come out of the CTC
    const structure = resolveStructure(india ? e : { ...e, pfApplicable: false, esiApplicable: false }, structs.get(e.id), template, pack.payroll.salaryTemplate);
    const regime = (((decls.get(e.id)?.regime ?? e.taxRegime) as Regime) ?? "new") as Regime;
    const plan = fbp ? plans.get(e.id) : undefined;
    const fbpFull = plan && fbp ? fbpMonthlyCredit(fbp.heads, regime as "new" | "old", plan, structure.components.special) : {};
    const fbpHeld = sumFbp(fbpFull);
    const paidStructure = fbpHeld ? { ...structure, gross: structure.gross - fbpHeld, components: { ...structure.components, special: structure.components.special - fbpHeld } } : structure;
    const share = days ? paidDays / days : 0;
    const fbpCredit = Object.fromEntries(Object.entries(fbpFull).map(([h, n]) => [h, Math.round(n * share * 100) / 100]).filter(([, n]) => (n as number) > 0));
    const leaving = !!e.lastWorkingDay && e.lastWorkingDay <= end;
    let fbpPayout = 0;
    if (fbp && (lastPayOfYear || leaving)) {
      const c = credited.get(e.id) ?? {};
      const k = claimedFbp.get(e.id) ?? {};
      const heads = new Set([...Object.keys(c), ...Object.keys(fbpCredit), ...Object.keys(k)]);
      for (const h of heads) fbpPayout += Math.max(0, (c[h] ?? 0) + ((fbpCredit as FbpAllocations)[h] ?? 0) - (k[h] ?? 0));
      fbpPayout = Math.round(fbpPayout);
    }
    const y = ytd.byEmployee.get(e.id);
    const slip = computePayslip({
      country: ent.country as CountryCode,
      rules,
      month: run.month,
      structure: paidStructure,
      template: pack.payroll.salaryTemplate ?? templateFor(template, e.salaryTemplateId),
      countryProfile: e.countryProfile,
      ...(run.frequency !== "monthly" ? { period: { perYear: PERIODS_PER_YEAR[run.frequency as PayFrequency], index: periodIndex(periodContaining(run.frequency as PayFrequency, run.periodStart, ent.payAnchor), pack.payroll.taxYearStartMonth ?? 4, ent.payAnchor) } } : {}),
      esiContinue: esiCovered.has(e.id),
      ...(offCycle ? { offCycle: true } : {}),
      daysInMonth: days,
      paidDays,
      adjustments: adjustments
        .filter((a) => a.employeeId === e.id)
        .map((a) => ({ label: a.label, kind: a.kind as "earning" | "deduction", amount: Number(a.amount), taxable: a.taxable, esiWage: a.esiWage }))
        .concat(fbpPayout > 0 ? [{ label: "Unclaimed flexible benefits", kind: "earning" as const, amount: fbpPayout, taxable: true, esiWage: false }] : []),
      pfApplicable: e.pfApplicable && statOn(ent, "epf"),
      esiApplicable: e.esiApplicable && statOn(ent, "esi"),
      ptApplicable: e.ptApplicable && statOn(ent, "pt"),
      state: branchState ?? ent.state ?? tenant?.state ?? null,
      gender: e.gender,
      profile: { nationality: e.nationality, region: ent.state, insuredSince: insured.get(e.id) ?? null, joinedOn: e.dateOfJoining },
      regime,
      reimbursement: claims.get(e.id) ?? 0,
      taxProfile: decls.get(e.id) ? { declaration: decls.get(e.id)!.data, verified: decls.get(e.id)!.verified } : undefined,
      ytd: y ? { taxableGross: y.taxableGross, tds: y.tds, employeePf: y.employeePf, professionalTax: y.professionalTax } : ytd.hasHistory ? { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 } : undefined,
    });
    const warnings = [...slip.warnings];
    if (fbpHeld) warnings.push(`Flexible benefits of ${inrPlain(sumFbp(fbpCredit as FbpAllocations))} held back from special allowance, to claim against bills`);
    if (!e.accountLast4 || (india && !e.ifsc)) warnings.push("No bank account on file");
    if (india && !e.pan) warnings.push("PAN missing: TDS should be at least 20%");
    if (e.lastWorkingDay && e.lastWorkingDay <= end) warnings.push("Leaving this month: settle full and final separately");
    if (e.dateOfJoining >= start) warnings.push("Joined this month: pay prorated from joining date");
    // minimum wage, on the full month's pay (LOP doesn't make a salary non-compliant)
    const mwState = india ? (branchState ?? tenant?.state ?? null) : null;
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
      ...(slip.wages !== undefined ? { codeWages: slip.wages } : {}),
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
      // non-cash perquisites (car) are taxable salary too
      taxableGross: slip.gross - nonTaxable + (slip.perquisites ?? 0),
      employeePf: slip.deductions.find((d) => d.code === "pf")?.amount ?? 0,
      professionalTax: slip.deductions.find((d) => d.code === "pt")?.amount ?? 0,
      tax: slip.tax as unknown as Record<string, unknown>,
      fbpCredit: Object.keys(fbpCredit).length ? (fbpCredit as FbpAllocations) : null,
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
