import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";
import { purgeOldSelfies } from "../src/services/selfie-retention";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let kunal: Client, priya: Client, hardik: Client, amit: Client;
let priyaId = "";
const today = todayIST();
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const dataUrl = (b: Uint8Array) => `data:image/jpeg;base64,${Buffer.from(b).toString("base64")}`;
let saved: unknown = null;

beforeAll(async () => {
  [kunal, priya, hardik, amit] = await Promise.all(["kunal.shah", "priya.vaghela", "hardik.mehta", "amit.dave"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ s: saved }] = (await sql`select settings->'punchPolicy' as s from tenants where code = 'TN-0142'`) as any;
  await sql`delete from attendance_records where employee_id = ${priyaId} and date = ${today}`;
});
afterAll(async () => {
  await sql`delete from attendance_records where employee_id = ${priyaId} and date = ${today}`;
  if (saved) await sql`update tenants set settings = jsonb_set(settings, '{punchPolicy}', ${sql.json(saved as any)}) where code = 'TN-0142'`;
  else await sql`update tenants set settings = settings - 'punchPolicy' where code = 'TN-0142'`;
  await sql.end();
  await db.$client.end();
});

describe("Selfie and location punch", () => {
  it("can require a selfie, and tells self-service", async () => {
    const r = await kunal.req("PUT", "/admin/attendance/punch-policy", { location: "off", ip: "off", wfhExempt: true, selfie: "required", selfieRetentionDays: 30 });
    expect(r.status).toBe(200);
    expect((await kunal.req("PUT", "/admin/attendance/punch-policy", { location: "off", ip: "off", wfhExempt: true, selfie: "required", selfieRetentionDays: 3 })).status).toBe(422);
    expect((await priya.get("/ess/home")).body.punch).toEqual({ selfie: "required", location: "off" });
  });

  it("refuses a punch without a real image", async () => {
    const none = await priya.post("/ess/attendance/punch", { source: "gps", lat: 21.7645, lng: 72.1519 });
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe("selfie_required");
    const fake = await priya.post("/ess/attendance/punch", { source: "gps", selfie: `data:image/jpeg;base64,${Buffer.from("<html>").toString("base64")}` });
    expect(fake.body.error.message).toMatch(/didn't come through/);
    const [rec] = await sql`select id from attendance_records where employee_id = ${priyaId} and date = ${today}`;
    expect(rec).toBeUndefined();
  });

  it("keeps the selfie and location of each punch", async () => {
    const inn = await priya.post("/ess/attendance/punch", { source: "gps", lat: 21.7645, lng: 72.1519, accuracy: 12, selfie: dataUrl(JPG) });
    expect(inn.status).toBe(200);
    expect(inn.body).toMatchObject({ action: "in", selfie: true });
    await sql`update attendance_records set check_in = check_in - interval '9 hours' where employee_id = ${priyaId} and date = ${today}`;
    const out = await priya.post("/ess/attendance/punch", { source: "gps", lat: 21.77, lng: 72.16, selfie: dataUrl(JPG) });
    expect(out.body).toMatchObject({ action: "out", selfie: true });
    const [rec] = await sql`select lat, lng, check_out_lat, check_out_lng, check_in_selfie_key, check_out_selfie_key from attendance_records where employee_id = ${priyaId} and date = ${today}`;
    expect(rec).toMatchObject({ lat: 21.7645, lng: 72.1519, check_out_lat: 21.77, check_out_lng: 72.16 });
    expect(rec!.check_in_selfie_key).toMatch(/attendance\/.*-in-.*\.jpeg$/);
    expect(rec!.check_out_selfie_key).toMatch(/-out-/);
  });

  it("shows the manager the punch details and selfies, and nobody outside the team", async () => {
    const row = (await hardik.get("/admin/attendance/today")).body.rows.find((r: any) => r.employeeId === priyaId);
    expect(row.punch).toMatchObject({ inLat: 21.7645, outLat: 21.77, inSelfie: true, outSelfie: true });
    const img = await hardik.file(`/admin/attendance/records/${row.punch.recordId}/selfie/in`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await img.raw.arrayBuffer())).toEqual(JPG);
    expect((await amit.file(`/admin/attendance/records/${row.punch.recordId}/selfie/in`)).status).toBe(404);
    expect((await hardik.file(`/admin/attendance/records/${row.punch.recordId}/selfie/sideways`)).status).toBe(404);
  });

  it("deletes selfies after the retention period", async () => {
    const soon = new Date(`${today}T00:00:00Z`);
    soon.setUTCDate(soon.getUTCDate() + 10);
    expect((await purgeOldSelfies(db, env, soon.toISOString().slice(0, 10))).removed).toBe(0); // inside 30 days
    const later = new Date(`${today}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 31);
    expect((await purgeOldSelfies(db, env, later.toISOString().slice(0, 10))).removed).toBe(2);
    const [rec] = await sql`select check_in_selfie_key, check_out_selfie_key, lat from attendance_records where employee_id = ${priyaId} and date = ${today}`;
    expect(rec).toMatchObject({ check_in_selfie_key: null, check_out_selfie_key: null, lat: 21.7645 });
  });
});
