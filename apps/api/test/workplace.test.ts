import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let priyaId = "", kunalId = "", tid = "";
let profile: unknown;

beforeAll(async () => {
  kunal = await login("kunal.shah@strats360.com");
  [{ tid }] = (await sql`select tenant_id as tid from employees where work_email = 'kunal.shah@strats360.com'`) as any;
  // a woman with payroll history and no leave in the dates used below
  [{ id: priyaId, p: profile }] = (await sql`select e.id, e.country_profile as p from employees e
    where e.tenant_id = ${tid} and e.gender = 'female' and e.status = 'active'
      and exists (select 1 from payroll_items i where i.employee_id = e.id)
      and not exists (select 1 from leave_requests r where r.employee_id = e.id and r.status in ('pending','approved') and r.end_date >= '2026-11-25' and r.start_date <= '2027-05-26')
    order by e.employee_code limit 1`) as any;
  [{ id: kunalId }] = (await sql`select id from employees where work_email = 'kunal.shah@strats360.com'`) as any;
});
afterAll(async () => {
  const types = (await sql`select id from leave_types where tenant_id = ${tid} and code in ('ML','MLE')`) as any[];
  for (const t of types) {
    await sql`delete from leave_requests where leave_type_id = ${t.id}`;
    await sql`delete from leave_balances where leave_type_id = ${t.id}`;
    await sql`delete from leave_types where id = ${t.id}`;
  }
  await sql`update employees set country_profile = ${profile === null ? null : sql.json(profile as any)} where id = ${priyaId}`;
  await sql.end();
});

describe("maternity benefit", () => {
  it("works out eligibility and pay from attendance and payroll", async () => {
    const r = await kunal.get(`/admin/compliance/workplace/maternity/${priyaId}?event=delivery&eventDate=2027-01-20&survivingChildren=0`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.daysWorkedLast12Months).toBeGreaterThanOrEqual(80);
    expect(r.body).toMatchObject({ eligible: true, weeks: 26, startDate: "2026-11-25", days: 182 });
    expect(r.body.averageDailyWage).toBeGreaterThan(0);
    expect((await kunal.get(`/admin/compliance/workplace/maternity/${kunalId}?event=delivery&eventDate=2027-01-20`)).status).toBe(400);
  });

  it("grants the leave, split at the year end", async () => {
    const g = await kunal.post(`/admin/compliance/workplace/maternity/${priyaId}`, { event: "delivery", eventDate: "2027-01-20", survivingChildren: 0 });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(g.body.requests).toHaveLength(2);
    const reqs = (await sql`select r.start_date::text as s, r.end_date::text as e, r.status, t.code from leave_requests r join leave_types t on t.id = r.leave_type_id where r.employee_id = ${priyaId} and t.code in ('ML','MLE') order by r.start_date`) as any[];
    expect(reqs.map((r) => [r.s, r.e, r.status])).toEqual([["2026-11-25", "2026-12-31", "approved"], ["2027-01-01", "2027-05-25", "approved"]]);
  });
});

describe("night shifts and health checks", () => {
  it("lists women on night shifts without consent, and checks due from 40", async () => {
    const n = await kunal.get("/admin/compliance/workplace/night-shifts");
    expect(n.status).toBe(200);
    expect(n.body).toHaveProperty("missing");
    const h = await kunal.get("/admin/compliance/workplace/health-checks");
    expect(h.status).toBe(200);
    for (const r of h.body.rows) expect(r.age).toBeGreaterThanOrEqual(40);
  });
});
