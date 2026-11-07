import { describe, expect, it } from "vitest";
import { evaluateFlags, flagOn, rolloutBucket, type FlagRule } from "../src/flags";

const base: FlagRule = { key: "module.tds", enabled: true, rollout: "all", plans: [], tenantIds: [], excludedTenantIds: [], percent: 100 };
const t = { id: "t1", plan: "starter" };

describe("feature flags", () => {
  it("rolls out by plan, tenant and percent", () => {
    expect(flagOn(base, t)).toBe(true);
    expect(flagOn({ ...base, enabled: false }, t)).toBe(false);
    expect(flagOn({ ...base, rollout: "plans", plans: ["growth"] }, t)).toBe(false);
    expect(flagOn({ ...base, rollout: "plans", plans: ["growth"], tenantIds: ["t1"] }, t)).toBe(true);
    expect(flagOn({ ...base, rollout: "tenants", tenantIds: ["t2"] }, t)).toBe(false);
    expect(flagOn({ ...base, excludedTenantIds: ["t1"] }, t)).toBe(false);
    expect(flagOn({ ...base, rollout: "percent", percent: 0 }, t)).toBe(false);
    expect(flagOn({ ...base, rollout: "percent", percent: 100 }, t)).toBe(true);
  });
  it("keeps a tenant in the same bucket", () => {
    expect(rolloutBucket("t1", "x")).toBe(rolloutBucket("t1", "x"));
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => rolloutBucket(`t${i}`, "x")));
    expect(buckets.size).toBeGreaterThan(50);
  });
  it("defaults known features to on", () => {
    const r = evaluateFlags([{ ...base, key: "module.payments", rollout: "plans", plans: ["growth"] }], t);
    expect(r["module.tds"]).toBe(true);
    expect(r["module.payments"]).toBe(false);
  });
});
