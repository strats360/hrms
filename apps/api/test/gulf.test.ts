import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
const entities: string[] = [];
const runs: string[] = [];
const emps: string[] = [];

beforeAll(async () => {
  // the Gulf site
  env.ALLOWED_COUNTRIES = "IN,AE,QA,KW,OM,BH";
  kunal = await login("kunal.shah@strats360.com");
});
afterAll(async () => {
  delete env.ALLOWED_COUNTRIES;
  if (runs.length) await sql`delete from payroll_runs where id in ${sql(runs)}`;
  if (emps.length) await sql`delete from employees where id in ${sql(emps)}`;
  if (entities.length) await sql`delete from legal_entities where id in ${sql(entities)}`;
  await sql.end();
});

async function setUp(country: string, name: string, registrations: Record<string, string>, people: { firstName: string; nationality: string; iban: string; bankName?: string; annualCtc: number; dateOfJoining?: string; id?: Record<string, string> }[]) {
  const ent = await kunal.post("/admin/org/entities", { name, country, registrations });
  expect(ent.status, JSON.stringify(ent.body)).toBe(201);
  entities.push(ent.body.id);
  const ids: string[] = [];
  for (const [i, p] of people.entries()) {
    const r = await kunal.post("/admin/employees", {
      firstName: p.firstName,
      lastName: "Test",
      nationality: p.nationality,
      workEmail: `${p.firstName.toLowerCase()}.${country.toLowerCase()}${i}@strats360.com`,
      dateOfJoining: p.dateOfJoining ?? "2020-01-01",
      entityId: ent.body.id,
      status: "active",
      annualCtc: p.annualCtc,
      accountNumber: p.iban,
      bankName: p.bankName,
      sendInvite: false,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    emps.push(r.body.id);
    ids.push(r.body.id);
    if (p.id) expect((await kunal.post(`/admin/employees/${r.body.id}/identities`, p.id)).status).toBe(201);
  }
  const run = await kunal.post("/admin/payroll/runs", { month: "2026-08", entityId: ent.body.id });
  expect(run.status).toBe(201);
  runs.push(run.body.id);
  await kunal.post(`/admin/payroll/runs/${run.body.id}/calculate`);
  await sql`update payroll_items set lop_override = 0 where run_id = ${run.body.id}`;
  expect((await kunal.post(`/admin/payroll/runs/${run.body.id}/calculate`)).status).toBe(200);
  const res = (await kunal.get(`/admin/payroll/runs/${run.body.id}/items`)).body;
  const items = res.items ?? res;
  return { runId: run.body.id as string, item: (n: number) => items.find((x: any) => x.employeeId === ids[n]) };
}

describe("Qatar", () => {
  it("pays a Qatari into GRSIA and builds the WPS file", async () => {
    const { runId, item } = await setUp("QA", "Strats360 Qatar WLL", { establishmentId: "123456", payerBank: "QNB", payerIban: "QA58DOHB00001234567890ABCDEFG" }, [
      { firstName: "Hamad", nationality: "QA", iban: "QA57CITI000010777100000000012", bankName: "CBQ", annualCtc: 240000, id: { type: "qid", number: "28463400001", expiresOn: "2030-01-01" } },
      { firstName: "Maria", nationality: "PH", iban: "QA57CITI000010777100000000099", bankName: "QIIB", annualCtc: 120000, id: { type: "qid", number: "28460800000", expiresOn: "2028-01-01" } },
    ]);
    expect(item(0).deductions.map((l: any) => [l.code, l.amount])).toEqual([["pension", 980]]);
    expect(item(1).deductions).toEqual([]);
    await sql`update payroll_runs set status = 'approved' where id = ${runId}`;
    const f = await kunal.file(`/admin/payroll/runs/${runId}/qatar-wps.csv`);
    expect(f.status).toBe(200);
    const rows = (await f.raw.text()).trim().split("\r\n");
    expect(rows[1]).toMatch(/^123456,\d{8},\d{4},123456,,QNB,QA58DOHB00001234567890ABCDEFG,202608,29020\.00,2,1$/);
    expect(rows).toContain("000001,28463400001,,Hamad Test,CBQ,QA57CITI000010777100000000012,M,31,19020.00,10000.00,0,10000.00,980.00,Normal Payment,");
  });
});

describe("Kuwait", () => {
  it("pays in fils with PIFSS for Kuwaitis", async () => {
    const { item } = await setUp("KW", "Strats360 Kuwait WLL", {}, [
      { firstName: "Sara", nationality: "KW", iban: "KW81CBKU0000000000001234560101", annualCtc: 24000 },
      { firstName: "Omar", nationality: "EG", iban: "KW81CBKU0000000000001234560102", annualCtc: 12000 },
    ]);
    expect(item(0).deductions.map((l: any) => [l.code, l.amount])).toEqual([["pension", 210]]);
    expect(Number(item(0).net)).toBe(1790);
    expect(Number(item(1).net)).toBe(1000);
  });
});

describe("Bahrain", () => {
  it("charges the employer the monthly leaving indemnity for expats", async () => {
    const { item } = await setUp("BH", "Strats360 Bahrain WLL", {}, [
      { firstName: "Ravi", nationality: "IN", iban: "BH67BMAG00001299123456", annualCtc: 12000, dateOfJoining: "2025-01-01" },
      { firstName: "Ali", nationality: "BH", iban: "BH67BMAG00001299123457", annualCtc: 12000 },
    ]);
    expect(item(0).employer.map((l: any) => [l.code, l.amount])).toEqual([["injury_er", 30], ["unemployment_er", 10], ["indemnity_er", 42]]);
    expect(item(1).deductions.map((l: any) => [l.code, l.amount])).toEqual([["pension", 60], ["unemployment", 10]]);
  });
});
