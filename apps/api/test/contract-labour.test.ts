import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let kid = "";

beforeAll(async () => {
  kunal = await login("kunal.shah@strats360.com");
  const r = await kunal.post("/admin/contractors", { name: "Shree Facility Services", kind: "company", section: "194C" });
  kid = r.body.id;
});
afterAll(async () => {
  await sql`delete from contractors where id = ${kid}`;
  await sql.end();
});

describe("contract labour", () => {
  it("tracks a labour contractor's workers and monthly checks", async () => {
    expect((await kunal.req("PUT", `/admin/compliance/contract-labour/contractors/${kid}`, { suppliesLabour: true, workNature: "Housekeeping", contractFrom: "2026-04-01", contractTo: "2027-03-31" })).status).toBe(200);
    expect((await kunal.post(`/admin/compliance/contract-labour/contractors/${kid}/workers`, { name: "Ramesh", gender: "male", joinedOn: "2026-04-01", dailyWage: 650, aadhaarLast4: "12345" })).status).toBe(422);
    for (const n of ["Ramesh Patel", "Sunita Rathod"]) expect((await kunal.post(`/admin/compliance/contract-labour/contractors/${kid}/workers`, { name: n, gender: n.startsWith("S") ? "female" : "male", joinedOn: "2026-04-01", dailyWage: 650 })).status).toBe(201);
    const before = (await kunal.get("/admin/compliance/contract-labour")).body;
    const row = before.rows.find((r: any) => r.contractorId === kid);
    expect(row.workers).toBe(2);
    expect(row.issues.join(" ")).toMatch(/wages/);
    const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
    const month = prev.toISOString().slice(0, 7);
    expect((await kunal.req("PUT", `/admin/compliance/contract-labour/contractors/${kid}/months`, { month, workers: 2, wagesPaidOn: `${new Date().toISOString().slice(0, 7)}-05`, pfChallan: "PF-1", esiChallan: "ESI-1" })).status).toBe(200);
    const after = (await kunal.get("/admin/compliance/contract-labour")).body.rows.find((r: any) => r.contractorId === kid);
    expect(after.issues).toEqual([]);
    const f = await kunal.file("/admin/compliance/contract-labour/register.csv");
    expect(await f.raw.text()).toMatch(/Shree Facility Services,,Housekeeping,Ramesh Patel,male/);
  });
});
