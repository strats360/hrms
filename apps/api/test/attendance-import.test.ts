import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client;
let a: { id: string; code: string }, b: { id: string; code: string }, c: { id: string; code: string }, d: { id: string; code: string };
let lockedDay = "";
let locks: { id: string; status: string }[] = [];
const today = todayIST();
const dmy = (iso: string) => iso.split("-").reverse().join("-");
// punch times earlier today, as a fraction of the time since midnight IST (never in the future)
const at = (f: number) => new Date(Date.parse(`${today}T00:00:00+05:30`) + Math.floor((Date.now() - Date.parse(`${today}T00:00:00+05:30`)) * f / 1000) * 1000);
const local = (x: Date) => new Date(x.getTime() + 5.5 * 3600_000).toISOString().slice(0, 19).replace("T", " ");

beforeAll(async () => {
  [nisha, hardik] = await Promise.all([login("nisha.trivedi@strats360.com"), login("hardik.mehta@strats360.com")]);
  const rows = (await sql`
    select e.id, e.employee_code as code from employees e join tenants t on t.id = e.tenant_id
    where t.code = 'TN-0142' and e.status = 'active' and e.user_id is null and e.date_of_joining < current_date - interval '1 year' and e.last_working_day is null
    order by e.employee_code desc limit 4`) as any[];
  [a, b, c, d] = rows;
  const [run] = await sql`select r.month from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142' and r.status = 'paid' and r.month < ${today.slice(0, 7)} order by r.month desc limit 1`;
  lockedDay = `${run!.month}-15`;
  // other test files may approve this month's payroll, which locks its attendance; unlock it while these run
  locks = (await sql`select r.id, r.status from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142' and r.month = ${today.slice(0, 7)} and r.status in ('approved','paid')`) as any;
  for (const l of locks) await sql`update payroll_runs set status = 'calculated' where id = ${l.id}`;
});
afterAll(async () => {
  for (const l of locks) await sql`update payroll_runs set status = ${l.status} where id = ${l.id}`;
  await sql.end();
});

describe("Bulk attendance upload", () => {
  it("offers a template", async () => {
    const r = await nisha.req("GET", "/admin/attendance/import/template.csv");
    expect(r.status).toBe(200);
  });

  it("checks every row in a dry run and writes nothing", async () => {
    await sql`delete from attendance_records where employee_id in (${a.id}, ${b.id}) and date = ${today}`;
    const csv = [
      "Emp Code,Date,In Time,Out Time,Status,Remarks",
      `${a.code},${dmy(today)},9:40 AM,6:45 PM,,From the eSSL export`,
      `${b.code},${today},,,L,Sick`,
      `NOPE-1,${today},09:00,18:00,,`,
      `${a.code},31-02-2026,09:00,18:00,,`,
      `${a.code},2099-01-01,09:00,18:00,,`,
      `${a.code},${today},09:00,18:00,,`,
      `${b.code},${lockedDay},09:00,18:00,,`,
      `${c.code},${today},,18:00,,`,
      `${d.code},${today},,,maybe,`,
    ].join("\n");
    const r = await nisha.post("/admin/attendance/import", { csv, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 9, create: 2, errors: 7, written: 0 });
    const msg = (row: number) => r.body.results.find((x: any) => x.row === row)?.message ?? "";
    expect(msg(4)).toMatch(/Unknown employee/);
    expect(msg(5)).toMatch(/isn't a date/);
    expect(msg(6)).toMatch(/Future/);
    expect(msg(7)).toMatch(/twice/);
    expect(msg(8)).toMatch(/locked/);
    expect(msg(9)).toMatch(/without a check-in/);
    expect(msg(10)).toMatch(/Unknown status/);
    const first = r.body.results.find((x: any) => x.row === 2);
    expect(first).toMatchObject({ action: "create", checkIn: "09:40", checkOut: "18:45" });
    expect((await sql`select 1 from attendance_records where employee_id = ${a.id} and date = ${today}`).length).toBe(0);
  });

  it("imports, then leaves existing days alone unless told to overwrite", async () => {
    const csv = `Employee ID,Date,Check in,Check out,Status\n${a.code},${today},09:40,18:45,\n${b.code},${today},,,L`;
    const r = await nisha.post("/admin/attendance/import", { csv, dryRun: false });
    expect(r.body).toMatchObject({ create: 2, written: 2 });
    const [rec] = await sql`select source, status, is_manual, work_minutes from attendance_records where employee_id = ${a.id} and date = ${today}`;
    expect(rec).toMatchObject({ source: "import", is_manual: true });
    expect(rec!.work_minutes).toBe(545);
    const again = await nisha.post("/admin/attendance/import", { csv: `Employee ID,Date,Status\n${a.code},${today},P`, dryRun: false });
    expect(again.body).toMatchObject({ skip: 1, written: 0 });
    const over = await nisha.post("/admin/attendance/import", { csv: `Employee ID,Date,Status\n${a.code},${today},WFH`, dryRun: false, overwrite: true });
    expect(over.body).toMatchObject({ update: 1, written: 1 });
    expect((await sql`select status from attendance_records where employee_id = ${a.id} and date = ${today}`)[0]!.status).toBe("wfh");
  });

  it("needs attendance edit rights and the right columns", async () => {
    expect((await hardik.post("/admin/attendance/import", { csv: "a,b\n1,2", dryRun: true })).status).toBe(403);
    const bad = await nisha.post("/admin/attendance/import", { csv: "Name,Day\nX,1", dryRun: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Employee ID/);
  });
});

describe("Biometric devices", () => {
  let key = "";
  let deviceId = "";
  const push = (k: string, punches: unknown[]) => new Client().req("POST", "/public/attendance/punches", { punches }, { authorization: `Bearer ${k}` });

  it("issues a key once and lists the device without it", async () => {
    const r = await nisha.post("/admin/attendance/devices", { name: "Bhavnagar HQ reception", serialNumber: "ZK-8812" });
    expect(r.status).toBe(201);
    key = r.body.key;
    deviceId = r.body.id;
    expect(key).toMatch(/^dev_[0-9a-f-]{36}\./);
    const list = (await nisha.get("/admin/attendance/devices")).body;
    expect(list.endpoint).toMatch(/\/api\/public\/attendance\/punches$/);
    const d = list.rows.find((x: any) => x.id === deviceId);
    expect(d.key).toBeUndefined();
    expect(d.keyHint).toBe(key.slice(-4));
  });

  it("refuses bad keys", async () => {
    expect((await push("nope", [{ userId: c.code, time: `${today} 09:00` }])).status).toBe(401);
    expect((await push(key.slice(0, -2) + "xx", [{ userId: c.code, time: `${today} 09:00` }])).status).toBe(401);
  });

  it("turns the first and last punch of the day into check-in and check-out", async () => {
    await sql`delete from attendance_records where employee_id = ${c.id} and date = ${today}`;
    const [t1, t2, t3] = [at(0.2), at(0.5), at(0.8)];
    const r = await push(key, [
      { userId: c.code, time: local(t1) },
      { userId: c.code, time: local(t2) },
      { userId: c.code, time: t3.toISOString() }, // ISO with Z works too
      { userId: "99999", time: local(t1) },
      { userId: c.code, time: "garbage-time" },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ received: 5, accepted: 3, daysUpdated: 1, unknownUsers: ["99999"] });
    expect(r.body.invalid).toHaveLength(1);
    const [rec] = await sql`select source, check_in, check_out, work_minutes from attendance_records where employee_id = ${c.id} and date = ${today}`;
    expect(rec!.source).toBe("biometric");
    expect(new Date(rec!.check_in).toISOString()).toBe(t1.toISOString());
    expect(new Date(rec!.check_out).toISOString()).toBe(t3.toISOString());
    // sending the same punches again changes nothing
    const again = await push(key, [{ userId: c.code, time: local(t1) }]);
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it("matches the biometric ID, and doesn't overwrite a day HR entered", async () => {
    expect((await nisha.req("PATCH", `/admin/employees/${b.id}`, { biometricId: "7781" })).status).toBe(200);
    expect((await nisha.req("PATCH", `/admin/employees/${c.id}`, { biometricId: "7781" })).status).toBe(409);
    const r = await push(key, [{ userId: 7781, time: local(at(0.3)) }, { userId: a.code, time: local(at(0.35)) }]);
    expect(r.body.accepted).toBe(2);
    expect(r.body.skipped.length).toBe(2); // b was marked on leave by the upload, a was imported: both entered by HR
    expect((await sql`select status from attendance_records where employee_id = ${b.id} and date = ${today}`)[0]!.status).toBe("on_leave");
  });

  it("stops a device that's turned off or has a new key", async () => {
    const rot = await nisha.post(`/admin/attendance/devices/${deviceId}/rotate`);
    expect((await push(key, [{ userId: c.code, time: local(at(0.6)) }])).status).toBe(401);
    expect((await push(rot.body.key, [{ userId: c.code, time: local(at(0.6)) }])).status).toBe(200);
    await nisha.req("PATCH", `/admin/attendance/devices/${deviceId}`, { active: false });
    expect((await push(rot.body.key, [{ userId: c.code, time: local(at(0.65)) }])).status).toBe(403);
    const d = (await nisha.get("/admin/attendance/devices")).body.rows.find((x: any) => x.id === deviceId);
    expect(d.punchCount).toBe(6);
    expect(d.lastSeenAt).toBeTruthy();
  });
});
