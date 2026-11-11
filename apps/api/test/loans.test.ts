import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";
import { loansToRecover } from "../src/services/loans";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let priya: Client, krupa: Client, kunal: Client, hardik: Client;
let priyaId = "";
let tenantId = "";
let month = "";
let loanId = "";
let runId = "";

beforeAll(async () => {
  [priya, krupa, kunal, hardik] = await Promise.all(["priya.vaghela", "krupa.joshi", "kunal.shah", "hardik.mehta"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  if (runId) await sql`delete from payroll_runs where id = ${runId}`;
  await sql`delete from employee_loans where tenant_id = ${tenantId}`;
  await sql`update tenants set settings = settings - 'loanPolicy' where id = ${tenantId}`;
  await sql.end();
  await db.$client.end();
});

describe("Loans and advances", () => {
  it("lets an employee ask for an advance within the company's limits", async () => {
    const mine = (await priya.get("/ess/loans")).body;
    expect(mine.policy).toMatchObject({ requests: true, advanceMaxMonths: 3 });
    expect(mine.policy.advanceMax).toBe(118200); // 100% of monthly gross
    const big = await priya.post("/ess/loans", { type: "advance", amount: 200000, months: 2, reason: "Medical" });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toMatch(/up to 100% of your monthly gross/);
    const r = await priya.post("/ess/loans", { type: "advance", amount: 30000, months: 3, reason: "Family medical expense" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: "ADV-0001", status: "requested" });
    loanId = r.body.id;
    month = r.body.startMonth;
    expect(month >= todayIST().slice(0, 7)).toBe(true);
    expect((await priya.post("/ess/loans", { type: "advance", amount: 1000, months: 1, reason: "Again" })).status).toBe(409);
  });

  it("goes through approval and payout, and HR sees it", async () => {
    expect((await hardik.post(`/admin/payroll/loans/${loanId}/decision`, { decision: "approved", amount: 30000, months: 3, interestPct: 0, startMonth: month })).status).toBe(403);
    expect((await krupa.post(`/admin/payroll/loans/${loanId}/decision`, { decision: "rejected", note: "" })).status).toBe(422);
    expect((await krupa.post(`/admin/payroll/loans/${loanId}/decision`, { decision: "approved", amount: 30000, months: 3, interestPct: 0, startMonth: month })).status).toBe(200);
    expect((await krupa.post(`/admin/payroll/loans/${loanId}/disburse`, { paidOn: todayIST(), method: "bank_transfer", reference: "UTR123" })).status).toBe(200);
    const list = (await krupa.get("/admin/payroll/loans")).body;
    const row = list.rows.find((r: any) => r.id === loanId);
    expect(row).toMatchObject({ status: "active", emi: 10000, outstanding: 30000, employeeName: "Priya Vaghela", nextMonth: month });
    expect(list.summary).toMatchObject({ active: 1, outstanding: 30000, monthly: 10000 });
  });

  it("recovers the instalment through payroll", async () => {
    const run = await krupa.post("/admin/payroll/runs", { month });
    expect(run.status).toBe(201);
    runId = run.body.id;
    await krupa.post(`/admin/payroll/runs/${runId}/calculate`);
    const [item] = await sql`select deductions from payroll_items where run_id = ${runId} and employee_id = ${priyaId}`;
    const line = (item!.deductions as any[]).find((d) => /Salary advance recovery ADV-0001 \(1 of 3\)/.test(d.label));
    expect(line?.amount).toBe(10000);
    // it's in open payroll, so it shows as pending, not recovered
    const d = (await krupa.get(`/admin/payroll/loans/${loanId}`)).body;
    expect(d.loan).toMatchObject({ recovered: 0, pending: 10000 });
    // the line can't be removed by hand
    const [adj] = await sql`select id from payroll_adjustments where run_id = ${runId} and source = 'loan'`;
    expect((await krupa.req("DELETE", `/admin/payroll/runs/${runId}/adjustments/${adj!.id}`)).body.error.message).toMatch(/pause it under Payroll › Loans/);
    // locking the payroll makes it recovered (the demo month has open attendance corrections,
    // which block the approve button, so lock it directly here)
    await sql`update payroll_runs set status = 'approved', approved_at = now() where id = ${runId}`;
    expect((await krupa.get(`/admin/payroll/loans/${loanId}`)).body.loan).toMatchObject({ recovered: 10000, pending: 0, outstanding: 20000 });
  });

  it("can pause a month, take a repayment, and is recovered in full and final", async () => {
    const next = (await krupa.get(`/admin/payroll/loans/${loanId}`)).body.firstOpenMonth;
    expect((await krupa.post(`/admin/payroll/loans/${loanId}/pause`, { month, paused: true })).status).toBe(400); // locked
    const p = await krupa.post(`/admin/payroll/loans/${loanId}/pause`, { month: next, paused: true });
    expect(p.body.skipMonths).toEqual([next]);
    const sched = (await krupa.get(`/admin/payroll/loans/${loanId}`)).body.schedule;
    expect(sched.map((x: any) => x.month)).not.toContain(next);
    expect((await krupa.post(`/admin/payroll/loans/${loanId}/repayment`, { amount: 25000, paidOn: todayIST() })).status).toBe(400);
    expect((await krupa.post(`/admin/payroll/loans/${loanId}/repayment`, { amount: 5000, paidOn: todayIST(), note: "Cash" })).status).toBe(201);
    expect((await loansToRecover(db, tenantId, priyaId))).toEqual([{ key: `loan:${loanId}`, label: "Salary advance ADV-0001 balance", amount: 15000 }]);
    const ess = (await priya.get("/ess/loans")).body.rows[0];
    expect(ess).toMatchObject({ code: "ADV-0001", outstanding: 15000, recovered: 15000 });
    expect(ess.requestedBy).toBeUndefined();
  });

  it("closes when repaid, or can be written off", async () => {
    const r = await krupa.post(`/admin/payroll/loans/${loanId}/repayment`, { amount: 15000, paidOn: todayIST() });
    expect(r.body.closed).toBe(true);
    expect((await krupa.get(`/admin/payroll/loans/${loanId}`)).body.loan.status).toBe("closed");

    const e = await kunal.get("/admin/employees?q=STL-0057");
    const loan = await krupa.post("/admin/payroll/loans", { employeeId: e.body.rows[0].id, type: "loan", amount: 120000, months: 12, interestPct: 9, startMonth: (await krupa.get("/admin/payroll/loans")).body.firstOpenMonth, reason: "Housing deposit", paid: { paidOn: todayIST(), method: "cheque", reference: "000123" } });
    expect(loan.status).toBe(201);
    expect(loan.body).toMatchObject({ code: "LN-0001", status: "active" });
    const d = (await krupa.get(`/admin/payroll/loans/${loan.body.id}`)).body;
    expect(d.loan.emi).toBe(10495);
    expect(d.loan.payable).toBeGreaterThan(120000);
    expect((await krupa.post(`/admin/payroll/loans/${loan.body.id}/write-off`, { note: "Waived on compassionate grounds" })).status).toBe(200);
    const [a] = await sql`select summary from audit_logs where action = 'loans.write_off' order by created_at desc limit 1`;
    expect(a!.summary).toMatch(/^Wrote off ₹1,2\d,\d{3} on LN-0001: Waived/);
  });
});
