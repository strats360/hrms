/**
 * UAE Wage Protection System: the salary information file (SIF) that goes to the bank or exchange
 * house, which passes it to the Central Bank and MOHRE.
 *
 * One EDR line per employee, then one SCR control line. File name: the 13 digit MOHRE establishment
 * ID, then YYMMDDHHMMSS, then .SIF. This follows the Central Bank's published layout; agents
 * sometimes ask for small variations, so check with yours before the first live upload.
 */
export interface WpsEmployee {
  name: string;
  /** MOHRE person code: 14 digits, on the work permit. */
  personId: string;
  /** The employee's bank routing code (agent ID): 9 digits. */
  routingCode: string;
  /** UAE IBAN: AE and 21 digits. */
  iban: string;
  payStart: string;
  payEnd: string;
  daysInPeriod: number;
  /** Basic and fixed allowances paid this month. */
  fixed: number;
  /** Overtime, bonuses and other variable pay. */
  variable: number;
  leaveDays: number;
}

export interface WpsFile {
  /** 13 digit MOHRE establishment ID. */
  employerId: string;
  /** The employer's bank routing code: 9 digits. */
  employerRoutingCode: string;
  /** YYYY-MM, the salary month. */
  month: string;
  createdAt: Date;
  employees: WpsEmployee[];
  reference?: string;
}

const digits = (s: string, n: number) => new RegExp(`^\\d{${n}}$`).test(s);
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const two = (n: number) => String(n).padStart(2, "0");

/** Problems that would make the agent reject the file, one sentence each. */
export function checkWps(f: WpsFile): string[] {
  const errors: string[] = [];
  if (!digits(f.employerId, 13)) errors.push("The MOHRE establishment ID must be 13 digits (Legal entities › registrations).");
  if (!digits(f.employerRoutingCode, 9)) errors.push("The company bank's routing code must be 9 digits.");
  if (!f.employees.length) errors.push("There's nobody to pay.");
  for (const e of f.employees) {
    if (!digits(e.personId, 14)) errors.push(`${e.name}: the MOHRE person code must be 14 digits (IDs & visas).`);
    if (!digits(e.routingCode, 9)) errors.push(`${e.name}: the bank routing code must be 9 digits.`);
    if (!/^AE\d{21}$/.test(e.iban.replace(/\s/g, ""))) errors.push(`${e.name}: the IBAN must be AE followed by 21 digits.`);
    if (e.fixed + e.variable <= 0) errors.push(`${e.name}: nothing to pay.`);
  }
  return errors;
}

export function buildWpsSif(f: WpsFile): { fileName: string; content: string } {
  const d = f.createdAt;
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const stamp = `${String(d.getUTCFullYear()).slice(2)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
  const edr = f.employees.map((e) => ["EDR", e.personId, e.routingCode, e.iban.replace(/\s/g, ""), e.payStart, e.payEnd, e.daysInPeriod, amt(e.fixed), amt(e.variable), e.leaveDays].join(","));
  const total = f.employees.reduce((s, e) => s + Math.round((e.fixed + e.variable) * 100), 0) / 100;
  const scr = ["SCR", f.employerId, f.employerRoutingCode, date, `${two(d.getUTCHours())}${two(d.getUTCMinutes())}`, `${f.month.slice(5, 7)}${f.month.slice(0, 4)}`, f.employees.length, amt(total), "AED", (f.reference ?? "").replace(/[,\r\n]/g, " ").slice(0, 35)].join(",");
  return { fileName: `${f.employerId}${stamp}.SIF`, content: [...edr, scr].join("\r\n") + "\r\n" };
}
