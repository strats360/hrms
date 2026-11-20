import { z } from "zod";

/**
 * Flexible benefit plan. An employee moves part of their special allowance into heads like fuel,
 * phone or meals. The amount builds up each month instead of being paid as salary; they claim it
 * against bills through reimbursements, tax free, and whatever is left at the end of the year (or
 * when they leave) is paid out as taxable salary.
 *
 * The caps below are starting points. Check them with your tax advisor: some heads only save tax
 * in the old regime.
 */
export interface FbpHead {
  code: string;
  label: string;
  /** Most an employee can put in this head in a year. */
  annualCap: number;
  /** Also saves tax in the new regime (most perquisite exemptions do; LTA doesn't). */
  newRegime: boolean;
}

export const FBP_SUGGESTED_HEADS: FbpHead[] = [
  { code: "fuel", label: "Fuel and car maintenance", annualCap: 21600, newRegime: true },
  { code: "telephone", label: "Phone and internet", annualCap: 24000, newRegime: true },
  { code: "meals", label: "Meal cards", annualCap: 26400, newRegime: true },
  { code: "gift", label: "Gift vouchers", annualCap: 5000, newRegime: true },
  { code: "books", label: "Books and periodicals", annualCap: 12000, newRegime: false },
  { code: "lta", label: "Leave travel (LTA)", annualCap: 50000, newRegime: false },
];

export const fbpHeadSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,23}$/, "Use 2-24 lowercase letters, digits or _"),
  label: z.string().trim().min(1, "Name the benefit").max(60),
  annualCap: z.coerce.number().min(0).max(10_000_000),
  newRegime: z.boolean().default(true),
});

export const fbpSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Approve declarations as soon as employees submit them. */
    autoApprove: z.boolean().default(false),
    heads: z.array(fbpHeadSchema).max(12),
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.heads.forEach((h, i) => {
      if (seen.has(h.code)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["heads", i, "code"], message: `Two benefits use the code ${h.code}` });
      seen.add(h.code);
    });
  });
export type FbpSettings = z.infer<typeof fbpSettingsSchema>;

export const fbpDeclarationSchema = z.object({
  /** Yearly amount per head code. */
  allocations: z.record(z.string(), z.coerce.number().min(0).max(10_000_000)),
});

export type FbpAllocations = Record<string, number>;

/** The heads an employee can use under their regime. */
export function fbpHeadsFor(heads: FbpHead[], regime: "new" | "old") {
  return heads.filter((h) => regime === "old" || h.newRegime);
}

/**
 * Checks a declaration: known heads, within each cap, and no more than the special allowance it
 * comes out of. Returns the allocations with zero heads dropped, or throws a message to show.
 */
export function checkFbpAllocations(heads: FbpHead[], regime: "new" | "old", allocations: FbpAllocations, annualSpecial: number): FbpAllocations {
  const allowed = fbpHeadsFor(heads, regime);
  const out: FbpAllocations = {};
  let total = 0;
  for (const [code, raw] of Object.entries(allocations)) {
    const amount = Math.round(Number(raw) || 0);
    if (amount <= 0) continue;
    const h = heads.find((x) => x.code === code);
    if (!h) throw new Error(`There's no benefit called ${code}`);
    if (!allowed.includes(h)) throw new Error(`${h.label} doesn't save tax in the new regime, so it isn't offered`);
    if (amount > h.annualCap) throw new Error(`${h.label} can be at most ${h.annualCap.toLocaleString("en-IN")} a year`);
    out[code] = amount;
    total += amount;
  }
  if (total > Math.max(0, Math.floor(annualSpecial))) throw new Error(`Your benefits add up to ${total.toLocaleString("en-IN")}, more than your special allowance of ${Math.floor(annualSpecial).toLocaleString("en-IN")} a year`);
  return out;
}

/**
 * What builds up this month per head, prorated for paid days, never more than the special
 * allowance it comes out of. Heads the regime doesn't allow stay in the special allowance.
 */
export function fbpMonthlyCredit(heads: FbpHead[], regime: "new" | "old", allocations: FbpAllocations, monthlySpecial: number): FbpAllocations {
  const allowed = new Set(fbpHeadsFor(heads, regime).map((h) => h.code));
  const out: FbpAllocations = {};
  let left = Math.max(0, monthlySpecial);
  for (const [code, yearly] of Object.entries(allocations)) {
    if (!allowed.has(code) || left <= 0) continue;
    const m = Math.min(left, Math.round((yearly / 12) * 100) / 100);
    if (m > 0) {
      out[code] = m;
      left -= m;
    }
  }
  return out;
}

export const sumFbp = (a: FbpAllocations | null | undefined) => Math.round(Object.values(a ?? {}).reduce((s, n) => s + n, 0) * 100) / 100;
