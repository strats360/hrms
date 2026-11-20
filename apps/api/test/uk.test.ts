import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let entityId = "";
const runs: string[] = [];
const emps: string[] = [];

beforeAll(async () => {
  env.ALLOWED_COUNTRIES = "IN,GB";
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

describe("a UK entity", () => {
  it("checks UK payroll details against the entity's country", async () => {
    const ent = await kunal.post("/admin/org/entities", { name: "Strats360 UK Ltd", country: "GB", state: "England", registrations: { payeReference: "123/AB45678" } });
    expect(ent.status).toBe(201);
    expect(ent.body).toMatchObject({ currency: "GBP", timeZone: "Europe/London" });
    entityId = ent.body.id;
    const base = { lastName: "Test", dateOfJoining: "2024-01-08", entityId, status: "active", accountNumber: "31926819", ifsc: "601613", sendInvite: false };
    const bad = await kunal.post("/admin/employees", { ...base, firstName: "Bad", workEmail: "bad.uk@strats360.com", annualCtc: 36000, countryProfile: { taxCode: "12X" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/tax code like 1257L/);
    for (const [i, p] of [
      { firstName: "Olivia", annualCtc: 36000, countryProfile: { taxCode: "1257L" } },
      { firstName: "Callum", annualCtc: 42000, countryProfile: { taxCode: "S1257L", studentLoans: ["plan2"] } },
    ].entries()) {
      const r = await kunal.post("/admin/employees", { ...base, ...p, workEmail: `${p.firstName.toLowerCase()}.uk${i}@strats360.com` });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      emps.push(r.body.id);
      expect((await kunal.post(`/admin/employees/${r.body.id}/identities`, { type: "ni_number", number: i ? "AB 12 34 56 D" : "QQ123456C" })).status).toBe(201);
    }
    // the sort code is stored in its usual form, and the profile comes back with its defaults
    const olivia = (await kunal.get(`/admin/employees/${emps[0]}`)).body;
    expect(olivia.ifsc).toBe("60-16-13");
    expect(olivia.countryProfile).toMatchObject({ taxCode: "1257L", niCategory: "A", studentLoans: [], pensionOptOut: false });
  });

  it("runs PAYE, NI, student loans and pension, one salary line each", async () => {
    const { id, items } = await runMonth("2026-04");
    const olivia = items.find((x) => x.employeeId === emps[0]);
    const callum = items.find((x) => x.employeeId === emps[1]);
    expect(olivia.earnings).toEqual([{ code: "basic", label: "Salary", amount: 3000 }]);
    const lines = (l: any[]) => Object.fromEntries(l.map((x) => [x.code, x.amount]));
    expect(lines(olivia.deductions)).toEqual({ paye: 390.2, ni: 156.16, pension: 99.2 });
    expect(lines(olivia.employer)).toEqual({ ni_er: 387.45, pension_er: 74.4 });
    expect(Number(olivia.net)).toBe(2354.44);
    expect(lines(callum.deductions)).toMatchObject({ sl_plan2: 101 });
    expect(callum.deductions.find((d: any) => d.code === "paye").label).toBe("Income tax (S1257L)");
    for (const it of [olivia, callum]) expect(it.warnings.join(" ")).not.toMatch(/PAN|minimum wage|bank account|tax code/);
    await sql`update payroll_runs set status = 'approved' where id = ${id}`;
  });

  it("carries tax to date into the next month and exports the RTI summary", async () => {
    const { id, items } = await runMonth("2026-05");
    const olivia = items.find((x) => x.employeeId === emps[0]);
    expect(olivia.deductions.find((d: any) => d.code === "paye").amount).toBe(390.4); // cumulative: 20% of 6,000 − 2,096.50 to whole pounds, less April's 390.20
    const f = await kunal.file(`/admin/payroll/runs/${id}/rti.csv`);
    expect(f.status).toBe(200);
    expect(f.headers.get("Content-Disposition")).toMatch(/rti-2026-27-month2\.csv/);
    const rows = (await f.raw.text()).trim().split(/\r?\n/);
    expect(rows[0]).toMatch(/^Employee ID,Name,NI number,Tax code,NI category,Tax month,Taxable pay,Taxable pay to date,Tax,Tax to date/);
    const row = rows.find((r) => r.includes("QQ123456C"))!;
    expect(row).toMatch(/,QQ123456C,1257L,A,2,3000\.00,6000\.00,390\.40,780\.60,156\.16,312\.32,387\.45,774\.90,0\.00,0\.00,99\.20,74\.40,2354\.24$/);
  });
});
