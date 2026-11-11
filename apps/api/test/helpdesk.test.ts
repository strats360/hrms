import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";
import { autoCloseTickets } from "../src/services/helpdesk";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let nisha: Client, kunal: Client, hardik: Client, priya: Client;
let tenantId = "", nishaId = "", ticketId = "", secretId = "";

beforeAll(async () => {
  [nisha, kunal, hardik, priya] = await Promise.all(["nisha.trivedi", "kunal.shah", "hardik.mehta", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: nishaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'nisha.trivedi@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from helpdesk_tickets where tenant_id = ${tenantId}`;
  await sql`update tenants set settings = settings - 'helpdesk' where id = ${tenantId}`;
  await sql.end();
  await db.$client.end();
});

describe("Employee helpdesk", () => {
  it("lets HR set up categories and teams", async () => {
    const s = (await nisha.get("/admin/helpdesk/settings")).body;
    expect(s.settings.categories.map((c: any) => c.key)).toContain("payroll");
    expect(s.agents.map((a: any) => a.name)).toContain("Nisha Trivedi");
    expect((await nisha.req("PUT", "/admin/helpdesk/settings", { ...s.settings, teams: { ...s.settings.teams, hr: [nishaId] } })).status).toBe(200);
    expect((await hardik.get("/admin/helpdesk")).status).toBe(403);
  });

  it("takes a ticket from an employee and tells the team", async () => {
    const cats = (await priya.get("/ess/helpdesk")).body.categories;
    expect(cats.find((c: any) => c.key === "payroll")).toMatchObject({ teamLabel: "HR" });
    expect((await priya.post("/ess/helpdesk", { categoryKey: "nope", subject: "Hello there", body: "Something long enough" })).body.error.message).toMatch(/Pick what/);
    const before = mailer.sent.length;
    const f = new FormData();
    f.append("data", JSON.stringify({ categoryKey: "payroll", subject: "October payslip is missing HRA", body: "My October payslip shows HRA as zero. It was there in September.", priority: "high" }));
    f.append("file", new Blob([new TextEncoder().encode("%PDF-1.4 payslip")], { type: "application/pdf" }), "payslip-oct.pdf");
    const r = await priya.req("POST", "/ess/helpdesk", f);
    expect(r.status).toBe(201);
    expect(r.body.number).toMatch(/^HD-\d{4}$/);
    ticketId = r.body.id;
    expect(mailer.sent.slice(before).some((m) => m.to === "nisha.trivedi@strats360.com" && /October payslip is missing HRA/.test(m.subject))).toBe(true);
    const [t] = await sql`select team, priority, extract(epoch from response_due_at - created_at) / 3600 as hours from helpdesk_tickets where id = ${ticketId}`;
    expect(t).toMatchObject({ team: "hr", priority: "high" });
    expect(Math.round(Number(t!.hours))).toBe(12); // 24h for payroll, halved for high priority
  });

  it("lets the team reply, keep internal notes, and resolve", async () => {
    const q = (await nisha.get("/admin/helpdesk")).body;
    expect(q.rows.find((x: any) => x.id === ticketId)).toMatchObject({ status: "open", assignee: null, raiser: { name: "Priya Vaghela" } });
    expect(q.stats.open).toBeGreaterThanOrEqual(1);
    expect((await nisha.post(`/admin/helpdesk/${ticketId}/reply`, { body: "Payroll override missed her HRA; fix in November run.", internal: true })).status).toBe(200);
    const before = mailer.sent.length;
    expect((await nisha.post(`/admin/helpdesk/${ticketId}/reply`, { body: "Thanks Priya. Can you confirm your rent receipts are uploaded?", status: "waiting" })).body.status).toBe("waiting");
    expect(mailer.sent.slice(before).map((m) => m.to)).toEqual(["priya.vaghela@strats360.com"]);
    const mine = (await priya.get(`/ess/helpdesk/${ticketId}`)).body;
    expect(mine.status).toBe("waiting");
    expect(mine.assignee).toBe("Nisha Trivedi");
    expect(mine.messages.map((m: any) => m.body)).not.toContain("Payroll override missed her HRA; fix in November run.");
    expect(mine.messages[0].hasAttachment).toBe(true);
    expect((await priya.file(`/ess/helpdesk/${ticketId}/messages/${mine.messages[0].id}/file`)).status).toBe(200);
    expect((await priya.post(`/ess/helpdesk/${ticketId}/reply`, { body: "Yes, uploaded last week." })).body.status).toBe("in_progress");
    expect((await nisha.post(`/admin/helpdesk/${ticketId}/reply`, { body: "Fixed. It will be paid as arrears in November.", status: "resolved" })).body.status).toBe("resolved");
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toMatch(/resolved/);
    const agentView = (await nisha.get(`/admin/helpdesk/${ticketId}`)).body;
    expect(agentView.messages.filter((m: any) => m.internal).length).toBeGreaterThanOrEqual(1);
    expect(agentView.firstResponseAt).toBeTruthy();
  });

  it("reopens on a reply, and closes when rated or after a while", async () => {
    expect((await priya.post(`/ess/helpdesk/${ticketId}/rate`, { rating: 5, comment: "Quick, thanks" })).status).toBe(200);
    expect((await priya.get(`/ess/helpdesk/${ticketId}`)).body).toMatchObject({ status: "closed", rating: 5 });
    expect((await priya.post(`/ess/helpdesk/${ticketId}/reply`, { body: "One more thing" })).body.error.message).toMatch(/closed/);
    const t2 = (await priya.post("/ess/helpdesk", { categoryKey: "equipment", subject: "Laptop battery drains fast", body: "Lasts about an hour now." })).body.id;
    await kunal.post(`/admin/helpdesk/${t2}/reply`, { body: "Swap booked for Monday.", status: "resolved" });
    await sql`update helpdesk_tickets set resolved_at = now() - interval '8 days' where id = ${t2}`;
    expect(await autoCloseTickets(db)).toBeGreaterThanOrEqual(1);
    const [row] = await sql`select status from helpdesk_tickets where id = ${t2}`;
    expect(row!.status).toBe("closed");
  });

  it("keeps confidential tickets to HR leads and assignees", async () => {
    // a helpdesk agent who isn't a lead
    await sql`update roles set permissions = permissions || '{"helpdesk":["view","edit"]}'::jsonb where tenant_id = ${tenantId} and key = 'manager'`;
    try {
      const hk = await login("hardik.mehta@strats360.com");
      const s = (await nisha.get("/admin/helpdesk/settings")).body.settings;
      const [{ id: hardikId }] = (await sql`select id from employees where work_email = 'hardik.mehta@strats360.com'`) as any;
      await nisha.req("PUT", "/admin/helpdesk/settings", { ...s, teams: { ...s.teams, hr: [nishaId, hardikId] } });
      secretId = (await priya.post("/ess/helpdesk", { categoryKey: "leave", subject: "Something personal", body: "I'd like to discuss a personal matter.", confidential: true })).body.id;
      const open = (await priya.post("/ess/helpdesk", { categoryKey: "leave", subject: "Leave balance looks wrong", body: "Casual leave shows 2, I think it's 4." })).body.id;
      const theirs = (await hk.get("/admin/helpdesk")).body.rows.map((r: any) => r.id);
      expect(theirs).toContain(open);
      expect(theirs).not.toContain(secretId);
      expect((await hk.get(`/admin/helpdesk/${secretId}`)).status).toBe(404);
      expect((await nisha.get(`/admin/helpdesk/${secretId}`)).body.subject).toBe("Something personal");
      // assigning it opens it to them
      await nisha.req("PATCH", `/admin/helpdesk/${secretId}`, { assigneeId: hardikId });
      expect((await hk.get(`/admin/helpdesk/${secretId}`)).status).toBe(200);
      expect((await nisha.req("PATCH", `/admin/helpdesk/${secretId}`, { assigneeId: (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`)[0]!.id })).body.error.message).toMatch(/own ticket/);
    } finally {
      await sql`update roles set permissions = permissions - 'helpdesk' where tenant_id = ${tenantId} and key = 'manager'`;
    }
  });
});
