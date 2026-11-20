import type { CustomFieldDef, CustomFieldValues } from "@hrms/shared";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";

/** Inputs for the company's own employee fields (Settings, Custom employee fields). */
export function CustomFieldInputs({ defs, value, onChange }: { defs: CustomFieldDef[]; value: CustomFieldValues; onChange: (v: CustomFieldValues) => void }) {
  const set = (k: string, v: CustomFieldValues[string]) => onChange({ ...value, [k]: v });
  return (
    <>
      {defs.map((d) => {
        const v = value[d.key];
        const label = d.required ? `${d.label} *` : d.label;
        if (d.type === "yes_no")
          return (
            <Field key={d.key} label={d.label}>
              <div className="pt-1"><Checkbox checked={v === true} onChange={(x) => set(d.key, x)} label="Yes" /></div>
            </Field>
          );
        if (d.type === "select")
          return (
            <Field key={d.key} label={label} htmlFor={`cf-${d.key}`}>
              <Select id={`cf-${d.key}`} value={typeof v === "string" ? v : ""} onChange={(e) => set(d.key, e.target.value || null)}>
                <option value="">Not set</option>
                {(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
          );
        return (
          <Field key={d.key} label={label} htmlFor={`cf-${d.key}`}>
            <Input id={`cf-${d.key}`} type={d.type === "date" ? "date" : "text"} inputMode={d.type === "number" ? "decimal" : undefined} value={v === null || v === undefined ? "" : String(v)} onChange={(e) => set(d.key, e.target.value)} />
          </Field>
        );
      })}
    </>
  );
}
