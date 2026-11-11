import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { unzipSync, strFromU8 } from "fflate";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";
import { getFile, putFile } from "../src/lib/storage";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, priya: Client, leaver: Client;
let tenantId = "";
let priyaId = "";
const leaverId = crypto.randomUUID();
const leaverUser = crypto.randomUUID();
const leaverEmail = `leaver.${leaverId.slice(0, 8)}@strats360.com`;

async function unzip(c: Client, path: string) {
  const r = await c.file(path);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/zip");
  return unzipSync(new Uint8Array(await r.raw.arrayBuffer()));
}

beforeAll(async () => {
  [nisha, hardik, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  // someone who left in July, with a sign-in, a photo, a document, a company letter and a selfie punch
  await sql`insert into employees (id, tenant_id, employee_code, first_name, last_name, full_name, work_email, personal_email, phone, date_of_birth, current_address, permanent_address, pan, uan, date_of_joining, status, last_working_day, photo_key, bank_name, account_last4, ifsc, user_id)
    values (${leaverId}, ${tenantId}, ${"LV-" + leaverId.slice(0, 6)}, 'Leela', 'Ved', 'Leela Ved', ${leaverEmail}, 'leela.personal@example.com', '9800000000', '1995-04-02', 'Flat 4, Navrangpura', 'Bhuj, Kutch', 'ABCPV1234K', '100200300400', '2024-01-01', 'exited', '2026-07-15', ${`photos/${leaverId}`}, 'HDFC Bank', '4321', 'HDFC0000001', ${leaverUser})`;
  await sql`insert into auth_user (id, name, email, email_verified) values (${leaverUser}, 'Leela Ved', ${leaverEmail}, true)`;
  await sql`insert into auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at) select gen_random_uuid()::text, ${leaverUser}, 'credential', ${leaverUser}, a.password, now(), now() from auth_account a join auth_user u on u.id = a.user_id where u.email = 'priya.vaghela@strats360.com' and a.provider_id = 'credential'`;
  await sql`insert into memberships (id, tenant_id, user_id, employee_id) values (gen_random_uuid()::text, ${tenantId}, ${leaverUser}, ${leaverId})`;
  await putFile(env, `photos/${leaverId}`, new TextEncoder().encode("photo").buffer as ArrayBuffer, "image/jpeg");
  await putFile(env, `docs/${leaverId}/pan`, new TextEncoder().encode("%PDF pan").buffer as ArrayBuffer, "application/pdf");
  await putFile(env, `docs/${leaverId}/relieving`, new TextEncoder().encode("%PDF relieving").buffer as ArrayBuffer, "application/pdf");
  await putFile(env, `selfies/${leaverId}`, new TextEncoder().encode("selfie").buffer as ArrayBuffer, "image/jpeg");
  await sql`insert into employee_documents (id, tenant_id, employee_id, type, name, file_key, mime_type) values
    (gen_random_uuid()::text, ${tenantId}, ${leaverId}, 'pan', 'PAN card', ${`docs/${leaverId}/pan`}, 'application/pdf'),
    (gen_random_uuid()::text, ${tenantId}, ${leaverId}, 'relieving_letter', 'Relieving letter.pdf', ${`docs/${leaverId}/relieving`}, 'application/pdf')`;
  await sql`insert into attendance_records (id, tenant_id, employee_id, date, check_in, source, status, lat, lng, ip, check_in_selfie_key) values (gen_random_uuid()::text, ${tenantId}, ${leaverId}, '2026-07-10', '2026-07-10T09:30:00+05:30', 'mobile', 'present', 23.03, 72.58, '10.0.0.9', ${`selfies/${leaverId}`})`;
  leaver = await login(leaverEmail);
});
afterAll(async () => {
  await sql`delete from privacy_requests where tenant_id = ${tenantId}`;
  await sql`delete from employees where id = ${leaverId}`;
  await sql`delete from auth_user where id = ${leaverUser}`;
  await sql`update tenants set settings = settings - 'privacy' where id = ${tenantId}`;
  await sql.end();
});

describe("DPDP: copy of my data", () => {
  it("gives the employee a zip of everything held about them", async () => {
    const files = await unzip(leaver, "/ess/privacy/export");
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "data.json", "photo/photo.jpg", "documents/PAN card.pdf", "documents/Relieving letter.pdf"]));
    const data = JSON.parse(strFromU8(files["data.json"]!));
    expect(data.profile).toMatchObject({ fullName: "Leela Ved", personalEmail: "leela.personal@example.com", bankAccount: "ending 4321" });
    // no secrets or internal keys
    expect(JSON.stringify(data)).not.toMatch(/accountNumberEnc|tenantId|fileKey|SelfieKey/);
    expect(data.attendance).toHaveLength(1);
    expect(data.attendance[0]).toMatchObject({ lat: 23.03, ip: "10.0.0.9" });
    const [log] = await sql`select summary from audit_logs where action = 'privacy.export' and entity_id = ${leaverId} order by created_at desc limit 1`;
    expect(log!.summary).toBe("Leela Ved downloaded a copy of their data");
  });

  it("lets HR download it too, but not a manager", async () => {
    expect((await hardik.file(`/admin/privacy/employees/${priyaId}/export`)).status).toBe(403);
    const files = await unzip(nisha, `/admin/privacy/employees/${priyaId}/export`);
    expect(JSON.parse(strFromU8(files["data.json"]!)).profile.fullName).toBe("Priya Vaghela");
  });
});

describe("DPDP: erasure", () => {
  it("shows the grievance officer and why erasure has to wait while someone works here", async () => {
    expect((await nisha.req("PUT", "/admin/privacy/settings", { officerName: "Nisha Trivedi", officerEmail: "privacy@strats360.com", responseDays: 15 })).status).toBe(200);
    const me = (await priya.get("/ess/privacy")).body;
    expect(me.officer).toEqual({ name: "Nisha Trivedi", email: "privacy@strats360.com" });
    expect(me.blocker).toMatch(/still work here/);
    expect(me.kept.join(" ")).toMatch(/Payslips/);
  });

  it("takes a request, tells HR, and lets HR decline it with a reason", async () => {
    const before = mailer.sent.length;
    const r = await priya.post("/ess/privacy/erasure", { reason: "Just checking" });
    expect(r.status).toBe(201);
    expect((await priya.post("/ess/privacy/erasure", {})).body.error.message).toMatch(/already have a request/);
    expect(mailer.sent.slice(before).map((m) => m.subject)).toContain("Data erasure request: Priya Vaghela");
    const list = (await nisha.get("/admin/privacy")).body.rows;
    const mine = list.find((x: any) => x.id === r.body.id);
    expect(mine).toMatchObject({ status: "pending", name: "Priya Vaghela", overdue: false });
    expect(mine.blocker).toMatch(/still work here/);
    // HR can't erase someone who still works here
    expect((await nisha.post(`/admin/privacy/requests/${r.body.id}/erase`, {})).body.error.message).toMatch(/still work here/);
    expect((await nisha.post(`/admin/privacy/requests/${r.body.id}/reject`, { note: "" })).status).toBe(422);
    expect((await nisha.post(`/admin/privacy/requests/${r.body.id}/reject`, { note: "You still work here; we'll erase it after you leave." })).status).toBe(200);
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toBe("About your data erasure request");
    expect((await priya.get("/ess/privacy")).body.requests[0]).toMatchObject({ status: "rejected", decisionNote: "You still work here; we'll erase it after you leave." });
  });

  it("lets the employee withdraw a request", async () => {
    const r = await priya.post("/ess/privacy/erasure", {});
    expect((await priya.post(`/ess/privacy/erasure/${r.body.id}/cancel`)).status).toBe(200);
    expect((await priya.get("/ess/privacy")).body.requests[0].status).toBe("cancelled");
    expect((await hardik.get("/admin/privacy")).status).toBe(403);
  });

  it("erases a leaver's personal data and keeps statutory records", async () => {
    const r = await leaver.post("/ess/privacy/erasure", { reason: "I've moved on" });
    expect(r.status).toBe(201);
    expect(r.body.dueDate).toBeTruthy();
    const done = await nisha.post(`/admin/privacy/requests/${r.body.id}/erase`, { note: "Done as asked." });
    expect(done.status).toBe(200);
    expect(done.body.summary).toMatchObject({ documents: 1, photo: 1, selfies: 1, punchLocations: 1, signIns: 1 });

    const [e] = await sql`select personal_email, phone, date_of_birth, current_address, permanent_address, pan, uan, full_name, photo_key, account_last4, bank_name, user_id, work_email, erased_at from employees where id = ${leaverId}`;
    expect(e).toMatchObject({ personal_email: null, phone: null, date_of_birth: null, current_address: null, photo_key: null, account_last4: null, bank_name: null, user_id: null });
    expect(e).toMatchObject({ full_name: "Leela Ved", pan: "ABCPV1234K", uan: "100200300400", permanent_address: "Bhuj, Kutch" });
    expect(e!.work_email).toMatch(/@erased\.invalid$/);
    expect(e!.erased_at).not.toBeNull();
    const docs = await sql`select type from employee_documents where employee_id = ${leaverId}`;
    expect(docs.map((d) => d.type)).toEqual(["relieving_letter"]);
    expect(await getFile(env, `docs/${leaverId}/pan`)).toBeNull();
    expect(await getFile(env, `docs/${leaverId}/relieving`)).not.toBeNull();
    expect(await getFile(env, `selfies/${leaverId}`)).toBeNull();
    const [a] = await sql`select lat, ip, check_in_selfie_key, check_in from attendance_records where employee_id = ${leaverId}`;
    expect(a).toMatchObject({ lat: null, ip: null, check_in_selfie_key: null });
    expect(a!.check_in).not.toBeNull();
    // the login is gone, and they were told at their personal email
    expect((await sql`select 1 from auth_user where id = ${leaverUser}`).length).toBe(0);
    expect([401, 403]).toContain((await leaver.get("/ess/privacy")).status);
    await expect(login(leaverEmail)).rejects.toThrow(/login failed/);
    expect(lastEmailTo("leela.personal@example.com")!.subject).toBe("Your personal data has been erased");
    const row = (await nisha.get("/admin/privacy")).body.rows.find((x: any) => x.id === r.body.id);
    expect(row).toMatchObject({ status: "completed", decidedByName: "Nisha Trivedi" });
    // and it can't run twice
    expect((await nisha.post(`/admin/privacy/employees/${leaverId}/erase`, {})).body.error.message).toMatch(/already been erased/);
    expect((await nisha.get(`/admin/privacy/employees/${leaverId}`)).body.erasedAt).toBeTruthy();
  });
});
