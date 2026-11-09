import { fmtDate, type TaxStatement } from "@hrms/shared";
import { A4, colors, MARGIN, PdfWriter, rs } from "../lib/pdf";
import { monthName } from "./payslip-pdf";

export interface Form16Data {
  fy: string;
  assessmentYear: string;
  provisional: boolean;
  employer: { name?: string | null; address?: string | null; pan?: string | null; tan?: string | null };
  employee: { name: string; code: string; pan: string | null; regime: string };
  period: { from: string | null; to: string | null };
  projectedMonths: number;
  quarters: { quarter: string; amountPaid: number; tdsDeducted: number; tdsDeposited: number; receipt: string | null }[];
  statement: TaxStatement;
  tdsDeducted: number;
  challans: { period: string; reference: string | null; paidOn: string; amount: number }[];
}

const L = MARGIN;
const R = A4.width - MARGIN;
const W = R - L;

/** Form No. 16: Part A from our records, and Part B, the salary and tax computation. */
export async function form16Pdf(f: Form16Data) {
  const w = await PdfWriter.create({ title: `Form 16 FY ${f.fy} · ${f.employee.name}`, author: f.employer.name ?? undefined });
  let y = w.y;

  w.text(L, y, "FORM NO. 16 · CERTIFICATE UNDER SECTION 203 OF THE INCOME-TAX ACT, 1961", { size: 8, bold: true, color: colors.accent });
  w.text(R - 160, y, f.provisional ? "PROVISIONAL" : "FINAL", { size: 8, bold: true, color: f.provisional ? colors.bad : colors.okFg, align: "right", width: 160 });
  y += 14;
  w.text(L, y, "Tax deducted at source on salary", { size: 16, bold: true });
  y += 22;
  y += w.text(L, y, `Financial year ${f.fy} · Assessment year ${f.assessmentYear}${f.period.from && f.period.to ? ` · ${monthName(f.period.from)} to ${monthName(f.period.to)}` : ""}`, { size: 9, color: colors.muted, width: W });
  y += 8;

  // parties
  const half = (W - 24) / 2;
  const left = [f.employer.name ?? "", f.employer.address ?? "", `PAN ${f.employer.pan ?? "-"} · TAN ${f.employer.tan ?? "-"}`];
  const right = [f.employee.name, `${f.employee.code} · PAN ${f.employee.pan ?? "Not available"}`, `Opted for new regime u/s 115BAC: ${f.employee.regime === "new" ? "Yes" : "No"}`];
  const linesH = (arr: string[]) => arr.reduce((h, s) => h + w.wrap(s || "-", half, 9).length * 11.7, 0);
  const boxH = Math.max(linesH(left), linesH(right)) + 34;
  w.rect(L, y, W, boxH, colors.tint, 6);
  const party = (x: number, label: string, arr: string[]) => {
    let t = y + 10;
    w.text(x, t, label, { size: 8, color: colors.muted });
    t += 12;
    arr.forEach((s, i) => (t += w.text(x, t, s, { size: 9, bold: i === 0, width: half - 12 })));
  };
  party(L + 12, "Employer (deductor)", left);
  party(L + 12 + half + 12, "Employee (deductee)", right);
  y += boxH + 18;

  // Part A
  w.text(L, y, "Part A · Summary of tax deducted and deposited", { size: 11, bold: true });
  y += 18;
  const cols = [
    { label: "Quarter", x: L, w: 60, align: "left" as const },
    { label: "Return receipt no.", x: L + 60, w: 150, align: "left" as const },
    { label: "Amount paid / credited", x: L + 210, w: 110, align: "right" as const },
    { label: "Tax deducted", x: L + 320, w: 95, align: "right" as const },
    { label: "Tax deposited", x: L + 415, w: W - 415, align: "right" as const },
  ];
  cols.forEach((c) => w.text(c.x, y, c.label, { size: 8, color: colors.muted, align: c.align, width: c.w }));
  y += 12;
  w.line(L, y, R);
  y += 5;
  for (const q of f.quarters) {
    const vals = [q.quarter, q.receipt ?? "-", rs(q.amountPaid), rs(q.tdsDeducted), rs(q.tdsDeposited)];
    cols.forEach((c, i) => w.text(c.x, y, vals[i]!, { size: 9, align: c.align, width: c.w }));
    y += 15;
  }
  w.line(L, y, R);
  y += 5;
  w.text(L, y, "Total", { size: 9.5, bold: true });
  w.text(cols[3]!.x, y, rs(f.quarters.reduce((s, q) => s + q.tdsDeducted, 0)), { size: 9.5, bold: true, align: "right", width: cols[3]!.w });
  w.text(cols[4]!.x, y, rs(f.quarters.reduce((s, q) => s + q.tdsDeposited, 0)), { size: 9.5, bold: true, align: "right", width: cols[4]!.w });
  y += 18;
  if (f.challans.length) y += w.text(L, y, `Challans: ${f.challans.map((c) => `${monthName(c.period)} ${c.reference ?? ""} (${fmtDate(c.paidOn)})`).join(" · ")}`, { size: 8, color: colors.muted, width: W, maxLines: 4 }) + 4;
  y += w.text(L, y, "The official Part A with the TRACES certificate number is downloaded from TRACES after the Q4 return is processed.", { size: 8, color: colors.muted, width: W }) + 14;

  // Part B
  w.y = y;
  w.ensure(320);
  y = w.y;
  w.text(L, y, "Part B · Details of salary paid and tax deducted", { size: 11, bold: true });
  y += 16;
  if (f.provisional && f.projectedMonths) y += w.text(L, y, `Provisional: salary includes ${f.projectedMonths} projected month${f.projectedMonths === 1 ? "" : "s"} to the end of the financial year, because deductions and tax slabs apply to the whole year.`, { size: 8, color: colors.muted, width: W }) + 6;

  const s = f.statement;
  const row = (label: string, value: number, o: { minus?: boolean; bold?: boolean; indent?: boolean } = {}) => {
    if (w.y !== y) w.y = y;
    w.ensure(18);
    y = w.y;
    if (o.bold) {
      w.line(L, y, R);
      y += 4;
    }
    w.text(L + (o.indent ? 12 : 0), y, label, { size: 9.5, bold: o.bold, width: W - 130 });
    w.text(R - 120, y, `${o.minus && value ? "- " : ""}${rs(Math.abs(value))}`, { size: 9.5, bold: o.bold, align: "right", width: 120 });
    y += 15;
    w.y = y;
  };
  const kicker = (t: string) => {
    w.ensure(24);
    y = Math.max(y, w.y) + 4;
    w.text(L, y, t.toUpperCase(), { size: 8, bold: true, color: colors.accent });
    y += 13;
    w.y = y;
  };
  kicker("Income");
  row("Gross salary (incl. previous employer)", s.grossSalary);
  for (const e of s.exemptions) row(e.label, e.amount, { minus: true, indent: true });
  row("Standard deduction u/s 16(ia)", s.standardDeduction, { minus: true, indent: true });
  if (s.regime === "old") row("Professional tax u/s 16(iii)", s.professionalTax, { minus: true, indent: true });
  row("Income from salary", s.incomeFromSalary, { bold: true });
  if (s.houseProperty) row("Loss from house property (home loan interest 24(b))", s.houseProperty, { minus: true, indent: true });
  if (s.otherIncome) row("Income from other sources", s.otherIncome, { indent: true });
  row("Gross total income", s.grossTotalIncome, { bold: true });
  if (s.deductions.length) {
    kicker("Deductions under Chapter VI-A");
    for (const d of s.deductions) row(d.label, d.amount, { minus: true, indent: true });
    row("Total deductions", s.totalDeductions, { minus: true, bold: true });
  } else if (s.regime === "new") {
    y += w.text(L, y, "New regime (s.115BAC): Chapter VI-A deductions, HRA exemption and professional tax aren't allowed.", { size: 8.5, color: colors.muted, width: W }) + 4;
    w.y = y;
  }
  w.ensure(30);
  y = w.y + 4;
  w.rect(L, y, W, 22, colors.tint, 4);
  w.text(L + 10, y + 6, "Taxable income (rounded to Rs. 10)", { size: 9.5, bold: true });
  w.text(R - 130, y + 6, rs(s.taxableIncome), { size: 9.5, bold: true, align: "right", width: 120 });
  y += 32;
  w.y = y;
  kicker("Tax");
  row("Tax on total income", s.tax.baseTax);
  if (s.tax.rebate) row("Rebate u/s 87A", s.tax.rebate, { minus: true, indent: true });
  if (s.tax.surcharge) row("Surcharge", s.tax.surcharge, { indent: true });
  row("Health & education cess 4%", s.tax.cess, { indent: true });
  row("Tax payable for the year", s.tax.total, { bold: true });
  if (s.previousEmployerTds) row("TDS by previous employer", s.previousEmployerTds, { minus: true, indent: true });
  row("Tax deducted at source by this employer", f.tdsDeducted, { bold: true });

  w.ensure(70);
  y = w.y + 14;
  y += w.text(L, y, "Verification: certified that the information above is true and correct based on the books of account and documents available with the employer.", { size: 8.5, color: colors.muted, width: W }) + 30;
  w.line(L, y, L + 200);
  w.text(L, y + 4, "Signature of the person responsible for deduction of tax", { size: 8, color: colors.muted });
  w.text(R - 200, y + 4, "Place · Date", { size: 8, color: colors.muted, align: "right", width: 200 });
  return w.bytes();
}

export const form16FileName = (f: { fy: string; employee: { code: string } }) => `form16-${f.fy}-${f.employee.code}.pdf`;
