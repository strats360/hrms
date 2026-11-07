import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, lastEmailTo, login } from "./helpers";

let kunal: Client, krupa: Client, nisha: Client, priya: Client, hardik: Client;
let hdfc: any;
const today = todayIST();
const idOf = async (code: string) => (await kunal.get(`/admin/employees?q=${code}`)).body.rows[0].id as string;

beforeAll(async () => {
  [kunal, krupa, nisha, priya, hardik] = await Promise.all(["kunal.shah", "krupa.joshi", "nisha.trivedi", "priya.vaghela", "hardik.mehta"].map((u) => login(`${u}@strats360.com`)));
  hdfc = (await kunal.get("/admin/payments/accounts")).body.find((a: any) => a.isDefault);
});

describe("Debit accounts", () => {
  it("lists accounts without account numbers; only admins change them", async () => {
    const r = await krupa.get("/admin/payments/accounts");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(JSON.stringify(r.body)).not.toContain("50200012345678");
    expect(r.body[0].accountLast4).toBe("5678");
    expect((await krupa.post("/admin/payments/accounts", { label: "X", bankName: "SBI", accountNumber: "12345678", ifsc: "SBIN0000001" })).status).toBe(403);
    const a = await kunal.post("/admin/payments/accounts", { label: "Bonus", bankName: "State Bank of India", accountNumber: "30012345678", ifsc: "SBIN0000001", fileFormat: "generic_csv" });
    expect(a.status).toBe(201);
    expect((await kunal.patch(`/admin/payments/accounts/${a.body.id}`, { active: false })).body.active).toBe(false);
    expect((await priya.get("/admin/payments/accounts")).status).toBe(403);
    expect((await nisha.get("/admin/payments/accounts")).status).toBe(403);
  });
});

describe("Summary and history", () => {
  it("shows seeded salary batches and the failed payment from October", async () => {
    const s = (await krupa.get("/admin/payments/summary")).body;
    expect(s.attention.count).toBeGreaterThanOrEqual(1);
    expect(s.account.bankName).toBe("HDFC Bank");
    const batches = (await krupa.get("/admin/payments/batches?type=salary")).body;
    expect(batches.length).toBeGreaterThanOrEqual(6);
    expect(batches.every((b: any) => b.type === "salary")).toBe(true);
    const att = (await krupa.get("/admin/payments/attention")).body;
    expect(att.find((p: any) => p.employeeCode === "STL-0160")?.failureReason).toMatch(/dormant/);
  });
  it("exports a paid/unpaid report as CSV and Excel", async () => {
    const csv = await krupa.get("/admin/payments/report?status=failed,held");
    expect(csv.status).toBe(200);
    expect(csv.body).toContain("STL-0160");
    const x = await krupa.req("GET", "/admin/payments/report?format=xlsx&type=salary");
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    expect((await hardik.get("/admin/payments/report")).status).toBe(403);
  });
});

describe("Reimbursement batch", () => {
  let batchId = "";
  let claimId = "";
  it("pays approved claims outside payroll", async () => {
    const cats = (await priya.get("/ess/claims")).body.categories;
    const food = cats.find((c: any) => c.name === "Food");
    const f = new FormData();
    f.set("data", JSON.stringify({ categoryId: food.id, expenseDate: today, amount: 410, description: "Lunch at client office" }));
    const c = await priya.req("POST", "/ess/claims", f);
    expect(c.status).toBe(201);
    claimId = c.body.claim.id;
    await hardik.post(`/admin/reimbursements/claims/${claimId}/decision`, { decision: "approved" });
    const all = await krupa.post("/admin/payments/batches/preview", { type: "reimbursement", bankAccountId: hdfc.id, paymentDate: today });
    expect(all.body.lines.some((l: any) => l.employeeCode === "STL-0042")).toBe(true);
    const body = { type: "reimbursement", bankAccountId: hdfc.id, paymentDate: today, claimIds: [claimId] };
    const b = await krupa.post("/admin/payments/batches", body);
    expect(b.status).toBe(201);
    batchId = b.body.id;
    const claim = (await kunal.get(`/admin/reimbursements/claims/${claimId}`)).body;
    expect(claim.payment).toMatch(/In payment batch PB-/);
    // nothing left to pay in a second batch
    expect((await krupa.post("/admin/payments/batches", body)).status).toBe(400);
  });

  it("follows approve, export and reconcile", async () => {
    expect((await krupa.get(`/admin/payments/batches/${batchId}/file`)).status).toBe(400); // not approved
    expect((await kunal.post(`/admin/payments/batches/${batchId}/approve`)).status).toBe(200);
    const file = await krupa.get(`/admin/payments/batches/${batchId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toMatch(/\.csv/); // HDFC ENet
    const detail = (await krupa.get(`/admin/payments/batches/${batchId}`)).body;
    expect(detail.status).toBe("processing");
    const priyaPay = detail.payments.find((p: any) => p.employeeCode === "STL-0042");
    const others = detail.payments.filter((p: any) => p.id !== priyaPay.id);
    const text = ["Customer Reference,Status,UTR,Reason", `${priyaPay.reference},Rejected,,Account dormant`, ...others.map((p: any) => `${p.reference},Success,UTR${p.reference},`), "NOPE-1,Success,X,"].join("\n");
    const fd = new FormData();
    fd.set("file", new File([text], "status.csv", { type: "text/csv" }));
    const r = await krupa.req("POST", `/admin/payments/batches/${batchId}/reconcile`, fd);
    expect(r.status).toBe(200);
    expect(r.body.failed).toBe(1);
    expect(r.body.paid).toBe(others.length);
    expect(r.body.unknown).toEqual(["NOPE-1"]);
    expect(lastEmailTo("priya.vaghela@strats360.com")?.subject).toMatch(/returned by the bank/);
    expect((await kunal.get(`/admin/reimbursements/claims/${claimId}`)).body.status).toBe("approved");
    expect((await krupa.get(`/admin/payments/batches/${batchId}`)).body.status).toBe("completed");
  });

  it("retries a failed payment with the same reference", async () => {
    const detail = (await krupa.get(`/admin/payments/batches/${batchId}`)).body;
    const p = detail.payments.find((x: any) => x.status === "failed");
    expect((await krupa.patch(`/admin/payments/payments/${p.id}`, { status: "pending" })).body.done).toBe(1);
    const again = (await krupa.get(`/admin/payments/batches/${batchId}`)).body;
    expect(again.status).toBe("processing");
    const file = await krupa.get(`/admin/payments/batches/${batchId}/file`);
    expect(file.body).toContain(p.reference);
    expect(file.body.trim().split("\r\n")).toHaveLength(1); // only the retried payment
    expect(file.headers.get("content-disposition")).toMatch(/retry/);
    expect((await krupa.patch(`/admin/payments/payments/${p.id}`, { status: "paid", utr: "HDFCN999" })).status).toBe(200);
    expect((await kunal.get(`/admin/reimbursements/claims/${claimId}`)).body.status).toBe("paid");
    expect((await krupa.patch(`/admin/payments/payments/${p.id}`, { status: "failed", reason: "x" })).status).toBe(400); // paid is final
  });
});

describe("Other payments", () => {
  it("builds a manual batch, blocks duplicates, and enforces maker-checker", async () => {
    const priyaId = await idOf("STL-0042");
    const amitId = await idOf("STL-0152");
    const lines = [{ employeeId: priyaId, amount: 5000, description: "Referral bonus" }, { employeeId: amitId, amount: 7500, description: "Relocation" }];
    expect((await krupa.post("/admin/payments/batches", { type: "other", bankAccountId: hdfc.id, paymentDate: today, lines: [lines[0], lines[0]] })).status).toBe(400);
    const b = await kunal.post("/admin/payments/batches", { type: "other", bankAccountId: hdfc.id, paymentDate: today, label: "Referral and relocation", lines });
    expect(b.status).toBe(201);
    expect(b.body.summary.amount).toBe(12500);
    const pre = await kunal.post("/admin/payments/batches/preview", { type: "other", bankAccountId: hdfc.id, paymentDate: today, lines });
    expect(pre.body.warnings.join(" ")).toMatch(/Possible duplicate/);
    // a draft can still change
    const add = await kunal.post(`/admin/payments/batches/${b.body.id}/lines`, { employeeId: await idOf("STL-0057"), amount: 1000 });
    expect(add.status).toBe(201);
    expect((await kunal.req("DELETE", `/admin/payments/batches/${b.body.id}/lines/${add.body.id}`)).status).toBe(200);
    // super admin may approve their own; a cancelled batch stays cancelled
    expect((await kunal.post(`/admin/payments/batches/${b.body.id}/approve`)).status).toBe(200);
    expect((await kunal.post(`/admin/payments/batches/${b.body.id}/cancel`, { reason: "Paid by cheque instead" })).body.status).toBe("cancelled");
    expect((await kunal.get(`/admin/payments/batches/${b.body.id}/file`)).status).toBe(400);
  });

  it("generates statutory bonus lines", async () => {
    const pre = await krupa.post("/admin/payments/batches/preview", { type: "bonus", bankAccountId: hdfc.id, paymentDate: today, bonus: { fy: "2024-25", percent: 8.33 } });
    expect(pre.status).toBe(200);
    expect(pre.body.summary.count).toBeGreaterThan(0);
    expect(pre.body.lines.every((l: any) => l.amount <= 7000)).toBe(true);
    expect(pre.body.warnings.join(" ")).toMatch(/TDS/);
  });
});
