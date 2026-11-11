import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { branches, departments, designations, employees, tenants, type Database } from "@hrms/db";
import { BUILT_IN_LETTERS, COMPONENT_LABELS, letterBlocks, pronouns, rupeesInWords, todayIST, type LetterTemplate, type LetterValues, type MonthlyComponents } from "@hrms/shared";
import { A4, colors, MARGIN, PdfWriter } from "../lib/pdf";
import { getTemplate, resolveStructure, structuresAsOf } from "./payroll";

export interface LetterSettings {
  signatoryName: string | null;
  signatoryTitle: string | null;
}
interface Stored {
  letterTemplates?: LetterTemplate[];
  letterSettings?: Partial<LetterSettings>;
}

/** "2 January 2022", the way letters write dates. */
export const longDate = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
export const rupees = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-IN")}`;
const EMPLOYMENT: Record<string, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", intern: "Intern", consultant: "Consultant" };

/** Built-in templates (with the company's edits) followed by the company's own. */
export async function letterTemplates(db: Database, tenantId: string) {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const s = (t?.settings ?? {}) as Stored;
  const saved = s.letterTemplates ?? [];
  const builtIns = BUILT_IN_LETTERS.map((b) => {
    const edit = saved.find((x) => x.id === b.id);
    return { ...b, ...(edit ? { name: edit.name, body: edit.body, edited: true } : { edited: false }) };
  });
  const own = saved.filter((x) => !x.id.startsWith("builtin:")).map((x) => ({ ...x, builtIn: false, edited: false }));
  return { templates: [...builtIns, ...own], settings: { signatoryName: s.letterSettings?.signatoryName ?? null, signatoryTitle: s.letterSettings?.signatoryTitle ?? null } as LetterSettings, saved };
}

export interface SalaryRow {
  label: string;
  monthly: number;
  strong?: boolean;
}

/** Everything a letter can merge in for one employee. Salary only when `withSalary`. */
export async function letterValues(db: Database, tenantId: string, employeeId: string, withSalary: boolean, settings: LetterSettings) {
  const mgr = alias(employees, "mgr");
  const [row] = await db
    .select({ e: employees, dept: departments.name, desig: designations.name, branch: branches.name, manager: mgr.fullName })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!row) return null;
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const e = row.e;
  const v: LetterValues = {
    "employee.name": e.fullName,
    "employee.first_name": e.firstName,
    "employee.code": e.employeeCode,
    "employee.designation": row.desig ?? "",
    "employee.department": row.dept ?? "",
    "employee.branch": row.branch ?? "",
    "employee.work_location": e.workLocation ?? row.branch ?? "",
    "employee.manager": row.manager ?? "",
    "employee.employment_type": EMPLOYMENT[e.employmentType ?? ""] ?? e.employmentType ?? "",
    "employee.joining_date": longDate(e.dateOfJoining),
    "employee.confirmation_date": longDate(e.confirmationDate),
    "employee.probation_months": e.probationMonths != null ? String(e.probationMonths) : "",
    "employee.last_working_day": longDate(e.lastWorkingDay),
    "employee.resignation_date": longDate(e.resignationDate),
    "employee.address": e.currentAddress ?? "",
    "employee.permanent_address": e.permanentAddress ?? e.currentAddress ?? "",
    "employee.date_of_birth": longDate(e.dateOfBirth),
    "employee.pan": e.pan ?? "",
    ...pronouns(e.gender),
    "company.name": t?.legalName ?? t?.name ?? "",
    "company.address": t?.registeredAddress ?? "",
    "company.state": t?.state ?? "",
    "signatory.name": settings.signatoryName ?? "",
    "signatory.title": settings.signatoryTitle ?? "",
    today: longDate(todayIST()),
  };
  let salary: SalaryRow[] | null = null;
  if (withSalary) {
    const book = await getTemplate(db, tenantId);
    const current = (await structuresAsOf(db, tenantId, [e.id], todayIST())).get(e.id);
    const st = resolveStructure(e, current, book);
    if (st.annualCtc > 0) {
      const c: MonthlyComponents = st.components;
      Object.assign(v, {
        "salary.annual_ctc": rupees(st.annualCtc),
        "salary.annual_ctc_words": rupeesInWords(st.annualCtc).replace(/^./, (x) => x.toUpperCase()),
        "salary.monthly_ctc": rupees(st.monthlyCtc),
        "salary.monthly_gross": rupees(st.gross),
        "salary.monthly_basic": rupees(c.basic),
      } satisfies LetterValues);
      salary = [
        ...(["basic", "hra", "conveyance", "medical"] as const).filter((k) => c[k] > 0).map((k) => ({ label: COMPONENT_LABELS[k], monthly: c[k] })),
        ...(c.extras ?? []).filter((x) => x.amount > 0).map((x) => ({ label: x.label, monthly: x.amount })),
        ...(c.special > 0 ? [{ label: COMPONENT_LABELS.special, monthly: c.special }] : []),
        { label: "Gross salary", monthly: st.gross, strong: true },
        ...(st.employer.pf > 0 ? [{ label: "Provident fund (employer)", monthly: st.employer.pf }] : []),
        ...(st.employer.esi > 0 ? [{ label: "ESI (employer)", monthly: st.employer.esi }] : []),
        { label: "Cost to company", monthly: st.monthlyCtc, strong: true },
      ];
    }
  }
  return { values: v, salary, employee: { id: e.id, name: e.fullName, code: e.employeeCode }, company: { name: t?.legalName ?? t?.name ?? "", address: t?.registeredAddress ?? null, gstin: t?.gstin ?? null, cin: t?.llpinCin ?? null } };
}

const L = MARGIN + 14;
const R = A4.width - MARGIN - 14;
const W = R - L;

/** A letter on the company's letterhead. `text` is already filled in. */
export async function letterPdf(o: { title: string; text: string; reference: string; company: { name: string; address: string | null; gstin: string | null; cin: string | null }; salary: SalaryRow[] | null; signatory: LetterSettings }) {
  const w = await PdfWriter.create({ title: o.title, author: o.company.name });
  const header = () => {
    let y = MARGIN;
    w.text(L, y, o.company.name, { size: 16, bold: true });
    y += 21;
    if (o.company.address) y += w.text(L, y, o.company.address, { size: 8.5, color: colors.muted, width: W * 0.7 });
    const ids = [o.company.cin ? `CIN/LLPIN ${o.company.cin}` : "", o.company.gstin ? `GSTIN ${o.company.gstin}` : ""].filter(Boolean).join(" · ");
    if (ids) y += w.text(L, y, ids, { size: 8, color: colors.muted, width: W });
    y += 6;
    w.line(L, y, R, colors.accent, 1.2);
    return y + 18;
  };
  let y = header();
  const room = (h: number) => {
    if (y + h > A4.height - MARGIN - 30) {
      w.addPage();
      y = header();
    }
  };
  w.text(L, y, `Ref: ${o.reference}`, { size: 9, color: colors.muted });
  w.text(R - 200, y, `Date: ${longDate(todayIST())}`, { size: 9, color: colors.muted, align: "right", width: 200 });
  y += 26;

  for (const b of letterBlocks(o.text)) {
    if (b.kind === "heading") {
      room(30);
      w.text(L, y, b.text.toUpperCase(), { size: 12, bold: true, align: "center", width: W });
      y += 26;
    } else if (b.kind === "paragraph") {
      for (const line of b.text.split("\n")) {
        const lines = w.wrap(line || " ", W, 10.5);
        for (const l of lines) {
          room(15);
          w.text(L, y, l, { size: 10.5 });
          y += 15;
        }
      }
      y += 8;
    } else if (o.salary) {
      room(24 + o.salary.length * 18);
      const c1 = L + W * 0.5;
      const c2 = L + W * 0.75;
      w.rect(L, y, W, 20, colors.tint);
      w.text(L + 8, y + 5, "Component", { size: 9, bold: true });
      w.text(c1, y + 5, "Monthly", { size: 9, bold: true, align: "right", width: W * 0.25 - 8 });
      w.text(c2, y + 5, "Annual", { size: 9, bold: true, align: "right", width: W * 0.25 - 8 });
      y += 22;
      for (const r of o.salary) {
        w.text(L + 8, y + 3, r.label, { size: 9.5, bold: r.strong });
        w.text(c1, y + 3, rupees(r.monthly), { size: 9.5, bold: r.strong, align: "right", width: W * 0.25 - 8 });
        w.text(c2, y + 3, rupees(r.monthly * 12), { size: 9.5, bold: r.strong, align: "right", width: W * 0.25 - 8 });
        y += 18;
        w.line(L, y, R);
      }
      y += 14;
    }
  }

  room(90);
  y += 10;
  w.text(L, y, `For ${o.company.name}`, { size: 10.5, bold: true });
  y += 52;
  if (o.signatory.signatoryName) {
    w.text(L, y, o.signatory.signatoryName, { size: 10.5, bold: true });
    y += 14;
  }
  w.text(L, y, o.signatory.signatoryTitle ?? "Authorised signatory", { size: 10, color: colors.muted });

  const pages = w.doc.getPages();
  pages.forEach((p, i) => {
    w.page = p;
    w.text(L, A4.height - MARGIN + 6, `${o.reference}${pages.length > 1 ? ` · Page ${i + 1} of ${pages.length}` : ""}`, { size: 7.5, color: colors.muted });
  });
  return w.bytes();
}
