import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { Client, env, login, mailer } from "./helpers";
import { sendScheduledAnnouncements } from "../src/services/announcements";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let nisha: Client, hardik: Client, priya: Client;
let tenantId = "", deptId = "", otherDept = "", policyId = "";

beforeAll(async () => {
  [nisha, hardik, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId, department_id: deptId }] = (await sql`select tenant_id, department_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: otherDept }] = (await sql`select id from departments where tenant_id = ${tenantId} and id <> ${deptId} limit 1`) as any;
});
afterAll(async () => {
  await sql`delete from announcements where tenant_id = ${tenantId}`;
  await sql.end();
  await db.$client.end();
});
const post = (c: Client, b: Record<string, unknown>) => c.post("/admin/announcements", { body: "Details below.", ...b });

describe("Announcements", () => {
  it("lets HR post to everyone, emailing them", async () => {
    expect((await priya.post("/admin/announcements", { title: "Hi all", body: "x" })).status).toBe(403);
    const before = mailer.sent.length;
    const r = await post(nisha, { title: "Diwali party on Friday", category: "event", body: "Join us at 5 pm in the cafeteria.\n\nFamilies welcome.", pinned: true });
    expect(r.status).toBe(201);
    expect(r.body.state).toBe("live");
    expect(r.body.emailed).toBeGreaterThan(100);
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && m.subject === "Event: Diwali party on Friday")).toBe(true);
    const feed = (await priya.get("/ess/announcements")).body;
    expect(feed[0]).toMatchObject({ title: "Diwali party on Friday", pinned: true, read: false });
  });

  it("targets a department and asks for confirmation", async () => {
    const r = await post(nisha, { title: "New leave policy", category: "policy", departmentIds: [deptId], requireAck: true, emailEveryone: false, body: "From 1 December, casual leave is 10 days a year." });
    policyId = r.body.id;
    expect(r.body.emailed).toBe(0);
    await post(nisha, { title: "Only for another team", departmentIds: [otherDept], emailEveryone: false });
    const feed = (await priya.get("/ess/announcements")).body;
    expect(feed.map((a: any) => a.title)).toContain("New leave policy");
    expect(feed.map((a: any) => a.title)).not.toContain("Only for another team");
    const one = (await priya.get(`/ess/announcements/${policyId}`)).body;
    expect(one).toMatchObject({ title: "New leave policy", requireAck: true, acknowledgedAt: null });
    expect((await priya.post(`/ess/announcements/${policyId}/acknowledge`)).status).toBe(200);
    const readers = (await nisha.get(`/admin/announcements/${policyId}/readers`)).body;
    const me = readers.find((r: any) => r.name === "Priya Vaghela");
    expect(me.readAt).toBeTruthy();
    expect(me.acknowledgedAt).toBeTruthy();
    const list = (await nisha.get("/admin/announcements")).body.find((a: any) => a.id === policyId);
    expect(list).toMatchObject({ read: 1, acknowledged: 1 });
    expect(list.audienceSize).toBeLessThan(200);
  });

  it("schedules posts and emails them when their time comes", async () => {
    const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const r = await post(nisha, { title: "Office closed for maintenance", publishAt: at });
    expect(r.body).toMatchObject({ state: "scheduled", emailed: 0 });
    expect((await priya.get("/ess/announcements")).body.map((a: any) => a.title)).not.toContain("Office closed for maintenance");
    expect((await sendScheduledAnnouncements(db, env)).posts).toBe(0);
    const before = mailer.sent.length;
    const later = await sendScheduledAnnouncements(db, env, new Date(Date.now() + 3 * 3_600_000));
    expect(later.posts).toBe(1);
    expect(mailer.sent.slice(before).some((m) => m.subject === "Office closed for maintenance")).toBe(true);
    // only once
    expect((await sendScheduledAnnouncements(db, env, new Date(Date.now() + 4 * 3_600_000))).posts).toBe(0);
  });

  it("keeps drafts private and lets HR take posts down", async () => {
    const d = await post(nisha, { title: "Draft thoughts", draft: true });
    expect(d.body.state).toBe("draft");
    expect((await priya.get("/ess/announcements")).body.map((a: any) => a.title)).not.toContain("Draft thoughts");
    expect((await priya.get(`/ess/announcements/${d.body.id}`)).status).toBe(404);
    expect((await nisha.del(`/admin/announcements/${d.body.id}`)).status).toBe(200);
    expect((await nisha.del(`/admin/announcements/${policyId}`)).status).toBe(400);
    expect((await nisha.post(`/admin/announcements/${policyId}/archive`)).status).toBe(200);
    expect((await priya.get(`/ess/announcements/${policyId}`)).status).toBe(404);
    expect((await hardik.get("/admin/announcements")).status).toBe(403);
    expect((await post(nisha, { title: "Old news", expiresAt: "2020-01-01" })).body.error.message).toMatch(/passed/);
  });

  it("takes a PDF attachment", async () => {
    const r = await post(nisha, { title: "Holiday list 2027", category: "holiday", emailEveryone: false });
    const f = new FormData();
    f.append("file", new Blob([new TextEncoder().encode("%PDF-1.4 holidays")], { type: "application/pdf" }), "holidays-2027.pdf");
    expect((await nisha.req("POST", `/admin/announcements/${r.body.id}/attachment`, f)).status).toBe(200);
    const bad = new FormData();
    bad.append("file", new Blob(["nope"], { type: "application/pdf" }), "x.pdf");
    expect((await nisha.req("POST", `/admin/announcements/${r.body.id}/attachment`, bad)).status).toBe(400);
    const file = await priya.file(`/ess/announcements/${r.body.id}/attachment`);
    expect(file.status).toBe(200);
    expect(await file.raw.text()).toBe("%PDF-1.4 holidays");
  });
});
