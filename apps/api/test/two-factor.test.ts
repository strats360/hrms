import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { Client, env, lastEmailTo, login, PASSWORD } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const KUNAL = "kunal.shah@strats360.com";
const AMIT = "amit.dave@strats360.com";

/** RFC 6238 code for the secret in an otpauth:// URI, as an authenticator app would show it. */
function totp(uri: string, at = Date.now()) {
  const b32 = new URL(uri).searchParams.get("secret")!.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const ch of b32) bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function enroll(c: Client) {
  const r = await c.post("/auth/two-factor/enable", { password: PASSWORD });
  expect(r.status).toBe(200);
  const v = await c.post("/auth/two-factor/verify-totp", { code: totp(r.body.totpURI) });
  expect(v.status).toBe(200);
  return r.body as { totpURI: string; backupCodes: string[] };
}

async function signIn(email: string, c = new Client()) {
  const r = await c.post("/auth/sign-in/email", { email, password: PASSWORD });
  expect(r.status).toBe(200);
  return { c, body: r.body };
}

let kunal: Client;
let uri = "";
let backup: string[] = [];

beforeAll(async () => {
  kunal = await login(KUNAL);
});
afterAll(async () => {
  await sql`update tenants set settings = settings - 'security' where code = 'TN-0142'`;
  const ids = (await sql`select id from auth_user where email in (${KUNAL}, ${AMIT})`).map((r) => r.id);
  await sql`delete from auth_two_factor where user_id in ${sql(ids)}`;
  await sql`update auth_user set two_factor_enabled = false where id in ${sql(ids)}`;
  await sql.end();
});

describe("Two-factor sign-in", () => {
  it("sets up an authenticator app after confirming a code", async () => {
    // a company can't require it until the admin turning that on has it themselves
    const early = await kunal.req("PUT", "/admin/access/security", { twoFactor: "admins" });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/your own account first/);
    const r = await kunal.post("/auth/two-factor/enable", { password: "wrong-password" });
    expect(r.status).toBe(400);
    const ok = await kunal.post("/auth/two-factor/enable", { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.totpURI).toMatch(/^otpauth:\/\/totp\/Strats360%20People:/);
    expect(ok.body.backupCodes).toHaveLength(10);
    // not on until a code is confirmed
    expect((await kunal.get("/me")).body.user.twoFactorEnabled).toBe(false);
    expect((await kunal.post("/auth/two-factor/verify-totp", { code: "000000" })).status).toBe(401);
    expect((await kunal.post("/auth/two-factor/verify-totp", { code: totp(ok.body.totpURI) })).status).toBe(200);
    expect((await kunal.get("/me")).body.user.twoFactorEnabled).toBe(true);
    expect(lastEmailTo(KUNAL)?.subject).toBe("Two-factor sign-in turned on");
    uri = ok.body.totpURI;
    backup = ok.body.backupCodes;
  });

  it("asks for a code after the password", async () => {
    const { c, body } = await signIn(KUNAL);
    expect(body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect((await c.get("/me")).body).toBeNull();
    expect((await c.post("/auth/two-factor/verify-totp", { code: "123456" })).status).toBe(401);
    expect((await c.post("/auth/two-factor/verify-totp", { code: totp(uri), trustDevice: true })).status).toBe(200);
    expect((await c.get("/me")).status).toBe(200);
    // a trusted device skips the code next time
    await c.post("/auth/sign-out");
    const again = await signIn(KUNAL, c);
    expect(again.body.twoFactorRedirect).toBeUndefined();
    expect((await c.get("/me")).status).toBe(200);
  });

  it("accepts each backup code once", async () => {
    const first = await signIn(KUNAL);
    expect((await first.c.post("/auth/two-factor/verify-backup-code", { code: backup[0] })).status).toBe(200);
    expect((await first.c.get("/me")).status).toBe(200);
    const second = await signIn(KUNAL);
    expect((await second.c.post("/auth/two-factor/verify-backup-code", { code: backup[0] })).status).toBe(401);
  });

  it("lets the company require it for admins", async () => {
    const nisha = await login("nisha.trivedi@strats360.com");
    const amit = await login(AMIT);
    const priya = await login("priya.vaghela@strats360.com");
    expect((await nisha.req("PUT", "/admin/access/security", { twoFactor: "admins" })).status).toBe(403);
    expect((await kunal.req("PUT", "/admin/access/security", { twoFactor: "admins" })).status).toBe(200);
    expect((await kunal.get("/admin/access/security")).body).toMatchObject({ twoFactor: "admins", coverage: { adminsOn: 1 } });

    const blocked = await amit.get("/admin/employees");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("two_factor_required");
    expect((await amit.get("/me")).body.memberships[0].twoFactorRequired).toBe(true);
    // self-service-only employees aren't covered by "admins"
    expect((await priya.get("/ess/profile")).status).toBe(200);
    expect((await priya.get("/me")).body.memberships[0].twoFactorRequired).toBe(false);

    // setting it up unblocks them
    await enroll(amit);
    expect((await amit.get("/admin/employees")).status).toBe(200);
  });

  it("lets a super admin reset it for someone who lost their phone", async () => {
    const amit = (await signIn(AMIT)).c; // stuck at the code step
    const [m] = await sql`select m.id from memberships m join auth_user u on u.id = m.user_id where u.email = ${AMIT}`;
    const [self] = await sql`select m.id from memberships m join auth_user u on u.id = m.user_id where u.email = ${KUNAL}`;
    const nisha = await login("nisha.trivedi@strats360.com");
    expect((await nisha.post(`/admin/access/members/${m!.id}/reset-two-factor`)).status).toBe(403);
    expect((await kunal.post(`/admin/access/members/${self!.id}/reset-two-factor`)).status).toBe(400);
    const members = (await kunal.get("/admin/access/members")).body.members;
    expect(members.find((x: any) => x.email === AMIT).twoFactorEnabled).toBe(true);

    expect((await kunal.post(`/admin/access/members/${m!.id}/reset-two-factor`)).status).toBe(200);
    expect(lastEmailTo(AMIT)?.subject).toBe("Two-factor sign-in turned off");
    expect((await amit.get("/me")).body).toBeNull();
    // signs in with just the password, but the policy still sends them to set it up
    const fresh = await signIn(AMIT);
    expect(fresh.body.twoFactorRedirect).toBeUndefined();
    expect((await fresh.c.get("/admin/employees")).body.error.code).toBe("two_factor_required");
    const [audit] = await sql`select summary from audit_logs where action = 'member.reset_2fa' order by created_at desc limit 1`;
    expect(audit!.summary).toBe(`Reset two-factor sign-in for ${AMIT}`);
  });

  it("can be turned off with the password", async () => {
    await kunal.req("PUT", "/admin/access/security", { twoFactor: "off" });
    const c = (await signIn(KUNAL)).c;
    await c.post("/auth/two-factor/verify-totp", { code: totp(uri) });
    expect((await c.post("/auth/two-factor/disable", { password: "nope" })).status).toBe(400);
    expect((await c.post("/auth/two-factor/disable", { password: PASSWORD })).status).toBe(200);
    expect(lastEmailTo(KUNAL)?.subject).toBe("Two-factor sign-in turned off");
    expect((await signIn(KUNAL)).body.twoFactorRedirect).toBeUndefined();
  });
});
