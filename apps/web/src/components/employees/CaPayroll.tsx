import { Checkbox, Field, Input } from "@/components/ui/field";

export interface CaForm {
  federalClaim: string;
  provincialClaim: string;
  extraTax: string;
  cppExempt: boolean;
  eiExempt: boolean;
}

export const EMPTY_CA: CaForm = { federalClaim: "", provincialClaim: "", extraTax: "", cppExempt: false, eiExempt: false };

const str = (v: unknown) => (v === undefined || v === null || v === 0 ? "" : String(v));
export function caFromProfile(p: Record<string, unknown> | null | undefined): CaForm {
  if (!p) return EMPTY_CA;
  return { federalClaim: str(p.federalClaim), provincialClaim: str(p.provincialClaim), extraTax: str(p.extraTax), cppExempt: !!p.cppExempt, eiExempt: !!p.eiExempt };
}
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,\s]/g, "")));
export function caToProfile(f: CaForm) {
  return { federalClaim: num(f.federalClaim), provincialClaim: num(f.provincialClaim), extraTax: num(f.extraTax) ?? 0, cppExempt: f.cppExempt, eiExempt: f.eiExempt };
}

/** TD1 claims and CPP or EI exemptions for a Canadian employee. */
export function CaPayrollFields({ value, onChange }: { value: CaForm; onChange: (v: CaForm) => void }) {
  const set = <K extends keyof CaForm>(k: K, v: CaForm[K]) => onChange({ ...value, [k]: v });
  const money = (k: "federalClaim" | "provincialClaim" | "extraTax", label: string, hint?: string) => (
    <Field label={label} htmlFor={`f-${k}`} hint={hint}>
      <Input id={`f-${k}`} inputMode="decimal" value={value[k]} onChange={(e) => set(k, e.target.value)} placeholder={k === "extraTax" ? "0" : "Basic personal amount"} />
    </Field>
  );
  return (
    <>
      {money("federalClaim", "Federal TD1 total claim", "Leave blank for the basic personal amount")}
      {money("provincialClaim", "Provincial TD1 total claim", "Leave blank for the basic personal amount")}
      {money("extraTax", "Extra tax each pay (TD1)")}
      <Field label="Exemptions" span>
        <div className="flex flex-wrap gap-5 pt-1">
          <Checkbox checked={value.cppExempt} onChange={(v) => set("cppExempt", v)} label="Not contributing to CPP or QPP" />
          <Checkbox checked={value.eiExempt} onChange={(v) => set("eiExempt", v)} label="Not insurable for EI" />
        </div>
      </Field>
    </>
  );
}
