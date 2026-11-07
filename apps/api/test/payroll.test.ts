import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, lastEmailTo, login } from "./helpers";

let krupa: Client, kunal: Client, nisha: Client, priya: Client;
const month = todayIST().slice(0, 7);
let runId = "";
let priyaId = "";

beforeAll(async () => {
  [krupa, kunal, nisha, priya] = await Promise.all([
    login("krupa.joshi@strats360.com"),
    login("kunal.shah@strats360.com"),
    login("nisha.trivedi@strats360.com"),
    login("priya.vaghela@strats360.com"),
  ]);
  priyaId = (await krupa.get("/admin/employees?q=STL-0042")).body.rows[0].id;
});

describe("payroll permissions", () => {
  it("HR admin can view payroll but not run it; employees can't see it", async () => {
    expect((await nisha.get("/admin/payroll/runs")).status).toBe(200);
    expect((await nisha.post("/admin/payroll/runs", { month })).status).toBe(403);
    expect((await priya.get("/admin/payroll/runs")).status).toBe(403);
  });
});

describe("salary structures", () => {
  it("previews a structure from CTC", async () => {
    const r = await krupa.post("/admin/payroll/template/preview", { annualCtc: 1440000 });
    expect(r.body.gross).toBe(118200);
  });
  it("blocks revisions inside a locked month", async () => {
    const r = await krupa.post(`/admin/payroll/structures/${priyaId}`, { effectiveFrom: "2026-06-01", annualCtc: 1500000 });
    expect(r.status).toBe(400);
  });
  it("lists current structures", async () => {
    const r = await krupa.get("/admin/payroll/structures?q=Priya");
    expect(r.body[0].annualCtc).toBe(1440000);
  });
});

describe("payroll run lifecycle", () => {
  it("creates the current month and refuses duplicates", async () => {
    const r = await krupa.post("/admin/payroll/runs", { month });
    expect(r.status).toBe(201);
    runId = r.body.id;
    expect((await krupa.post("/admin/payroll/runs", { month })).status).toBe(409);
  });
  it("reports inputs", async () => {
    const r = await krupa.get(`/admin/payroll/runs/${runId}/inputs`);
    expect(r.body.employees).toBeGreaterThan(200);
    expect(r.body.pendingCorrections).toBeGreaterThanOrEqual(0);
  });
  it("calculates with continuous TDS from year-to-date history", async () => {
    const r = await krupa.post(`/admin/payroll/runs/${runId}/calculate`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("calculated");
    expect(r.body.totals.employees).toBeGreaterThan(200);
    const items = (await krupa.get(`/admin/payroll/runs/${runId}/items?q=STL-0042`)).body;
    const p = items[0];
    expect(p.gross).toBeGreaterThan(0);
    expect(p.net).toBe(Math.round((p.gross - p.totalDeductions + Number(p.reimbursement)) * 100) / 100);
    // Priya's October TDS and this month's should be close (same salary, YTD aware)
    expect(p.previousNet).not.toBeNull();
    const runs = (await krupa.get("/admin/payroll/runs")).body;
    const prev = runs.find((x: any) => x.month < month && x.status === "paid");
    const prevItem = (await krupa.get(`/admin/payroll/runs/${prev.id}/items?q=STL-0042`)).body[0];
    expect(p.tds).toBeGreaterThan(0);
    expect(Math.abs(p.tds - prevItem.tds)).toBeLessThanOrEqual(5);
  });
  it("pays approved claims with salary, outside gross and TDS", async () => {
    const k = (await krupa.get(`/admin/payroll/runs/${runId}/items?q=STL-0091`)).body[0];
    expect(Number(k.reimbursement)).toBeGreaterThanOrEqual(950); // RB-1036, approved this month
    expect(Number(k.net)).toBeCloseTo(Number(k.gross) - Number(k.totalDeductions) + Number(k.reimbursement), 2);
    // last month's run already settled RB-1039 for Amit
    const runs = (await krupa.get("/admin/payroll/runs")).body;
    const prev = runs.find((x: any) => x.month < month && x.status === "paid");
    const amit = (await krupa.get(`/admin/payroll/runs/${prev.id}/items?q=STL-0152`)).body[0];
    expect(Number(amit.reimbursement)).toBe(1240);
    const claim = (await kunal.get("/admin/reimbursements/claims?q=RB-1039")).body[0];
    expect(claim.status).toBe("paid");
    expect((await kunal.get("/admin/reimbursements/claims?q=RB-1036")).body[0].payment).toMatch(/payroll/);
  });
  it("adds a one-time incentive and recalculates", async () => {
    const before = (await krupa.get(`/admin/payroll/runs/${runId}/items?q=STL-0042`)).body[0];
    const r = await krupa.post(`/admin/payroll/runs/${runId}/adjustments`, { employeeId: priyaId, kind: "earning", label: "Project bonus", amount: 10000 });
    expect(r.status).toBe(201);
    const after = (await krupa.get(`/admin/payroll/runs/${runId}/items?q=STL-0042`)).body[0];
    expect(after.gross).toBe(before.gross + 10000);
    expect(after.tds).toBeGreaterThanOrEqual(before.tds);
  });
  it("overrides LOP and holds a salary", async () => {
    const id = (await krupa.get("/admin/employees?q=STL-0057")).body.rows[0].id;
    expect((await krupa.patch(`/admin/payroll/runs/${runId}/items/${id}`, { lopOverride: 2 })).status).toBe(200);
    const it = (await krupa.get(`/admin/payroll/runs/${runId}/items?q=STL-0057`)).body[0];
    expect(it.lopOverride).toBe(2);
    expect(it.paidDays).toBe(it.daysInMonth - 2);
    expect((await krupa.patch(`/admin/payroll/runs/${runId}/items/${id}`, { onHold: true, holdReason: "Bank details being verified" })).status).toBe(200);
    expect((await krupa.get(`/admin/payroll/runs/${runId}`)).body.totals.onHold).toBe(1);
  });
  it("enforces maker-checker and blocks on pending corrections", async () => {
    expect((await krupa.post(`/admin/payroll/runs/${runId}/approve`)).status).toBe(403);
    const corr = (await nisha.get("/admin/attendance/corrections?status=pending")).body.filter((x: any) => x.date.startsWith(month));
    if (corr.length) {
      expect((await kunal.post(`/admin/payroll/runs/${runId}/approve`)).status).toBe(400);
      await nisha.post("/admin/attendance/corrections/bulk-decision", { ids: corr.map((x: any) => x.id), decision: "approved" });
      await krupa.post(`/admin/payroll/runs/${runId}/calculate`);
    }
    const r = await kunal.post(`/admin/payroll/runs/${runId}/approve`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("approved");
    // locked: no more edits
    expect((await krupa.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(400);
    expect((await krupa.post(`/admin/payroll/runs/${runId}/adjustments`, { employeeId: priyaId, kind: "earning", label: "x", amount: 1 })).status).toBe(400);
  });
  it("publishes payslips to self-service and emails employees", async () => {
    expect((await priya.get("/ess/payslips")).body.some((p: any) => p.runId === runId)).toBe(false);
    const r = await kunal.post(`/admin/payroll/runs/${runId}/publish`);
    expect(r.body.held).toBe(1);
    expect(lastEmailTo("priya.vaghela@strats360.com")?.subject).toMatch(/^Payslip for/);
    const slips = (await priya.get("/ess/payslips")).body;
    expect(slips[0].runId).toBe(runId);
    const slip = (await priya.get(`/ess/payslips/${runId}`)).body;
    expect(slip.earnings.some((e: any) => e.label === "Project bonus")).toBe(true);
    expect(slip.employee.name).toBe("Priya Vaghela");
  });
  it("exports a bank file without held salaries", async () => {
    expect((await kunal.post(`/admin/payroll/runs/${runId}/mark-paid`, { paidOn: todayIST() })).status).toBe(400);
    const csv = await kunal.get(`/admin/payroll/runs/${runId}/bank-file.csv`);
    expect(csv.status).toBe(200);
    expect(csv.body).toContain("034501512345"); // Priya's full account in the bank file
    expect(csv.body).not.toContain("STL-0057"); // held
    expect((await kunal.post(`/admin/payroll/runs/${runId}/reopen`, { reason: "Need to fix an error" })).status).toBe(400); // bank file exported
  });
  it("pays salary through a payment batch and marks the run paid", async () => {
    const accounts = (await kunal.get("/admin/payments/accounts")).body;
    const hdfc = accounts.find((a: any) => a.isDefault);
    const body = { type: "salary", payrollRunId: runId, bankAccountId: hdfc.id, paymentDate: todayIST() };
    const prev = await krupa.post("/admin/payments/batches/preview", body);
    expect(prev.status).toBe(200);
    expect(prev.body.warnings.join(" ")).toMatch(/on hold/);
    const b = await krupa.post("/admin/payments/batches", body);
    expect(b.status).toBe(201);
    expect(b.body.code).toMatch(/^PB-\d{4}-S/);
    expect((await krupa.post("/admin/payments/batches", body)).status).toBe(409); // one batch per payroll
    // old run-level paths are closed once a batch pays the run
    expect((await kunal.post(`/admin/payroll/runs/${runId}/mark-paid`, { paidOn: todayIST() })).status).toBe(400);
    expect((await kunal.post(`/admin/payroll/runs/${runId}/reopen`, { reason: "Need to fix an error" })).status).toBe(400);
    expect((await krupa.post(`/admin/payments/batches/${b.body.id}/approve`)).status).toBe(403); // payroll admin can't approve
    expect((await kunal.post(`/admin/payments/batches/${b.body.id}/approve`)).body.status).toBe("approved");
    const file = await krupa.get(`/admin/payments/batches/${b.body.id}/file`);
    expect(file.status).toBe(200);
    expect(file.body).toContain("034501512345");
    const done = await kunal.post(`/admin/payments/batches/${b.body.id}/mark-all-paid`, {});
    expect(done.body.errors).toHaveLength(0);
    const run = (await krupa.get(`/admin/payroll/runs/${runId}`)).body;
    expect(run.status).toBe("paid");
    expect(run.paymentReference).toBe(b.body.code);
    expect((await kunal.get("/admin/reimbursements/claims?q=RB-1036")).body[0].status).toBe("paid");
  });
  it("exports the salary register", async () => {
    const r = await nisha.get(`/admin/payroll/runs/${runId}/register.csv`);
    expect(r.status).toBe(403); // HR admin has view only
    const ok = await krupa.get(`/admin/payroll/runs/${runId}/register.csv`);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("Net pay");
  });
});
