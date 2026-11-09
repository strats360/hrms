import { fmtDate, rupeesInWords } from "@hrms/shared";
import { A4, colors, MARGIN, PdfWriter, rs } from "../lib/pdf";

interface Line {
  code: string;
  label: string;
  amount: number;
}
export interface PayslipData {
  company: { name?: string | null; legalName?: string | null; address?: string | null; pan?: string | null; tan?: string | null };
  run: { month: string; payDate: string | null };
  employee: { name: string; code: string; designation: string | null; department: string | null; branch: string | null; dateOfJoining: string; pan: string | null; uan: string | null; esicIpNumber?: string | null; bankName: string | null; accountLast4: string | null; regime: string };
  daysInMonth: number;
  paidDays: number;
  lopDays: number;
  earnings: Line[];
  deductions: Line[];
  employer: Line[];
  gross: number;
  totalDeductions: number;
  reimbursement: number;
  net: number;
  employerCost: number;
  tax: { taxableIncome: number } | null;
  onHold: boolean;
}

export const monthName = (month: string) => new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** One payslip on an A4 page, laid out like the on-screen payslip. */
export async function renderPayslip(w: PdfWriter, s: PayslipData) {
  const L = MARGIN;
  const R = A4.width - MARGIN;
  const W = R - L;
  const e = s.employee;
  let y = w.y;

  // header
  w.text(L, y, s.company.legalName ?? s.company.name ?? "", { size: 16, bold: true, width: W - 150 });
  w.text(R - 150, y + 1, "PAYSLIP", { size: 8, bold: true, color: colors.accent, align: "right", width: 150 });
  w.text(R - 150, y + 13, monthName(s.run.month), { size: 11, bold: true, align: "right", width: 150 });
  y += 22;
  const sub = [s.company.address, s.company.pan && `PAN ${s.company.pan}`, s.company.tan && `TAN ${s.company.tan}`].filter(Boolean).join(" · ");
  if (sub) y += w.text(L, y, sub, { size: 8.5, color: colors.muted, width: W - 160, maxLines: 3 });
  if (s.onHold) w.text(R - 150, y - 4, "SALARY ON HOLD", { size: 9, bold: true, color: colors.bad, align: "right", width: 150 });
  y += 10;

  // employee details
  const cells: [string, string, boolean?][] = [
    ["Employee", e.name, true],
    ["ID · Designation", [e.code, e.designation].filter(Boolean).join(" · ")],
    ["PAN · UAN", `${e.pan ?? "-"} · ${e.uan ?? "-"}`],
    ["Bank", e.bankName ? `${e.bankName} ····${e.accountLast4 ?? ""}` : "-"],
    ["Date of joining", fmtDate(e.dateOfJoining)],
    ["Paid days", `${s.paidDays} / ${s.daysInMonth}`],
    ["LOP days", String(s.lopDays)],
    ["Department · Location", [e.department, e.branch].filter(Boolean).join(" · ") || "-"],
  ];
  const colW = (W - 24) / 4;
  // rows grow when a value wraps onto a second line
  const rowH = (row: typeof cells) => Math.max(...row.map(([, v]) => 8 * 1.3 + 1 + Math.min(2, w.wrap(v || "-", colW - 8, 9.5).length) * 9.5 * 1.3)) + 6;
  const rows = [cells.slice(0, 4), cells.slice(4, 8)];
  const heights = rows.map(rowH);
  const boxH = heights.reduce((a, b) => a + b, 0) + 14;
  w.rect(L, y, W, boxH, colors.tint, 6);
  let ry = y + 10;
  rows.forEach((row, r) => {
    row.forEach(([label, value, bold], i) => w.kv(L + 12 + i * colW, ry, colW - 8, label, value, bold));
    ry += heights[r]!;
  });
  y += boxH + 16;

  // earnings and deductions side by side
  const half = (W - 24) / 2;
  const table = (x: number, top: number, title: string, lines: Line[], total: number, totalLabel: string) => {
    let t = top;
    w.text(x, t, title.toUpperCase(), { size: 8, bold: true, color: colors.accent });
    t += 14;
    for (const l of lines.length ? lines : [{ code: "none", label: "None", amount: 0 }]) {
      w.text(x, t, l.label, { size: 9.5, width: half - 90, maxLines: 2, color: l.code === "none" ? colors.muted : colors.text });
      if (l.code !== "none") w.text(x + half - 90, t, rs(l.amount), { size: 9.5, align: "right", width: 90 });
      t += 15;
    }
    w.line(x, t + 1, x + half);
    t += 6;
    w.text(x, t, totalLabel, { size: 10, bold: true });
    w.text(x + half - 100, t, rs(total), { size: 10, bold: true, align: "right", width: 100 });
    return t + 16;
  };
  const yl = table(L, y, "Earnings", s.earnings, s.gross, "Gross earnings");
  const yr = table(L + half + 24, y, "Deductions", s.deductions, s.totalDeductions, "Total deductions");
  y = Math.max(yl, yr) + 10;

  // net pay
  const netH = s.reimbursement ? 70 : 58;
  w.rect(L, y, W, netH, colors.okBg, 6);
  w.text(L + 14, y + 10, "Net pay", { size: 9, color: colors.okFg });
  w.text(L + 14, y + 22, rs(s.net), { size: 18, bold: true, color: colors.okFg });
  w.text(L + 14, y + 43, rupeesInWords(s.net), { size: 8.5, color: colors.okFg, width: W / 2 });
  if (s.reimbursement) w.text(L + 14, y + 55, `Includes reimbursements of ${rs(s.reimbursement)} (not taxable)`, { size: 8.5, color: colors.okFg });
  const erPf = s.employer.filter((l) => l.code === "epf_er" || l.code === "eps").reduce((a, l) => a + l.amount, 0);
  const erEsi = s.employer.find((l) => l.code === "esi_er")?.amount ?? 0;
  const right = [`Employer PF ${rs(erPf)}${erEsi ? ` · Employer ESI ${rs(erEsi)}` : ""}`, `Monthly cost to company ${rs(s.gross + s.employerCost)}`, ...(s.tax ? [`Projected annual taxable income ${rs(s.tax.taxableIncome)} · ${e.regime === "old" ? "Old" : "New"} regime`] : [])];
  right.forEach((t, i) => w.text(L + W / 2, y + 12 + i * 13, t, { size: 8.5, color: colors.okFg, align: "right", width: W / 2 - 14 }));
  y += netH + 14;

  w.text(L, y, `This is a computer-generated payslip and does not need a signature. Pay date ${s.run.payDate ? fmtDate(s.run.payDate) : "-"}.`, { size: 8, color: colors.muted, width: W });
  w.y = y + 20;
}

export async function payslipPdf(s: PayslipData) {
  const w = await PdfWriter.create({ title: `Payslip ${monthName(s.run.month)} · ${s.employee.name}`, author: s.company.legalName ?? s.company.name ?? undefined });
  await renderPayslip(w, s);
  return w.bytes();
}

export const payslipFileName = (s: { run: { month: string }; employee: { code: string } }) => `payslip-${s.run.month}-${s.employee.code}.pdf`;
