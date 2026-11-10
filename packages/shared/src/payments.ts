/**
 * Bank bulk-payment files and statutory bonus. Pure functions, shared by the API and tests.
 *
 * The bank layouts follow the common bulk upload templates. Banks vary them per
 * corporate client, so confirm the column order with your relationship manager
 * before the first live upload.
 */
export type BankFileFormat = "hdfc_enet" | "icici_cib" | "generic_csv" | "custom";

export interface BankFileLine {
  reference: string;
  employeeCode: string;
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
  amount: number;
  narration: string;
  email?: string | null;
  bankName?: string | null;
  pan?: string | null;
}
export interface DebitAccount {
  accountNumber: string;
  ifsc: string;
  clientCode?: string | null;
}

export const BANK_FORMAT_LABEL: Record<BankFileFormat, string> = {
  hdfc_enet: "HDFC ENet (CSV)",
  icici_cib: "ICICI CIB bulk (TXT)",
  generic_csv: "Generic CSV",
  custom: "Custom layout",
};

/** Columns a company can pick for its own bank file layout. */
export const EXPORT_COLUMNS = [
  { key: "reference", label: "Payment reference" },
  { key: "employee_code", label: "Employee ID" },
  { key: "beneficiary_name", label: "Beneficiary name" },
  { key: "account_number", label: "Account number" },
  { key: "ifsc", label: "IFSC" },
  { key: "bank_name", label: "Bank" },
  { key: "amount", label: "Amount" },
  { key: "mode", label: "Mode (NEFT, RTGS or internal)" },
  { key: "payment_date", label: "Payment date" },
  { key: "narration", label: "Narration" },
  { key: "email", label: "Email" },
  { key: "pan", label: "PAN" },
  { key: "debit_account", label: "Debit account" },
] as const;
export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];
export const EXPORT_FILE_TYPES = ["csv", "pipe", "tab", "xlsx"] as const;
export const EXPORT_FILE_TYPE_LABEL: Record<(typeof EXPORT_FILE_TYPES)[number], string> = { csv: "CSV, comma separated", pipe: "Text, pipe separated", tab: "Text, tab separated", xlsx: "Excel (.xlsx)" };
export const EXPORT_DATE_FORMATS = ["DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "DDMMYYYY"] as const;

export interface ExportLayout {
  columns: ExportColumnKey[];
  fileType: (typeof EXPORT_FILE_TYPES)[number];
  dateFormat: (typeof EXPORT_DATE_FORMATS)[number];
  /** First row has column names. */
  header: boolean;
  /** Upper case names and narration, without special characters, as most bank portals want. */
  bankSafe: boolean;
}
export const DEFAULT_EXPORT_LAYOUT: ExportLayout = {
  columns: ["employee_code", "beneficiary_name", "bank_name", "account_number", "ifsc", "amount", "reference"],
  fileType: "csv",
  dateFormat: "DD/MM/YYYY",
  header: true,
  bankSafe: true,
};

export function formatExportDate(iso: string, f: ExportLayout["dateFormat"]) {
  const [y, m, d] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
  return f === "YYYY-MM-DD" ? `${y}-${m}-${d}` : f === "DDMMYYYY" ? `${d}${m}${y}` : f === "DD-MM-YYYY" ? `${d}-${m}-${y}` : `${d}/${m}/${y}`;
}

/** Header and rows for a custom layout. Amounts stay numbers (for Excel). */
export function layoutTable(layout: ExportLayout, debit: DebitAccount, paymentDate: string, lines: BankFileLine[]) {
  const label = (k: ExportColumnKey) => EXPORT_COLUMNS.find((c) => c.key === k)!.label.replace(/ \(.*\)$/, "");
  const name = (v: string, max?: number) => (layout.bankSafe ? bankSafe(v, max) : v);
  const value = (k: ExportColumnKey, l: BankFileLine): string | number => {
    switch (k) {
      case "reference": return l.reference;
      case "employee_code": return l.employeeCode;
      case "beneficiary_name": return name(l.beneficiaryName);
      case "account_number": return l.accountNumber;
      case "ifsc": return l.ifsc.toUpperCase();
      case "bank_name": return l.bankName ?? "";
      case "amount": return Number(l.amount.toFixed(2));
      case "mode": return transferMode(debit.ifsc, l.ifsc, l.amount).toUpperCase();
      case "payment_date": return formatExportDate(paymentDate, layout.dateFormat);
      case "narration": return name(l.narration, 30);
      case "email": return l.email ?? "";
      case "pan": return l.pan ?? "";
      case "debit_account": return debit.accountNumber;
    }
  };
  return { header: layout.columns.map(label), rows: lines.map((l) => layout.columns.map((k) => value(k, l))) };
}

const SEP = { csv: ",", pipe: "|", tab: "\t" } as const;
/** Text body for a custom layout (not Excel). */
export function layoutText(layout: ExportLayout, table: { header: string[]; rows: (string | number)[][] }) {
  const sep = SEP[layout.fileType as keyof typeof SEP] ?? ",";
  const cell = (v: unknown) => {
    const s = typeof v === "number" ? v.toFixed(2) : String(v ?? "");
    if (sep === ",") return csvCell(s);
    return s.split(sep).join(" ").replace(/[\r\n]+/g, " ");
  };
  const out = [...(layout.header ? [table.header] : []), ...table.rows].map((r) => r.map(cell).join(sep));
  return (layout.fileType === "csv" && layout.header ? "\uFEFF" : "") + out.join("\r\n") + "\r\n";
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Bank files reject special characters in names and narration. */
export const bankSafe = (s: string, max = 35) => s.replace(/[^A-Za-z0-9 .\-/]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).toUpperCase();
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Same bank (IFSC prefix matches) is an internal transfer; otherwise NEFT, or RTGS at ₹2 lakh and above. */
export function transferMode(debitIfsc: string, beneficiaryIfsc: string, amount: number) {
  if (debitIfsc.slice(0, 4).toUpperCase() === beneficiaryIfsc.slice(0, 4).toUpperCase()) return "internal" as const;
  return amount >= 200000 ? ("rtgs" as const) : ("neft" as const);
}

export function buildBankFile(format: BankFileFormat, debit: DebitAccount, paymentDate: string, lines: BankFileLine[], layout: ExportLayout = DEFAULT_EXPORT_LAYOUT) {
  const date = ddmmyyyy(paymentDate);
  if (format === "custom") {
    const table = layoutTable(layout, debit, paymentDate, lines);
    // Excel files are written by the API (it has the zip library); hand back the table
    if (layout.fileType === "xlsx") return { body: "", table, ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    return { body: layoutText(layout, table), table, ext: layout.fileType === "csv" ? "csv" : "txt", mime: layout.fileType === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8" };
  }
  if (format === "hdfc_enet") {
    // Transaction type (I = within HDFC, N = NEFT, R = RTGS), beneficiary code, account, amount, name, ... , reference, ..., date, IFSC, ..., email
    const rows = lines.map((l) => {
      const mode = transferMode(debit.ifsc, l.ifsc, l.amount);
      return [mode === "internal" ? "I" : mode === "rtgs" ? "R" : "N", l.employeeCode, l.accountNumber, l.amount.toFixed(2), bankSafe(l.beneficiaryName), "", "", "", "", "", "", "", "", l.reference, bankSafe(l.narration, 30), "", "", "", "", "", "", "", date, "", l.ifsc.toUpperCase(), "", "", l.email ?? ""]
        .map(csvCell)
        .join(",");
    });
    return { body: rows.join("\r\n") + "\r\n", ext: "csv", mime: "text/csv; charset=utf-8" };
  }
  if (format === "icici_cib") {
    // Pipe separated: pay mode | debit account | beneficiary account | name | amount | date | IFSC | reference | narration
    const rows = lines.map((l) => {
      const mode = transferMode(debit.ifsc, l.ifsc, l.amount);
      return [mode === "internal" ? "FT" : mode === "rtgs" ? "RTG" : "NEFT", debit.accountNumber, l.accountNumber, bankSafe(l.beneficiaryName), l.amount.toFixed(2), date, l.ifsc.toUpperCase(), l.reference, bankSafe(l.narration, 30)].join("|");
    });
    return { body: rows.join("\r\n") + "\r\n", ext: "txt", mime: "text/plain; charset=utf-8" };
  }
  const header = ["Reference", "Employee ID", "Beneficiary name", "Account number", "IFSC", "Amount", "Mode", "Payment date", "Narration", "Email"];
  const rows = lines.map((l) => [l.reference, l.employeeCode, l.beneficiaryName, l.accountNumber, l.ifsc.toUpperCase(), l.amount.toFixed(2), transferMode(debit.ifsc, l.ifsc, l.amount).toUpperCase(), date, l.narration, l.email ?? ""].map(csvCell).join(","));
  return { body: "﻿" + [header.join(","), ...rows].join("\r\n") + "\r\n", ext: "csv", mime: "text/csv; charset=utf-8" };
}

export interface BankResponseRow {
  reference: string;
  status: "paid" | "failed";
  utr: string | null;
  reason: string | null;
}

function splitLine(line: string, sep: string) {
  if (sep !== ",") return line.split(sep).map((x) => x.trim());
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Read a bank status / MIS file. Needs a header row with a reference column and a
 * status column; UTR and reason columns are optional. Works with CSV, pipe or tab files.
 */
export function parseBankResponse(text: string): { rows: BankResponseRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ["The file has no data rows"] };
  const sep = lines[0]!.includes("|") ? "|" : lines[0]!.includes("\t") ? "\t" : ",";
  const head = splitLine(lines[0]!, sep).map((h) => h.toLowerCase());
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const refI = find("customer ref", "reference", "ref no", "ref");
  const stI = find("status");
  const utrI = find("utr", "bank ref", "transaction id");
  const reasonI = find("reason", "remark", "description", "message");
  if (refI < 0 || stI < 0) return { rows: [], errors: ["Couldn't find the reference and status columns in the header row"] };
  const rows: BankResponseRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((l, i) => {
    const cells = splitLine(l, sep);
    const reference = cells[refI]?.trim();
    const raw = (cells[stI] ?? "").toLowerCase();
    if (!reference) return;
    const status = /success|paid|processed|credited|complete|executed|^s$/.test(raw) ? "paid" : /fail|reject|return|error|^f$|^r$/.test(raw) ? "failed" : null;
    if (!status) {
      errors.push(`Row ${i + 2}: unknown status "${cells[stI] ?? ""}"`);
      return;
    }
    rows.push({ reference, status, utr: utrI >= 0 ? cells[utrI] || null : null, reason: reasonI >= 0 ? cells[reasonI] || null : null });
  });
  return { rows, errors };
}

/** Payment of Bonus Act, 1965: wage limit for eligibility and calculation ceiling (per month). */
export const BONUS = { eligibilityWage: 21000, calculationCeiling: 7000, minPercent: 8.33, maxPercent: 20, minDays: 30 };

/**
 * Statutory bonus for one employee for a financial year.
 * months: wages (basic + DA) actually earned in each month worked.
 * Eligible if they worked at least 30 days and their wages never went above ₹21,000.
 * Bonus = percent x min(wage, ceiling) summed over the months, with the minimum of ₹100.
 */
export function statutoryBonus(months: { wage: number; paidDays: number }[], percent = BONUS.minPercent, ceiling = BONUS.calculationCeiling) {
  const days = months.reduce((s, m) => s + m.paidDays, 0);
  const maxWage = Math.max(0, ...months.map((m) => m.wage));
  if (days < BONUS.minDays) return { eligible: false as const, reason: "Worked less than 30 days in the year", amount: 0, wageBase: 0 };
  if (maxWage > BONUS.eligibilityWage) return { eligible: false as const, reason: "Wages above ₹21,000 a month", amount: 0, wageBase: 0 };
  const wageBase = months.reduce((s, m) => s + Math.min(m.wage, ceiling), 0);
  const amount = Math.max(100, Math.round((wageBase * percent) / 100));
  return { eligible: true as const, reason: null, amount, wageBase };
}
