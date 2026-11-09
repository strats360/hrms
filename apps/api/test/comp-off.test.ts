import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { todayIST } from "@hrms/shared";
import { Client, env, lastEmailTo, login } from "./helpers";
import { expireCompOff } from "../src/services/comp-off";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
const today = todayIST();
const year = Number(today.slice(0, 4));
let priya: Client, hardik: Client, nisha: Client;
let priyaId = "";
let co = "";
let sunday = "", workday = "";
let reqId = "";

const back = (n: number) => new Date(Date.parse(today + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
const coBalance = async () => (await sql`select (opening + accrued + adjusted - used)::float as b from leave_balances where employee_id = ${priyaId} and leave_type_id = ${co} and year = ${year}`)[0]?.b ?? 0;

beforeAll(async () => {
  [priya, hardik, nisha] = await Promise.all([login("priya.vaghela@strats360.com"), login("hardik.mehta@strats360.com"), login("nisha.trivedi@strats360.com")]);
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: co }] = (await sql`select lt.id from leave_types lt join tenants t on t.id = lt.tenant_id where t.code = 'TN-0142' and lt.code = 'CO'`) as any;
  // the latest Sunday and a weekday in the past fortnight, neither a holiday
  for (let i = 1; i <= 14 && (!sunday || !workday); i++) {
    const d = back(i);
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    const [hol] = await sql`select 1 from holidays h join tenants t on t.id = h.tenant_id where t.code = 'TN-0142' and h.date = ${d}`;
    if (hol) continue;
    if (dow === 0 && !sunday) sunday = d;
    if (dow >= 2 && dow <= 4 && !workday) workday = d;
  }
  for (const [d, mins] of [[sunday, 540], [workday, 540]] as const) {
    await sql`insert into attendance_records (id, tenant_id, employee_id, date, status, source, work_minutes, check_in, check_out)
      select gen_random_uuid()::text, tenant_id, id, ${d}, 'present', 'web', ${mins}, ${d + "T09:00:00+05:30"}, ${d + "T18:00:00+05:30"} from employees where id = ${priyaId}
      on conflict (tenant_id, employee_id, date) do update set work_minutes = ${mins}`;
  }
  await sql`delete from comp_off_requests where employee_id = ${priyaId}`;
});
afterAll(async () => {
  await sql`delete from comp_off_requests where employee_id = ${priyaId}`;
  await sql.end();
  await db.$client.end();
});

describe("Comp off", () => {
  it("lists the off days an employee worked and hasn't claimed", async () => {
    const r = (await priya.get("/ess/comp-off")).body;
    expect(r.settings).toEqual({ expiryDays: 60, claimWithinDays: 30 });
    expect(r.claimable).toContainEqual({ date: sunday, dayType: "weekly_off", days: 1 });
    expect(r.claimable.some((x: any) => x.date === workday)).toBe(false);
  });

  it("only allows a claim for a worked weekly off or holiday, once", async () => {
    const wd = await priya.post("/ess/comp-off", { date: workday, reason: "Release" });
    expect(wd.status).toBe(400);
    expect(wd.body.error.message).toMatch(/working day/);
    expect((await priya.post("/ess/comp-off", { date: back(45), reason: "Old work" })).body.error.message).toMatch(/within 30 days/);
    const r = await priya.post("/ess/comp-off", { date: sunday, reason: "Production release" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "pending", days: 1, dayType: "weekly_off" });
    reqId = r.body.id;
    expect(lastEmailTo("hardik.mehta@strats360.com")?.subject).toBe("Comp off request: Priya Vaghela");
    expect((await priya.post("/ess/comp-off", { date: sunday, reason: "Again" })).status).toBe(400);
  });

  it("lets the manager approve, which credits the balance until it expires", async () => {
    expect((await hardik.post(`/admin/leave/comp-off/${reqId}/decision`, { decision: "rejected" })).status).toBe(400); // needs a reason
    const before = await coBalance();
    const r = await hardik.post(`/admin/leave/comp-off/${reqId}/decision`, { decision: "approved" });
    expect(r.status).toBe(200);
    const expires = new Date(Date.parse(sunday + "T00:00:00Z") + 60 * 86400000).toISOString().slice(0, 10);
    expect(r.body).toMatchObject({ status: "approved", expiresOn: expires });
    expect(await coBalance()).toBe(before + 1);
    expect(lastEmailTo("priya.vaghela@strats360.com")?.subject).toBe("Comp off approved: 1 day");
    const list = (await hardik.get("/admin/leave/comp-off")).body.rows;
    expect(list.some((x: any) => x.id === reqId)).toBe(true);
  });

  it("lapses unused comp off after it expires", async () => {
    const before = await coBalance();
    await sql`update comp_off_requests set expires_on = ${back(1)} where id = ${reqId}`;
    const r = await expireCompOff(db);
    expect(r.lapsedDays).toBeGreaterThanOrEqual(1);
    const [row] = await sql`select status, lapsed_days::float from comp_off_requests where id = ${reqId}`;
    expect(row).toMatchObject({ status: "expired", lapsed_days: 1 });
    expect(await coBalance()).toBe(before - 1);
    expect((await expireCompOff(db)).expired).toBe(0); // only once
  });

  it("lets HR grant comp off directly", async () => {
    expect((await hardik.post("/admin/leave/comp-off", { employeeId: priyaId, date: workday, days: 0.5, reason: "Client visit" })).status).toBe(403);
    const before = await coBalance();
    const r = await nisha.post("/admin/leave/comp-off", { employeeId: priyaId, date: workday, days: 0.5, reason: "Client visit on a Saturday" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "approved", days: 0.5 });
    expect(await coBalance()).toBe(before + 0.5);
  });
});
