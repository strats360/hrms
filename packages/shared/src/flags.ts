/** Feature flags: which features a tenant gets. Unknown flags default to on (fail open). */
export interface FlagRule {
  key: string;
  enabled: boolean;
  rollout: "all" | "plans" | "tenants" | "percent" | string;
  plans: string[];
  tenantIds: string[];
  excludedTenantIds: string[];
  percent: number;
}

/** Features the product checks. Each one gates API routes and hides the UI. */
export const FEATURES = {
  "module.tds": "TDS declarations and Form 16",
  "module.reimbursements": "Reimbursements and expense claims",
  "module.payments": "Payment batches, bank files and reconciliation",
  "module.reports": "Reports",
  "module.compliance": "Statutory compliance",
  "module.performance": "Performance reviews",
  "module.recruitment": "Recruitment and careers page",
  "module.assets": "Company assets",
  "module.timesheets": "Timesheets and projects",
  "module.announcements": "Announcements",
} as const;
export type FeatureKey = keyof typeof FEATURES;

/** Stable 0-99 bucket for a tenant and flag (FNV-1a), so a percent rollout doesn't flip between requests. */
export function rolloutBucket(tenantId: string, key: string) {
  let h = 0x811c9dc5;
  for (const ch of `${key}:${tenantId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export function flagOn(f: FlagRule, tenant: { id: string; plan: string }) {
  if (!f.enabled) return false;
  if (f.excludedTenantIds.includes(tenant.id)) return false;
  if (f.rollout === "plans") return f.plans.includes(tenant.plan) || f.tenantIds.includes(tenant.id);
  if (f.rollout === "tenants") return f.tenantIds.includes(tenant.id);
  if (f.rollout === "percent") return f.tenantIds.includes(tenant.id) || rolloutBucket(tenant.id, f.key) < f.percent;
  return true;
}

/** All flags for one tenant, with known features defaulting to on when no flag exists. */
export function evaluateFlags(flags: FlagRule[], tenant: { id: string; plan: string }): Record<string, boolean> {
  const out: Record<string, boolean> = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true]));
  for (const f of flags) out[f.key] = flagOn(f, tenant);
  return out;
}
