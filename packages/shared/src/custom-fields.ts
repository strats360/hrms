import { z } from "zod";

/** Extra fields a company keeps on each employee, like T-shirt size, cost centre or vaccination date. */
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "yes_no", "select"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = { text: "Text", number: "Number", date: "Date", yes_no: "Yes or no", select: "Pick from a list" };

export const customFieldDefSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,31}$/, "Use 2-32 lowercase letters, digits or _"),
    label: z.string().trim().min(1, "Name the field").max(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    required: z.boolean().default(false),
    /** Employees see it on their own profile in self service. */
    showToEmployee: z.boolean().default(false),
  })
  .superRefine((d, ctx) => {
    if (d.type === "select" && !(d.options?.length ?? 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: `${d.label}: add at least one choice` });
  });
export type CustomFieldDef = z.infer<typeof customFieldDefSchema>;

export const customFieldDefsSchema = z
  .array(customFieldDefSchema)
  .max(30, "Up to 30 custom fields")
  .superRefine((defs, ctx) => {
    const seen = new Set<string>();
    defs.forEach((d, i) => {
      if (seen.has(d.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "key"], message: `Two fields use the key ${d.key}` });
      seen.add(d.key);
    });
  });

export type CustomFieldValue = string | number | boolean | null;
export type CustomFieldValues = Record<string, CustomFieldValue>;

/**
 * Checks an employee's values against the company's field list and returns them cleaned up:
 * numbers as numbers, blanks dropped, and values for fields that no longer exist left alone so
 * deleting a field by mistake loses nothing. Throws a message a person can act on.
 */
export function cleanCustomValues(defs: CustomFieldDef[], values: Record<string, unknown>, opts: { partial?: boolean } = {}): CustomFieldValues {
  const out: CustomFieldValues = {};
  for (const [k, v] of Object.entries(values)) if (!defs.some((d) => d.key === k) && v !== undefined) out[k] = v as CustomFieldValue;
  for (const d of defs) {
    const raw = values[d.key];
    const blank = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    if (blank) {
      if (d.required && !opts.partial && d.type !== "yes_no") throw new Error(`${d.label} is required`);
      continue;
    }
    switch (d.type) {
      case "text":
        out[d.key] = String(raw).trim().slice(0, 500);
        break;
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s]/g, ""));
        if (!Number.isFinite(n)) throw new Error(`${d.label} must be a number`);
        out[d.key] = n;
        break;
      }
      case "date":
        if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw new Error(`${d.label} must be a date`);
        out[d.key] = raw;
        break;
      case "yes_no":
        out[d.key] = raw === true || raw === "true" || raw === "yes" || raw === "Yes";
        break;
      case "select":
        if (!d.options?.includes(String(raw))) throw new Error(`${d.label} must be one of ${d.options?.join(", ")}`);
        out[d.key] = String(raw);
        break;
    }
  }
  return out;
}

/** How a value reads in a table or export. */
export function customValueText(d: CustomFieldDef, v: CustomFieldValue | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  if (d.type === "yes_no") return v ? "Yes" : "No";
  return String(v);
}
