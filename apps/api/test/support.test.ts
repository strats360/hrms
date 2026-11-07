import { beforeAll, describe, expect, it } from "vitest";
import { Client, lastEmailTo, login } from "./helpers";

let platform: Client, kunal: Client, priya: Client;
let tenantId = "";
let ticketId = "";

function form(data: Record<string, unknown>, files: File[] = []) {
  const f = new FormData();
  f.set("data", JSON.stringify(data));
  for (const x of files) f.append("files", x);
  return f;
}

beforeAll(async () => {
  [platform, kunal, priya] = await Promise.all([login("platform@strats360people.in"), login("kunal.shah@strats360.com"), login("priya.vaghela@strats360.com")]);
  tenantId = (await platform.get("/platform/tenants?q=TN-0142")).body[0].id;
});

describe("Support tickets", () => {
  it("tenant admins raise tickets with attachments", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "screen.png", { type: "image/png" });
    const r = await kunal.req("POST", "/admin/support", form({ subject: "Payslips not emailed for October", category: "payroll", priority: "P1", body: "Published payslips but employees say no email arrived." }, [png]));
    expect(r.status).toBe(201);
    expect(r.body.number).toBeGreaterThan(4812);
    ticketId = r.body.id;
    expect(lastEmailTo("platform@strats360people.in")?.subject).toMatch(/^\[P1\] #\d+ Payslips/);
    const mine = (await kunal.get("/admin/support")).body;
    expect(mine.find((t: any) => t.id === ticketId).sla).toMatch(/1 hour/);
    expect((await priya.get("/admin/support")).status).toBe(403); // self-service only
    expect((await kunal.req("POST", "/admin/support", form({ subject: "x", body: "short" }))).status).toBe(400);
  });

  it("shows up in the platform queue with its SLA", async () => {
    const q = (await platform.get("/platform/support/tickets?status=open")).body;
    expect(q[0].priority).toBe("P1"); // P1 first
    expect(q.find((t: any) => t.id === ticketId).slaState).toBe("pending");
    const s = (await platform.get("/platform/support/summary")).body;
    expect(s.p1).toBeGreaterThanOrEqual(1);
    expect((await kunal.get("/platform/support/tickets")).status).toBe(403);
  });

  it("replies reach the customer; internal notes don't", async () => {
    const note = await platform.req("POST", `/platform/support/tickets/${ticketId}/messages`, form({ body: "Check Resend logs for the tenant domain", internal: true }));
    expect(note.status).toBe(201);
    const reply = await platform.req("POST", `/platform/support/tickets/${ticketId}/messages`, form({ body: "Looking into it. Can you allow read-only access so we can check the run?" }));
    expect(reply.status).toBe(201);
    expect(lastEmailTo("kunal.shah@strats360.com")?.subject).toMatch(/^Re: #\d+/);
    const t = (await platform.get(`/platform/support/tickets/${ticketId}`)).body;
    expect(t.firstResponseAt).not.toBeNull();
    expect(t.status).toBe("waiting_on_customer");
    expect(t.assigneeName).toBe("Meera Iyer");
    const seen = (await kunal.get(`/admin/support/${ticketId}`)).body.thread;
    expect(seen.some((m: any) => m.body.includes("Resend logs"))).toBe(false);
    expect(seen).toHaveLength(2);
    const file = await kunal.get(`/admin/support/attachments/${seen[0].id}/0`);
    expect(file.status).toBe(200);
  });
});

describe("Read-only support access", () => {
  it("needs the customer's consent", async () => {
    expect((await platform.post(`/platform/support/tickets/${ticketId}/access`)).status).toBe(403);
    expect((await kunal.patch(`/admin/support/${ticketId}`, { allowAccess: true })).body.allowAccess).toBe(true);
  });

  it("lets support look but not change or download anything", async () => {
    const a = await platform.post(`/platform/support/tickets/${ticketId}/access`);
    expect(a.status).toBe(201);
    const me = (await platform.get("/me")).body;
    expect(me.supportSessions[0].tenantId).toBe(tenantId);
    platform.tenantId = tenantId;
    expect((await platform.get("/admin/employees?pageSize=5")).status).toBe(200);
    expect((await platform.get("/admin/payroll/runs")).status).toBe(200);
    expect((await platform.post("/admin/payroll/runs", { month: "2030-01" })).status).toBe(403);
    expect((await platform.patch(`/admin/support/${ticketId}`, { allowAccess: true })).status).toBe(403);
    expect((await platform.get("/admin/reimbursements/export.csv")).status).toBe(403);
    expect((await platform.get("/admin/reports/employee-master?format=csv")).status).toBe(403);
    expect((await platform.get("/admin/reports/employee-master")).status).toBe(200); // preview is fine
    expect((await platform.get("/ess/payslips")).status).toBe(403); // not an employee
    const log = (await kunal.get(`/admin/support/${ticketId}`)).body;
    expect(log.accessLog[0].staffName).toBe("Meera Iyer");
    expect(log.thread.some((m: any) => m.authorKind === "system" && m.body.includes("read-only access"))).toBe(true);
    const audit = (await kunal.get("/admin/audit")).body;
    expect(JSON.stringify(audit)).toContain("started read-only access");
  });

  it("ends when the customer withdraws consent", async () => {
    await kunal.patch(`/admin/support/${ticketId}`, { allowAccess: false });
    expect((await platform.get("/admin/employees?pageSize=5")).status).toBe(403);
    platform.tenantId = undefined;
    expect((await platform.get("/me")).body.supportSessions).toHaveLength(0);
  });

  it("customer replies reopen the ticket; resolving closes access", async () => {
    await kunal.req("POST", `/admin/support/${ticketId}/messages`, form({ body: "Access allowed again, thanks" }));
    expect((await platform.get(`/platform/support/tickets/${ticketId}`)).body.status).toBe("open");
    await kunal.patch(`/admin/support/${ticketId}`, { allowAccess: true });
    const a = await platform.post(`/platform/support/tickets/${ticketId}/access`);
    expect((await platform.patch(`/platform/support/tickets/${ticketId}`, { status: "resolved" })).body.status).toBe("resolved");
    platform.tenantId = tenantId;
    expect((await platform.get("/admin/employees?pageSize=5")).status).toBe(403);
    platform.tenantId = undefined;
    expect((await platform.post(`/platform/support/access/${a.body.id}/end`)).status).toBe(404); // already ended
  });
});
