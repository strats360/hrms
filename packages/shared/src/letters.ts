/**
 * HR letters from templates. A template is plain text with merge fields in double braces,
 * e.g. {{employee.name}}. A line starting with "# " is the letter's heading, a blank line
 * starts a new paragraph, and {{salary_table}} on its own line becomes the CTC breakdown.
 */
export const LETTER_FIELDS = [
  { key: "employee.name", label: "Full name", group: "Employee" },
  { key: "employee.first_name", label: "First name", group: "Employee" },
  { key: "employee.title", label: "Mr. / Ms. / Mx.", group: "Employee" },
  { key: "employee.code", label: "Employee ID", group: "Employee" },
  { key: "employee.designation", label: "Designation", group: "Employee" },
  { key: "employee.department", label: "Department", group: "Employee" },
  { key: "employee.branch", label: "Branch", group: "Employee" },
  { key: "employee.work_location", label: "Work location", group: "Employee" },
  { key: "employee.manager", label: "Reporting manager", group: "Employee" },
  { key: "employee.employment_type", label: "Employment type", group: "Employee" },
  { key: "employee.joining_date", label: "Date of joining", group: "Employee" },
  { key: "employee.confirmation_date", label: "Confirmation date", group: "Employee" },
  { key: "employee.probation_end_date", label: "End of probation", group: "Employee" },
  { key: "employee.probation_months", label: "Probation (months)", group: "Employee" },
  { key: "employee.last_working_day", label: "Last working day", group: "Employee" },
  { key: "employee.resignation_date", label: "Resignation date", group: "Employee" },
  { key: "employee.address", label: "Current address", group: "Employee" },
  { key: "employee.permanent_address", label: "Permanent address", group: "Employee" },
  { key: "employee.date_of_birth", label: "Date of birth", group: "Employee" },
  { key: "employee.pan", label: "PAN", group: "Employee" },
  { key: "employee.he_she", label: "he / she / they", group: "Pronouns" },
  { key: "employee.He_She", label: "He / She / They", group: "Pronouns" },
  { key: "employee.him_her", label: "him / her / them", group: "Pronouns" },
  { key: "employee.his_her", label: "his / her / their", group: "Pronouns" },
  { key: "employee.His_Her", label: "His / Her / Their", group: "Pronouns" },
  { key: "salary.annual_ctc", label: "Annual CTC", group: "Salary" },
  { key: "salary.annual_ctc_words", label: "Annual CTC in words", group: "Salary" },
  { key: "salary.monthly_ctc", label: "Monthly CTC", group: "Salary" },
  { key: "salary.monthly_gross", label: "Monthly gross", group: "Salary" },
  { key: "salary.monthly_basic", label: "Monthly basic", group: "Salary" },
  { key: "company.name", label: "Company name", group: "Company" },
  { key: "company.address", label: "Registered address", group: "Company" },
  { key: "company.state", label: "State", group: "Company" },
  { key: "signatory.name", label: "Signatory name", group: "Letter" },
  { key: "signatory.title", label: "Signatory title", group: "Letter" },
  { key: "today", label: "Today's date", group: "Letter" },
] as const;
export type LetterFieldKey = (typeof LETTER_FIELDS)[number]["key"];
export type LetterValues = Partial<Record<LetterFieldKey, string>>;
export const SALARY_TABLE = "{{salary_table}}";

export interface LetterTemplate {
  id: string;
  name: string;
  body: string;
  /** Shipped with the app; can be edited or reset, not deleted. */
  builtIn?: boolean;
}

/** Pronoun fields from the gender on record; "they" when it isn't male or female. */
export function pronouns(gender: string | null | undefined): LetterValues {
  const g = (gender ?? "").toLowerCase();
  const [he, him, his, title] = g === "male" ? ["he", "him", "his", "Mr."] : g === "female" ? ["she", "her", "her", "Ms."] : ["they", "them", "their", "Mx."];
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  return { "employee.title": title, "employee.he_she": he, "employee.He_She": cap(he), "employee.him_her": him, "employee.his_her": his, "employee.His_Her": cap(his) };
}

const FIELD = /\{\{\s*([A-Za-z_]+(?:\.[A-Za-z_]+)?)\s*\}\}/g;
const known = new Set<string>([...LETTER_FIELDS.map((f) => f.key), "salary_table"]);

/** Fill in merge fields. Unknown fields stay as typed; fields with no value are listed as missing. */
export function renderLetter(body: string, values: LetterValues) {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = body.replace(FIELD, (all, key: string) => {
    if (key === "salary_table") return all;
    if (!known.has(key)) {
      unknown.add(key);
      return all;
    }
    const v = values[key as LetterFieldKey];
    if (!v) {
      missing.add(key);
      return `[${LETTER_FIELDS.find((f) => f.key === key)!.label}]`;
    }
    return v;
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

export type LetterBlock = { kind: "heading"; text: string } | { kind: "paragraph"; text: string } | { kind: "salary_table" };

/** Split a filled-in letter into blocks for the PDF. Single line breaks stay within a paragraph. */
export function letterBlocks(text: string): LetterBlock[] {
  const out: LetterBlock[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd());
    let para: string[] = [];
    const flush = () => {
      if (para.join("").trim()) out.push({ kind: "paragraph", text: para.join("\n").trim() });
      para = [];
    };
    for (const l of lines) {
      if (l.trim() === SALARY_TABLE) (flush(), out.push({ kind: "salary_table" }));
      else if (/^#\s+/.test(l)) (flush(), out.push({ kind: "heading", text: l.replace(/^#\s+/, "").trim() }));
      else para.push(l);
    }
    flush();
  }
  return out;
}

export const BUILT_IN_LETTERS: LetterTemplate[] = [
  {
    id: "builtin:offer",
    name: "Offer letter",
    builtIn: true,
    body: `# Offer of employment

Dear {{employee.name}},

We are pleased to offer you the position of {{employee.designation}} in the {{employee.department}} team at {{company.name}}. We were impressed with your background and believe you will be a valuable addition to the team.

Your date of joining will be {{employee.joining_date}}, and you will be based at {{employee.branch}}. You will report to {{employee.manager}}.

Your annual cost to company (CTC) will be {{salary.annual_ctc}} ({{salary.annual_ctc_words}}). The breakdown is below.

{{salary_table}}

You will be on probation for {{employee.probation_months}} months from your date of joining. A detailed appointment letter with the terms and conditions of your employment will be issued when you join.

Please bring the originals of your educational certificates, previous employment documents, PAN and Aadhaar on your first day.

Please confirm your acceptance of this offer by signing and returning a copy of this letter. We look forward to welcoming you.`,
  },
  {
    id: "builtin:appointment",
    name: "Appointment letter",
    builtIn: true,
    body: `# Letter of appointment

Dear {{employee.name}},

With reference to your application and the subsequent discussions, we are pleased to appoint you as {{employee.designation}} in the {{employee.department}} department of {{company.name}}, with effect from {{employee.joining_date}}, on the following terms and conditions.

Place of work: Your place of work will be {{employee.branch}}. You may be transferred to any other location, department or group company as the company decides.

Remuneration: Your annual cost to company will be {{salary.annual_ctc}} ({{salary.annual_ctc_words}}), as broken down below. Your salary details are confidential and must not be shared.

{{salary_table}}

Probation: You will be on probation for {{employee.probation_months}} months. On satisfactory completion, your employment will be confirmed in writing. The company may extend the probation period if needed.

Notice period: During probation, either party may end the employment with the notice period set in the company's policy. After confirmation, the notice period in the company's policy applies, or salary in lieu of notice.

Working hours and leave: You will follow the working hours, holidays and leave policy of the company as notified from time to time.

Confidentiality: You will keep all information about the company, its clients and its employees confidential, during and after your employment.

Statutory benefits: You will be covered by Provident Fund, ESI (where applicable), gratuity and other benefits as per applicable law.

Please sign and return a copy of this letter as a token of your acceptance.`,
  },
  {
    id: "builtin:confirmation",
    name: "Confirmation letter",
    builtIn: true,
    body: `# Confirmation of employment

Dear {{employee.name}},

We are pleased to inform you that you have successfully completed your probation. Your employment with {{company.name}} as {{employee.designation}} in the {{employee.department}} department is confirmed with effect from {{employee.confirmation_date}}.

All other terms and conditions of your appointment letter remain unchanged.

We appreciate your contribution so far and look forward to your continued growth with us.`,
  },
  {
    id: "builtin:probation_extension",
    name: "Probation extension letter",
    builtIn: true,
    body: `# Extension of probation

Dear {{employee.name}},

Your probation period as {{employee.designation}}, which began when you joined on {{employee.joining_date}}, has been reviewed. We have decided to extend your probation until {{employee.probation_end_date}}.

During this time, {{employee.manager}} will work with you on the areas discussed and review your progress regularly. Your employment will be reviewed again at the end of the extended period.

All other terms and conditions of your appointment letter remain unchanged.`,
  },
  {
    id: "builtin:experience",
    name: "Experience letter",
    builtIn: true,
    body: `# Experience certificate

To whom it may concern,

This is to certify that {{employee.title}} {{employee.name}} (Employee ID {{employee.code}}) worked with {{company.name}} from {{employee.joining_date}} to {{employee.last_working_day}}. At the time of leaving, {{employee.he_she}} held the position of {{employee.designation}} in the {{employee.department}} department.

During {{employee.his_her}} time with us, we found {{employee.him_her}} sincere, hardworking and dependable. {{employee.His_Her}} conduct was good throughout.

We wish {{employee.him_her}} every success in the future.`,
  },
  {
    id: "builtin:relieving",
    name: "Relieving letter",
    builtIn: true,
    body: `# Relieving letter

Dear {{employee.name}},

This refers to your resignation dated {{employee.resignation_date}}. We confirm that your resignation has been accepted and you are relieved from the services of {{company.name}} with effect from the close of working hours on {{employee.last_working_day}}.

You worked with us as {{employee.designation}} in the {{employee.department}} department from {{employee.joining_date}} to {{employee.last_working_day}}.

Your full and final settlement will be processed as per company policy. Please note that the confidentiality obligations you agreed to continue to apply after you leave.

We thank you for your contribution and wish you the very best.`,
  },
  {
    id: "builtin:salary_certificate",
    name: "Salary certificate",
    builtIn: true,
    body: `# Salary certificate

To whom it may concern,

This is to certify that {{employee.title}} {{employee.name}} (Employee ID {{employee.code}}) has been working with {{company.name}} since {{employee.joining_date}} and currently holds the position of {{employee.designation}}.

{{employee.His_Her}} current annual cost to company is {{salary.annual_ctc}} ({{salary.annual_ctc_words}}), with a monthly gross salary of {{salary.monthly_gross}}. The breakdown is below.

{{salary_table}}

This certificate is issued at the request of the employee for the purpose of their choice, and carries no liability on the part of the company.`,
  },
  {
    id: "builtin:address_proof",
    name: "Employment and address proof",
    builtIn: true,
    body: `# To whom it may concern

This is to certify that {{employee.title}} {{employee.name}} (Employee ID {{employee.code}}) is employed with {{company.name}} as {{employee.designation}} since {{employee.joining_date}}.

As per our records, {{employee.his_her}} current residential address is:
{{employee.address}}

This letter is issued at the request of the employee to serve as proof of employment and address.`,
  },
];
