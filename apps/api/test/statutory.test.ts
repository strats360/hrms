import { beforeAll, describe, expect, it } from "vitest";
import { todayLocal } from "@hrms/shared";
import { Client, login } from "./helpers";

let platform: Client, kunal: Client;
const monthStart = todayLocal().slice(0, 7) + "-01";

beforeAll(async () => {
  [platform, kunal] = await Promise.all([login("platform@saralix.com"), login("kunal.shah@strats360.com")]);
});

describe("Statutory master", () => {
  it("lists versions with what's in force today", async () => {
    const r = await platform.get("/platform/statutory");
    expect(r.status).toBe(200);
    const pf = r.body.rows.find((x: any) => x.key === "pf");
    expect(pf.inForce).toBe(true);
    expect(pf.summary).toContain("₹25,000"); // in force since 17 Sep 2026
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

describe("Indian rules from the Labour Codes", () => {
  it("splits the EPF ceiling by days in September 2026", async () => {
    const { createDb } = await import("@hrms/db");
    const { rulesFor } = await import("../src/services/statutory");
    const { env } = await import("./helpers");
    const db = createDb(env.DATABASE_URL!, { max: 1 });
    try {
      expect((await rulesFor(db, "2026-08")).pf.wageCeiling).toBe(15000);
      expect((await rulesFor(db, "2026-09")).pf.wageCeiling).toBe(Math.round((15000 * 16 + 25000 * 14) / 30));
      expect((await rulesFor(db, "2026-10")).pf.wageCeiling).toBe(25000);
    } finally {
      await db.$client.end();
    }
  });

  it("keeps ESI going to the end of the contribution period once someone was covered", async () => {
    const { createDb } = await import("@hrms/db");
    const { esiCoveredThisPeriod } = await import("../src/services/payroll");
    const { env } = await import("./helpers");
    const postgres = (await import("postgres")).default;
    const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const db = createDb(env.DATABASE_URL!, { max: 1 });
    const [{ e, t, ent }] = (await sql`select e.id as e, e.tenant_id as t, l.id as ent from employees e join legal_entities l on l.tenant_id = e.tenant_id and l.is_default where e.work_email = 'priya.vaghela@strats360.com'`) as any;
    const [{ id: runId }] = (await sql`insert into payroll_runs (id, tenant_id, entity_id, month, period_start, period_end, status) values (gen_random_uuid()::text, ${t}, ${ent}, '2019-05', '2019-05-01', '2019-05-31', 'approved') returning id`) as any;
    try {
      await sql`insert into payroll_items (id, tenant_id, run_id, employee_id, snapshot, days_in_month, paid_days, lop_days, earnings, deductions, employer, gross, total_deductions, net, employer_cost, tds, taxable_gross, employee_pf, professional_tax)
        values (gen_random_uuid()::text, ${t}, ${runId}, ${e}, ${sql.json({ name: "Priya", code: "STL-0042" } as any)}, 31, 31, 0, ${sql.json([])}, ${sql.json([{ code: "esi", label: "ESI", amount: 150 }])}, ${sql.json([])}, 20000, 150, 19850, 0, 0, 20000, 0, 0)`;
      // June and September are in the same period (April to September); October starts a new one
      expect((await esiCoveredThisPeriod(db, t, "2019-06", [e])).has(e)).toBe(true);
      expect((await esiCoveredThisPeriod(db, t, "2019-09", [e])).has(e)).toBe(true);
      expect((await esiCoveredThisPeriod(db, t, "2019-10", [e])).size).toBe(0);
    } finally {
      await sql`delete from payroll_runs where id = ${runId}`;
      await sql.end();
      await db.$client.end();
    }
  });
});
