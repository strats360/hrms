import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let krupa: Client;
let runId = "";

beforeAll(async () => {
  krupa = await login("krupa.joshi@strats360.com");
  [{ id: runId }] = (await sql`select r.id from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142' and r.status = 'paid' and r.kind = 'regular' order by r.month desc limit 1`) as any;
});
afterAll(async () => {
  await sql.end();
});

describe("payroll journal", () => {
  it("balances, with PF, PT and TDS owed and net pay due", async () => {
    const j = (await krupa.get(`/admin/payroll/runs/${runId}/journal`)).body;
    expect(j.totals.debit).toBe(j.totals.credit);
    expect(j.totals.debit).toBeGreaterThan(0);
    const accounts = j.lines.map((l: any) => l.account);
    expect(accounts).toEqual(expect.arrayContaining(["Salaries and wages", "Employer contributions", "Provident fund payable", "Professional tax payable", "TDS on salary payable", "Salaries payable"]));
    const [{ net, gross }] = (await sql`select sum(net)::float as net, sum(gross)::float as gross from payroll_items where run_id = ${runId} and not on_hold`) as any;
    expect(j.lines.find((l: any) => l.account === "Salaries payable").credit).toBeCloseTo(net, 0);
    expect(j.lines.find((l: any) => l.account === "Salaries and wages").debit).toBeCloseTo(gross, 0);
  });

  it("exports for Zoho Books and Tally", async () => {
    const z = await krupa.file(`/admin/payroll/runs/${runId}/journal.csv?format=zoho`);
    expect(z.status).toBe(200);
    const text = await z.raw.text();
    expect(text.split("\n")[0]).toMatch(/^Journal Date,Reference Number,Notes,Journal Type,Currency,Account,Description,Debit,Credit/);
    expect(text).toMatch(/,INR,Salaries payable,/);
    const t = await krupa.file(`/admin/payroll/runs/${runId}/journal.xml`);
    const xml = await t.raw.text();
    expect(xml).toMatch(/<VOUCHER VCHTYPE="Journal" ACTION="Create">/);
    expect(xml).toMatch(/<LEDGERNAME>Salaries and wages<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-/);
  });
});
