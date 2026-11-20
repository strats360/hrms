import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let entityId = "";
let runId = "";
const emps: string[] = [];

beforeAll(async () => {
  // a Saudi site
  env.ALLOWED_COUNTRIES = "IN,SA";
  kunal = await login("kunal.shah@strats360.com");
});
afterAll(async () => {
  delete env.ALLOWED_COUNTRIES;
  if (runId) await sql`delete from payroll_runs where id = ${runId}`;
  if (emps.length) await sql`delete from employees where id in ${sql(emps)}`;
  if (entityId) await sql`delete from legal_entities where id = ${entityId}`;
  await sql.end();
});

describe("a Saudi entity", () => {
  it("can be set up with its registrations", async () => {
    const r = await kunal.post("/admin/org/entities", {
      name: "Strats360 Arabia LLC",
      country: "SA",
      state: "Riyadh",
      registrations: { crNumber: "1010123456", mhrsdId: "1-123456", gosiNumber: "501234567", vatNumber: "300000000000003" },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ currency: "SAR", timeZone: "Asia/Riyadh" });
    entityId = r.body.id;
  });

  it("pays a Saudi and an expat in its own payroll run, with GOSI", async () => {
    const people = [
      { firstName: "Fahad", lastName: "Al Otaibi", nationality: "SA", iban: "SA0380000000608010167519", id: { type: "saudi_id", number: "1012345678", expiresOn: "2030-01-01" }, gosi: "2025-02-01" },
      { firstName: "Anil", lastName: "Kumar", nationality: "IN", iban: "SA4420000001234567891234", id: { type: "iqama", number: "2123456789", expiresOn: "2027-06-30" }, gosi: null },
    ];
    for (const [i, p] of people.entries()) {
      const r = await kunal.post("/admin/employees", {
        firstName: p.firstName,
        lastName: p.lastName,
        nationality: p.nationality,
        workEmail: `${p.firstName.toLowerCase()}.ksa${i}@strats360.com`,
        dateOfJoining: "2020-01-01",
        entityId,
        status: "active",
        annualCtc: 240000,
        pfApplicable: true,
        esiApplicable: false,
        accountNumber: p.iban,
        sendInvite: false,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      emps.push(r.body.id);
      expect((await kunal.post(`/admin/employees/${r.body.id}/identities`, p.id)).status).toBe(201);
      if (p.gosi) expect((await kunal.post(`/admin/employees/${r.body.id}/identities`, { type: "gosi", number: "123456789", issuedOn: p.gosi })).status).toBe(201);
    }

    const run = await kunal.post("/admin/payroll/runs", { month: "2026-08", entityId });
    expect(run.status).toBe(201);
    runId = run.body.id;
    expect((await kunal.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);
    // pay the full month whatever attendance says
    await sql`update payroll_items set lop_override = 0 where run_id = ${runId}`;
    expect((await kunal.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);

    const res = (await kunal.get(`/admin/payroll/runs/${runId}/items`)).body;
    const items = res.items ?? res;
    const fahad = items.find((x: any) => x.employeeId === emps[0]);
    const anil = items.find((x: any) => x.employeeId === emps[1]);
    // first insured in 2025, so the new law's 10% from July 2026, on basic plus housing (14,000)
    expect(fahad.deductions.map((l: any) => [l.code, l.amount])).toEqual([["gosi", 1400], ["saned", 105]]);
    expect(Number(fahad.net)).toBe(18495);
    expect(anil.deductions).toEqual([]);
    expect(anil.employer.map((l: any) => [l.code, l.amount])).toEqual([["hazards_er", 280]]);
    expect(Number(anil.net)).toBe(20000);
    for (const it of [fahad, anil]) expect(it.warnings.join(" ")).not.toMatch(/PAN|minimum wage|bank account/);
  });

  it("builds the Mudad salary sheet once the payroll is locked", async () => {
    expect((await kunal.get(`/admin/payroll/runs/${runId}/mudad.csv`)).status).toBe(400);
    await sql`update payroll_runs set status = 'approved' where id = ${runId}`;
    expect((await kunal.get(`/admin/payroll/runs/${runId}/wps.sif`)).body.error.message).toMatch(/UAE entities only/);
    const f = await kunal.file(`/admin/payroll/runs/${runId}/mudad.csv`);
    expect(f.status).toBe(200);
    expect(f.headers.get("Content-Disposition")).toMatch(/mudad-1-123456-2026-08\.csv/);
    const lines = (await f.raw.text()).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines).toContain("1012345678,Fahad Al Otaibi,SA0380000000608010167519,10000.00,4000.00,6000.00,1505.00,18495.00");
    expect(lines).toContain("2123456789,Anil Kumar,SA4420000001234567891234,10000.00,4000.00,6000.00,0.00,20000.00");
  });

  it("shows Saudization", async () => {
    const e = (await kunal.get("/admin/org/entities")).body.entities.find((x: any) => x.id === entityId);
    expect(e.saudization).toMatchObject({ nationals: 1, counted: 1, share: 0.5, belowFullWage: 0 });
    expect(e.emiratisation).toBeNull();
  });
});
