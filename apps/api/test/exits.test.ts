import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, lastEmailTo, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const addDays = (n: number) => new Date(Date.parse(todayIST()) + n * 86400000).toISOString().slice(0, 10);
let kunal: Client, nisha: Client, krupa: Client, priya: Client, hardik: Client;
let emp: { id: string; employee_code: string; full_name: string; status: string };

beforeAll(async () => {
  [kunal, nisha, krupa, priya, hardik] = await Promise.all([
    login("kunal.shah@strats360.com"),
    login("nisha.trivedi@strats360.com"),
    login("krupa.joshi@strats360.com"),
    login("priya.vaghela@strats360.com"),
    login("hardik.mehta@strats360.com"),
  ]);
  // a long-serving employee who isn't one of the demo logins, with bank details
  [emp] = (await sql`
    select e.id, e.employee_code, e.full_name, e.status from employees e join tenants t on t.id = e.tenant_id
    where t.code = 'TN-0142' and e.status = 'active' and e.user_id is null and e.account_number_enc is not null and e.ifsc is not null
      and e.date_of_joining < current_date - interval '6 years'
    order by e.date_of_joining limit 1`) as any;
});
afterAll(async () => {
  await sql.end();
});

describe("Full and final settlement", () => {
  let exitId = "";

  it("starts an exit and puts the dates on the employee", async () => {
    const r = await nisha.post("/admin/exits", { employeeId: emp.id, type: "resignation", resignationDate: addDays(-40), lastWorkingDay: addDays(-5), reason: "Moving to Pune" });
    expect(r.status).toBe(201);
    exitId = r.body.id;
    expect(r.body.code).toMatch(/^EX-\d{4}$/);
    expect(r.body.noticeDays).toBe(30);
    expect(r.body.clearance).toHaveLength(4);
    const [e] = await sql`select status, last_working_day::text as lwd from employees where id = ${emp.id}`;
    expect(e).toMatchObject({ status: "notice", lwd: addDays(-5) });
    expect((await nisha.post("/admin/exits", { employeeId: emp.id, type: "resignation", resignationDate: addDays(-1), lastWorkingDay: addDays(1) })).status).toBe(409);
    expect((await hardik.post("/admin/exits", { employeeId: emp.id, type: "termination", resignationDate: addDays(-1), lastWorkingDay: addDays(1) })).status).toBe(403);
    const list = (await nisha.get("/admin/exits?status=open")).body;
    expect(list.rows.some((x: any) => x.id === exitId)).toBe(true);
  });

  it("works out gratuity and leave encashment, and keeps exits from managers", async () => {
    expect((await hardik.get(`/admin/exits/${exitId}`)).status).toBe(403);
    expect((await hardik.get("/admin/exits")).status).toBe(403);
    expect((await nisha.get(`/admin/exits/${exitId}`)).body.preview.result.net).toBeDefined(); // HR has read-only payroll
    const d = (await krupa.get(`/admin/exits/${exitId}`)).body;
    const lines = d.preview.result.lines;
    expect(lines.find((l: any) => l.key === "gratuity").amount).toBeGreaterThan(0);
    expect(d.preview.result.gratuityEligible).toBe(true);
    expect(d.preview.result.notice).toMatchObject({ required: 30, served: 30, shortfall: 0 });
    expect(d.preview.structure.basic).toBeGreaterThan(0);
  });

  it("drafts the settlement with recoveries and TDS", async () => {
    const r = await krupa.req("PUT", `/admin/exits/${exitId}/settlement`, { manual: [{ label: "Laptop charger not returned", kind: "deduction", amount: 1500 }], tds: 2000, notes: "As agreed" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("settlement");
    const lines = r.body.settlement.lines;
    expect(lines.some((l: any) => l.label === "Laptop charger not returned" && l.kind === "deduction")).toBe(true);
    expect(lines.some((l: any) => l.key === "tds" && l.amount === 2000)).toBe(true);
    expect(r.body.netAmount).toBeCloseTo(r.body.settlement.earnings - r.body.settlement.deductions, 2);
  });

  it("needs a second person and a finished checklist to approve", async () => {
    expect((await krupa.post(`/admin/exits/${exitId}/approve`)).status).toBe(403); // drafted it
    const early = await kunal.post(`/admin/exits/${exitId}/approve`);
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/exit checklist/);
    for (const key of ["assets", "handover", "access", "finance"]) expect((await nisha.post(`/admin/exits/${exitId}/clearance`, { key, done: true })).status).toBe(200);
    const ok = await kunal.post(`/admin/exits/${exitId}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    // changes are locked once approved
    expect((await nisha.req("PATCH", `/admin/exits/${exitId}`, { lastWorkingDay: addDays(-3) })).status).toBe(400);
  });

  it("pays through a payment batch and closes when the payment clears", async () => {
    const accounts = (await kunal.get("/admin/payments/accounts")).body;
    const account = (accounts.rows ?? accounts).find((a: any) => a.active);
    const pay = await krupa.post(`/admin/exits/${exitId}/pay`, { bankAccountId: account.id, paymentDate: todayIST() });
    expect(pay.status).toBe(201);
    expect((await krupa.post(`/admin/exits/${exitId}/pay`, { bankAccountId: account.id, paymentDate: todayIST() })).status).toBe(409);
    expect((await kunal.post(`/admin/exits/${exitId}/settle`, { settledOn: todayIST(), method: "cheque" })).status).toBe(400); // in a batch
    const [{ amount }] = await sql`select amount::float from payments where id = ${pay.body.paymentId}`;
    const [{ net_amount }] = await sql`select net_amount::float from employee_exits where id = ${exitId}`;
    expect(amount).toBe(net_amount);
    expect((await kunal.post(`/admin/payments/batches/${pay.body.batchId}/approve`)).status).toBe(200);
    expect((await kunal.get(`/admin/payments/batches/${pay.body.batchId}/file`)).status).toBe(200);
    const [before] = await sql`select coalesce(sum(b.adjusted),0)::float as adj from leave_balances b join leave_types t on t.id = b.leave_type_id where b.employee_id = ${emp.id} and t.encashable`;
    expect((await kunal.post(`/admin/payments/batches/${pay.body.batchId}/mark-all-paid`, {})).status).toBe(200);
    const d = (await krupa.get(`/admin/exits/${exitId}`)).body;
    expect(d.status).toBe("settled");
    expect(d.payment.status).toBe("paid");
    const [e] = await sql`select status from employees where id = ${emp.id}`;
    expect(e!.status).toBe("exited");
    const encashed = (d.settlement.leave as any[]).reduce((s, l) => s + l.days, 0);
    const [after] = await sql`select coalesce(sum(b.adjusted),0)::float as adj from leave_balances b join leave_types t on t.id = b.leave_type_id where b.employee_id = ${emp.id} and t.encashable`;
    expect(before!.adj - after!.adj).toBeCloseTo(encashed, 1); // encashed leave can't be used again
  });

  it("lets an employee resign, withdraw before HR accepts, and HR accept or withdraw", async () => {
    const r = await priya.post("/ess/resignation", { reason: "Higher studies" });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("requested");
    expect(lastEmailTo("nisha.trivedi@strats360.com")?.subject).toBe("Resignation: Priya Vaghela");
    expect((await priya.post("/ess/resignation", { reason: "Again" })).status).toBe(409);
    expect((await priya.get("/ess/exit")).body.exit.status).toBe("requested");
    expect((await priya.post("/ess/resignation/withdraw")).status).toBe(200);
    expect((await priya.get("/ess/exit")).body.exit).toBeNull();
    const again = await priya.post("/ess/resignation", { reason: "Higher studies", proposedLastDay: addDays(20) });
    const before = (await sql`select status from employees where id = (select employee_id from employee_exits where id = ${again.body.id})`)[0]!.status;
    // HR can't draft a settlement until the resignation is accepted
    expect((await krupa.req("PUT", `/admin/exits/${again.body.id}/settlement`, { manual: [], tds: 0 })).status).toBe(400);
    const acc = await nisha.post(`/admin/exits/${again.body.id}/accept`, { lastWorkingDay: addDays(25) });
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe("notice");
    expect((await priya.post("/ess/resignation/withdraw")).status).toBe(400);
    const me = (await priya.get("/ess/exit")).body.exit;
    expect(me).toMatchObject({ status: "notice", lastWorkingDay: addDays(25) });
    expect(me.settlement).toBeNull();
    const cancel = await nisha.post(`/admin/exits/${again.body.id}/cancel`, { reason: "Resignation withdrawn after discussion" });
    expect(cancel.status).toBe(200);
    const [e] = await sql`select status, last_working_day from employees where id = (select employee_id from employee_exits where id = ${again.body.id})`;
    expect(e).toMatchObject({ status: before, last_working_day: null });
  });

  it("closes a settlement where the employee owes the company", async () => {
    const [short] = (await sql`
      select e.id from employees e join tenants t on t.id = e.tenant_id
      where t.code = 'TN-0142' and e.status = 'active' and e.user_id is null and e.date_of_joining > current_date - interval '3 years'
      order by e.date_of_joining desc limit 1`) as any;
    const x = (await nisha.post("/admin/exits", { employeeId: short.id, type: "resignation", resignationDate: addDays(-3), lastWorkingDay: addDays(-1), reason: "Personal" })).body;
    for (const key of ["assets", "handover", "access", "finance"]) await nisha.post(`/admin/exits/${x.id}/clearance`, { key, done: true });
    const draft = await krupa.req("PUT", `/admin/exits/${x.id}/settlement`, { manual: [], tds: 0, encashDays: Object.fromEntries(((await krupa.get(`/admin/exits/${x.id}`)).body.preview.leave as any[]).map((l) => [l.leaveTypeId, 0])) });
    expect(draft.body.settlement.lines.find((l: any) => l.key === "notice_recovery")).toBeTruthy(); // served 3 of 30 days
    expect(draft.body.netAmount).toBeLessThan(0);
    expect((await kunal.post(`/admin/exits/${x.id}/approve`)).status).toBe(200);
    const accounts = (await kunal.get("/admin/payments/accounts")).body;
    const account = (accounts.rows ?? accounts).find((a: any) => a.active);
    expect((await krupa.post(`/admin/exits/${x.id}/pay`, { bankAccountId: account.id, paymentDate: todayIST() })).status).toBe(400);
    const s = await kunal.post(`/admin/exits/${x.id}/settle`, { settledOn: todayIST(), method: "recovered", reference: "Cheque 004512" });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe("settled");
  });
});
