import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
const entities: string[] = [];
const runs: string[] = [];
const emps: string[] = [];

beforeAll(async () => {
  env.ALLOWED_COUNTRIES = "IN,CA";
  kunal = await login("kunal.shah@strats360.com");
});
afterAll(async () => {
  delete env.ALLOWED_COUNTRIES;
  if (runs.length) await sql`delete from payroll_runs where id in ${sql(runs)}`;
  if (emps.length) await sql`delete from employees where id in ${sql(emps)}`;
  if (entities.length) await sql`delete from legal_entities where id in ${sql(entities)}`;
  await sql.end();
});

const lines = (l: any[]) => Object.fromEntries(l.map((x) => [x.code, x.amount]));

async function setUp(name: string, province: string, people: { firstName: string; annualCtc: number; countryProfile?: Record<string, unknown> }[]) {
  const ent = await kunal.post("/admin/org/entities", { name, country: "CA", state: province, registrations: { businessNumber: "123456789" } });
  expect(ent.status, JSON.stringify(ent.body)).toBe(201);
  entities.push(ent.body.id);
  const ids: string[] = [];
  for (const [i, p] of people.entries()) {
    const r = await kunal.post("/admin/employees", { ...p, lastName: "Test", workEmail: `${p.firstName.toLowerCase()}.ca${entities.length}${i}@strats360.com`, dateOfJoining: "2025-03-03", entityId: ent.body.id, status: "active", accountNumber: "1234567", ifsc: "12345003", sendInvite: false });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    emps.push(r.body.id);
    ids.push(r.body.id);
  }
  const run = await kunal.post("/admin/payroll/runs", { month: "2026-01", entityId: ent.body.id });
  expect(run.status).toBe(201);
  runs.push(run.body.id);
  await kunal.post(`/admin/payroll/runs/${run.body.id}/calculate`);
  await sql`update payroll_items set lop_override = 0 where run_id = ${run.body.id}`;
  expect((await kunal.post(`/admin/payroll/runs/${run.body.id}/calculate`)).status).toBe(200);
  const res = (await kunal.get(`/admin/payroll/runs/${run.body.id}/items`)).body;
  const items = (res.items ?? res) as any[];
  return { ids, item: (n: number) => items.find((x) => x.employeeId === ids[n]) };
}

describe("a Canadian entity", () => {
  it("pays federal and Ontario tax, CPP and EI in Ontario", async () => {
    const bad = await kunal.post("/admin/org/entities", { name: "Nope", country: "CA", timeZone: "Asia/Dubai" });
    expect(bad.status).toBe(400);
    const { ids, item } = await setUp("Strats360 Canada Inc", "Ontario", [{ firstName: "Liam", annualCtc: 60000, countryProfile: {} }, { firstName: "Noah", annualCtc: 60000, countryProfile: { extraTax: 100 } }]);
    const liam = item(0);
    expect(liam.earnings).toEqual([{ code: "basic", label: "Salary", amount: 5000 }]);
    expect(lines(liam.deductions)).toEqual({ fed_tax: 444.86, prov_tax: 248.52, cpp: 280.15, ei: 81.5 });
    expect(lines(liam.employer)).toEqual({ cpp_er: 280.15, ei_er: 114.1 });
    expect(Number(liam.net)).toBe(3944.97);
    expect(lines(item(1).deductions).fed_tax).toBe(544.86);
    expect(liam.warnings.join(" ")).not.toMatch(/PAN|minimum wage|bank account|income tax isn't/);
    const emp = (await kunal.get(`/admin/employees/${ids[0]}`)).body;
    expect(emp.ifsc).toBe("12345-003");
    expect(emp.countryProfile).toMatchObject({ federalClaim: null, extraTax: 0, cppExempt: false });
    expect((await kunal.patch(`/admin/employees/${ids[0]}`, { countryProfile: { extraTax: -5 } })).status).toBe(400);
  });

  it("uses QPP, QPIP and Quebec's EI rate in Quebec", async () => {
    const { item } = await setUp("Strats360 Québec Inc", "Quebec", [{ firstName: "Chloe", annualCtc: 60000, countryProfile: {} }]);
    expect(lines(item(0).deductions)).toEqual({ fed_tax: 370.91, cpp: 301.33, ei: 65, qpip: 24.7 });
    expect(item(0).warnings.join(" ")).toMatch(/Quebec income tax isn't worked out/);
  });
});
