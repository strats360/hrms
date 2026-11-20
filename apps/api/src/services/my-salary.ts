import { and, asc, eq, lte } from "drizzle-orm";
import { branches, employees, salaryStructures, tenants, type Database } from "@hrms/db";
import { computePayslip, packFor, fyOfMonth, templateFor, todayLocal, type CountryCode, type Regime } from "@hrms/shared";
import { entityOf } from "./entities";
import { getTemplate, insuredSince, resolveStructure, yearToDate } from "./payroll";
import { declarationsFor } from "./tax";
import { rulesFor } from "./statutory";

/** Does the company show the salary breakdown in self-service? On unless HR turned it off. */
export const essSalaryVisible = (settings: unknown) => (settings as { essSalaryView?: boolean } | null)?.essSalaryView !== false;

/**
 * An employee's own salary: the current structure as a CTC breakdown, an estimate of a
 * full month's take-home (worked out the way payroll would this month), and revisions so
 * far. Revisions dated in the future stay hidden until they take effect.
 */
export async function mySalary(db: Database, tenantId: string, employeeId: string) {
  const today = todayLocal();
  const month = today.slice(0, 7);
  const [row] = await db
    .select({ e: employees, state: branches.state })
    .from(employees)
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!row) return null;
  const e = row.e;
  const [tenant] = await db.select({ state: tenants.state, statutory: tenants.statutory }).from(tenants).where(eq(tenants.id, tenantId));
  const ent = await entityOf(db, tenantId, e.entityId);
  const statOn = (k: string) => (ent.statutory as Record<string, { enabled?: boolean }> | null)?.[k]?.enabled ?? (tenant?.statutory as Record<string, { enabled?: boolean }> | null)?.[k]?.enabled ?? true;

  const history = await db
    .select({ effectiveFrom: salaryStructures.effectiveFrom, annualCtc: salaryStructures.annualCtc, components: salaryStructures.components })
    .from(salaryStructures)
    .where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeId, employeeId), lte(salaryStructures.effectiveFrom, today)))
    .orderBy(asc(salaryStructures.effectiveFrom));
  const current = history[history.length - 1];
  const book = await getTemplate(db, tenantId);
  const india = ent.country === "IN";
  const pack = packFor(ent.country);
  const structure = resolveStructure(india ? e : { ...e, pfApplicable: false, esiApplicable: false }, current, book, pack.payroll.salaryTemplate);

  const [rules, ytd, decls] = await Promise.all([rulesFor(db, month, ent.country), yearToDate(db, tenantId, month), declarationsFor(db, tenantId, fyOfMonth(month), [employeeId])]);
  const decl = decls.get(employeeId);
  const y = ytd.byEmployee.get(employeeId);
  const regime = ((decl?.regime ?? e.taxRegime) as Regime) ?? "new";
  const slip = computePayslip({
    country: ent.country as CountryCode,
    rules,
    month,
    structure,
    template: pack.payroll.salaryTemplate ?? templateFor(book, e.salaryTemplateId),
    countryProfile: e.countryProfile,
    daysInMonth: 30,
    paidDays: 30,
    pfApplicable: e.pfApplicable && statOn("epf"),
    esiApplicable: e.esiApplicable && statOn("esi"),
    ptApplicable: e.ptApplicable && statOn("pt"),
    state: row.state ?? ent.state ?? tenant?.state ?? null,
    gender: e.gender,
    profile: { nationality: e.nationality, region: ent.state, insuredSince: ent.country === "SA" ? ((await insuredSince(db, tenantId, [employeeId])).get(employeeId) ?? null) : null, joinedOn: e.dateOfJoining },
    regime,
    taxProfile: decl ? { declaration: decl.data, verified: decl.verified } : undefined,
    ytd: y ? { taxableGross: y.taxableGross, tds: y.tds, employeePf: y.employeePf, professionalTax: y.professionalTax } : ytd.hasHistory ? { taxableGross: 0, tds: 0, employeePf: 0, professionalTax: 0 } : undefined,
  });

  const revisions = history.map((h, i) => {
    const prev = i ? Number(history[i - 1]!.annualCtc) : null;
    const ctc = Number(h.annualCtc);
    return { effectiveFrom: h.effectiveFrom, annualCtc: ctc, change: prev ? ctc - prev : null, changePct: prev ? Math.round(((ctc - prev) / prev) * 1000) / 10 : null };
  });

  return {
    /** Null when HR hasn't recorded a revision: the CTC is the one on the employee record. */
    effectiveFrom: current?.effectiveFrom ?? null,
    annualCtc: structure.annualCtc,
    monthlyCtc: structure.monthlyCtc,
    earnings: slip.earnings,
    gross: slip.gross,
    // CTC counts the employer's PF and ESI; EDLI and PF admin charges are the company's own cost
    employer: [
      { code: "pf_er", label: "Provident fund (employer)", amount: structure.employer.pf },
      { code: "esi_er", label: "ESI (employer)", amount: structure.employer.esi },
    ].filter((x) => x.amount > 0),
    employerTotal: structure.employer.pf + structure.employer.esi,
    deductions: slip.deductions,
    totalDeductions: slip.totalDeductions,
    takeHome: slip.net,
    regime,
    pf: e.pfApplicable && statOn("epf"),
    esi: slip.deductions.some((d) => d.code === "esi"),
    revisions: revisions.reverse(),
  };
}
