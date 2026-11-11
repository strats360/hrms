import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { addMonthsToDate, todayIST } from "@hrms/shared";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";
import { probationReminders } from "../src/services/probation";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let hardik: Client, nisha: Client, amit: Client, priya: Client;
let priyaId = "";
let original: any = null;
const today = todayIST();
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const end = plusDays(today, 10);

beforeAll(async () => {
  [hardik, nisha, amit, priya] = await Promise.all(["hardik.mehta", "nisha.trivedi", "amit.dave", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [original] = (await sql`select id, status, date_of_joining::text as doj, confirmation_date::text as conf, probation_months from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  priyaId = original.id;
  // put Priya on a 6-month probation that ends in 10 days
  await sql`update employees set status = 'probation', probation_months = 6, confirmation_date = null, probation_reminded_for = null, date_of_joining = ${addMonthsToDate(end, -6)} where id = ${priyaId}`;
});
afterAll(async () => {
  await sql`update employees set status = ${original.status}, date_of_joining = ${original.doj}, confirmation_date = ${original.conf}, probation_months = ${original.probation_months}, probation_reminded_for = null where id = ${priyaId}`;
  await sql`delete from probation_events where employee_id = ${priyaId}`;
  await sql`update tenants set settings = settings - 'probation' where code = 'TN-0142'`;
  await sql.end();
  await db.$client.end();
});

describe("Probation confirmation", () => {
  it("shows the manager their people whose probation is ending", async () => {
    const r = (await hardik.get("/admin/probation")).body;
    const p = r.rows.find((x: any) => x.employeeId === priyaId);
    expect(p).toMatchObject({ name: "Priya Vaghela", endDate: end, daysLeft: 10, due: true, manager: "Hardik Mehta", review: null });
    expect(r.canDecide).toBe(false);
    expect((await hardik.get("/admin/dashboard")).body.probationDue).toBeGreaterThanOrEqual(1);
    expect((await amit.get("/admin/probation")).body.rows.some((x: any) => x.employeeId === priyaId)).toBe(false);
    expect((await priya.get("/admin/probation")).status).toBe(403);
  });

  it("takes the manager's recommendation", async () => {
    expect((await amit.post(`/admin/probation/${priyaId}/review`, { recommendation: "confirm", note: "Not mine" })).status).toBe(403);
    expect((await hardik.post(`/admin/probation/${priyaId}/review`, { recommendation: "confirm", note: "" })).status).toBe(422);
    expect((await hardik.post(`/admin/probation/${priyaId}/review`, { recommendation: "extend", note: "Strong on delivery; needs another month on code reviews" })).status).toBe(201);
    const p = (await nisha.get("/admin/probation")).body.rows.find((x: any) => x.employeeId === priyaId);
    expect(p.review).toMatchObject({ recommendation: "extend", by: "Hardik Mehta" });
  });

  it("reminds the manager and HR once per end date", async () => {
    const before = mailer.sent.length;
    await probationReminders(db, env, today);
    const mine = mailer.sent.slice(before).filter((m) => m.subject === "Probation review: Priya Vaghela");
    expect(mine.map((m) => m.to)).toEqual(expect.arrayContaining(["hardik.mehta@strats360.com", "nisha.trivedi@strats360.com", "kunal.shah@strats360.com"]));
    expect(lastEmailTo("hardik.mehta@strats360.com")!.text).toMatch(/ends on .*, in 10 days[\s\S]*Hardik Mehta has recommended: extend/);
    const again = mailer.sent.length;
    await probationReminders(db, env, today);
    expect(mailer.sent.slice(again).filter((m) => m.subject === "Probation review: Priya Vaghela")).toHaveLength(0);
  });

  it("lets HR extend probation, which re-arms the reminder", async () => {
    expect((await hardik.post(`/admin/probation/${priyaId}/extend`, { until: plusDays(end, 30), reason: "More time" })).status).toBe(403);
    expect((await nisha.post(`/admin/probation/${priyaId}/extend`, { until: plusDays(end, -1), reason: "Too early" })).status).toBe(400);
    const until = plusDays(end, 30);
    expect((await nisha.post(`/admin/probation/${priyaId}/extend`, { until, reason: "Another month to settle into code reviews" })).status).toBe(200);
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toBe("Your probation has been extended");
    const p = (await nisha.get("/admin/probation")).body.rows.find((x: any) => x.employeeId === priyaId);
    expect(p).toMatchObject({ endDate: until, extensions: 1, due: false });
    const [row] = await sql`select probation_reminded_for from employees where id = ${priyaId}`;
    expect(row!.probation_reminded_for).toBeNull();
    // the extension letter has the new date
    const letter = await nisha.post("/admin/letters/preview", { employeeId: priyaId, templateId: "builtin:probation_extension" });
    const long = new Date(`${until}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    expect(letter.body.text).toContain(`extend your probation until ${long}`);
  });

  it("lets HR confirm, which ends probation", async () => {
    expect((await nisha.post(`/admin/probation/${priyaId}/confirm`, { date: today, note: "Confirmed after extension" })).status).toBe(200);
    const [row] = await sql`select status, confirmation_date::text as d from employees where id = ${priyaId}`;
    expect(row).toMatchObject({ status: "active", d: today });
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toBe("Your employment is confirmed");
    expect((await nisha.get("/admin/probation")).body.rows.some((x: any) => x.employeeId === priyaId)).toBe(false);
    const history = (await nisha.get(`/admin/probation/${priyaId}/history`)).body.map((h: any) => h.kind);
    expect(history).toEqual(["review", "extended", "confirmed"]);
    expect((await nisha.post(`/admin/probation/${priyaId}/confirm`, { date: today })).status).toBe(400);
  });
});
