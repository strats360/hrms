import { NI_CATEGORIES, STUDENT_LOAN_OPTIONS, UK_TAX_YEAR } from "@hrms/shared";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";

export interface UkForm {
  taxCode: string;
  niCategory: string;
  studentLoans: string[];
  postgraduateLoan: boolean;
  pensionOptOut: boolean;
  p45Pay: string;
  p45Tax: string;
}

export const EMPTY_UK: UkForm = { taxCode: "1257L", niCategory: "A", studentLoans: [], postgraduateLoan: false, pensionOptOut: false, p45Pay: "", p45Tax: "" };

export function ukFromProfile(p: Record<string, unknown> | null | undefined): UkForm {
  if (!p) return EMPTY_UK;
  const p45 = p.p45 as { taxYear: string; pay: number; tax: number } | null | undefined;
  return {
    taxCode: String(p.taxCode ?? "1257L"),
    niCategory: String(p.niCategory ?? "A"),
    studentLoans: (p.studentLoans as string[] | undefined) ?? [],
    postgraduateLoan: !!p.postgraduateLoan,
    pensionOptOut: !!p.pensionOptOut,
    p45Pay: p45 && p45.taxYear === UK_TAX_YEAR ? String(p45.pay) : "",
    p45Tax: p45 && p45.taxYear === UK_TAX_YEAR ? String(p45.tax) : "",
  };
}

export function ukToProfile(f: UkForm) {
  const pay = f.p45Pay.trim();
  return {
    taxCode: f.taxCode.trim().toUpperCase() || "1257L",
    niCategory: f.niCategory,
    studentLoans: f.studentLoans,
    postgraduateLoan: f.postgraduateLoan,
    pensionOptOut: f.pensionOptOut,
    p45: pay ? { taxYear: UK_TAX_YEAR, pay: Number(pay), tax: Number(f.p45Tax || 0) } : null,
  };
}

/** UK payroll details: from the starter checklist or P45, and HMRC's notices. */
export function UkPayrollFields({ value, onChange }: { value: UkForm; onChange: (v: UkForm) => void }) {
  const set = <K extends keyof UkForm>(k: K, v: UkForm[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <Field label="Tax code" htmlFor="f-taxCode" hint="From their P45 or HMRC. Use 1257L M1 if they have neither">
        <Input id="f-taxCode" value={value.taxCode} onChange={(e) => set("taxCode", e.target.value)} className="uppercase" placeholder="1257L" />
      </Field>
      <Field label="NI category" htmlFor="f-niCategory">
        <Select id="f-niCategory" value={value.niCategory} onChange={(e) => set("niCategory", e.target.value)}>
          {Object.entries(NI_CATEGORIES).map(([k, label]) => (
            <option key={k} value={k}>{k}: {label}</option>
          ))}
        </Select>
      </Field>
      <Field label={`Pay from earlier jobs this tax year (P45)`} htmlFor="f-p45Pay">
        <Input id="f-p45Pay" inputMode="decimal" value={value.p45Pay} onChange={(e) => set("p45Pay", e.target.value)} placeholder="0.00" />
      </Field>
      <Field label="Tax paid on it" htmlFor="f-p45Tax">
        <Input id="f-p45Tax" inputMode="decimal" value={value.p45Tax} onChange={(e) => set("p45Tax", e.target.value)} placeholder="0.00" />
      </Field>
      <Field label="Student loans" span>
        <div className="flex flex-wrap gap-5 pt-1">
          {STUDENT_LOAN_OPTIONS.map((o) => (
            <Checkbox key={o.key} checked={value.studentLoans.includes(o.key)} onChange={(on) => set("studentLoans", on ? [...value.studentLoans, o.key] : value.studentLoans.filter((x) => x !== o.key))} label={o.label} />
          ))}
          <Checkbox checked={value.postgraduateLoan} onChange={(v) => set("postgraduateLoan", v)} label="Postgraduate loan" />
          <Checkbox checked={value.pensionOptOut} onChange={(v) => set("pensionOptOut", v)} label="Opted out of the workplace pension" />
        </div>
      </Field>
    </>
  );
}
