import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, lastEmailTo, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let priya: Client, hardik: Client, nisha: Client;
let priyaId = "";
let cl = "";
const year = Number(todayIST().slice(0, 4));
const made: string[] = [];

/** Weekdays in the year with no leave for Priya yet. */
async function freeWeekdays(n: number) {
  const taken = await sql`select start_date::text as s, end_date::text as e from leave_requests where employee_id = ${priyaId} and status in ('pending','approved')`;
  const hol = new Set((await sql`select date::text as d from holidays`).map((h) => h.d));
  const out: string[] = [];
  for (let d = new Date(Date.UTC(year, 0, 5)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || hol.has(iso) || taken.some((t) => t.s <= iso && t.e >= iso)) {
      out.length = 0;
      continue;
    }
    out.push(iso);
    if (out.length === n) return out;
  }
  throw new Error("no free days");
}

beforeAll(async () => {
  [priya, hardik, nisha] = await Promise.all([login("priya.vaghela@strats360.com"), login("hardik.mehta@strats360.com"), login("nisha.trivedi@strats360.com")]);
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: cl }] = (await sql`select lt.id from leave_types lt join tenants t on t.id = lt.tenant_id where t.code = 'TN-0142' and lt.code = 'EL'`) as any;
  await sql`update leave_balances set adjusted = adjusted + 10 where employee_id = ${priyaId} and leave_type_id = ${cl} and year = ${year}`;
});
afterAll(async () => {
  if (made.length) await sql`update leave_requests set status = 'cancelled' where id in ${sql(made)} and status = 'pending'`;
  await sql`update tenants set settings = settings - 'approvals' where code = 'TN-0142'`;
  await sql.end();
});

describe("Approval chains", () => {
  it("saves the company's chains", async () => {
    expect((await hardik.req("PUT", "/admin/org/approvals", { leave: { steps: ["manager"], longLeaveDays: null, longSteps: ["hr"] }, attendance: { steps: ["manager"] } })).status).toBe(403);
    expect((await nisha.req("PUT", "/admin/org/approvals", { leave: { steps: [], longLeaveDays: null, longSteps: ["hr"] }, attendance: { steps: ["manager"] } })).status).toBe(422);
    const r = await nisha.req("PUT", "/admin/org/approvals", { leave: { steps: ["manager", "hr"], longLeaveDays: 3, longSteps: ["manager", "skip_manager", "hr"] }, attendance: { steps: ["manager", "hr"] } });
    expect(r.status).toBe(200);
    expect((await hardik.get("/admin/org/approvals")).body.leave.longLeaveDays).toBe(3);
  });

  it("takes leave through manager, then HR", async () => {
    const [d] = await freeWeekdays(1);
    const req = await priya.post("/ess/leave", { leaveTypeId: cl, startDate: d, endDate: d, halfDay: false, reason: "Family function" });
    expect(req.status).toBe(201);
    const id = req.body.id ?? req.body.request?.id;
    made.push(id);
    const mine = (await hardik.get("/admin/leave/requests?status=pending")).body.find((x: any) => x.id === id);
    expect(mine.waitingOn).toMatchObject({ step: "manager", label: "Hardik Mehta", at: 1, of: 2, yourTurn: true });
    const first = await hardik.post(`/admin/leave/requests/${id}/decision`, { decision: "approved" });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("pending");
    const after = (await hardik.get("/admin/leave/requests?status=pending")).body.find((x: any) => x.id === id);
    expect(after.waitingOn).toMatchObject({ step: "hr", label: "HR", at: 2, yourTurn: false });
    const again = await hardik.post(`/admin/leave/requests/${id}/decision`, { decision: "approved" });
    expect(again.status).toBe(403);
    expect(again.body.error.message).toMatch(/waiting for HR/);
    const final = await nisha.post(`/admin/leave/requests/${id}/decision`, { decision: "approved" });
    expect(final.status).toBe(200);
    expect(final.body.status).toBe("approved");
    const [row] = await sql`select approvals from leave_requests where id = ${id}`;
    expect((row!.approvals as any[]).map((a) => [a.step, a.name])).toEqual([["manager", "Hardik Mehta"], ["hr", "Nisha Trivedi"]]);
  });

  it("adds the manager's manager for long leave, and emails them", async () => {
    const days = await freeWeekdays(4);
    const req = await priya.post("/ess/leave", { leaveTypeId: cl, startDate: days[0], endDate: days[3], halfDay: false, reason: "Trip" });
    expect(req.status).toBe(201);
    const id = req.body.id ?? req.body.request?.id;
    made.push(id);
    await hardik.post(`/admin/leave/requests/${id}/decision`, { decision: "approved" });
    expect(lastEmailTo("kunal.shah@strats360.com")?.subject).toBe("Leave to approve: Priya Vaghela");
    const w = (await nisha.get("/admin/leave/requests?status=pending")).body.find((x: any) => x.id === id).waitingOn;
    expect(w).toMatchObject({ step: "skip_manager", label: "Kunal Shah (skip level)", at: 2, of: 3, yourTurn: true }); // HR can act on any step
    // a rejection at any step ends it
    const r = await nisha.post(`/admin/leave/requests/${id}/decision`, { decision: "rejected", note: "Quarter-end freeze" });
    expect(r.body.status).toBe("rejected");
  });

  it("takes attendance corrections through the chain too", async () => {
    const d = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await sql`delete from attendance_corrections where employee_id = ${priyaId} and date = ${d}`;
    const c = await priya.post("/ess/attendance/corrections", { date: d, issue: "Missed punch-out", requestedCheckOut: "18:30", reason: "Forgot" });
    expect(c.status).toBe(201);
    const id = c.body.id;
    expect((await hardik.post(`/admin/attendance/corrections/${id}/decision`, { decision: "approved" })).status).toBe(200);
    expect((await sql`select status from attendance_corrections where id = ${id}`)[0]!.status).toBe("pending");
    expect((await hardik.get("/admin/attendance/corrections?status=pending")).body.find((x: any) => x.id === id).waitingOn.label).toBe("HR");
    expect((await nisha.post(`/admin/attendance/corrections/${id}/decision`, { decision: "approved" })).status).toBe(200);
    expect((await sql`select status from attendance_corrections where id = ${id}`)[0]!.status).toBe("approved");
  });
});
