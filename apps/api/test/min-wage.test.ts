import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";
import { invalidateRules } from "../src/services/statutory";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let krupa: Client, kunal: Client;
let low: { id: string; code: string }, ok: { id: string; code: string };
let ruleId = "";
let runId = "";
let month = "";

beforeAll(async () => {
  [krupa, kunal] = await Promise.all([login("krupa.joshi@strats360.com"), login("kunal.shah@strats360.com")]);
  const [first] = await sql`select min(r.month) as m from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142'`;
  const base = new Date(`${first!.m}-01T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() - 1);
  month = base.toISOString().slice(0, 7);
  [low, ok] = (await sql`
    select e.id, e.employee_code as code from employees e join tenants t on t.id = e.tenant_id join branches b on b.id = e.branch_id
    where t.code = 'TN-0142' and e.status = 'active' and b.state = 'Gujarat' and e.user_id is null and e.date_of_joining < ${`${month}-01`} and e.last_working_day is null
    order by e.employee_code limit 2`) as any;
  // a live Gujarat rule: low default rate, and a highly skilled rate nobody here meets
  [{ id: ruleId }] = (await sql`insert into statutory_rules (id, key, category, scope, value, effective_from, status, source)
    values (gen_random_uuid()::text, 'minwage:Gujarat', 'minwage', 'Gujarat', ${sql.json({ monthly: 1000, zone: "Zone I", skill: "Unskilled", rates: { highly_skilled: 900000 } })}, '2000-01-01', 'live', 'test')
    returning id`) as any;
  await sql`update employees set wage_category = 'highly_skilled' where id = ${low.id}`;
  invalidateRules();
});
afterAll(async () => {
  if (runId) await sql`delete from payroll_runs where id = ${runId}`;
  await sql`delete from statutory_rules where id = ${ruleId}`;
  await sql`update employees set wage_category = null where id in (${low.id}, ${ok.id})`;
  invalidateRules();
  await sql.end();
});

describe("Minimum wage check", () => {
  it("lists everyone against the state minimum, shortfalls first", async () => {
    const r = await kunal.get("/admin/reports/min-wage-check");
    expect(r.status).toBe(200);
    const first = r.body.rows[0];
    expect(first[0]).toBe(low.code);
    expect(first).toEqual(expect.arrayContaining(["Gujarat", "Highly skilled", 900000, "Below minimum"]));
    const other = r.body.rows.find((x: any[]) => x[0] === ok.code);
    expect(other.slice(-2)).toEqual([0, "OK"]);
    expect(r.body.note).toMatch(/Compared on monthly basic/);
  });

  it("warns in the payroll calculation", async () => {
    const r = await krupa.post("/admin/payroll/runs", { month });
    expect(r.status).toBe(201);
    runId = r.body.id;
    await krupa.post(`/admin/payroll/runs/${runId}/calculate`);
    const [a] = await sql`select warnings from payroll_items where run_id = ${runId} and employee_id = ${low.id}`;
    expect((a!.warnings as string[]).some((w) => /Below the Gujarat minimum wage \(Highly skilled\): basic ₹[\d,]+ against ₹9,00,000/.test(w))).toBe(true);
    const [b] = await sql`select warnings from payroll_items where run_id = ${runId} and employee_id = ${ok.id}`;
    expect((b!.warnings as string[]).some((w) => /minimum wage/.test(w))).toBe(false);
  });

  it("warns when a salary revision is below it", async () => {
    const r = await krupa.post(`/admin/payroll/structures/${low.id}`, { effectiveFrom: "2099-01-01", annualCtc: 600000, reason: "Test" });
    expect(r.status).toBe(201);
    expect(r.body.warning).toMatch(/below the Gujarat minimum wage for highly skilled work/);
    const fine = await krupa.post(`/admin/payroll/structures/${ok.id}`, { effectiveFrom: "2099-01-01", annualCtc: 600000, reason: "Test" });
    expect(fine.body.warning).toBeNull();
    await sql`delete from salary_structures where effective_from = '2099-01-01' and employee_id in (${low.id}, ${ok.id})`;
  });
});
