import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, hardik: Client;
let tenantId = "", defaultId = "", secondId = "", empId = "";

beforeAll(async () => {
  [kunal, hardik] = await Promise.all(["kunal.shah", "hardik.mehta"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId }] = (await sql`select tenant_id from employees where work_email = 'kunal.shah@strats360.com'`) as any;
});
afterAll(async () => {
  if (empId) await sql`delete from employees where id = ${empId}`;
  await sql`delete from legal_entities where tenant_id = ${tenantId} and not is_default`;
  await sql.end();
});

describe("legal entities", () => {
  it("gives every company a default entity made from its details", async () => {
    const r = await kunal.get("/admin/org/entities");
    expect(r.status).toBe(200);
    const d = r.body.entities.find((e: any) => e.isDefault);
    defaultId = d.id;
    expect(d).toMatchObject({ code: "E01", country: "IN", currency: "INR", timeZone: "Asia/Kolkata", countryName: "India" });
    expect(d.registrations).toMatchObject({ gstin: "24ABCFS1234K1Z5", pan: "ABCFS1234K", tan: "AHMS12345B" });
    expect(d.employees).toBeGreaterThan(200);
    expect(r.body.countries.map((x: any) => x.code)).toEqual(["IN"]);
    const [{ n }] = await sql`select count(*)::int as n from tenants t where not exists (select 1 from legal_entities e where e.tenant_id = t.id and e.is_default)`;
    expect(n).toBe(0);
  });

  it("keeps the default entity and the company profile in step", async () => {
    expect((await kunal.patch("/admin/org/tenant", { tan: "AHMS54321B" })).status).toBe(200);
    let d = (await kunal.get("/admin/org/entities")).body.entities.find((e: any) => e.isDefault);
    expect(d.registrations.tan).toBe("AHMS54321B");
    // and the other way round
    const r = await kunal.patch(`/admin/org/entities/${defaultId}`, { name: d.name, legalName: d.legalName, country: "IN", state: d.state, address: d.address, registrations: { ...d.registrations, tan: "AHMS12345B" } });
    expect(r.status).toBe(200);
    expect((await kunal.get("/admin/org/tenant")).body.tan).toBe("AHMS12345B");
    d = (await kunal.get("/admin/org/entities")).body.entities.find((e: any) => e.isDefault);
    expect(d.registrations.tan).toBe("AHMS12345B");
  });

  it("only allows countries this site supports", async () => {
    const ae = await kunal.post("/admin/org/entities", { name: "Strats360 FZ LLC", country: "AE" });
    expect(ae.status).toBe(400);
    expect(ae.body.error.message).toMatch(/isn't supported yet/);
    expect((await kunal.post("/admin/org/entities", { name: "Wrong zone", country: "IN", timeZone: "Asia/Dubai" })).status).toBe(400);
    expect((await hardik.post("/admin/org/entities", { name: "Nope", country: "IN" })).status).toBe(403);
    const r = await kunal.post("/admin/org/entities", { name: "Strats360 Labs Pvt Ltd", country: "IN", registrations: { pan: "AAICS1111A" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: "E02", currency: "INR", timeZone: "Asia/Kolkata", isDefault: false });
    secondId = r.body.id;
  });

  it("puts employees in an entity and protects entities that are in use", async () => {
    // an entity that isn't this company's
    const bad = await kunal.post("/admin/employees", { firstName: "Asha", workEmail: "asha.entity@strats360.com", dateOfJoining: "2026-12-01", entityId: crypto.randomUUID(), sendInvite: false });
    expect(bad.status).toBe(400);
    const r = await kunal.post("/admin/employees", { firstName: "Asha", workEmail: "asha.entity@strats360.com", dateOfJoining: "2026-12-01", entityId: secondId, sendInvite: false });
    expect(r.status).toBe(201);
    empId = r.body.id;
    expect((await kunal.get(`/admin/employees/${empId}`)).body.entity).toMatchObject({ id: secondId, code: "E02" });
    // employees without an entity belong to the default one
    const nobody = (await kunal.get(`/admin/employees/${(await sql`select id from employees where tenant_id = ${tenantId} and entity_id is null limit 1`)[0]!.id}`)).body;
    expect(nobody.entity.code).toBe("E01");

    expect((await kunal.del(`/admin/org/entities/${secondId}`)).status).toBe(409);
    expect((await kunal.del(`/admin/org/entities/${defaultId}`)).status).toBe(409);
    await sql`update employees set entity_id = ${defaultId} where id = ${empId}`;
    expect((await kunal.del(`/admin/org/entities/${secondId}`)).status).toBe(200);
  });
});
