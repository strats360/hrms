import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, priya: Client;
let tid = "";

beforeAll(async () => {
  [kunal, priya] = await Promise.all([login("kunal.shah@strats360.com"), login("priya.vaghela@strats360.com")]);
  [{ tid }] = (await sql`select tenant_id as tid from employees where work_email = 'kunal.shah@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from privacy_consents where tenant_id = ${tid}`;
  await sql`delete from privacy_notices where tenant_id = ${tid}`;
  await sql`delete from data_breaches where tenant_id = ${tid}`;
  await sql.end();
});

describe("DPDP notice and consents", () => {
  it("asks employees to read a new notice and logs consents", async () => {
    const before = (await priya.get("/ess/dpdp")).body;
    expect(before.notice.text).toMatch(/legitimate use/);
    expect((await kunal.post("/admin/dpdp/notice", { text: "Too short" })).status).toBe(422);
    const pub = await kunal.post("/admin/dpdp/notice", { text: `${before.notice.text}\n\nUpdated for this test.` });
    expect(pub.status).toBe(201);
    const s = (await priya.get("/ess/dpdp")).body;
    expect(s).toMatchObject({ needsAcknowledgement: true, notice: { version: pub.body.version } });
    expect((await priya.post("/ess/dpdp/acknowledge", { version: pub.body.version - 1 })).status).toBe(400);
    expect((await priya.post("/ess/dpdp/acknowledge", { version: pub.body.version })).status).toBe(200);
    expect((await priya.post("/ess/dpdp/consents", { purpose: "selfie_punch", granted: true })).status).toBe(200);
    expect((await priya.post("/ess/dpdp/consents", { purpose: "selfie_punch", granted: false })).status).toBe(200);
    const after = (await priya.get("/ess/dpdp")).body;
    expect(after.needsAcknowledgement).toBe(false);
    expect(after.consents.selfie_punch.granted).toBe(false);
    const admin = (await kunal.get("/admin/dpdp")).body;
    expect(admin.acknowledgements.acknowledged).toBeGreaterThanOrEqual(1);
    expect(admin.consents.selfie_punch.withdrawn).toBeGreaterThanOrEqual(1);
    expect(admin.retention.years).toBe(8);
    expect((await priya.get("/admin/dpdp")).status).toBe(403);
  });

  it("logs a breach and tracks the 72 hour report", async () => {
    const at = new Date(Date.now() - 80 * 3600_000).toISOString();
    const b = await kunal.post("/admin/dpdp/breaches", { discoveredAt: at, description: "A payroll sheet was emailed to the wrong address", dataAffected: "Names, salaries", affectedCount: 42 });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const row = (await kunal.get("/admin/dpdp")).body.breaches.find((x: any) => x.id === b.body.id);
    expect(row).toMatchObject({ code: "BR-001", overdue: true });
    expect(row.open).toContain("The full report to the Board is overdue");
    const now = new Date().toISOString();
    expect((await kunal.req("PUT", `/admin/dpdp/breaches/${b.body.id}`, { discoveredAt: at, description: "A payroll sheet was emailed to the wrong address", affectedCount: 42, status: "closed", boardIntimatedAt: now, boardReportAt: now, peopleNotifiedAt: now })).status).toBe(200);
    expect((await kunal.get("/admin/dpdp")).body.breaches.find((x: any) => x.id === b.body.id).open).toEqual([]);
  });
});
