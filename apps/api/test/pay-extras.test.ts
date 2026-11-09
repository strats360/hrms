import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const today = todayIST();
let month = "";
let otDay = "";
const year = Number(today.slice(0, 4));
let krupa: Client, nisha: Client, hardik: Client;
let x: { id: string; code: string }, y: { id: string; code: string };
let runId = "";
let el = "", cl = "";

beforeAll(async () => {
  [krupa, nisha, hardik] = await Promise.all([login("krupa.joshi@strats360.com"), login("nisha.trivedi@strats360.com"), login("hardik.mehta@strats360.com")]);
  // a month no other test uses: the one before the earliest payroll run
  const [first] = await sql`select min(r.month) as m from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142'`;
  const base = first?.m ? new Date(`${first.m}-01T00:00:00Z`) : new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() - 1);
  month = base.toISOString().slice(0, 7);
  otDay = `${month}-16`;
  [x, y] = (await sql`
    select e.id, e.employee_code as code from employees e join tenants t on t.id = e.tenant_id
    where t.code = 'TN-0142' and e.status in ('active','probation') and e.user_id is null and e.last_working_day is null and e.date_of_joining < ${`${month}-01`}
    order by e.employee_code limit 2`) as any;
  const types = await sql`select lt.id, lt.code from leave_types lt join tenants t on t.id = lt.tenant_id where t.code = 'TN-0142'`;
  el = types.find((t) => t.code === "EL")!.id;
  cl = types.find((t) => t.code === "CL")!.id;
  // overtime worked this month, as attendance would record it
  for (const [e, mins] of [[x, 150], [y, 90]] as const) {
    await sql`insert into attendance_records (id, tenant_id, employee_id, date, status, source, overtime_minutes, work_minutes)
      select gen_random_uuid()::text, tenant_id, id, ${otDay}, 'present', 'web', ${mins}, 600 from employees where id = ${e.id}
      on conflict (tenant_id, employee_id, date) do update set overtime_minutes = ${mins}`;
  }
});
afterAll(async () => {
  // leave no run behind: the payroll tests create runs of their own
  if (runId) {
    await sql`update leave_encashments set status = 'cancelled' where run_id = ${runId}`;
    await sql`delete from payroll_runs where id = ${runId}`;
  }
  await sql.end();
});

describe("Overtime through payroll", () => {
  it("lists overtime worked in the run's period, priced at twice the hourly rate", async () => {
    const r = await krupa.post("/admin/payroll/runs", { month });
    expect(r.status).toBe(201);
    runId = r.body.id;
    expect((await krupa.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);
    const ot = (await krupa.get(`/admin/payroll/runs/${runId}/overtime`)).body;
    expect(ot.settings).toMatchObject({ multiplier: 2, basis: "gross" });
    const rx = ot.rows.find((r: any) => r.employeeId === x.id);
    const [{ m }] = await sql`select sum(overtime_minutes)::int as m from attendance_records where employee_id = ${x.id} and to_char(date, 'YYYY-MM') = ${month}`;
    expect(rx.hours).toBeCloseTo(m / 60, 2); // includes the 150 minutes added
    expect(rx.hours).toBeGreaterThanOrEqual(2.5);
    expect(rx.amount).toBe(Math.round(rx.ratePerHour * rx.hours));
    expect(rx.paid).toBeNull();
  });

  it("pays the approved hours as a taxable earning, outside PF wages", async () => {
    expect((await nisha.req("PUT", `/admin/payroll/runs/${runId}/overtime`, { rows: [] })).status).toBe(403);
    const before = (await sql`select employee_pf::float as pf, gross::float as gross from payroll_items where run_id = ${runId} and employee_id = ${x.id}`)[0]!;
    const r = await krupa.req("PUT", `/admin/payroll/runs/${runId}/overtime`, { rows: [{ employeeId: x.id, hours: 2 }, { employeeId: y.id, hours: 1.5 }] });
    expect(r.status).toBe(200);
    expect(r.body.employees).toBe(2);
    const adj = await sql`select label, amount::float, taxable, esi_wage, source from payroll_adjustments where run_id = ${runId} and source = 'overtime' order by employee_id`;
    expect(adj).toHaveLength(2);
    expect(adj.every((a) => a.taxable && a.esi_wage)).toBe(true);
    const after = (await sql`select employee_pf::float as pf, gross::float as gross from payroll_items where run_id = ${runId} and employee_id = ${x.id}`)[0]!;
    const xAmt = adj.find((a) => a.label.startsWith("Overtime (2 h"))!.amount;
    expect(after.gross - before.gross).toBeCloseTo(xAmt, 0);
    expect(after.pf).toBe(before.pf);
    // saving again replaces the overtime lines
    await krupa.req("PUT", `/admin/payroll/runs/${runId}/overtime`, { rows: [{ employeeId: x.id, hours: 2 }] });
    expect((await sql`select count(*)::int as n from payroll_adjustments where run_id = ${runId} and source = 'overtime'`)[0]!.n).toBe(1);
    const ot = (await krupa.get(`/admin/payroll/runs/${runId}/overtime`)).body;
    expect(ot.rows.find((r: any) => r.employeeId === x.id).paid.hours).toBe(2);
  });
});

describe("Leave encashment", () => {
  let encId = "";
  const elBalance = async () => (await sql`select (opening + accrued + adjusted - used)::float as bal from leave_balances where employee_id = ${x.id} and leave_type_id = ${el} and year = ${year}`)[0]?.bal ?? 0;

  it("encashes encashable leave and takes it off the balance", async () => {
    expect((await nisha.post("/admin/leave/encashments", { employeeId: x.id, leaveTypeId: cl, days: 1 })).body.error.message).toMatch(/can't be encashed/);
    expect((await nisha.post("/admin/leave/encashments", { employeeId: x.id, leaveTypeId: el, days: 300 })).status).toBe(400);
    expect((await hardik.post("/admin/leave/encashments", { employeeId: x.id, leaveTypeId: el, days: 1 })).status).toBe(403);
    // make sure there's something to encash
    await sql`update leave_balances set adjusted = adjusted + 5 where employee_id = ${x.id} and leave_type_id = ${el} and year = ${year}`;
    const before = await elBalance();
    const r = await nisha.post("/admin/leave/encashments", { employeeId: x.id, leaveTypeId: el, days: 2, note: "Requested" });
    expect(r.status).toBe(201);
    encId = r.body.id;
    expect(r.body.amount).toBe(Math.round(r.body.perDay * 2));
    expect(await elBalance()).toBeCloseTo(before - 2, 1);
  });

  it("goes into the payroll as a one-time earning that isn't ESI wages", async () => {
    const r = await krupa.post(`/admin/payroll/runs/${runId}/encashments`);
    expect(r.status).toBe(200);
    expect(r.body.added).toBe(1);
    const [a] = await sql`select id, esi_wage, taxable, label from payroll_adjustments where run_id = ${runId} and source = 'encashment'`;
    expect(a).toMatchObject({ esi_wage: false, taxable: true });
    expect(a!.label).toMatch(/Earned leave encashment \(2 days\)/);
    expect((await krupa.post(`/admin/payroll/runs/${runId}/encashments`)).status).toBe(400); // nothing left
    expect((await nisha.post(`/admin/leave/encashments/${encId}/cancel`)).status).toBe(400); // it's in payroll
    // removing the line from the payroll puts it back in the queue
    expect((await krupa.req("DELETE", `/admin/payroll/runs/${runId}/adjustments/${a!.id}`)).status).toBe(200);
    const list = (await nisha.get("/admin/leave/encashments?status=pending")).body;
    expect(list.some((e: any) => e.id === encId)).toBe(true);
  });

  it("can be cancelled while waiting, giving the days back", async () => {
    const before = await elBalance();
    expect((await nisha.post(`/admin/leave/encashments/${encId}/cancel`)).status).toBe(200);
    expect(await elBalance()).toBeCloseTo(before + 2, 1);
  });
});

describe("Closing a leave year", () => {
  const prev = year - 1;
  it("has nothing to close for a year the company didn't track here", async () => {
    await sql`delete from leave_balances b using tenants t where t.id = b.tenant_id and t.code = 'TN-0142' and b.year = ${prev - 5}`;
    const r = await nisha.post("/admin/leave/year-close", { year: prev - 5, dryRun: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/no leave balances/);
    if (today < `${year}-12-01`) expect((await nisha.post("/admin/leave/year-close", { year, dryRun: true })).status).toBe(400);
  });

  it("previews without changing anything, then carries leave forward up to each type's limit", async () => {
    // last year's earned leave for one employee: 40 days unused
    await sql`insert into leave_balances (id, tenant_id, employee_id, leave_type_id, year, opening, accrued, used, adjusted)
      select gen_random_uuid()::text, tenant_id, ${y.id}, ${el}, ${prev}, 22, 18, 0, 0 from employees where id = ${y.id}
      on conflict do nothing`;
    await sql`update leave_balances set opening = 22, accrued = 18, used = 0, adjusted = 0 where employee_id = ${y.id} and leave_type_id = ${el} and year = ${prev}`;
    expect((await nisha.get("/admin/leave/year-close")).body.due).toBe(prev);
    const rowsBefore = (await sql`select count(*)::int as n from leave_balances where year = ${prev}`)[0]!.n;
    const dry = (await nisha.post("/admin/leave/year-close", { year: prev, encashLapsed: true, dryRun: true })).body;
    expect(dry.employees).toBeGreaterThanOrEqual(1);
    expect((await sql`select count(*)::int as n from leave_balances where year = ${prev}`)[0]!.n).toBe(rowsBefore); // a preview writes nothing
    for (const r of dry.rows) {
      if (r.type === "Earned leave") expect(r.carried).toBeLessThanOrEqual(30);
      if (r.type === "Casual leave") expect(r.carried).toBe(0);
      expect(r.carried + r.lapsed + r.encashed).toBeCloseTo(r.left, 1);
    }
    const r = (await nisha.post("/admin/leave/year-close", { year: prev, encashLapsed: true, dryRun: false })).body;
    const row = r.rows.find((x: any) => x.employeeCode === y.code && x.type === "Earned leave");
    expect(row).toMatchObject({ left: 40, carried: 30, encashed: 10, lapsed: 0 });
    expect(dry.rows.find((x: any) => x.employeeCode === y.code && x.type === "Earned leave")).toEqual(row); // the preview matched
    const [open] = await sql`select opening::float from leave_balances where employee_id = ${y.id} and leave_type_id = ${el} and year = ${year}`;
    expect(open!.opening).toBe(30);
    const enc = await sql`select days::float, reason, status from leave_encashments where employee_id = ${y.id} and leave_type_id = ${el} and year = ${prev}`;
    expect(enc).toEqual([{ days: 10, reason: "year_end", status: "pending" }]);
    // running it again recomputes rather than adding twice
    await nisha.post("/admin/leave/year-close", { year: prev, encashLapsed: true, dryRun: false });
    expect((await sql`select count(*)::int as n from leave_encashments where employee_id = ${y.id} and year = ${prev}`)[0]!.n).toBe(1);
    expect((await nisha.get("/admin/leave/year-close")).body).toMatchObject({ lastClosed: prev, due: null });
  });
});
