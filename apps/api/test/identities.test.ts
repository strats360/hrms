import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { todayLocal } from "@hrms/shared";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";
import { idExpiryReminders } from "../src/services/identities";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let nisha: Client, hardik: Client;
let tenantId = "", reportId = "", reportEmail = "", otherId = "", passportId = "";
const inDays = (n: number) => new Date(Date.parse(todayLocal()) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  [nisha, hardik] = await Promise.all(["nisha.trivedi", "hardik.mehta"].map((u) => login(`${u}@strats360.com`)));
  const [h] = (await sql`select id, tenant_id from employees where work_email = 'hardik.mehta@strats360.com'`) as any;
  tenantId = h.tenant_id;
  [{ id: reportId, work_email: reportEmail }] = (await sql`select id, work_email from employees where manager_id = ${h.id} and status not in ('exited','inactive') order by employee_code limit 1`) as any;
  [{ id: otherId }] = (await sql`select id from employees where tenant_id = ${tenantId} and id <> ${h.id} and (manager_id is null or manager_id <> ${h.id}) and status not in ('exited','inactive') limit 1`) as any;
});
afterAll(async () => {
  await sql`delete from employee_identities where tenant_id = ${tenantId}`;
  await sql.end();
  await db.$client.end();
});

describe("ID documents", () => {
  it("lets HR add passports and visas, with expiry checks", async () => {
    const noExpiry = await nisha.post(`/admin/employees/${reportId}/identities`, { type: "passport", number: "Z1234567", issuingCountry: "IN" });
    expect(noExpiry.status).toBe(422);
    const r = await nisha.post(`/admin/employees/${reportId}/identities`, { type: "passport", number: "Z1234567", issuingCountry: "IN", issuedOn: "2017-01-10", expiresOn: inDays(100) });
    expect(r.status).toBe(201);
    passportId = r.body.id;
    // no expiry needed for IDs that don't expire
    expect((await nisha.post(`/admin/employees/${reportId}/identities`, { type: "ni_number", number: "QQ123456C" })).status).toBe(201);
    const list = (await nisha.get(`/admin/employees/${reportId}/identities`)).body;
    expect(list.identities[0]).toMatchObject({ label: "Passport", state: "due", daysLeft: 100 }); // passports remind 180 days ahead
    expect(list.identities[1]).toMatchObject({ label: "National Insurance number", state: "none" });
    expect(list.types.map((t: any) => t.key)).toContain("passport");
  });

  it("follows the private details rule", async () => {
    expect((await hardik.get(`/admin/employees/${reportId}/identities`)).status).toBe(200); // their own report
    expect((await hardik.get(`/admin/employees/${otherId}/identities`)).status).toBe(403);
    expect((await hardik.post(`/admin/employees/${reportId}/identities`, { type: "passport", number: "X1", expiresOn: inDays(10) })).status).toBe(403); // managers can't edit
  });

  it("shows HR what's expiring, and the employee their own", async () => {
    const exp = (await nisha.get("/admin/employees/identities/expiring")).body;
    expect(exp.find((x: any) => x.id === passportId)).toMatchObject({ label: "Passport", numberEnding: "4567", daysLeft: 100 });
    expect((await hardik.get("/admin/employees/identities/expiring")).status).toBe(403);
    expect((await nisha.get("/admin/dashboard")).body.idsExpiring).toBeGreaterThanOrEqual(1);
  });

  it("reminds HR and the employee once per expiry date", async () => {
    mailer.sent.length = 0;
    const first = await idExpiryReminders(db, env);
    expect(first.sent).toBeGreaterThanOrEqual(2);
    expect(lastEmailTo(reportEmail)?.subject).toMatch(/Reminder: your passport expires on/);
    expect(lastEmailTo("nisha.trivedi@strats360.com")?.subject).toMatch(/Passport expires on/);
    expect((await idExpiryReminders(db, env)).sent).toBe(0);
    // renewed with a new date, then that date comes close: reminded again
    expect((await nisha.patch(`/admin/employees/identities/${passportId}`, { type: "passport", number: "Z7654321", issuingCountry: "IN", expiresOn: inDays(20) })).status).toBe(200);
    expect((await idExpiryReminders(db, env)).sent).toBeGreaterThanOrEqual(2);
  });

  it("lets HR remove one", async () => {
    expect((await nisha.del(`/admin/employees/identities/${passportId}`)).status).toBe(200);
    expect((await nisha.get(`/admin/employees/${reportId}/identities`)).body.identities.some((x: any) => x.id === passportId)).toBe(false);
  });
});
