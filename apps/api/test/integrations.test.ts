import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import postgres from "postgres";
import { signWebhook } from "@hrms/shared";
import { buildApp } from "../src/app";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const app = buildApp();
let kunal: Client;
let server: Server;
let port = 0;
const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let tid = "";

const v1 = (path: string, key?: string) => app.fetch(new Request(`${env.APP_URL}/api/v1${path}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }), env);

beforeAll(async () => {
  kunal = await login("kunal.shah@strats360.com");
  [{ tid }] = (await sql`select tenant_id as tid from employees where work_email = 'kunal.shah@strats360.com'`) as any;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = req.url === "/fail" ? 500 : 200;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  await sql`delete from api_keys where tenant_id = ${tid}`;
  await sql`delete from webhooks where tenant_id = ${tid}`;
  server.close();
  await sql.end();
});

describe("public API keys", () => {
  it("reads employees with a key, within its scopes, until it's revoked", async () => {
    expect((await kunal.post("/admin/integrations/keys", { name: "BI", scopes: [] })).status).toBe(422);
    const k = await kunal.post("/admin/integrations/keys", { name: "BI dashboard", scopes: ["employees:read"] });
    expect(k.status).toBe(201);
    expect(k.body.key).toMatch(/^sx_[0-9a-f-]{36}\./);

    expect((await v1("/employees")).status).toBe(401);
    expect((await v1("/employees", "sx_00000000-0000-0000-0000-000000000000.abcdefghijklmnopqrstuvwxyz")).status).toBe(401);
    const r = await v1("/employees?pageSize=5", k.body.key);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.data).toHaveLength(5);
    expect(body.hasMore).toBe(true);
    expect(body.data[0]).toHaveProperty("employeeCode");
    expect(body.data[0]).not.toHaveProperty("pan");
    expect(body.data[0]).not.toHaveProperty("annualCtc");
    const one = await v1(`/employees/${body.data[0].employeeCode}`, k.body.key);
    expect(((await one.json()) as any).data.id).toBe(body.data[0].id);

    expect((await v1("/payroll/runs", k.body.key)).status).toBe(403);
    expect((await kunal.del(`/admin/integrations/keys/${k.body.id}`)).status).toBe(200);
    expect((await v1("/employees", k.body.key)).status).toBe(401);
  });

  it("reads approved payroll runs and their payslips", async () => {
    const k = await kunal.post("/admin/integrations/keys", { name: "Finance", scopes: ["payroll:read", "attendance:read"] });
    const runs = (await (await v1("/payroll/runs?pageSize=2", k.body.key)).json()) as any;
    expect(runs.data.length).toBeGreaterThan(0);
    expect(["approved", "paid"]).toContain(runs.data[0].status);
    const slips = (await (await v1(`/payroll/runs/${runs.data[0].id}/payslips`, k.body.key)).json()) as any;
    expect(slips.data[0]).toHaveProperty("net");
    expect((await v1("/attendance?from=2026-10-01&to=2027-01-31", k.body.key)).status).toBe(422);
    expect((await v1("/attendance?from=2026-10-01&to=2026-10-31", k.body.key)).status).toBe(200);
  });
});

describe("webhooks", () => {
  it("sends signed events, and retries ones that fail", async () => {
    const ftp = await kunal.post("/admin/integrations/webhooks", { url: "ftp://example.com", events: ["employee.updated"] });
    expect(ftp.status).toBe(400);
    const h = await kunal.post("/admin/integrations/webhooks", { url: `http://localhost:${port}/hook`, events: ["employee.updated"] });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    expect(h.body.secret).toMatch(/^whsec_/);

    const ping = await kunal.post(`/admin/integrations/webhooks/${h.body.id}/test`);
    expect(ping.body).toMatchObject({ ok: true, responseCode: 200 });

    const [emp] = (await sql`select id from employees where tenant_id = ${tid} and status = 'active' order by employee_code limit 1`) as any;
    const before = received.length;
    expect((await kunal.patch(`/admin/employees/${emp.id}`, { workLocation: "Ahmedabad office" })).status).toBe(200);
    const got = received.slice(before).find((r) => r.headers["x-saralix-event"] === "employee.updated");
    expect(got).toBeTruthy();
    const parsed = JSON.parse(got!.body);
    expect(parsed.data).toMatchObject({ id: emp.id, fields: ["workLocation"] });
    const sig = String(got!.headers["x-saralix-signature"]);
    const t = Number(sig.match(/t=(\d+)/)![1]);
    expect(sig).toBe(await signWebhook(h.body.secret, got!.body, t));

    const bad = await kunal.post("/admin/integrations/webhooks", { url: `http://localhost:${port}/fail`, events: ["employee.updated"] });
    await kunal.patch(`/admin/employees/${emp.id}`, { workLocation: null });
    const d = (await kunal.get(`/admin/integrations/webhooks/${bad.body.id}/deliveries`)).body.rows[0];
    expect(d).toMatchObject({ event: "employee.updated", status: "pending", attempts: 1, responseCode: 500 });
    expect(new Date(d.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    const list = (await kunal.get("/admin/integrations/webhooks")).body.rows;
    expect(list.find((x: any) => x.id === bad.body.id).pending).toBe(1);
  });
});
