import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { Client, env, login } from "./helpers";
import { calculateRun } from "../src/services/payroll";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let kunal: Client, priya: Client;
let tid = "", priyaId = "", catId = "";
const runs: string[] = [];
let before: unknown;

function form(data: Record<string, unknown>) {
  const f = new FormData();
  f.set("data", JSON.stringify(data));
  return f;
}

beforeAll(async () => {
  [kunal, priya] = await Promise.all([login("kunal.shah@strats360.com"), login("priya.vaghela@strats360.com")]);
  [{ id: priyaId, tid }] = (await sql`select id, tenant_id as tid from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ f: before }] = (await sql`select settings -> 'fbp' as f from tenants where id = ${tid}`) as any;
});
afterAll(async () => {
  for (const id of runs) await sql`delete from payroll_runs where id = ${id}`;
  await sql`delete from reimbursement_claims where category_id = ${catId}`;
  await sql`delete from reimbursement_categories where id = ${catId}`;
  await sql`delete from fbp_declarations where employee_id = ${priyaId}`;
  await sql`update tenants set settings = case when ${before === null}::boolean then settings - 'fbp' else jsonb_set(settings, '{fbp}', ${sql.json(before as any)}) end where id = ${tid}`;
  await sql.end();
  await (db as any).$client?.end?.();
});

async function runFor(month: string) {
  const [ent] = (await sql`select id from legal_entities where tenant_id = ${tid} and is_default`) as any;
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  const [r] = (await sql`insert into payroll_runs (id, tenant_id, entity_id, month, period_start, period_end, status, kind, frequency)
    values (gen_random_uuid()::text, ${tid}, ${ent.id}, ${month}, ${`${month}-01`}, ${end}, 'draft', 'regular', 'monthly') returning id`) as any;
  runs.push(r.id);
  await calculateRun(db, tid, r.id, null, { assumePresent: true });
  const [item] = (await sql`select * from payroll_items where run_id = ${r.id} and employee_id = ${priyaId}`) as any;
  return item;
}

describe("flexible benefit plan", () => {
  it("lets an employee declare a plan within the caps, and HR approve it", async () => {
    expect((await kunal.patch("/admin/org/settings", { fbp: { enabled: true, heads: [{ code: "fuel", label: "Fuel", annualCap: 21600, newRegime: true }, { code: "fuel", label: "Fuel 2", annualCap: 1, newRegime: true }] } })).status).toBe(422);
    expect((await kunal.patch("/admin/org/settings", { fbp: { enabled: true, autoApprove: false, heads: [{ code: "fuel", label: "Fuel and car", annualCap: 21600, newRegime: true }, { code: "lta", label: "Leave travel", annualCap: 50000, newRegime: false }] } })).status).toBe(200);
    const g = (await priya.get("/ess/fbp")).body;
    expect(g).toMatchObject({ enabled: true, fy: "2026-27", regime: "old" });
    expect(g.heads.map((h: any) => h.code)).toEqual(["fuel", "lta"]);
    expect((await priya.req("PUT", "/ess/fbp", { allocations: { fuel: 30000 } })).body.error?.message ?? "").toMatch(/at most 21,600/);
    const put = await priya.req("PUT", "/ess/fbp", { allocations: { fuel: 21600, lta: 0 } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ status: "submitted", total: 21600 });
    const list = (await kunal.get("/admin/payroll/fbp")).body;
    const row = list.rows.find((r: any) => r.employeeId === priyaId);
    expect(row).toMatchObject({ total: 21600, status: "submitted" });
    expect((await kunal.post(`/admin/payroll/fbp/${row.id}/decision`, { decision: "rejected" })).status).toBe(400);
    expect((await kunal.post(`/admin/payroll/fbp/${row.id}/decision`, { decision: "approved" })).status).toBe(200);
  });

  it("holds the benefit back from special allowance, pays claims from it, and pays the rest at year end", async () => {
    const nov = await runFor("2027-01");
    expect(nov.fbp_credit).toEqual({ fuel: 1800 });
    expect(nov.warnings.join(" ")).toMatch(/Flexible benefits of ₹1,800 held back/);
    const special = nov.earnings.find((e: any) => e.code === "special").amount;
    expect(special).toBeGreaterThan(0);

    const [cat] = (await sql`insert into reimbursement_categories (id, tenant_id, name, approval, fbp_head, receipt_required_above) values (gen_random_uuid()::text, ${tid}, 'FBP fuel test', 'finance', 'fuel', 100000) returning id`) as any;
    catId = cat.id;
    const over = await priya.req("POST", "/ess/claims", form({ categoryId: catId, expenseDate: "2026-11-15", amount: 2000, description: "Fuel" }));
    expect(over.status).toBe(400);
    expect(over.body.error?.message ?? over.body.message).toMatch(/1,800.*left to claim/);
    const ok = await priya.req("POST", "/ess/claims", form({ categoryId: catId, expenseDate: "2026-11-15", amount: 1200, description: "Fuel" }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    await sql`update reimbursement_claims set status = 'approved', finance_approved_at = now() where category_id = ${catId}`;

    const mar = await runFor("2027-03");
    const payout = mar.earnings.find((e: any) => e.label === "Unclaimed flexible benefits");
    // Jan and Mar credits (1,800 each) less the 1,200 claimed
    expect(payout?.amount).toBe(2400);
    expect((await priya.get("/ess/fbp")).body.balances.fuel).toMatchObject({ credited: 3600, claimed: 1200 });
  });
});
