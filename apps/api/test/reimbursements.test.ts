import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, lastEmailTo, login } from "./helpers";

let priya: Client, hardik: Client, kunal: Client, krupa: Client, nisha: Client;
let cats: Record<string, any> = {};
const today = todayIST();

function form(data: Record<string, unknown>, files: File[] = []) {
  const f = new FormData();
  f.set("data", JSON.stringify(data));
  for (const x of files) f.append("files", x);
  return f;
}
const pdf = () => new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], "bill.pdf", { type: "application/pdf" });
/** A weekday-independent past date in this month (or today when it's the 1st). */
const pastDay = (n: number) => {
  const d = new Date(Date.parse(today + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
  return d;
};

beforeAll(async () => {
  [priya, hardik, kunal, krupa, nisha] = await Promise.all(
    ["priya.vaghela", "hardik.mehta", "kunal.shah", "krupa.joshi", "nisha.trivedi"].map((u) => login(`${u}@strats360.com`)),
  );
  const r = await priya.get("/ess/claims");
  expect(r.status).toBe(200);
  cats = Object.fromEntries(r.body.categories.map((c: any) => [c.name, c]));
});

describe("Reimbursement categories", () => {
  it("lists the policy categories; only admins configure them", async () => {
    expect(Object.keys(cats)).toEqual(expect.arrayContaining(["Travel", "Food", "Fuel", "Hotel", "Office expenses"]));
    expect(Number(cats.Fuel.ratePerKm)).toBe(8);
    expect((await hardik.post("/admin/reimbursements/categories", { name: "Gym" })).status).toBe(403);
    expect((await kunal.post("/admin/reimbursements/categories", { name: "Per km", limitPeriod: "km" })).status).toBe(400);
    const c = await kunal.post("/admin/reimbursements/categories", { name: "Training", limitAmount: 10000, approval: "manager_finance" });
    expect(c.status).toBe(201);
    const p = await kunal.patch(`/admin/reimbursements/categories/${c.body.id}`, { active: false });
    expect(p.body.active).toBe(false);
    expect(p.body.approval).toBe("manager_finance"); // PATCH keeps other fields
  });
});

describe("Employee claims", () => {
  let foodId = "";
  it("submits a claim that goes to the reporting manager", async () => {
    const r = await priya.req("POST", "/ess/claims", form({ categoryId: cats.Food.id, expenseDate: pastDay(1), amount: 320, description: "Working lunch" }));
    expect(r.status).toBe(201);
    expect(r.body.claim.status).toBe("pending_manager");
    expect(r.body.claim.code).toMatch(/^RB-\d+$/);
    expect(r.body.overLimit.over).toBe(false);
    foodId = r.body.claim.id;
  });

  it("blocks duplicates, future dates and missing receipts", async () => {
    const dup = await priya.req("POST", "/ess/claims", form({ categoryId: cats.Food.id, expenseDate: pastDay(1), amount: 320, description: "Working lunch" }));
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toMatch(/duplicate/);
    expect((await priya.req("POST", "/ess/claims", form({ categoryId: cats.Food.id, expenseDate: "2099-01-01", amount: 100, description: "Lunch" }))).status).toBe(400);
    const noReceipt = await priya.req("POST", "/ess/claims", form({ categoryId: cats["Client meetings"].id, expenseDate: pastDay(2), amount: 2000, description: "Client lunch" }));
    expect(noReceipt.status).toBe(400);
    expect(noReceipt.body.error.message).toMatch(/receipt/i);
    const ok = await priya.req("POST", "/ess/claims", form({ categoryId: cats["Client meetings"].id, expenseDate: pastDay(2), amount: 2000, project: "Torrent Power", description: "Client lunch" }, [pdf()]));
    expect(ok.status).toBe(201);
    const detail = (await priya.get(`/ess/claims/${ok.body.claim.id}`)).body;
    expect(detail.receiptFiles).toHaveLength(1);
    const file = await priya.get(`/ess/claims/receipts/${detail.receiptFiles[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
  });

  it("computes fuel from km x rate", async () => {
    const r = await priya.req("POST", "/ess/claims", form({ categoryId: cats.Fuel.id, expenseDate: pastDay(3), km: 42, description: "Client visit" }));
    expect(r.status).toBe(201);
    expect(Number(r.body.claim.amount)).toBe(336);
  });

  it("employees can cancel claims still waiting", async () => {
    expect((await priya.post(`/ess/claims/${foodId}/cancel`)).body.status).toBe("cancelled");
    expect((await priya.post(`/ess/claims/${foodId}/cancel`)).status).toBe(400);
  });

  it("employees can't use the admin API", async () => {
    expect((await priya.get("/admin/reimbursements/claims")).status).toBe(403);
  });
});

describe("Approval chain", () => {
  let overId = "";
  it("routes an over-limit claim through finance after the manager", async () => {
    const r = await priya.req("POST", "/ess/claims", form({ categoryId: cats.Food.id, expenseDate: pastDay(4), amount: 650, description: "Team dinner after release" }, [pdf()]));
    expect(r.body.claim.overLimit).toBe(true);
    overId = r.body.claim.id;
    const queue = (await hardik.get("/admin/reimbursements/claims?mine=1")).body;
    expect(queue.some((x: any) => x.id === overId)).toBe(true);
    const m = await hardik.post(`/admin/reimbursements/claims/${overId}/decision`, { decision: "approved" });
    expect(m.status).toBe(200);
    expect(m.body.status).toBe("pending_finance");
    // the manager can't approve the finance stage
    expect((await hardik.post(`/admin/reimbursements/claims/${overId}/decision`, { decision: "approved" })).status).toBe(403);
    const f = await kunal.post(`/admin/reimbursements/claims/${overId}/decision`, { decision: "approved" });
    expect(f.body.status).toBe("approved");
    expect(lastEmailTo("priya.vaghela@strats360.com")?.subject).toMatch(/approved/);
    expect((await kunal.post(`/admin/reimbursements/claims/${overId}/decision`, { decision: "approved" })).status).toBe(400);
  });

  it("blocks self-approval and requires a reason to reject", async () => {
    const own = (await hardik.get("/admin/reimbursements/claims?status=pending_manager")).body;
    expect(own.length).toBeGreaterThan(0);
    const mine = await hardik.req("POST", "/admin/reimbursements/claims", form({ employeeId: undefined, categoryId: cats.Food.id, expenseDate: pastDay(1), amount: 100, description: "x" }));
    expect(mine.status).toBe(403); // managers can't file on behalf
    const hardikClaim = (await kunal.get("/admin/reimbursements/claims?q=STL-0001")).body.find((x: any) => x.status === "pending_manager");
    expect(hardikClaim).toBeTruthy();
    const self = await hardik.post(`/admin/reimbursements/claims/${hardikClaim.id}/decision`, { decision: "approved" });
    expect(self.status).toBe(403);
    expect((await kunal.post(`/admin/reimbursements/claims/${hardikClaim.id}/decision`, { decision: "rejected" })).status).toBe(400);
    const rej = await kunal.post(`/admin/reimbursements/claims/${hardikClaim.id}/decision`, { decision: "rejected", note: "Bill is for a personal connection" });
    expect(rej.body.status).toBe("rejected");
  });

  it("managers see only their team; HR and payroll see everyone", async () => {
    const team = (await hardik.get("/admin/reimbursements/claims")).body;
    expect(team.every((x: any) => x.managerName === "Hardik Mehta")).toBe(true);
    const amit = (await kunal.get("/admin/reimbursements/claims?q=STL-0152")).body[0];
    expect((await hardik.get(`/admin/reimbursements/claims/${amit.id}`)).status).toBe(404);
    expect((await hardik.post(`/admin/reimbursements/claims/${amit.id}/decision`, { decision: "approved" })).status).toBe(403);
    const all = (await krupa.get("/admin/reimbursements/claims")).body;
    expect(all.length).toBeGreaterThan(team.length);
    expect((await nisha.get("/admin/reimbursements/claims")).body.length).toBe(all.length);
    expect((await krupa.post(`/admin/reimbursements/claims/${amit.id}/decision`, { decision: "approved" })).status).toBe(403);
  });

  it("bulk approves and reports per-claim errors", async () => {
    const queue = (await kunal.get("/admin/reimbursements/claims?mine=1")).body;
    const ids = queue.slice(0, 2).map((x: any) => x.id);
    const r = await kunal.post("/admin/reimbursements/claims/bulk-decision", { ids: [...ids, "nope"], decision: "approved" });
    expect(r.body.done).toBe(ids.length);
    expect(r.body.errors).toHaveLength(1);
  });

  it("summarises and exports", async () => {
    const s = (await kunal.get("/admin/reimbursements/summary")).body;
    expect(s.pending.count).toBeGreaterThan(0);
    expect(s.approvedUnpaid.amount).toBeGreaterThan(0);
    const csv = await kunal.get("/admin/reimbursements/export.csv");
    expect(csv.status).toBe(200);
    expect(csv.body).toContain("RB-1042");
    expect((await hardik.get("/admin/reimbursements/export.csv")).status).toBe(403);
  });
});
