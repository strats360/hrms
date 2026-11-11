import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let priya: Client;
let priyaId = "";
let saved: unknown = null;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ist = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

beforeAll(async () => {
  priya = await login("priya.vaghela@strats360.com");
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ s: saved }] = (await sql`select settings->'punchPolicy' as s from tenants where code = 'TN-0142'`) as any;
  await sql`update tenants set settings = settings - 'punchPolicy' where code = 'TN-0142'`;
  await sql`delete from attendance_records where employee_id = ${priyaId} and date = ${todayIST()}`;
});
afterAll(async () => {
  await sql`delete from attendance_records where employee_id = ${priyaId} and date = ${todayIST()}`;
  if (saved) await sql`update tenants set settings = jsonb_set(settings, '{punchPolicy}', ${sql.json(saved as any)}) where code = 'TN-0142'`;
  await sql.end();
});

describe("Punches saved offline", () => {
  it("refuses ones that are too old or in the future", async () => {
    const old = await priya.post("/ess/attendance/punch", { source: "gps", capturedAt: ago(13 * 60) });
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe("offline_too_old");
    expect((await priya.post("/ess/attendance/punch", { source: "gps", capturedAt: ago(-10) })).body.error.message).toMatch(/in the future/);
  });

  it("keeps the time it was made, and flags it for HR", async () => {
    // midnight-safe: a few minutes ago is still today in IST for this run
    const at = ago(5);
    const r = await priya.post("/ess/attendance/punch", { source: "gps", lat: 21.7645, lng: 72.1519, capturedAt: at });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: "in", checkIn: ist(at) });
    expect(r.body.flags.join(" ")).toMatch(new RegExp(`Punched offline at ${ist(at)}, sent at \\d\\d:\\d\\d`));
    const [rec] = await sql`select ip from attendance_records where employee_id = ${priyaId} and date = ${todayIST()}`;
    expect(rec!.ip).toBeNull(); // the network at sending time isn't where they punched
  });

  it("won't let a stale offline punch land before the check-in or after a check-out", async () => {
    const before = await priya.post("/ess/attendance/punch", { source: "gps", capturedAt: ago(6) });
    expect(before.status).toBe(400);
    await sql`update attendance_records set check_in = check_in - interval '8 hours' where employee_id = ${priyaId} and date = ${todayIST()}`;
    const out = await priya.post("/ess/attendance/punch", { source: "gps" });
    expect(out.body.action).toBe("out");
    const late = await priya.post("/ess/attendance/punch", { source: "gps", capturedAt: ago(30) });
    expect(late.body.error.message).toMatch(/already checked out after this offline punch/);
  });
});
