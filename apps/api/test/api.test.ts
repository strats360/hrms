import { describe, expect, it, beforeAll } from "vitest";
import { Client, lastEmailTo, login } from "./helpers";
import { todayIST } from "@hrms/shared";

let hr: Client, kunal: Client, priya: Client, hardik: Client, platform: Client;

beforeAll(async () => {
  [hr, kunal, priya, hardik, platform] = await Promise.all([
    login("nisha.trivedi@strats360.com"),
    login("kunal.shah@strats360.com"),
    login("priya.vaghela@strats360.com"),
    login("hardik.mehta@strats360.com"),
    login("platform@strats360people.in"),
  ]);
});

describe("auth", () => {
  it("rejects wrong password", async () => {
    const c = new Client();
    const r = await c.post("/auth/sign-in/email", { email: "kunal.shah@strats360.com", password: "wrong-password" });
    expect(r.status).toBe(401);
  });
  it("blocks public sign-up through Better Auth", async () => {
    const r = await new Client().post("/auth/sign-up/email", { email: "x@y.com", password: "abcdefghijk", name: "X" });
    expect(r.status).toBe(404);
  });
  it("requires a session", async () => {
    expect((await new Client().get("/admin/employees")).status).toBe(401);
  });
  it("returns memberships and permissions", async () => {
    const r = await kunal.get("/me");
    expect(r.status).toBe(200);
    expect(r.body.memberships[0].roleName).toBe("Super admin");
    expect(r.body.memberships[0].permissions.payroll).toContain("configure");
  });
});

describe("permissions", () => {
  it("employee-only login cannot open admin APIs", async () => {
    expect((await priya.get("/admin/employees")).status).toBe(403);
    expect((await priya.get("/ess/home")).status).toBe(200);
  });
  it("manager cannot change settings", async () => {
    expect((await hardik.post("/admin/org/departments", { name: "Hack" })).status).toBe(403);
  });
  it("platform console is staff only", async () => {
    expect((await kunal.get("/platform/tenants")).status).toBe(403);
    const r = await platform.get("/platform/tenants");
    expect(r.status).toBe(200);
    const stl = r.body.find((t: any) => t.code === "TN-0142");
    expect(stl.employees).toBeGreaterThan(200);
  });
});

describe("employees", () => {
  it("lists with search, sort and pagination", async () => {
    const r = await hr.get("/admin/employees?pageSize=10&sort=code");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(250);
    expect(r.body.rows).toHaveLength(10);
    const s = await hr.get("/admin/employees?q=Vaghela");
    expect(s.body.rows.some((e: any) => e.fullName === "Priya Vaghela")).toBe(true);
  });
  it("masks bank account and reveals with audit", async () => {
    const list = await hr.get("/admin/employees?q=STL-0042");
    const id = list.body.rows[0].id;
    const d = await hr.get(`/admin/employees/${id}`);
    expect(d.body.accountLast4).toBe("2345");
    expect(d.body.accountNumber).toBeNull();
    expect(d.body).not.toHaveProperty("accountNumberEnc");
    const rev = await hr.get(`/admin/employees/${id}?reveal=account`);
    expect(rev.body.accountNumber).toBe("034501512345");
  });
  it("partial update leaves other fields untouched", async () => {
    const id = (await hr.get("/admin/employees?q=STL-0057")).body.rows[0].id;
    const before = (await hr.get(`/admin/employees/${id}`)).body;
    expect((await hr.patch(`/admin/employees/${id}`, { phone: "+91 98240 00000" })).status).toBe(200);
    const after = (await hr.get(`/admin/employees/${id}`)).body;
    expect(after.phone).toBe("+91 98240 00000");
    expect(after.status).toBe(before.status);
    expect(after.annualCtc).toBe(before.annualCtc);
    expect(after.taxRegime).toBe(before.taxRegime);
    expect(after.esiApplicable).toBe(before.esiApplicable);
  });
  it("validates PAN and IFSC", async () => {
    const r = await hr.post("/admin/employees", { firstName: "Test", workEmail: "t1@strats360.com", dateOfJoining: "2026-12-01", pan: "BAD", sendInvite: false });
    expect(r.status).toBe(422);
  });
  it("rejects duplicate work email", async () => {
    const r = await hr.post("/admin/employees", { firstName: "Dup", workEmail: "priya.vaghela@strats360.com", dateOfJoining: "2026-12-01", sendInvite: false });
    expect(r.status).toBe(409);
  });
});

describe("self-onboarding from email invite", () => {
  it("runs the full flow", async () => {
    const lookups = await hr.get("/admin/org/lookups");
    const created = await hr.post("/admin/employees", {
      firstName: "Meet",
      lastName: "Thakkar",
      workEmail: "meet.thakkar@strats360.com",
      dateOfJoining: "2026-12-07",
      departmentId: lookups.body.departments[0].id,
      annualCtc: 720000,
      sendInvite: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.employeeCode).toMatch(/^STL-\d{4}$/);
    const mail = lastEmailTo("meet.thakkar@strats360.com");
    expect(mail?.subject).toContain("complete your joining details");
    const token = mail!.text.match(/\/onboarding\/([\w-]+)/)![1]!;

    const info = await new Client().get(`/public/onboarding/${token}`);
    expect(info.body.employeeName).toBe("Meet Thakkar");

    const emp = new Client();
    const acc = await emp.post("/public/onboarding/accept", { token, password: "MeetPass#2026" });
    expect(acc.status).toBe(200);
    emp.tenantId = acc.body.tenantId;

    expect((await emp.post("/ess/onboarding/save", { step: "personal", data: { firstName: "Meet", lastName: "Thakkar", dateOfBirth: "1999-04-01", gender: "male" } })).status).toBe(200);
    expect((await emp.post("/ess/onboarding/save", { step: "address", data: { currentAddress: "12, Sardarnagar, Bhavnagar 364002", permanentAddress: "12, Sardarnagar, Bhavnagar 364002", emergencyContactName: "Ramesh Thakkar", emergencyContactRelation: "Father", emergencyContactPhone: "+91 94260 11223" } })).status).toBe(200);
    const badBank = await emp.post("/ess/onboarding/save", { step: "bank", data: { accountHolderName: "Meet", bankName: "HDFC", accountNumber: "12", ifsc: "HDFC0000412" } });
    expect(badBank.status).toBe(400);
    expect((await emp.post("/ess/onboarding/save", { step: "bank", data: { accountHolderName: "Meet Thakkar", bankName: "HDFC Bank", accountNumber: "50100999988877", ifsc: "HDFC0000412" } })).status).toBe(200);
    expect((await emp.post("/ess/onboarding/save", { step: "tax", data: { pan: "ABCPT1234K", aadhaarLast4: "4381", taxRegime: "new" } })).status).toBe(200);

    // submit blocked until documents uploaded
    expect((await emp.post("/ess/onboarding/submit")).status).toBe(400);
    for (const type of ["pan", "aadhaar", "bank_proof"]) {
      const fd = new FormData();
      fd.set("type", type);
      fd.set("file", new File([new Uint8Array([37, 80, 68, 70])], `${type}.pdf`, { type: "application/pdf" }));
      expect((await emp.req("POST", "/ess/documents", fd)).status).toBe(201);
    }
    expect((await emp.post("/ess/onboarding/submit")).status).toBe(200);

    const tracker = await hr.get("/admin/onboarding");
    const row = tracker.body.rows.find((r: any) => r.email === "meet.thakkar@strats360.com");
    expect(row.status).toBe("submitted");
    expect((await hr.post(`/admin/onboarding/${row.employeeId}/verify`, { status: "probation" })).status).toBe(200);
    const after = await hr.get(`/admin/employees/${row.employeeId}`);
    expect(after.body.status).toBe("probation");
    expect(after.body.documents.every((d: any) => d.status === "verified")).toBe(true);
  });
});

describe("leave", () => {
  it("applies, enforces scope and approves", async () => {
    const home = await priya.get("/ess/leave");
    const cl = home.body.types.find((t: any) => t.code === "CL");
    // pick next Monday-Wednesday window beyond seeded leave
    const d = new Date(todayIST() + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 21);
    const start = d.toISOString().slice(0, 10);
    const r = await priya.post("/ess/leave", { leaveTypeId: cl.id, startDate: start, endDate: start, halfDay: false, reason: "Bank work" });
    if (start.slice(0, 4) !== todayIST().slice(0, 4)) return; // year boundary, skip
    expect(r.status).toBe(201);
    const overlap = await priya.post("/ess/leave", { leaveTypeId: cl.id, startDate: start, endDate: start, halfDay: false });
    expect(overlap.status).toBe(409);

    // Amit (Sales manager) can't approve Priya (Engineering)
    const amit = await login("amit.dave@strats360.com");
    expect((await amit.post(`/admin/leave/requests/${r.body.id}/decision`, { decision: "approved" })).status).toBe(403);
    // Priya's manager is Hardik? No: Priya reports to Hardik.
    const before = (await priya.get("/ess/leave")).body.balances.find((b: any) => b.code === "CL");
    const ok = await hardik.post(`/admin/leave/requests/${r.body.id}/decision`, { decision: "approved" });
    expect(ok.status).toBe(200);
    const afterBal = (await priya.get("/ess/leave")).body.balances.find((b: any) => b.code === "CL");
    expect(afterBal.used).toBe(before.used + 1);
    // decision is final
    expect((await hardik.post(`/admin/leave/requests/${r.body.id}/decision`, { decision: "rejected", note: "x" })).status).toBe(400);
  });
  it("needs a reason to reject and blocks self-approval", async () => {
    // create a pending request on the next weekday so the test doesn't depend on today's date
    const ravi = (await hr.get("/admin/employees?q=STL-0057")).body.rows[0];
    const types = (await hr.get("/admin/leave/types")).body;
    const lop = types.find((t: any) => t.code === "LOP");
    const d = new Date(todayIST() + "T00:00:00Z");
    do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()) || d.toISOString().slice(5, 10) === "11-09" || d.toISOString().slice(5, 10) === "11-10");
    const day = d.toISOString().slice(0, 10);
    const created = await hr.post("/admin/leave/requests", { employeeId: ravi.id, leaveTypeId: lop.id, startDate: day, endDate: day, halfDay: false, reason: "Test" });
    expect(created.status).toBe(201);
    const pending = await hr.get("/admin/leave/requests?status=pending");
    const reqRow = pending.body.find((x: any) => x.id === created.body.id);
    expect((await hr.post(`/admin/leave/requests/${reqRow.id}/decision`, { decision: "rejected" })).status).toBe(400);
    const own = pending.body.find((x: any) => x.employeeCode === "STL-0063");
    if (own) expect((await hr.post(`/admin/leave/requests/${own.id}/decision`, { decision: "approved" })).status).toBe(403);
  });
  it("refuses leave beyond balance", async () => {
    const home = await priya.get("/ess/leave");
    const sl = home.body.types.find((t: any) => t.code === "SL");
    const y = todayIST().slice(0, 4);
    const r = await priya.post("/ess/leave", { leaveTypeId: sl.id, startDate: `${y}-12-01`, endDate: `${y}-12-31`, halfDay: false });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Not enough/);
  });
});

describe("attendance", () => {
  it("lets an employee punch and shows in today's view", async () => {
    const krupa = await login("krupa.joshi@strats360.com");
    const r = await krupa.post("/ess/attendance/punch", { source: "web" });
    expect([200, 400]).toContain(r.status); // 400 if punched < 1 min ago in a rerun
    const today = await hr.get("/admin/attendance/today");
    const row = today.body.rows.find((x: any) => x.code === "STL-0091");
    expect(row.checkIn).not.toBeNull();
    expect(today.body.summary.total).toBeGreaterThan(200);
  });
  it("approves a correction and updates the record", async () => {
    const list = await hr.get("/admin/attendance/corrections?status=pending");
    const corr = list.body.find((x: any) => x.issue === "Biometric failed");
    const r = await hr.post(`/admin/attendance/corrections/${corr.id}/decision`, { decision: "approved" });
    expect(r.status).toBe(200);
    const month = await hr.get(`/admin/attendance/monthly?month=${corr.date.slice(0, 7)}`);
    const emp = month.body.rows.find((x: any) => x.employeeId === corr.employeeId);
    const idx = month.body.days.indexOf(corr.date);
    expect(emp.days[idx]).toBe("present");
  });
  it("exports the register as CSV", async () => {
    const r = await hr.get("/admin/attendance/monthly.csv");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
  });
});

describe("tenant isolation", () => {
  it("a second company cannot see the first company's data", async () => {
    const c = new Client();
    const r = await c.post("/public/signup", { adminName: "Other Admin", email: "admin@othercorp.in", password: "OtherCorp#2026", companyName: "Other Corp Pvt Ltd", state: "Maharashtra" });
    expect(r.status).toBe(200);
    const list = await c.get("/admin/employees");
    expect(list.body.total).toBe(0);
    const priyaId = (await hr.get("/admin/employees?q=STL-0042")).body.rows[0].id;
    expect((await c.get(`/admin/employees/${priyaId}`)).status).toBe(404);
    expect((await c.patch(`/admin/employees/${priyaId}`, { firstName: "Hacked" })).status).toBe(404);
    // and can't select the other tenant via header
    c.tenantId = (await hr.get("/me")).body.memberships[0].tenantId;
    expect((await c.get("/admin/employees")).status).toBe(403);
  });
  it("blocks a suspended tenant", async () => {
    const tenants = await platform.get("/platform/tenants?q=Other Corp");
    const t = tenants.body[0];
    expect((await platform.patch(`/platform/tenants/${t.id}`, { status: "suspended" })).status).toBe(200);
    const c = await login("admin@othercorp.in", "OtherCorp#2026");
    expect((await c.get("/admin/employees")).status).toBe(403);
  });
});

describe("access management", () => {
  it("invites an admin who can accept and sign in", async () => {
    const roles = await kunal.get("/admin/access/roles");
    const viewer = roles.body.find((r: any) => r.name === "Viewer");
    const inv = await kunal.post("/admin/access/members/invite", { email: "rakesh@bhattassociates.in", name: "CA Rakesh Bhatt", roleId: viewer.id, scope: "Payroll, Compliance (read)" });
    expect(inv.status).toBe(201);
    const token = lastEmailTo("rakesh@bhattassociates.in")!.text.match(/\/invite\/admin\/([\w-]+)/)![1]!;
    const ca = new Client();
    expect((await ca.post("/public/admin-invite/accept", { token, password: "RakeshCA#2026" })).status).toBe(200);
    expect((await ca.get("/admin/employees")).status).toBe(200);
    expect((await ca.post("/admin/org/departments", { name: "Nope" })).status).toBe(403);
  });
  it("cannot edit the super admin role or lock out the last super admin", async () => {
    const roles = await kunal.get("/admin/access/roles");
    expect(roles.body.find((r: any) => r.key === "hr_admin").members).toBe(1);
    const sa = roles.body.find((r: any) => r.key === "super_admin");
    expect((await kunal.patch(`/admin/access/roles/${sa.id}`, { permissions: {} })).status).toBe(400);
    const members = await kunal.get("/admin/access/members");
    const me = members.body.members.find((m: any) => m.email === "kunal.shah@strats360.com");
    expect((await kunal.patch(`/admin/access/members/${me.id}`, { status: "disabled" })).status).toBe(400);
  });
});
