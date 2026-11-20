import { z } from "zod";
import { NI_CATEGORIES, STUDENT_LOANS } from "./rules";

/** What HR keeps per UK employee for payroll: from the starter checklist or P45, and HMRC notices. */
export const ukPayrollProfileSchema = z.object({
  taxCode: z.string().trim().toUpperCase().regex(/^(S|C)?(\d{1,6}[LMNT]|K\d{1,6}|BR|D0|D1|D2|NT|0T)( ?(W1|M1|X))?$/, "Enter a tax code like 1257L, S1257L, K475, BR or 1257L M1").default("1257L"),
  niCategory: z.enum(Object.keys(NI_CATEGORIES) as [keyof typeof NI_CATEGORIES, ...(keyof typeof NI_CATEGORIES)[]]).default("A"),
  studentLoans: z.array(z.enum(["plan1", "plan2", "plan4", "plan5"])).default([]),
  postgraduateLoan: z.boolean().default(false),
  pensionOptOut: z.boolean().default(false),
  /** Pay and tax from earlier jobs this tax year, from the P45. */
  p45: z
    .object({ taxYear: z.string().regex(/^\d{4}-\d{2}$/), pay: z.coerce.number().min(0), tax: z.coerce.number() })
    .nullable()
    .optional(),
});
export type UkPayrollProfile = z.infer<typeof ukPayrollProfileSchema>;
export const STUDENT_LOAN_OPTIONS = (["plan1", "plan2", "plan4", "plan5"] as const).map((k) => ({ key: k, label: STUDENT_LOANS[k].label }));
