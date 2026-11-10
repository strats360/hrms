import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { todayIST } from "@hrms/shared";
import { Client, env, login, mailer } from "./helpers";
import { allowedRecipients } from "../src/services/notifications";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
const PRIYA = "priya.vaghela@strats360.com";
const HARDIK = "hardik.mehta@strats360.com";
let priya: Client, hardik: Client, nisha: Client;
let priyaId = "";
let tenantId = "";
let el = "";
const made: string[] = [];
const year = Number(todayIST().slice(0, 4));

const count = (to: string, subject: RegExp) => mailer.sent.filter((m) => m.to === to && subject.test(m.subject)).length;

/** A weekday this year with no leave for Priya yet. */
async function freeDay() {
  const taken = await sql`select start_date::text as s, end_date::text as e from leave_requests where employee_id = ${priyaId} and status in ('pending','approved')`;
  const hol = new Set((await sql`select date::text as d from holidays`).map((h) => h.d));
  for (let d = new Date(Date.UTC(year, 1, 2)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if ([0, 6].includes(d.getUTCDay()) || hol.has(iso) || taken.some((t) => t.s <= iso && t.e >= iso)) continue;
    return iso;
  }
  throw new Error("no free day");
}
async function apply() {
  const d = await freeDay();
  const r = await priya.post("/ess/leave", { leaveTypeId: el, startDate: d, endDate: d, halfDay: false, reason: "Notification test" });
  expect(r.status).toBe(201);
  made.push(r.body.id);
  return r.body.id as string;
}

beforeAll(async () => {
  [priya, hardik, nisha] = await Promise.all([login(PRIYA), login(HARDIK), login("nisha.trivedi@strats360.com")]);
  [{ id: priyaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = ${PRIYA}`) as any;
  [{ id: el }] = (await sql`select id from leave_types where tenant_id = ${tenantId} and code = 'EL'`) as any;
  await sql`update leave_balances set adjusted = adjusted + 5 where employee_id = ${priyaId} and leave_type_id = ${el} and year = ${year}`;
});
afterAll(async () => {
  if (made.length) await sql`update leave_requests set status = 'cancelled' where id in ${sql(made)} and status = 'pending'`;
  await sql`update memberships set notification_prefs = '{}'::jsonb where tenant_id = ${tenantId}`;
  await sql`update tenants set settings = settings - 'notifications' where id = ${tenantId}`;
  await sql.end();
  await db.$client.end();
});

describe("Notification settings", () => {
  it("shows each person the emails that apply to them", async () => {
    // managers (Priya has one report) also get the approver emails
    expect((await priya.get("/notifications/mine")).body).toEqual({ company: {}, personal: {}, groups: ["self", "approver"] });
    // without reports or an admin role, only their own
    const [{ id: hardikId }] = (await sql`select id from employees where work_email = ${HARDIK}`) as any;
    const moved = (await sql`update employees set manager_id = ${hardikId} where manager_id = ${priyaId} returning id`).map((r) => r.id);
    try {
      expect((await priya.get("/notifications/mine")).body.groups).toEqual(["self"]);
    } finally {
      if (moved.length) await sql`update employees set manager_id = ${priyaId} where id in ${sql(moved)}`;
    }
    expect((await hardik.get("/notifications/mine")).body.groups).toEqual(["self", "approver"]);
    expect((await priya.req("PUT", "/notifications/mine", { nope: false })).status).toBe(422);
  });

  it("emails the first approver when leave is applied for", async () => {
    const before = count(HARDIK, /^Leave to approve: Priya Vaghela/);
    await apply();
    expect(count(HARDIK, /^Leave to approve: Priya Vaghela/)).toBe(before + 1);
    expect(mailer.sent.at(-1)!.text).toMatch(/It needs your approval\./);
  });

  it("respects a person's own switches", async () => {
    expect((await hardik.req("PUT", "/notifications/mine", { leave_to_approve: false })).status).toBe(200);
    expect((await hardik.get("/notifications/mine")).body.personal).toEqual({ leave_to_approve: false });
    const before = count(HARDIK, /^Leave to approve/);
    const id = await apply();
    expect(count(HARDIK, /^Leave to approve/)).toBe(before);
    // their other emails still go out, and other people's aren't affected
    const decided = count(PRIYA, /^Leave (approved|rejected)/);
    await hardik.post(`/admin/leave/requests/${id}/decision`, { decision: "rejected", note: "Busy week" });
    expect(count(PRIYA, /^Leave rejected/)).toBe(decided + 1);
  });

  it("lets HR turn an email off for everyone", async () => {
    expect((await priya.req("PUT", "/admin/org/notifications", { leave_decision: false })).status).toBe(403);
    expect((await nisha.req("PUT", "/admin/org/notifications", { leave_decision: false })).status).toBe(200);
    expect((await priya.get("/notifications/mine")).body.company).toEqual({ leave_decision: false });
    const [audit] = await sql`select summary from audit_logs where action = 'settings.notifications' order by created_at desc limit 1`;
    expect(audit!.summary).toBe("Email notifications turned off for everyone: Leave approved or rejected");
    const id = await apply();
    const before = count(PRIYA, /^Leave (approved|rejected)/);
    await hardik.post(`/admin/leave/requests/${id}/decision`, { decision: "rejected", note: "Busy week" });
    expect(count(PRIYA, /^Leave (approved|rejected)/)).toBe(before);
  });

  it("filters bulk emails by login or work email", async () => {
    await sql`update tenants set settings = settings - 'notifications' where id = ${tenantId}`;
    const everyone = [PRIYA, HARDIK, "not-a-member@example.com"];
    expect([...(await allowedRecipients(db, tenantId, "payslip_published", everyone))].sort()).toEqual([...everyone].sort());
    await priya.req("PUT", "/notifications/mine", { payslip_published: false });
    expect([...(await allowedRecipients(db, tenantId, "payslip_published", everyone))].sort()).toEqual([HARDIK, "not-a-member@example.com"].sort());
    // case doesn't matter
    expect((await allowedRecipients(db, tenantId, "payslip_published", [PRIYA.toUpperCase()])).size).toBe(0);
  });
});
