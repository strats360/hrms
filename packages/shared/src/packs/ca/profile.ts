import { z } from "zod";

/** TD1 claims and exemptions per Canadian employee. Null claims mean the basic personal amount. */
export const caPayrollProfileSchema = z.object({
  /** Total claim amount from the federal TD1. */
  federalClaim: z.coerce.number().min(0).max(1e6).nullable().default(null),
  /** Total claim amount from the provincial TD1. */
  provincialClaim: z.coerce.number().min(0).max(1e6).nullable().default(null),
  /** Extra tax deducted each pay (TD1 additional tax). */
  extraTax: z.coerce.number().min(0).max(1e6).default(0),
  /** Not contributing to CPP or QPP (over 70, receiving a disability pension, or an elected stop). */
  cppExempt: z.boolean().default(false),
  /** Not insurable for EI (for example, related to a controlling shareholder). */
  eiExempt: z.boolean().default(false),
});
export type CaPayrollProfile = z.infer<typeof caPayrollProfileSchema>;
