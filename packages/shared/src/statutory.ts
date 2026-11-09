import { z } from "zod";
import { DEFAULT_RULES, LWF_RULES, PT_RULES, STATUTORY, TAX_TABLES, type LwfRule, type PtRule, type Regime, type StatutoryRules, type TaxTable } from "./payroll";

/**
 * Statutory master: versioned rules published by the platform. Keys:
 *   pf, esi, pt:<State>, lwf:<State>, tax:<FY>, minwage:<State>
 * The live version with the latest effective date on or before the 1st of a payroll
 * month applies to that month. Without one, the built-in rule applies.
 */
export const RULE_CATEGORIES = ["pf", "esi", "pt", "lwf", "tax", "minwage"] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export const RULE_CATEGORY_LABEL: Record<RuleCategory, string> = { pf: "EPF", esi: "ESI", pt: "Professional Tax", lwf: "Labour Welfare Fund", tax: "Income tax slabs", minwage: "Minimum wage" };

const rate = z.coerce.number().min(0).max(1);
const amount = z.coerce.number().min(0).max(1e9);
/** Slab "up to" of null means "and above". */
const upTo = z.union([z.null(), z.coerce.number().min(0)]);

export const pfValue = z.object({ employeeRate: rate, employerRate: rate, epsRate: rate, edliRate: rate, adminRate: rate, wageCeiling: amount });
export const esiValue = z.object({ employeeRate: rate, employerRate: rate, grossThreshold: amount });
const slabs = z.array(z.object({ upTo, amount })).min(1).max(20);
export const ptValue = z.object({ none: z.boolean().default(false), slabs: slabs.optional(), femaleSlabs: slabs.nullable().optional(), februaryTop: amount.nullable().optional() }).refine((v) => v.none || (v.slabs && v.slabs.at(-1)!.upTo === null), "The last slab must be open-ended (leave its 'up to' empty)");
export const lwfValue = z.object({ months: z.array(z.coerce.number().int().min(1).max(12)).min(1).max(12), employee: amount, employer: amount, minGross: amount.nullable().optional() });
const regimeTable = z.object({
  standardDeduction: amount,
  rebateLimit: amount,
  slabs: z.array(z.object({ upTo, rate })).min(1).max(15),
  surcharge: z.array(z.object({ above: amount, rate })).max(10).default([]),
});
export const taxValue = z.object({ new: regimeTable, old: regimeTable });
export const WAGE_CATEGORIES = ["unskilled", "semi_skilled", "skilled", "highly_skilled"] as const;
export type WageCategory = (typeof WAGE_CATEGORIES)[number];
export const WAGE_CATEGORY_LABELS: Record<WageCategory, string> = { unskilled: "Unskilled", semi_skilled: "Semi-skilled", skilled: "Skilled", highly_skilled: "Highly skilled" };
export const minWageValue = z.object({
  /** The rate for anyone without a skill category (usually the one that covers most staff). */
  monthly: amount,
  zone: z.string().max(40).nullable().optional(),
  skill: z.string().max(40).nullable().optional(),
  /** Monthly rate by skill category, as the state notification lists them. */
  rates: z.object({ unskilled: amount.optional(), semi_skilled: amount.optional(), skilled: amount.optional(), highly_skilled: amount.optional() }).optional(),
});

export const RULE_VALUE_SCHEMA: Record<RuleCategory, z.ZodTypeAny> = { pf: pfValue, esi: esiValue, pt: ptValue, lwf: lwfValue, tax: taxValue, minwage: minWageValue };

export const statutoryRuleSchema = z
  .object({
    category: z.enum(RULE_CATEGORIES),
    /** State for pt / lwf / minwage, FY ("2027-28") for tax. */
    scope: z.string().trim().max(60).optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    value: z.record(z.string(), z.unknown()),
    source: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (["pt", "lwf", "minwage", "tax"].includes(v.category) && !v.scope) ctx.addIssue({ code: "custom", path: ["scope"], message: v.category === "tax" ? "Pick the financial year" : "Pick the state" });
    if (v.category === "tax" && v.scope && !/^\d{4}-\d{2}$/.test(v.scope)) ctx.addIssue({ code: "custom", path: ["scope"], message: "Use a financial year like 2027-28" });
    const r = RULE_VALUE_SCHEMA[v.category].safeParse(v.value);
    if (!r.success) ctx.addIssue({ code: "custom", path: ["value", ...r.error.issues[0]!.path], message: r.error.issues[0]!.message });
  });

export const ruleKey = (category: RuleCategory, scope?: string | null) => (category === "pf" || category === "esi" ? category : `${category}:${scope}`);

const toPairs = (s: { upTo: number | null; amount?: number; rate?: number }[], k: "amount" | "rate") => s.map((x) => [x.upTo === null ? Infinity : Number(x.upTo), Number(x[k] ?? 0)] as [number, number]);
const fromPairs = (s: [number, number][], k: "amount" | "rate") => s.map(([u, a]) => ({ upTo: u === Infinity ? null : u, [k]: a }));

/** Convert a stored value into the engine's shape and merge it into a rule set. */
export function applyRule(R: StatutoryRules, category: RuleCategory, scope: string, value: Record<string, unknown>) {
  if (category === "pf") R.pf = pfValue.parse(value);
  else if (category === "esi") R.esi = esiValue.parse(value);
  else if (category === "pt") {
    const v = ptValue.parse(value);
    if (v.none) {
      R.noPt = [...new Set([...R.noPt, scope])];
      delete R.pt[scope];
    } else {
      R.noPt = R.noPt.filter((s) => s !== scope);
      const rule: PtRule = { slabs: toPairs(v.slabs!, "amount") };
      if (v.femaleSlabs?.length) rule.femaleSlabs = toPairs(v.femaleSlabs, "amount");
      if (v.februaryTop) rule.februaryTop = v.februaryTop;
      R.pt[scope] = rule;
    }
  } else if (category === "lwf") {
    const v = lwfValue.parse(value);
    const rule: LwfRule = { months: v.months, employee: v.employee, employer: v.employer };
    if (v.minGross) rule.minGross = v.minGross;
    R.lwf[scope] = rule;
  } else if (category === "tax") {
    const v = taxValue.parse(value);
    const t = (x: z.infer<typeof regimeTable>): TaxTable => ({ standardDeduction: x.standardDeduction, rebateLimit: x.rebateLimit, slabs: toPairs(x.slabs, "rate"), surcharge: x.surcharge.map((s) => [s.above, s.rate] as [number, number]) });
    R.tax[scope] = { new: t(v.new), old: t(v.old) } as Record<Regime, TaxTable>;
  } else if (category === "minwage") {
    const v = minWageValue.parse(value);
    R.minWage[scope] = { monthly: v.monthly, zone: v.zone ?? undefined, skill: v.skill ?? undefined, rates: v.rates };
  }
}

export interface RuleVersion {
  key: string;
  category: string;
  scope: string;
  value: Record<string, unknown>;
  effectiveFrom: string;
  status: string;
}

/** The rule set in force on a date: built-ins overlaid with the latest live version of each key. */
export function resolveRules(versions: RuleVersion[], asOf: string): StatutoryRules {
  const R: StatutoryRules = structuredClone({ ...DEFAULT_RULES, noPt: [...DEFAULT_RULES.noPt] });
  // structuredClone turns Infinity into... Infinity (it's preserved), so the built-in slabs survive.
  const latest = new Map<string, RuleVersion>();
  for (const v of versions) {
    if (v.status !== "live" || v.effectiveFrom > asOf) continue;
    const cur = latest.get(v.key);
    if (!cur || v.effectiveFrom > cur.effectiveFrom) latest.set(v.key, v);
  }
  for (const v of latest.values()) applyRule(R, v.category as RuleCategory, v.scope, v.value);
  return R;
}

/** Built-in rules expressed as stored values (to start a new version from, or to show as "Built-in"). */
export function builtInValue(category: RuleCategory, scope?: string | null): Record<string, unknown> | null {
  if (category === "pf") return { ...STATUTORY.pf };
  if (category === "esi") return { ...STATUTORY.esi };
  if (category === "pt" && scope) {
    if (DEFAULT_RULES.noPt.includes(scope)) return { none: true };
    const r = PT_RULES[scope];
    return r ? { none: false, slabs: fromPairs(r.slabs, "amount"), femaleSlabs: r.femaleSlabs ? fromPairs(r.femaleSlabs, "amount") : null, februaryTop: r.februaryTop ?? null } : null;
  }
  if (category === "lwf" && scope) {
    const r = LWF_RULES[scope];
    return r ? { months: r.months, employee: r.employee, employer: r.employer, minGross: r.minGross ?? null } : null;
  }
  if (category === "tax" && scope) {
    const years = Object.keys(TAX_TABLES).sort();
    const t = TAX_TABLES[scope] ?? TAX_TABLES[[...years].reverse().find((y) => y <= scope) ?? years[0]!]!;
    const conv = (x: TaxTable) => ({ standardDeduction: x.standardDeduction, rebateLimit: x.rebateLimit, slabs: fromPairs(x.slabs, "rate"), surcharge: x.surcharge.map(([above, r]) => ({ above, rate: r })) });
    return { new: conv(t.new), old: conv(t.old) };
  }
  return null;
}

const inrS = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** One line describing a rule value, for tables. */
export function describeRule(category: RuleCategory, value: Record<string, unknown>): string {
  try {
    if (category === "pf") {
      const v = pfValue.parse(value);
      return `${pct(v.employeeRate)} / ${pct(v.employerRate)} on wages up to ${inrS(v.wageCeiling)} · EPS ${pct(v.epsRate)} · EDLI ${pct(v.edliRate)} · admin ${pct(v.adminRate)}`;
    }
    if (category === "esi") {
      const v = esiValue.parse(value);
      return `${pct(v.employeeRate)} / ${pct(v.employerRate)} up to ${inrS(v.grossThreshold)} gross`;
    }
    if (category === "pt") {
      const v = ptValue.parse(value);
      if (v.none) return "Not levied";
      const s = v.slabs!;
      return s.map((x, i) => (x.upTo === null ? `> ${inrS(Number(s[i - 1]?.upTo ?? 0))} → ${inrS(x.amount)}` : `≤ ${inrS(x.upTo)} → ${inrS(x.amount)}`)).filter((_, i) => s[i]!.amount > 0 || i === 0).join(" · ") + (v.februaryTop ? ` (Feb ${inrS(v.februaryTop)})` : "");
    }
    if (category === "lwf") {
      const v = lwfValue.parse(value);
      const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${inrS(v.employee)} + ${inrS(v.employer)} in ${v.months.map((m) => M[m - 1]).join(" & ")}`;
    }
    if (category === "tax") {
      const v = taxValue.parse(value);
      return `New: ${v.new.slabs.map((s) => Math.round(s.rate * 100)).join(" / ")}% · rebate to ${inrS(v.new.rebateLimit)} · std ded ${inrS(v.new.standardDeduction)}`;
    }
    const v = minWageValue.parse(value);
    const rates = v.rates ? WAGE_CATEGORIES.filter((k) => v.rates![k]).map((k) => `${WAGE_CATEGORY_LABELS[k]} ${inrS(v.rates![k]!)}`) : [];
    return `${inrS(v.monthly)} / month${v.zone ? ` · ${v.zone}` : ""}${v.skill ? ` · ${v.skill}` : ""}${rates.length ? ` (${rates.join(", ")})` : ""}`;
  } catch {
    return "Invalid value";
  }
}

/**
 * Is a monthly wage below the state's minimum? Minimum wages are notified for basic + DA,
 * which is basic here; some companies compare gross instead. Uses the rate for the
 * employee's skill category when the rule lists one.
 */
export function minimumWageShortfall(
  rule: { monthly: number; zone?: string; skill?: string; rates?: Partial<Record<WageCategory, number>> } | undefined,
  pay: { basic: number; gross: number },
  opts: { category?: string | null; basis?: "basic" | "gross" } = {},
) {
  if (!rule) return null;
  const cat = opts.category as WageCategory | undefined;
  const required = (cat && rule.rates?.[cat]) || rule.monthly;
  const label = cat && rule.rates?.[cat] ? WAGE_CATEGORY_LABELS[cat] : (rule.skill ?? null);
  const paid = opts.basis === "gross" ? pay.gross : pay.basic;
  if (!required || paid >= required) return null;
  return { required, paid, short: required - paid, basis: opts.basis ?? "basic", label, zone: rule.zone ?? null };
}
