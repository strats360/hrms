import { FILING_STATUSES } from "@hrms/shared";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";

export interface UsForm {
  filingStatus: string;
  multipleJobs: boolean;
  dependents: string;
  otherIncome: string;
  deductions: string;
  extraWithholding: string;
  exempt: boolean;
  k401Percent: string;
  preTaxHealth: string;
}

export const EMPTY_US: UsForm = { filingStatus: "single", multipleJobs: false, dependents: "", otherIncome: "", deductions: "", extraWithholding: "", exempt: false, k401Percent: "", preTaxHealth: "" };

const str = (v: unknown) => (v === undefined || v === null || v === 0 ? "" : String(v));
export function usFromProfile(p: Record<string, unknown> | null | undefined): UsForm {
  if (!p) return EMPTY_US;
  return {
    filingStatus: String(p.filingStatus ?? "single"),
    multipleJobs: !!p.multipleJobs,
    dependents: str(p.dependents),
    otherIncome: str(p.otherIncome),
    deductions: str(p.deductions),
    extraWithholding: str(p.extraWithholding),
    exempt: !!p.exempt,
    k401Percent: str(p.k401Percent),
    preTaxHealth: str(p.preTaxHealth),
  };
}
const num = (s: string) => Number(s.replace(/[$,\s]/g, "") || 0);
export function usToProfile(f: UsForm) {
  return {
    filingStatus: f.filingStatus,
    multipleJobs: f.multipleJobs,
    dependents: num(f.dependents),
    otherIncome: num(f.otherIncome),
    deductions: num(f.deductions),
    extraWithholding: num(f.extraWithholding),
    exempt: f.exempt,
    k401Percent: num(f.k401Percent),
    preTaxHealth: num(f.preTaxHealth),
  };
}

/** Form W-4 and pre-tax benefits for a US employee. */
export function UsPayrollFields({ value, onChange }: { value: UsForm; onChange: (v: UsForm) => void }) {
  const set = <K extends keyof UsForm>(k: K, v: UsForm[K]) => onChange({ ...value, [k]: v });
  const money = (k: "dependents" | "otherIncome" | "deductions" | "extraWithholding" | "preTaxHealth", label: string, hint?: string) => (
    <Field label={label} htmlFor={`f-${k}`} hint={hint}>
      <Input id={`f-${k}`} inputMode="decimal" value={value[k]} onChange={(e) => set(k, e.target.value)} placeholder="0" />
    </Field>
  );
  return (
    <>
      <Field label="Filing status (W-4 Step 1c)" htmlFor="f-filingStatus">
        <Select id="f-filingStatus" value={value.filingStatus} onChange={(e) => set("filingStatus", e.target.value)}>
          {Object.entries(FILING_STATUSES).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </Select>
      </Field>
      {money("dependents", "Dependants credit, a year (Step 3)")}
      {money("otherIncome", "Other income, a year (Step 4a)")}
      {money("deductions", "Deductions, a year (Step 4b)")}
      {money("extraWithholding", "Extra withholding each month (Step 4c)")}
      <Field label="401(k), % of pay (pre-tax)" htmlFor="f-k401Percent">
        <Input id="f-k401Percent" inputMode="decimal" value={value.k401Percent} onChange={(e) => set("k401Percent", e.target.value)} placeholder="0" />
      </Field>
      {money("preTaxHealth", "Health premium each month (pre-tax)")}
      <Field label="W-4 options" span>
        <div className="flex flex-wrap gap-5 pt-1">
          <Checkbox checked={value.multipleJobs} onChange={(v) => set("multipleJobs", v)} label="Multiple jobs or spouse works (Step 2)" />
          <Checkbox checked={value.exempt} onChange={(v) => set("exempt", v)} label="Exempt from federal withholding" />
        </div>
      </Field>
    </>
  );
}
