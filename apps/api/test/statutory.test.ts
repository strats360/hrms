import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, login } from "./helpers";

let platform: Client, kunal: Client;
const monthStart = todayIST().slice(0, 7) + "-01";

beforeAll(async () => {
  [platform, kunal] = await Promise.all([login("platform@strats360people.in"), login("kunal.shah@strats360.com")]);
});

describe("Statutory master", () => {
  it("lists versions with what's in force today", async () => {
    const r = await platform.get("/platform/statutory");
    expect(r.status).toBe(200);
    const pf = r.body.rows.find((x: any) => x.key === "pf");
    expect(pf.inForce).toBe(true);
    expect(pf.summary).toContain("₹15,000");
    expect(r.body.pending).toBe(2);
    expect(r.body.rows.find((x: any) => x.key === "pt:Karnataka").status).toBe("draft");
    expect((await kunal.get("/platform/statutory")).status).toBe(403);
  });

  it("starts a new version from the latest one and validates it", async () => {
    const t = await platform.get("/platform/statutory/template?category=pt&scope=Gujarat");
    expect(t.body.value.slabs.at(-1).upTo).toBeNull();
    const bad = await platform.post("/platform/statutory", { category: "pt", scope: "Gujarat", effectiveFrom: monthStart, value: { slabs: [{ upTo: 12000, amount: 0 }] } });
    expect(bad.status).toBe(422);
    expect((await platform.post("/platform/statutory", { category: "lwf", effectiveFrom: monthStart, value: { months: [6], employee: 6, employer: 12 } })).status).toBe(422); // state needed
  });

  it("publishes a version that tenants and payroll pick up, then retires it", async () => {
    const before = (await kunal.get("/admin/compliance/rules")).body.rules.find((r: any) => r.rule === "Professional Tax" && r.scope === "Gujarat");
    expect(before.value).toContain("₹200");
    const d = await platform.post("/platform/statutory", { category: "pt", scope: "Gujarat", effectiveFrom: monthStart, value: { slabs: [{ upTo: 14999, amount: 0 }, { upTo: null, amount: 250 }] }, source: "Test revision" });
    expect(d.status).toBe(201);
    expect(d.body.status).toBe("draft");
    // drafts don't apply
    expect((await kunal.get("/admin/compliance/rules")).body.rules.find((r: any) => r.rule === "Professional Tax" && r.scope === "Gujarat").value).toContain("₹200");
    const p = await platform.post("/platform/statutory/publish", { ids: [d.body.id] });
    expect(p.body.published).toBe(1);
    expect(p.body.tenants).toBeGreaterThanOrEqual(1);
    const after = (await kunal.get("/admin/compliance/rules")).body.rules.find((r: any) => r.rule === "Professional Tax" && r.scope === "Gujarat");
    expect(after.value).toContain("₹250");
    expect(after.source).toContain("from");
    expect((await platform.patch(`/platform/statutory/${d.body.id}`, { category: "pt", scope: "Gujarat", effectiveFrom: monthStart, value: { none: true } })).status).toBe(400); // live can't be edited
    expect((await platform.post(`/platform/statutory/${d.body.id}/retire`)).body.status).toBe("retired");
    expect((await kunal.get("/admin/compliance/rules")).body.rules.find((r: any) => r.rule === "Professional Tax" && r.scope === "Gujarat").value).toContain("₹200");
  });

  it("deletes drafts only", async () => {
    const d = await platform.post("/platform/statutory", { category: "esi", effectiveFrom: "2030-01-01", value: { employeeRate: 0.0075, employerRate: 0.0325, grossThreshold: 25000 } });
    expect((await platform.del(`/platform/statutory/${d.body.id}`)).status).toBe(200);
    const pf = (await platform.get("/platform/statutory")).body.rows.find((x: any) => x.key === "pf");
    expect((await platform.del(`/platform/statutory/${pf.id}`)).status).toBe(400);
  });
});
