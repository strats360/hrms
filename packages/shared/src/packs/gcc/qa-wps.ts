/**
 * Qatar Wage Protection System: the salary information file (SIF) the employer's bank sends to
 * the Ministry of Labour. A header row with the employer and totals, then one row per employee.
 * This follows Qatar Central Bank's published layout; banks sometimes ask for small variations,
 * so check with yours before the first live upload.
 */
export interface QatarWpsEmployee {
  name: string;
  /** Qatar ID: 11 digits. */
  qid: string;
  /** The employee's bank short name, e.g. QNB, CBQ, DOHB. */
  bank: string;
  /** Qatar IBAN: QA, 2 digits, a 4 letter bank code and 21 characters. */
  iban: string;
  workingDays: number;
  net: number;
  basic: number;
  extraHours: number;
  extraIncome: number;
  deductions: number;
}

export interface QatarWpsFile {
  /** MoL establishment ID. */
  employerId: string;
  /** Salary bank short name and IBAN. */
  payerBank: string;
  payerIban: string;
  /** YYYY-MM. */
  month: string;
  createdAt: Date;
  employees: QatarWpsEmployee[];
}

const QA_IBAN = /^QA\d{2}[A-Z]{4}[A-Z0-9]{21}$/;
const clean = (s: string) => s.replace(/\s/g, "").toUpperCase();
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const two = (n: number) => String(n).padStart(2, "0");
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function checkQatarWps(f: QatarWpsFile): string[] {
  const errors: string[] = [];
  if (!/^\d{1,12}$/.test(f.employerId)) errors.push("Add the MoL establishment ID (Legal entities › registrations).");
  if (!f.payerBank.trim()) errors.push("Add the salary bank's short name (Legal entities › registrations).");
  if (!QA_IBAN.test(clean(f.payerIban))) errors.push("The salary account IBAN must be a Qatar IBAN (QA and 27 characters).");
  if (!f.employees.length) errors.push("There's nobody to pay.");
  for (const e of f.employees) {
    if (!/^\d{11}$/.test(e.qid)) errors.push(`${e.name}: add their Qatar ID (11 digits) under IDs & visas.`);
    if (!e.bank.trim()) errors.push(`${e.name}: add their bank name.`);
    if (!QA_IBAN.test(clean(e.iban))) errors.push(`${e.name}: the IBAN must be a Qatar IBAN (QA and 27 characters).`);
    if (e.net <= 0) errors.push(`${e.name}: nothing to pay.`);
  }
  return errors;
}

export function buildQatarWps(f: QatarWpsFile): { fileName: string; content: string } {
  const d = f.createdAt;
  const date = `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}${two(d.getUTCMinutes())}`;
  const total = f.employees.reduce((s, e) => s + Math.round(e.net * 100), 0) / 100;
  const bank = f.payerBank.trim().toUpperCase();
  const rows = [
    ["Employer EID", "File Creation Date", "File Creation Time", "Payer EID", "Payer QID", "Payer Bank Short Name", "Payer IBAN", "Salary Year and Month", "Total Salaries", "Total records", "SIF Version"].join(","),
    [f.employerId, date, time, f.employerId, "", bank, clean(f.payerIban), f.month.replace("-", ""), amt(total), f.employees.length, "1"].join(","),
    ["Record Sequence", "Employee QID", "Employee Visa ID", "Employee Name", "Employee Bank Short Name", "Employee Account", "Salary Frequency", "Number of Working days", "Net Salary", "Basic Salary", "Extra hours", "Extra Income", "Deductions", "Payment Type", "Notes / Comments"].join(","),
    ...f.employees.map((e, i) =>
      [String(i + 1).padStart(6, "0"), e.qid, "", cell(e.name), e.bank.trim().toUpperCase(), clean(e.iban), "M", e.workingDays, amt(e.net), amt(e.basic), e.extraHours, amt(e.extraIncome), amt(e.deductions), "Normal Payment", ""].join(","),
    ),
  ];
  return { fileName: `SIF_${f.employerId}_${bank}_${date}_${time}.csv`, content: rows.join("\r\n") + "\r\n" };
}
