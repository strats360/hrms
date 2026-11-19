import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let entityId = "";
let runId = "";
const emps: string[] = [];

beforeAll(async () => {
  // a Gulf site: India and the UAE
  env.ALLOWED_COUNTRIES = "IN,AE";
  kunal = await login("kunal.shah@strats360.com");
});
afterAll(async () => {
  delete env.ALLOWED_COUNTRIES;
  if (runId) await sql`delete from payroll_runs where id = ${runId}`;
  if (emps.length) await sql`delete from employees where id in ${sql(emps)}`;
  if (entityId) await sql`delete from legal_entities where id = ${entityId}`;
  await sql.end();
});

describe("a UAE entity", () => {
  it("can be set up with its emirate and registrations", async () => {
    const r = await kunal.post("/admin/org/entities", {
      name: "Strats360 FZ LLC",
      country: "AE",
      state: "Dubai",
      registrations: { mohreId: "1234567890123", wpsRoutingCode: "803320101", trn: "100000000000003" },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ currency: "AED", timeZone: "Asia/Dubai" });
    entityId = r.body.id;
  });

  it("pays an Emirati and an expat in its own payroll run", async () => {
    const people = [
      { firstName: "Mariam", lastName: "Al Mansoori", nationality: "AE", accountNumber: "AE070331234567890123456", person: "12345678901234" },
      { firstName: "Rahul", lastName: "Nair", nationality: "IN", accountNumber: "AE460090000000123456789", person: "98765432109876" },
    ];
    for (const [i, p] of people.entries()) {
      const r = await kunal.post("/admin/employees", {
        firstName: p.firstName,
        lastName: p.lastName,
        nationality: p.nationality,
        workEmail: `${p.firstName.toLowerCase()}.uae${i}@strats360.com`,
        dateOfJoining: "2020-01-01",
        entityId,
        status: "active",
        annualCtc: 240000,
        pfApplicable: true,
        esiApplicable: false,
        accountNumber: p.accountNumber,
        ifsc: "803320101",
        sendInvite: false,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      emps.push(r.body.id);
      expect((await kunal.post(`/admin/employees/${r.body.id}/identities`, { type: "mohre_person_id", number: p.person })).status).toBe(201);
    }

    const run = await kunal.post("/admin/payroll/runs", { month: "2020-03", entityId });
    expect(run.status).toBe(201);
    runId = run.body.id;
    // the Indian entity's March 2020 is a separate run
    expect((await kunal.post("/admin/payroll/runs", { month: "2020-03", entityId })).status).toBe(409);
    expect((await kunal.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);
    // no attendance was kept in 2020: pay the full month (overrides survive a recalculation)
    await sql`update payroll_items set lop_override = 0 where run_id = ${runId}`;
    expect((await kunal.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);

    const res = (await kunal.get(`/admin/payroll/runs/${runId}/items`)).body;
    const items = res.items ?? res;
    expect(items).toHaveLength(2);
    const mariam = items.find((x: any) => x.employeeId === emps[0]);
    const rahul = items.find((x: any) => x.employeeId === emps[1]);
    // GPSSA for the national, on the contribution salary, nothing Indian for anyone
    const codes = (lines: any[]) => lines.map((l) => l.code);
    expect(codes(mariam.deductions)).toContain("pension");
    expect(codes(mariam.employer)).toContain("pension_er");
    expect(codes(rahul.deductions)).not.toContain("pension");
    for (const it of [mariam, rahul]) {
      expect(codes(it.deductions)).not.toContain("pf");
      expect(codes(it.deductions)).not.toContain("pt");
      expect(Number(it.tds)).toBe(0);
      expect(it.warnings.join(" ")).not.toMatch(/PAN|minimum wage/);
    }
    // nobody's CTC lost an employer PF share
    expect(Number(rahul.gross)).toBe(20000);
    expect(Number(rahul.net)).toBe(20000);

    const runs = (await kunal.get("/admin/payroll/runs")).body;
    expect(runs.find((r: any) => r.id === runId)).toMatchObject({ entityName: "Strats360 FZ LLC", currency: "AED", country: "AE" });
  });

  it("builds the WPS salary file once the payroll is locked", async () => {
    expect((await kunal.get(`/admin/payroll/runs/${runId}/wps.sif`)).status).toBe(400);
    await sql`update payroll_runs set status = 'approved' where id = ${runId}`;
    const f = await kunal.file(`/admin/payroll/runs/${runId}/wps.sif`);
    expect(f.status).toBe(200);
    expect(f.headers.get("Content-Disposition")).toMatch(/filename="1234567890123\d{12}\.SIF"/);
    const lines = (await f.raw.text()).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^EDR,12345678901234,803320101,AE070331234567890123456,2020-03-01,2020-03-31,31,/);
    expect(lines[2]).toMatch(/^SCR,1234567890123,803320101,.*,032020,2,.*,AED,/);

    // a missing person code stops the file with a clear reason
    await sql`delete from employee_identities where employee_id = ${emps[1]!}`;
    const bad = await kunal.get(`/admin/payroll/runs/${runId}/wps.sif`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Rahul Nair: the MOHRE person code/);
  });

  it("shows where the entity stands on Emiratisation", async () => {
    const e = (await kunal.get("/admin/org/entities")).body.entities.find((x: any) => x.id === entityId);
    expect(e.emiratisation).toMatchObject({ nationals: 1, applies: false });
    expect(e.emiratisation.share).toBe(0.5);
    expect((await kunal.get("/admin/org/entities")).body.entities.find((x: any) => x.isDefault).emiratisation).toBeNull();
  });
});
