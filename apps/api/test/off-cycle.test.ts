import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let krupa: Client;
let runId = "";
let priyaId = "";

beforeAll(async () => {
  krupa = await login("krupa.joshi@strats360.com");
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  if (runId) await sql`delete from payroll_runs where id = ${runId}`;
  await sql.end();
});

describe("off-cycle runs", () => {
  it("pays a one-off bonus with TDS on the extra tax and no PF, ESI or PT", async () => {
    expect((await krupa.post("/admin/payroll/runs/off-cycle", { label: "", payDate: "2026-11-25", lines: [{ employeeId: priyaId, amount: 50000 }] })).status).toBe(422);
    const r = await krupa.post("/admin/payroll/runs/off-cycle", { label: "Diwali bonus", payDate: "2026-11-25", lines: [{ employeeId: priyaId, amount: 50000 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    runId = r.body.id;
    expect(r.body).toMatchObject({ kind: "off_cycle", label: "Diwali bonus", status: "calculated", month: "2026-11", periodStart: "2026-11-25" });
    const res = (await krupa.get(`/admin/payroll/runs/${runId}/items`)).body;
    const items = res.items ?? res;
    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.earnings).toEqual([{ code: "adj_e0", label: "Diwali bonus", amount: 50000 }]);
    const codes = it.deductions.map((d: any) => d.code);
    expect(codes).toEqual(["tds"]);
    expect(Number(it.tds)).toBeGreaterThan(0);
    expect(Number(it.tds)).toBeLessThanOrEqual(50000 * 0.39); // at most the top marginal rate
    expect(it.employer).toEqual([]);
  });

  it("can run several on one date, outside the regular one-run-per-period rule", async () => {
    const list = (await krupa.get("/admin/payroll/runs")).body;
    expect(list.find((x: any) => x.id === runId).kind).toBe("off_cycle");
    const again = await krupa.post("/admin/payroll/runs/off-cycle", { label: "Arrears", payDate: "2026-11-25", lines: [{ employeeId: priyaId, amount: 1000 }] });
    expect(again.status).toBe(201);
    await sql`delete from payroll_runs where id = ${again.body.id}`;
  });
});
