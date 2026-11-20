import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let entityId = "";
const runs: string[] = [];
const emps: string[] = [];

beforeAll(async () => {
  env.ALLOWED_COUNTRIES = "IN,US";
  kunal = await login("kunal.shah@strats360.com");
});
afterAll(async () => {
  delete env.ALLOWED_COUNTRIES;
  if (runs.length) await sql`delete from payroll_runs where id in ${sql(runs)}`;
  if (emps.length) await sql`delete from employees where id in ${sql(emps)}`;
  if (entityId) await sql`delete from legal_entities where id = ${entityId}`;
  await sql.end();
});

async function runMonth(month: string) {
  const run = await kunal.post("/admin/payroll/runs", { month, entityId });
  expect(run.status, JSON.stringify(run.body)).toBe(201);
  runs.push(run.body.id);
  await kunal.post(`/admin/payroll/runs/${run.body.id}/calculate`);
  await sql`update payroll_items set lop_override = 0 where run_id = ${run.body.id}`;
  expect((await kunal.post(`/admin/payroll/runs/${run.body.id}/calculate`)).status).toBe(200);
  const res = (await kunal.get(`/admin/payroll/runs/${run.body.id}/items`)).body;
  return { id: run.body.id as string, items: (res.items ?? res) as any[] };
}
const lines = (l: any[]) => Object.fromEntries(l.map((x) => [x.code, x.amount]));

describe("a US entity", () => {
  it("keeps each employee's W-4", async () => {
    const ent = await kunal.post("/admin/org/entities", { name: "Strats360 Inc", country: "US", state: "Texas", timeZone: "America/Chicago", registrations: { ein: "12-3456789" } });
    expect(ent.status, JSON.stringify(ent.body)).toBe(201);
    expect(ent.body).toMatchObject({ currency: "USD", timeZone: "America/Chicago" });
    entityId = ent.body.id;
    const base = { lastName: "Test", dateOfJoining: "2025-06-02", entityId, status: "active", accountNumber: "000123456789", ifsc: "021000021", sendInvite: false };
    const bad = await kunal.post("/admin/employees", { ...base, firstName: "Bad", workEmail: "bad.us@strats360.com", annualCtc: 60000, countryProfile: { filingStatus: "widowed" } });
    expect(bad.status).toBe(400);
    for (const [i, p] of [
      { firstName: "Emma", annualCtc: 60000, countryProfile: { filingStatus: "single" } },
      { firstName: "Jacob", annualCtc: 90000, countryProfile: { filingStatus: "married", k401Percent: 6, preTaxHealth: 250 } },
    ].entries()) {
      const r = await kunal.post("/admin/employees", { ...base, ...p, workEmail: `${p.firstName.toLowerCase()}.us${i}@strats360.com` });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      emps.push(r.body.id);
    }
    expect((await kunal.get(`/admin/employees/${emps[1]}`)).body.countryProfile).toMatchObject({ filingStatus: "married", k401Percent: 6, multipleJobs: false, exempt: false });
  });

  it("withholds federal tax and FICA, with no Indian rules and a calendar tax year", async () => {
    // December is the last month of the US tax year, so it mustn't carry into January
    const dec = await runMonth("2025-12");
    await sql`update payroll_runs set status = 'approved' where id = ${dec.id}`;
    const { items } = await runMonth("2026-01");
    const emma = items.find((x) => x.employeeId === emps[0]);
    const jacob = items.find((x) => x.employeeId === emps[1]);
    expect(emma.earnings).toEqual([{ code: "basic", label: "Salary", amount: 5000 }]);
    expect(lines(emma.deductions)).toEqual({ fit: 418.33, ss: 310, medicare: 72.5 });
    expect(lines(emma.employer)).toEqual({ ss_er: 310, medicare_er: 72.5, futa_er: 30 }); // FUTA starts again in January
    expect(Number(emma.net)).toBe(4199.17);
    expect(lines(jacob.deductions)).toMatchObject({ k401: 450, health: 250, ss: 449.5 });
    for (const it of [emma, jacob]) expect(it.warnings.join(" ")).not.toMatch(/PAN|minimum wage|bank account|W-4|Texas income tax/);
    expect(emma.warnings.join(" ")).toMatch(/Texas unemployment insurance \(SUI\)/);
  });
});
