import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let priya: Client, nisha: Client, hardik: Client, other: Client;
let priyaId = "";
let raviId = "";
let otherEmail = "";

// smallest valid-looking images: the server only checks the leading bytes
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const form = (bytes: Uint8Array, type = "image/png", name = "me.png") => {
  const f = new FormData();
  f.append("file", new File([bytes], name, { type }));
  return f;
};

beforeAll(async () => {
  [priya, nisha, hardik] = await Promise.all([login("priya.vaghela@strats360.com"), login("nisha.trivedi@strats360.com"), login("hardik.mehta@strats360.com")]);
  // someone from a different company
  other = new Client();
  otherEmail = `photo-${Date.now()}@example.com`;
  const su = await other.post("/public/signup", { adminName: "Photo Test", email: otherEmail, password: "PhotoTest#2026", companyName: "Photo Test Pvt Ltd", state: "Gujarat" });
  expect(su.status).toBeLessThan(300);
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: raviId }] = (await sql`select id from employees where employee_code = 'STL-0057'`) as any;
});
afterAll(async () => {
  await sql`update employees set photo_key = null where id in (${priyaId}, ${raviId})`;
  await sql`update tenants set settings = settings - 'essPhotoEdit' where code = 'TN-0142'`;
  if (otherEmail) {
    await sql`delete from tenants where id in (select m.tenant_id from memberships m join auth_user u on u.id = m.user_id where u.email = ${otherEmail})`;
    await sql`delete from auth_user where email = ${otherEmail}`;
  }
  await sql.end();
});

describe("Profile photos", () => {
  it("lets an employee set their own photo, checking it's really an image", async () => {
    expect((await priya.req("POST", "/ess/photo", form(new TextEncoder().encode("<svg onload=alert(1)>"), "image/png"))).body.error.message).toMatch(/JPG, PNG or WebP/);
    expect((await priya.req("POST", "/ess/photo", form(new Uint8Array(1024 * 1024 + 1).fill(0xff)))).status).toBe(400);
    const r = await priya.req("POST", "/ess/photo", form(PNG));
    expect(r.status).toBe(201);
    expect(r.body.photoVersion).toMatch(/^[0-9a-f]{8}$/);
    // shows in the company's photo index, for everyone in it
    const idx = (await hardik.get("/photos")).body;
    expect(idx[priyaId]).toBe(r.body.photoVersion);
  });

  it("serves the image to people in the same company only", async () => {
    const v = (await priya.get("/photos")).body[priyaId];
    const img = await hardik.file(`/photo/${priyaId}?v=${v}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toMatch(/max-age=2592000/);
    expect(new Uint8Array(await img.raw.arrayBuffer())).toEqual(PNG);
    // an old or missing version isn't cached
    expect((await hardik.file(`/photo/${priyaId}`)).headers.get("cache-control")).toBe("private, no-cache");
    expect((await other.file(`/photo/${priyaId}`)).status).toBe(404);
    expect((await new Client().file(`/photo/${priyaId}`)).status).toBe(401);
  });

  it("lets HR change or remove anyone's photo, and turn off self-service changes", async () => {
    expect((await hardik.req("POST", `/admin/employees/${raviId}/photo`, form(JPG, "image/jpeg", "r.jpg"))).status).toBe(403);
    const r = await nisha.req("POST", `/admin/employees/${raviId}/photo`, form(JPG, "image/png", "r.png"));
    expect(r.status).toBe(201);
    const [row] = await sql`select photo_key from employees where id = ${raviId}`;
    expect(row!.photo_key).toMatch(/photo-[0-9a-f-]+\.jpeg$/); // stored as what it really is
    expect((await nisha.req("DELETE", `/admin/employees/${raviId}/photo`)).body.photoVersion).toBeNull();
    expect((await nisha.get("/photos")).body[raviId]).toBeUndefined();

    const kunal = await login("kunal.shah@strats360.com");
    expect((await kunal.patch("/admin/org/settings", { essPhotoEdit: false })).status).toBe(200);
    const blocked = await priya.req("DELETE", "/ess/photo");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/HR team manages profile photos/);
    const [audit] = await sql`select summary from audit_logs where action = 'employee.photo_remove' order by created_at desc limit 1`;
    expect(audit!.summary).toMatch(/^Removed profile photo for /);
  });
});
