import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, priya: Client;
let tenantId = "", priyaId = "", laptopId = "", exitId = "";

beforeAll(async () => {
  [nisha, hardik, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from assets where tenant_id = ${tenantId}`;
  if (exitId) await sql`delete from employee_exits where id = ${exitId}`;
  await sql.end();
});

describe("Assets", () => {
  it("keeps a register with tags", async () => {
    expect((await hardik.get("/admin/assets")).status).toBe(403);
    const r = await nisha.post("/admin/assets", { name: "Dell Latitude 5440", category: "laptop", serialNumber: "DL5440-77", purchaseDate: "2026-04-10", purchaseCost: 78500, warrantyUntil: "2026-11-30", condition: "new" });
    expect(r.status).toBe(201);
    expect(r.body.tag).toMatch(/^AST-\d{4}$/);
    laptopId = r.body.id;
    expect((await nisha.post("/admin/assets", { tag: r.body.tag, name: "Copy", category: "laptop" })).status).toBe(409);
    const card = await nisha.post("/admin/assets", { tag: "ID-0042", name: "ID card", category: "id_card" });
    expect(card.body.tag).toBe("ID-0042");
    const list = (await nisha.get("/admin/assets")).body;
    expect(list.summary).toMatchObject({ total: 2, available: 2, value: 78500 });
    expect(list.rows.find((a: any) => a.id === laptopId).warranty).toBe("ending");
  });

  it("assigns to an employee, who confirms or reports a problem", async () => {
    const before = mailer.sent.length;
    expect((await nisha.post(`/admin/assets/${laptopId}/assign`, { employeeId: priyaId, date: todayIST(), condition: "new", note: "With charger" })).status).toBe(200);
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && /is assigned to you/.test(m.subject))).toBe(true);
    expect((await nisha.post(`/admin/assets/${laptopId}/assign`, { employeeId: priyaId, date: todayIST() })).body.error.message).toMatch(/already assigned/);
    const mine = (await priya.get("/ess/assets")).body;
    expect(mine[0]).toMatchObject({ asset: { name: "Dell Latitude 5440", serialNumber: "DL5440-77" }, noteOut: "With charger", acknowledgedAt: null });
    expect((await priya.post(`/ess/assets/${mine[0].id}/acknowledge`)).status).toBe(200);
    expect((await priya.post(`/ess/assets/${mine[0].id}/report`, { kind: "damaged", note: "Hinge cracked" })).status).toBe(200);
    const row = (await nisha.get(`/admin/assets?employeeId=${priyaId}`)).body.rows[0];
    expect(row).toMatchObject({ status: "assigned", acknowledged: true, issue: "damaged", holder: { name: "Priya Vaghela" } });
    expect((await nisha.post(`/admin/assets/${laptopId}/status`, { status: "retired" })).body.error.message).toMatch(/Take it back/);
  });

  it("blocks the exit checklist until assets come back, then ticks it", async () => {
    const [x] = await sql`insert into employee_exits (id, tenant_id, code, employee_id, type, status, previous_status, resignation_date, last_working_day, notice_days, clearance) values (gen_random_uuid()::text, ${tenantId}, 'EX-TEST-A', ${priyaId}, 'resignation', 'notice', 'active', ${todayIST()}, ${todayIST()}, 30, ${sql.json([{ key: "assets", label: "Company assets returned", done: false }])}) returning id`;
    exitId = x!.id;
    const block = await nisha.post(`/admin/exits/${exitId}/clearance`, { key: "assets", done: true });
    expect(block.body.error.message).toMatch(/still has Dell Latitude 5440/);
    expect((await nisha.get(`/admin/exits/${exitId}`)).body.heldAssets.map((a: any) => a.name)).toEqual(["Dell Latitude 5440"]);
    expect((await nisha.post(`/admin/assets/${laptopId}/return`, { date: "2020-01-01", condition: "damaged" })).body.error.message).toMatch(/before it was given/);
    expect((await nisha.post(`/admin/assets/${laptopId}/return`, { date: todayIST(), condition: "damaged", status: "in_repair", note: "Hinge" })).status).toBe(200);
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toMatch(/returned/);
    const [after] = await sql`select clearance from employee_exits where id = ${exitId}`;
    expect(after!.clearance[0].done).toBe(true);
    const detail = (await nisha.get(`/admin/assets/${laptopId}`)).body;
    expect(detail.asset).toMatchObject({ status: "in_repair", condition: "damaged", holderId: null });
    expect(detail.history[0]).toMatchObject({ conditionOut: "new", conditionIn: "damaged", issue: "damaged", employee: { name: "Priya Vaghela" } });
    expect((await priya.get("/ess/assets")).body[0].returnedOn).toBe(todayIST());
  });

  it("exports the register and only deletes assets that were never used", async () => {
    const x = await nisha.file("/admin/assets/export.xlsx");
    expect(x.status).toBe(200);
    expect((await nisha.del(`/admin/assets/${laptopId}`)).body.error.message).toMatch(/retired instead/);
  });
});
