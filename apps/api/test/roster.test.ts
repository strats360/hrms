import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let hardik: Client, amit: Client, priya: Client;
let priyaId = "";
let tenantId = "";
let general = "";
let night = "";
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// a Monday comfortably after the locked payroll months in the test data
const WEEK = "2026-12-07";

beforeAll(async () => {
  [hardik, amit, priya] = await Promise.all(["hardik.mehta", "amit.dave", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: general }] = (await sql`select id from shifts where tenant_id = ${tenantId} order by is_default desc limit 1`) as any;
  [{ id: night }] = (await sql`insert into shifts (id, tenant_id, name, start_time, end_time, weekly_offs) values (gen_random_uuid()::text, ${tenantId}, 'Night test', '22:00', '06:00', '{0}') returning id`) as any;
});
afterAll(async () => {
  await sql`delete from shift_roster where tenant_id = ${tenantId}`;
  await sql`delete from attendance_records where employee_id = ${priyaId} and date >= ${plus(todayIST(), -1)}`;
  await sql`delete from shifts where id = ${night}`;
  await sql.end();
});

describe("Shift roster", () => {
  it("shows a manager their team's week, with usual shifts and weekly offs", async () => {
    const r = await hardik.get(`/admin/attendance/roster?from=${WEEK}`);
    expect(r.status).toBe(200);
    expect(r.body.days).toHaveLength(7);
    const me = r.body.rows.find((x: any) => x.employeeId === priyaId);
    expect(me.cells[WEEK]).toMatchObject({ rostered: false, isOff: false });
    expect(me.cells[plus(WEEK, 5)]).toMatchObject({ rostered: false, isOff: true }); // Saturday
    expect((await amit.get(`/admin/attendance/roster?from=${WEEK}`)).body.rows.some((x: any) => x.employeeId === priyaId)).toBe(false);
    expect((await priya.get(`/admin/attendance/roster?from=${WEEK}`)).status).toBe(403);
  });

  it("plans single days, but not for other teams or locked months", async () => {
    const sat = plus(WEEK, 5);
    const ok = await hardik.req("PUT", "/admin/attendance/roster", { entries: [{ employeeId: priyaId, date: sat, shiftId: general, isOff: false }, { employeeId: priyaId, date: WEEK, shiftId: null, isOff: true }] });
    expect(ok.status).toBe(200);
    const me = (await hardik.get(`/admin/attendance/roster?from=${WEEK}`)).body.rows.find((x: any) => x.employeeId === priyaId);
    expect(me.cells[sat]).toMatchObject({ rostered: true, isOff: false, shiftId: general });
    expect(me.cells[WEEK]).toMatchObject({ rostered: true, isOff: true });
    expect((await amit.req("PUT", "/admin/attendance/roster", { entries: [{ employeeId: priyaId, date: sat, shiftId: general, isOff: false }] })).body.error.message).toMatch(/your team/);
    // the test data locks payroll up to the end of October
    const lockedRes = await hardik.req("PUT", "/admin/attendance/roster", { entries: [{ employeeId: priyaId, date: "2026-10-05", shiftId: null, isOff: true }] });
    expect(lockedRes.body.error.message).toMatch(/locked/);
    // clearing goes back to the usual pattern
    await hardik.req("PUT", "/admin/attendance/roster", { entries: [{ employeeId: priyaId, date: WEEK, clear: true }] });
    expect((await hardik.get(`/admin/attendance/roster?from=${WEEK}`)).body.rows.find((x: any) => x.employeeId === priyaId).cells[WEEK].rostered).toBe(false);
  });

  it("fills a stretch with a shift and days off, and copies a week", async () => {
    const f = await hardik.post("/admin/attendance/roster/fill", { employeeIds: [priyaId], from: WEEK, to: plus(WEEK, 6), shiftId: night, offDays: [3] });
    expect(f.body.saved).toBe(7);
    const c = await hardik.post("/admin/attendance/roster/copy-week", { fromWeek: WEEK, toWeek: plus(WEEK, 14), employeeIds: [priyaId] });
    expect(c.body.saved).toBe(7);
    const later = (await hardik.get(`/admin/attendance/roster?from=${plus(WEEK, 14)}`)).body.rows.find((x: any) => x.employeeId === priyaId);
    expect(later.cells[plus(WEEK, 14)]).toMatchObject({ shiftId: night, isOff: false });
    expect(later.cells[plus(WEEK, 16)]).toMatchObject({ isOff: true }); // Wednesday off
  });

  it("drives the calendar and self-service: a rostered day off isn't an absence", async () => {
    // other tests may leave a holiday or leave in the next fortnight, so pick a plain working day
    const before = (await priya.get("/ess/roster")).body.days;
    expect(before).toHaveLength(14);
    const day = before.find((d: any) => d.status === "work" && d.date > todayIST()).date;
    // written directly: other tests may have approved this month's payroll, which locks it for planning
    await sql`insert into shift_roster (id, tenant_id, employee_id, date, shift_id, is_off) values (gen_random_uuid()::text, ${tenantId}, ${priyaId}, ${day}, null, true) on conflict (employee_id, date) do update set shift_id = null, is_off = true`;
    const mine = (await priya.get("/ess/roster")).body.days;
    expect(mine.find((d: any) => d.date === day)).toMatchObject({ status: "off", changed: true, shift: null });
  });

  it("closes a night shift with a check-out after midnight", async () => {
    // a shift that started yesterday and ends an hour ago today
    const now = new Date();
    const hm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
    const end = hm(new Date(now.getTime() - 3_600_000));
    const start = hm(new Date(now.getTime() + 3_600_000));
    if (start <= end) return; // within an hour of midnight IST the shift wouldn't cross it; nothing to test
    const today = todayIST();
    const yesterday = plus(today, -1);
    await sql`update shifts set start_time = ${start}, end_time = ${end} where id = ${night}`;
    await sql`insert into shift_roster (id, tenant_id, employee_id, date, shift_id, is_off) values (gen_random_uuid()::text, ${tenantId}, ${priyaId}, ${yesterday}, ${night}, false) on conflict (employee_id, date) do update set shift_id = ${night}, is_off = false`;
    await sql`delete from attendance_records where employee_id = ${priyaId} and date in (${yesterday}, ${today})`;
    await sql`insert into attendance_records (id, tenant_id, employee_id, date, check_in, source, status) values (gen_random_uuid()::text, ${tenantId}, ${priyaId}, ${yesterday}, ${`${yesterday}T${start}:00+05:30`}, 'web', 'present')`;
    const r = await priya.post("/ess/attendance/punch", { source: "web" });
    expect(r.body.action).toBe("out");
    const rows = await sql`select date::text as d, check_out from attendance_records where employee_id = ${priyaId} and date in (${yesterday}, ${today})`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.d).toBe(yesterday);
    expect(rows[0]!.check_out).not.toBeNull();
  });
});
