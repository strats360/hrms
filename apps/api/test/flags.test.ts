import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, login } from "./helpers";

let platform: Client, kunal: Client, priya: Client;
let tenantId = "";
let flags: any[] = [];

beforeAll(async () => {
  [platform, kunal, priya] = await Promise.all([login("platform@strats360people.in"), login("kunal.shah@strats360.com"), login("priya.vaghela@strats360.com")]);
  tenantId = (await platform.get("/platform/tenants?q=TN-0142")).body[0].id;
  flags = (await platform.get("/platform/flags")).body.flags;
});
afterAll(async () => {
  await platform.patch(`/platform/billing/tenants/${tenantId}`, { plan: "growth" });
  const reports = flags.find((f) => f.key === "module.reports");
  await platform.patch(`/platform/flags/${reports.id}`, { enabled: true, rollout: "all", excludedTenantIds: [] });
});

describe("Feature flags", () => {
  it("lists flags with how many tenants have each", async () => {
    const r = await platform.get("/platform/flags");
    expect(r.status).toBe(200);
    expect(r.body.release.version).toBeTruthy();
    expect(r.body.flags.map((f: any) => f.key)).toEqual(expect.arrayContaining(["module.tds", "module.payments"]));
    expect(r.body.flags.find((f: any) => f.key === "module.tds").tenantsOn).toBeGreaterThanOrEqual(1);
    expect((await kunal.get("/platform/flags")).status).toBe(403);
    expect((await kunal.get("/me")).body.memberships[0].features["module.tds"]).toBe(true);
  });

  it("takes TDS and claims away on the Starter plan", async () => {
    await platform.patch(`/platform/billing/tenants/${tenantId}`, { plan: "starter" });
    expect((await kunal.get("/admin/tds/summary")).status).toBe(403);
    expect((await kunal.get("/admin/reimbursements/claims")).status).toBe(403);
    expect((await priya.get("/ess/claims")).status).toBe(403);
    expect((await priya.get("/ess/tax")).status).toBe(403);
    expect((await kunal.get("/admin/payroll/runs")).status).toBe(200); // payroll is in every plan
    const me = (await kunal.get("/me")).body.memberships[0];
    expect(me.features["module.tds"]).toBe(false);
    expect(me.features["module.reports"]).toBe(true);
    await platform.patch(`/platform/billing/tenants/${tenantId}`, { plan: "growth" });
    expect((await kunal.get("/admin/tds/summary")).status).toBe(200);
  });

  it("switches a feature off everywhere, or for one tenant", async () => {
    const reports = flags.find((f) => f.key === "module.reports");
    expect((await platform.patch(`/platform/flags/${reports.id}`, { enabled: false })).body.enabled).toBe(false);
    expect((await kunal.get("/admin/reports")).status).toBe(403);
    await platform.patch(`/platform/flags/${reports.id}`, { enabled: true, excludedTenantIds: [tenantId] });
    expect((await kunal.get("/admin/reports")).status).toBe(403);
    await platform.patch(`/platform/flags/${reports.id}`, { excludedTenantIds: [], rollout: "percent", percent: 0, tenantIds: [tenantId] });
    expect((await kunal.get("/admin/reports")).status).toBe(200); // named tenants always get a percent rollout
    await platform.patch(`/platform/flags/${reports.id}`, { rollout: "all", tenantIds: [] });
  });

  it("creates new flags (super admin only)", async () => {
    const r = await platform.post("/platform/flags", { key: "ess.mobile-punch-v2", name: "New mobile punch", rollout: "percent", percent: 10 });
    expect(r.status).toBe(201);
    expect((await kunal.get("/me")).body.memberships[0].features["ess.mobile-punch-v2"]).toBeTypeOf("boolean");
  });
});
