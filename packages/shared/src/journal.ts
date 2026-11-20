import { z } from "zod";

/**
 * The accounting journal for a payroll run: salary and employer costs as expenses, and what's owed
 * to employees and to the government as liabilities. Debits always equal credits, because
 * gross + employer cost + reimbursements = deductions + employer cost + net pay.
 */
export interface JournalItem {
  department?: string | null;
  earnings: { code: string; label: string; amount: number }[];
  deductions: { code: string; label: string; amount: number }[];
  employer: { code: string; label: string; amount: number }[];
  reimbursement: number;
  net: number;
}

export interface JournalLine {
  account: string;
  description: string;
  debit: number;
  credit: number;
}

/** Account keys a company can rename to match its chart of accounts. */
export const JOURNAL_ACCOUNT_DEFAULTS: Record<string, string> = {
  salary_expense: "Salaries and wages",
  employer_expense: "Employer contributions",
  reimbursement_expense: "Staff reimbursements",
  salary_payable: "Salaries payable",
  pf: "Provident fund payable",
  esi: "ESI payable",
  pt: "Professional tax payable",
  lwf: "Labour welfare fund payable",
  tds: "TDS on salary payable",
  nps: "NPS payable",
  loans: "Staff loans and advances",
  other_deductions: "Other salary deductions",
};

export const journalSettingsSchema = z.object({
  /** Account key → the account name in your books. */
  accounts: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
  /** Split salary and employer cost by department, for cost centres. */
  byDepartment: z.boolean().default(false),
});
export type JournalSettings = z.infer<typeof journalSettingsSchema>;

/** Which liability a payslip line goes to: employer and employee shares of a scheme share one account. */
export function accountKeyFor(code: string): string {
  if (["pf", "vpf", "epf_er", "eps", "edli", "pf_admin"].includes(code)) return "pf";
  if (code === "nps_er") return "nps";
  if (code.startsWith("adj_d")) return "other_deductions";
  return code.replace(/_er$/, "");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildPayrollJournal(items: JournalItem[], opts: { settings?: Partial<JournalSettings>; loanLabels?: Set<string> } = {}): JournalLine[] {
  const names = { ...JOURNAL_ACCOUNT_DEFAULTS, ...(opts.settings?.accounts ?? {}) };
  const byDept = !!opts.settings?.byDepartment;
  const debit = new Map<string, { account: string; description: string; amount: number }>();
  const credit = new Map<string, { account: string; description: string; amount: number }>();
  const put = (m: typeof debit, key: string, account: string, description: string, amount: number) => {
    if (!amount) return;
    const cur = m.get(key) ?? { account, description, amount: 0 };
    cur.amount += amount;
    m.set(key, cur);
  };
  const liability = (code: string, label: string) => {
    const key = opts.loanLabels?.has(label) ? "loans" : accountKeyFor(code);
    // unknown schemes (another country's tax or insurance) get an account named after the line
    const account = names[key] ?? `${label.replace(/\s*\((employee|employer)\)\s*/i, "").trim()} payable`;
    return { key, account };
  };
  for (const it of items) {
    const dept = byDept && it.department ? it.department : null;
    const suffix = dept ? ` · ${dept}` : "";
    put(debit, `salary|${dept}`, names.salary_expense!, `Gross pay${suffix}`, it.earnings.reduce((s, e) => s + e.amount, 0));
    put(debit, `employer|${dept}`, names.employer_expense!, `Employer contributions${suffix}`, it.employer.reduce((s, e) => s + e.amount, 0));
    put(debit, "reimb", names.reimbursement_expense!, "Expense claims paid with salary", it.reimbursement);
    for (const d of it.deductions) {
      const a = liability(d.code, d.label);
      put(credit, a.key === "other_deductions" || a.key === "loans" ? a.key : a.account, a.account, a.key === "loans" ? "Loan and advance recoveries" : a.key === "other_deductions" ? "Other deductions" : `Deducted from employees`, d.amount);
    }
    for (const e of it.employer) {
      const a = liability(e.code, e.label);
      put(credit, a.account, a.account, "Deducted from employees", e.amount);
    }
    put(credit, "net", names.salary_payable!, "Net pay due to employees", it.net);
  }
  const lines: JournalLine[] = [];
  for (const v of debit.values()) lines.push({ account: v.account, description: v.description, debit: r2(v.amount), credit: 0 });
  for (const v of credit.values()) lines.push({ account: v.account, description: v.description, debit: 0, credit: r2(v.amount) });
  // the same liability gets one line for both shares; describe it honestly
  for (const l of lines) if (l.credit && l.description === "Deducted from employees" && items.some((it) => it.employer.some((e) => liability(e.code, e.label).account === l.account))) l.description = "Employee and employer shares";
  // rounding: keep the journal balanced to the paisa
  const diff = r2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
  if (diff) {
    const net = lines.find((l) => l.account === names.salary_payable && l.credit);
    if (net) net.credit = r2(net.credit + diff);
  }
  return lines;
}

export const journalTotals = (lines: JournalLine[]) => ({ debit: r2(lines.reduce((s, l) => s + l.debit, 0)), credit: r2(lines.reduce((s, l) => s + l.credit, 0)) });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A Tally Prime journal voucher to import (Gateway of Tally, Import, Transactions). */
export function tallyJournalXml(lines: JournalLine[], opts: { date: string; narration: string; company?: string }) {
  const entries = lines
    .map((l) => {
      const isDebit = l.debit > 0;
      const amount = isDebit ? -l.debit : l.credit;
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(l.account)}</LEDGERNAME><ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${opts.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(opts.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ""}</REQUESTDESC><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>${opts.date.replace(/-/g, "")}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>${esc(opts.narration)}</NARRATION>
${entries}
</VOUCHER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
`;
}
