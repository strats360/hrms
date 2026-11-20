import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client;
let before: unknown;
let empId: string;

beforeAll(async () => {
  kunal = await login("kunal.shah@strats360.com");
  const [t] = await sql`select settings -> 'customFields' as f from tenants where id = (select tenant_id from employees where work_email = 'kunal.shah@strats360.com' limit 1)`;
  before = t?.f ?? null;
  const list = (await kunal.get("/admin/employees?pageSize=1")).body;
  empId = (list.rows ?? list.items ?? list)[0].id;
});
afterAll(async () => {
  await kunal.patch("/admin/org/settings", { customFields: before ?? [] });
  await sql`update employees set custom_fields = '{}'::jsonb where id = ${empId}`;
  await sql.end();
});

describe("custom employee fields", () => {
  it("defines fields, checks values and exports them", async () => {
    const bad = await kunal.patch("/admin/org/settings", { customFields: [{ key: "tshirt", label: "T-shirt size", type: "select" }] });
    expect(bad.status).toBe(422);
    const ok = await kunal.patch("/admin/org/settings", {
      customFields: [
        { key: "tshirt", label: "T-shirt size", type: "select", options: ["S", "M", "L"], showToEmployee: true },
        { key: "cost_centre", label: "Cost centre", type: "number" },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await kunal.get("/admin/org/lookups")).body.customFields).toHaveLength(2);

    const wrong = await kunal.patch(`/admin/employees/${empId}`, { customFields: { tshirt: "XXL" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error?.message ?? wrong.body.message).toMatch(/one of S, M, L/);
    expect((await kunal.patch(`/admin/employees/${empId}`, { customFields: { tshirt: "M" } })).status).toBe(200);
    expect((await kunal.patch(`/admin/employees/${empId}`, { customFields: { cost_centre: "4,100" } })).status).toBe(200);
    const e = (await kunal.get(`/admin/employees/${empId}`)).body;
    expect(e.customFields).toEqual({ tshirt: "M", cost_centre: 4100 });
    expect(e.customFieldDefs.map((d: { key: string }) => d.key)).toEqual(["tshirt", "cost_centre"]);

    const f = await kunal.file("/admin/employees/export.csv");
    const text = await f.raw.text();
    expect(text.split("\n")[0]).toMatch(/T-shirt size,Cost centre/);
    expect(text).toMatch(/,M,4100/);
  });
});
