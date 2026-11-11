import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addWeeks, todayIST, weekDates, weekStart } from "@hrms/shared";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, amit: Client, priya: Client;
let tenantId = "", priyaId = "", web = "", internal = "", sheetId = "";
const week = addWeeks(weekStart(todayIST()), -1);
const [mon, tue, wed] = weekDates(week);

beforeAll(async () => {
  [nisha, hardik, amit, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "amit.dave", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from timesheets where tenant_id = ${tenantId}`;
  await sql`delete from projects where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("Timesheets", () => {
  it("lets HR set up projects", async () => {
    expect((await hardik.post("/admin/attendance/timesheets/projects", { code: "web", name: "Client website" })).status).toBe(403);
    const a = await nisha.post("/admin/attendance/timesheets/projects", { code: "web", name: "Client website", client: "Acme Retail", billable: true });
    expect(a.body.code).toBe("WEB");
    web = a.body.id;
    expect((await nisha.post("/admin/attendance/timesheets/projects", { code: "WEB", name: "Dup" })).status).toBe(409);
    internal = (await nisha.post("/admin/attendance/timesheets/projects", { code: "INT", name: "Internal", billable: false })).body.id;
  });

  it("lets an employee fill in and submit a week", async () => {
    const g = (await priya.get(`/ess/timesheets?week=${wed}`)).body;
    expect(g.week).toBe(week);
    expect(g.dates).toHaveLength(7);
    expect(g.projects.map((p: any) => p.code)).toEqual(["INT", "WEB"]);
    expect((await priya.req("PUT", `/ess/timesheets/${addWeeks(week, 2)}`, { rows: [] })).body.error.message).toMatch(/future week/);
    expect((await priya.req("PUT", `/ess/timesheets/${tue}`, { rows: [] })).body.error.message).toMatch(/Monday/);
    expect((await priya.req("PUT", `/ess/timesheets/${week}`, { rows: [], submit: true })).body.error.message).toMatch(/Add some hours/);
    expect((await priya.req("PUT", `/ess/timesheets/${week}`, { rows: [{ projectId: web, minutes: { [mon]: 900 } }, { projectId: internal, minutes: { [mon]: 600 } }] })).body.error.message).toMatch(/More than 24 hours/);
    const rows = [
      { projectId: web, note: "Checkout page", minutes: { [mon]: 360, [tue]: 420 } },
      { projectId: internal, note: "Team meeting", minutes: { [mon]: 60, [wed]: 0 } },
    ];
    expect((await priya.req("PUT", `/ess/timesheets/${week}`, { rows })).body).toMatchObject({ status: "draft", totalMinutes: 840 });
    const again = (await priya.get(`/ess/timesheets?week=${week}`)).body;
    expect(again.rows).toEqual([
      { projectId: web, note: "Checkout page", minutes: { [mon]: 360, [tue]: 420 } },
      { projectId: internal, note: "Team meeting", minutes: { [mon]: 60 } },
    ]);
    const before = mailer.sent.length;
    const s = await priya.req("PUT", `/ess/timesheets/${week}`, { rows, submit: true });
    expect(s.body.status).toBe("submitted");
    sheetId = s.body.id;
    expect(mailer.sent.slice(before).some((m) => m.to === "hardik.mehta@strats360.com" && /Timesheet to approve: Priya Vaghela/.test(m.subject))).toBe(true);
    expect((await priya.req("PUT", `/ess/timesheets/${week}`, { rows })).body.error.message).toMatch(/waiting for approval/);
  });

  it("shows the manager their team's week, and lets them send it back or approve", async () => {
    const t = (await hardik.get(`/admin/attendance/timesheets?week=${week}`)).body;
    expect(t.rows.find((r: any) => r.employeeId === priyaId)).toMatchObject({ status: "submitted", totalMinutes: 840, billableMinutes: 780 });
    expect(t.rows.some((r: any) => r.status === "missing")).toBe(true);
    expect((await amit.get(`/admin/attendance/timesheets/sheets/${sheetId}`)).status).toBe(404);
    const detail = (await hardik.get(`/admin/attendance/timesheets/sheets/${sheetId}`)).body;
    expect(detail.employee.name).toBe("Priya Vaghela");
    expect(detail.rows).toHaveLength(2);
    expect((await hardik.post(`/admin/attendance/timesheets/sheets/${sheetId}/reject`, { reason: "" })).status).toBe(422);
    expect((await hardik.post(`/admin/attendance/timesheets/sheets/${sheetId}/reject`, { reason: "Split the meeting time by project" })).status).toBe(200);
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toMatch(/sent back/);
    const back = (await priya.get(`/ess/timesheets?week=${week}`)).body;
    expect(back.sheet).toMatchObject({ status: "rejected", rejectReason: "Split the meeting time by project" });
    // fix and resubmit, then the manager approves the whole team's week
    await priya.req("PUT", `/ess/timesheets/${week}`, { rows: [{ projectId: web, note: "Checkout page", minutes: { [mon]: 420, [tue]: 420 } }], submit: true });
    expect((await hardik.post("/admin/attendance/timesheets/approve-all", { week })).body.approved).toBe(1);
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toMatch(/approved/);
    expect((await priya.req("PUT", `/ess/timesheets/${week}`, { rows: [] })).body.error.message).toMatch(/approved/);
  });

  it("reports approved hours by project and person", async () => {
    const r = (await nisha.get(`/admin/attendance/timesheets/report?from=${week}&to=${weekDates(week)[6]}`)).body;
    expect(r.projects[0]).toMatchObject({ code: "WEB", minutes: 840, billable: 840, people: 1 });
    expect(r.people[0]).toMatchObject({ name: "Priya Vaghela", minutes: 840 });
    expect((await nisha.file(`/admin/attendance/timesheets/report.xlsx?from=${week}&to=${weekDates(week)[6]}`)).status).toBe(200);
    expect((await hardik.post("/admin/attendance/timesheets/remind", { week })).body.reminded).toBeGreaterThan(0);
    const proj = (await nisha.get("/admin/attendance/timesheets/projects")).body.find((p: any) => p.id === web);
    expect(proj.approvedMinutes).toBe(840);
  });
});
