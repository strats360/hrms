import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
const entities: string[] = [];
const emps: string[] = [];

beforeAll(async () => {
  env.ALLOWED_COUNTRIES = "IN,US";
  kunal = await login("kunal.shah@strats360.com");
});
afterAll(async () => {
  delete env.ALLOWED_COUNTRIES;
  if (entities.length) await sql`delete from payroll_runs where entity_id in ${sql(entities)}`;
  if (emps.length) await sql`delete from employees where id in ${sql(emps)}`;
  if (entities.length) await sql`delete from legal_entities where id in ${sql(entities)}`;
  await sql.end();
});

async function entityWithEmployee(name: string, payFrequency: string, payAnchor: string | null) {
  const ent = await kunal.post("/admin/org/entities", { name, country: "US", state: "Texas", timeZone: "America/Chicago", payFrequency, payAnchor });
  expect(ent.status, JSON.stringify(ent.body)).toBe(201);
  entities.push(ent.body.id);
  const r = await kunal.post("/admin/employees", { firstName: name.split(" ")[0], lastName: "Test", workEmail: `${name.replace(/\W/g, "").toLowerCase()}@strats360.com`, dateOfJoining: "2025-06-02", entityId: ent.body.id, status: "active", annualCtc: 60000, accountNumber: "000123456789", ifsc: "021000021", countryProfile: { filingStatus: "single" }, sendInvite: false });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  emps.push(r.body.id);
  return { entityId: ent.body.id as string, employeeId: r.body.id as string };
}

async function calculate(runId: string) {
  await kunal.post(`/admin/payroll/runs/${runId}/calculate`);
  await sql`update payroll_items set lop_override = 0 where run_id = ${runId}`;
  expect((await kunal.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);
  const res = (await kunal.get(`/admin/payroll/runs/${runId}/items`)).body;
  return (res.items ?? res)[0];
}

describe("pay frequency", () => {
  it("only allows shorter periods where the country's rules support them", async () => {
    expect((await kunal.post("/admin/org/entities", { name: "Nope Pvt Ltd", country: "IN", payFrequency: "biweekly", payAnchor: "2026-01-05" })).body.error.message).toMatch(/monthly only/);
    expect((await kunal.post("/admin/org/entities", { name: "Nope Inc", country: "US", payFrequency: "biweekly" })).body.error.message).toMatch(/first day of any one pay period/);
  });

  it("runs biweekly payroll period by period, with tax annualised over 26 pays", async () => {
    const { entityId } = await entityWithEmployee("Biweekly Inc", "biweekly", "2026-01-05");
    expect((await kunal.post("/admin/payroll/runs", { entityId, periodStart: "2026-01-12" })).body.error.message).toMatch(/isn't the first day of a pay period/);
    const first = await kunal.post("/admin/payroll/runs", { entityId, periodStart: "2026-01-19" });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ frequency: "biweekly", periodStart: "2026-01-19", periodEnd: "2026-02-01", month: "2026-02", payDate: "2026-02-06" });
    const item = await calculate(first.body.id);
    expect(Number(item.daysInMonth)).toBe(14);
    expect(Number(item.gross)).toBe(2307.69);
    expect(item.deductions.find((d: any) => d.code === "fit").amount).toBeCloseTo(5020 / 26, 1);
    expect(item.deductions.find((d: any) => d.code === "ss").amount).toBe(143.08);

    // an open run blocks the next one, and asking for "the next run" returns the open one
    expect((await kunal.post("/admin/payroll/runs", { entityId, periodStart: "2026-02-02" })).body.error.message).toMatch(/Finish the 19 Jan to 1 Feb 2026 payroll/);
    expect((await kunal.post("/admin/payroll/runs", { entityId })).body.id).toBe(first.body.id);
    // and changing how often the entity pays waits until it's done
    const ent = (await kunal.get("/admin/org/entities")).body.entities.find((e: any) => e.id === entityId);
    expect((await kunal.patch(`/admin/org/entities/${entityId}`, { ...ent, payFrequency: "weekly" })).status).toBe(409);

    await sql`update payroll_runs set status = 'approved' where id = ${first.body.id}`;
    const next = await kunal.post("/admin/payroll/runs", { entityId });
    expect(next.status).toBe(201);
    expect(next.body).toMatchObject({ periodStart: "2026-02-02", periodEnd: "2026-02-15", month: "2026-02" });
    const second = await calculate(next.body.id);
    expect(Number(second.gross)).toBe(2307.69);
    const list = (await kunal.get("/admin/payroll/runs")).body.filter((r: any) => r.entityId === entityId);
    expect(list).toHaveLength(2); // two runs in February
  });

  it("pays twice a month on the 15th and the last day", async () => {
    const { entityId } = await entityWithEmployee("Semimonthly Inc", "semi_monthly", null);
    const a = await kunal.post("/admin/payroll/runs", { entityId, periodStart: "2026-03-01" });
    expect(a.body).toMatchObject({ periodEnd: "2026-03-15", payDate: "2026-03-15", month: "2026-03" });
    const item = await calculate(a.body.id);
    expect(Number(item.gross)).toBe(2500);
    expect(Number(item.daysInMonth)).toBe(15);
    await sql`update payroll_runs set status = 'approved' where id = ${a.body.id}`;
    const b = await kunal.post("/admin/payroll/runs", { entityId });
    expect(b.body).toMatchObject({ periodStart: "2026-03-16", periodEnd: "2026-03-31", payDate: "2026-03-31" });
  });
});
