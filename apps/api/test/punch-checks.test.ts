import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const today = todayIST();
let nisha: Client, priya: Client, hardik: Client;
let priyaId = "";
let branchId = "";
const office = { lat: 21.7645, lng: 72.1519 };

const punch = (body: Record<string, unknown>, ip = "203.0.113.20") => priya.req("POST", "/ess/attendance/punch", body, { "cf-connecting-ip": ip });
const reset = () => sql`delete from attendance_records where employee_id = ${priyaId} and date = ${today}`;

beforeAll(async () => {
  [nisha, priya, hardik] = await Promise.all([login("nisha.trivedi@strats360.com"), login("priya.vaghela@strats360.com"), login("hardik.mehta@strats360.com")]);
  [{ id: priyaId, branch_id: branchId }] = (await sql`select id, branch_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  await reset();
});
afterAll(async () => {
  await reset();
  await sql`update tenants set settings = settings - 'punchPolicy' where code = 'TN-0142'`;
  await sql`update branches set geo_lat = null, geo_lng = null, geo_radius_m = null, allowed_ips = '[]' where id = ${branchId}`;
  await sql.end();
});

describe("Punch checks", () => {
  it("needs an office set up before a check can be turned on", async () => {
    const r = await nisha.req("PUT", "/admin/attendance/punch-policy", { location: "block", ip: "off", wfhExempt: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/office location/);
    expect((await hardik.req("PUT", "/admin/attendance/punch-policy", { location: "off", ip: "off", wfhExempt: true })).status).toBe(403);
  });

  it("saves the office's location and network on the branch", async () => {
    expect((await nisha.req("PATCH", `/admin/org/branches/${branchId}`, { allowedIps: ["not-an-ip"] })).status).toBe(422);
    const r = await nisha.req("PATCH", `/admin/org/branches/${branchId}`, { geoLat: office.lat, geoLng: office.lng, geoRadiusM: 150, allowedIps: ["203.0.113.0/24"] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ geoRadiusM: 150, allowedIps: ["203.0.113.0/24"] });
    // a later edit that leaves them out keeps them
    expect((await nisha.req("PATCH", `/admin/org/branches/${branchId}`, { city: "Bhavnagar" })).body.allowedIps).toEqual(["203.0.113.0/24"]);
    expect((await nisha.req("PUT", "/admin/attendance/punch-policy", { location: "block", ip: "flag", wfhExempt: true })).status).toBe(200);
  });

  it("refuses a punch away from the office, and takes one at the office", async () => {
    const away = await punch({ source: "gps", lat: 21.8, lng: 72.15, accuracy: 20 });
    expect(away.status).toBe(403);
    expect(away.body.error.message).toMatch(/You're 4\.0 km from/);
    expect((await punch({ source: "web" })).body.error.message).toMatch(/Turn on location/);
    const ok = await punch({ source: "gps", lat: 21.7649, lng: 72.152, accuracy: 30 });
    expect(ok.status).toBe(200);
    expect(ok.body.flags).toEqual([]);
    const [rec] = await sql`select flags, distance_m from attendance_records where employee_id = ${priyaId} and date = ${today}`;
    expect(rec!.flags).toEqual([]);
    expect(rec!.distance_m).toBeLessThan(150);
  });

  it("flags a punch from outside the office network, and HR sees it", async () => {
    await reset();
    const r = await punch({ source: "gps", lat: 21.7649, lng: 72.152 }, "198.51.100.7");
    expect(r.status).toBe(200);
    expect(r.body.flags).toEqual(["Not on an office network (198.51.100.7)"]);
    const t = (await nisha.get(`/admin/attendance/today?date=${today}`)).body;
    expect(t.summary.flagged).toBeGreaterThanOrEqual(1);
    expect(t.rows.find((x: any) => x.employeeId === priyaId).flags).toEqual(["In: Not on an office network (198.51.100.7)"]);
  });

  it("lets work from home through", async () => {
    await reset();
    expect((await punch({ source: "wfh" }, "198.51.100.7")).status).toBe(200);
    await nisha.req("PUT", "/admin/attendance/punch-policy", { location: "block", ip: "off", wfhExempt: false });
    await reset();
    expect((await punch({ source: "wfh", lat: 22.3, lng: 70.8 })).status).toBe(403);
  });
});
