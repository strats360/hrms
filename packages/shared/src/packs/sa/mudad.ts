/**
 * Saudi Wage Protection: a salary sheet for Mudad and the bank. Mudad takes each employee's ID
 * (national ID for Saudis, iqama for everyone else), IBAN and the parts of their pay. Mudad's
 * upload template and each bank's salary file differ a little, so check the columns against
 * yours before the first live upload.
 */
export interface MudadEmployee {
  name: string;
  /** National ID or iqama: 10 digits, starting 1 for Saudis and 2 for residents. */
  idNumber: string;
  /** Saudi IBAN: SA and 22 digits. */
  iban: string;
  basic: number;
  housing: number;
  otherEarnings: number;
  deductions: number;
  net: number;
}

export interface MudadSheet {
  /** MHRSD (Qiwa) establishment number, e.g. 1-123456. */
  establishmentId: string;
  month: string;
  employees: MudadEmployee[];
}

/** Problems that would make Mudad or the bank reject the sheet, one sentence each. */
export function checkMudad(s: MudadSheet): string[] {
  const errors: string[] = [];
  if (!/^\d{1,2}-\d{4,10}$/.test(s.establishmentId)) errors.push("The MHRSD establishment number must look like 1-123456 (Legal entities › registrations).");
  if (!s.employees.length) errors.push("There's nobody to pay.");
  for (const e of s.employees) {
    if (!/^[12]\d{9}$/.test(e.idNumber)) errors.push(`${e.name}: add their national ID or iqama (10 digits) under IDs & visas.`);
    if (!/^SA\d{22}$/.test(e.iban.replace(/\s/g, ""))) errors.push(`${e.name}: the IBAN must be SA followed by 22 digits.`);
    if (e.net <= 0) errors.push(`${e.name}: nothing to pay.`);
  }
  return errors;
}

const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function buildMudadSheet(s: MudadSheet): { fileName: string; content: string } {
  const head = ["Employee ID", "Employee name", "IBAN", "Basic salary", "Housing allowance", "Other earnings", "Deductions", "Net salary"];
  const rows = s.employees.map((e) => [e.idNumber, cell(e.name), e.iban.replace(/\s/g, ""), amt(e.basic), amt(e.housing), amt(e.otherEarnings), amt(e.deductions), amt(e.net)].join(","));
  return { fileName: `mudad-${s.establishmentId}-${s.month}.csv`, content: [head.join(","), ...rows].join("\r\n") + "\r\n" };
}
