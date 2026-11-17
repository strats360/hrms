import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, lastEmailTo, login, PASSWORD } from "./helpers";
import { putFile } from "../src/lib/storage";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, krupa: Client, kunal: Client;
let tenantId = "", reportId = "", otherId = "";
const docIds: string[] = [];
const tempEmp = crypto.randomUUID();
const outsiderId = crypto.randomUUID();
// someone with a login at another company (same password as the demo users)
const outsider = `outsider.${outsiderId.slice(0, 8)}@example.com`;

async function addDoc(employeeId: string) {
  const id = crypto.randomUUID();
  const key = `tenants/${tenantId}/employees/${employeeId}/test-${id}`;
  await putFile(env, key, new TextEncoder().encode("%PDF-1.4 pan").buffer as ArrayBuffer, "application/pdf");
  await sql`insert into employee_documents (id, tenant_id, employee_id, type, name, file_key, mime_type) values (${id}, ${tenantId}, ${employeeId}, 'pan', 'PAN card.pdf', ${key}, 'application/pdf')`;
  docIds.push(id);
  return id;
}

beforeAll(async () => {
  [nisha, hardik, krupa, kunal] = await Promise.all(["nisha.trivedi", "hardik.mehta", "krupa.joshi", "kunal.shah"].map((u) => login(`${u}@strats360.com`)));
  const [h] = (await sql`select id, tenant_id from employees where work_email = 'hardik.mehta@strats360.com'`) as any;
  tenantId = h.tenant_id;
  [{ id: reportId }] = (await sql`select id from employees where manager_id = ${h.id} and status <> 'exited' and pan is not null limit 1`) as any;
  await sql`insert into auth_user (id, name, email, email_verified) values (${outsiderId}, 'Outside Admin', ${outsider}, true)`;
  await sql`insert into auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at) select gen_random_uuid()::text, ${outsiderId}, 'credential', ${outsiderId}, a.password, now(), now() from auth_account a join auth_user u on u.id = a.user_id where u.email = 'priya.vaghela@strats360.com' and a.provider_id = 'credential'`;
  [{ id: otherId }] = (await sql`select id from employees where tenant_id = ${tenantId} and id <> ${h.id} and (manager_id is null or manager_id <> ${h.id}) and pan is not null limit 1`) as any;
});
afterAll(async () => {
  if (docIds.length) await sql`delete from employee_documents where id in ${sql(docIds)}`;
  await sql`delete from employees where id = ${tempEmp}`;
  await sql`delete from admin_invites where email = ${outsider} and tenant_id = ${tenantId}`;
  await sql`delete from memberships where tenant_id = ${tenantId} and user_id in (select id from auth_user where email = ${outsider})`;
  await sql`delete from auth_user where id = ${outsiderId}`;
  await sql.end();
});

describe("private employee details", () => {
  it("shows a manager full details only for their own team", async () => {
    await addDoc(reportId);
    await addDoc(otherId);
    const mine = (await hardik.get(`/admin/employees/${reportId}`)).body;
    expect(mine.limited).toBe(false);
    expect(mine.pan).toBeTruthy();
    expect(mine.documents.length).toBeGreaterThan(0);
    const theirs = (await hardik.get(`/admin/employees/${otherId}`)).body;
    expect(theirs.limited).toBe(true);
    expect(theirs).toMatchObject({ pan: null, dateOfBirth: null, personalEmail: null, aadhaarLast4: null, accountLast4: null, documents: [] });
    expect(theirs.fullName).toBeTruthy(); // the directory card still works
  });
  it("lets HR and payroll see everyone", async () => {
    for (const c of [nisha, krupa]) {
      const r = (await c.get(`/admin/employees/${otherId}`)).body;
      expect(r.limited).toBe(false);
      expect(r.pan).toBeTruthy();
    }
  });
  it("blocks a manager from downloading documents outside their team", async () => {
    const [mineDoc, otherDoc] = docIds;
    expect((await hardik.file(`/files/documents/${mineDoc}`)).status).toBe(200);
    expect((await hardik.file(`/files/documents/${otherDoc}`)).status).toBe(403);
    expect((await nisha.file(`/files/documents/${otherDoc}`)).status).toBe(200);
  });
});

describe("invite links and existing logins", () => {
  it("asks for the current password instead of replacing it", async () => {
    const roles = await kunal.get("/admin/access/roles");
    const viewer = roles.body.find((r: any) => r.name === "Viewer");
    expect((await kunal.post("/admin/access/members/invite", { email: outsider, name: "Other Corp admin", roleId: viewer.id })).status).toBe(201);
    const token = lastEmailTo(outsider)!.text.match(/\/invite\/admin\/([\w-]+)/)![1]!;
    expect((await new Client().get(`/public/admin-invite/${token}`)).body.hasAccount).toBe(true);
    const wrong = await new Client().post("/public/admin-invite/accept", { token, password: "Attacker#2026" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/current password/);
    // the old password still works, and accepting with it links the login
    await login(outsider, PASSWORD);
    expect((await new Client().post("/public/admin-invite/accept", { token, password: PASSWORD })).status).toBe(200);
  });
  it("won't reset a password through an onboarding link", async () => {
    // a new hire whose email already has a login somewhere else
    const token = "t".repeat(40);
    const { sha256Hex } = await import("@hrms/shared");
    await sql`insert into employees (id, tenant_id, employee_code, first_name, full_name, work_email, date_of_joining, status)
      values (${tempEmp}, ${tenantId}, ${"TMP-" + tempEmp.slice(0, 6)}, 'Other', 'Other Admin', ${outsider}, '2026-11-01', 'onboarding')`;
    await sql`insert into onboarding_invites (id, tenant_id, employee_id, email, token_hash, expires_at, status)
      values (${crypto.randomUUID()}, ${tenantId}, ${tempEmp}, ${outsider}, ${await sha256Hex(token)}, now() + interval '1 day', 'in_progress')`;
    const r = await new Client().post("/public/onboarding/accept", { token, password: "Attacker#2026" });
    expect(r.status).toBe(400);
    await login(outsider, PASSWORD);
    expect((await new Client().get(`/public/onboarding/${token}`)).body.hasAccount).toBe(true);
  });
});
