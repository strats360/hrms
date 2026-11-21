import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, nisha: Client, priya: Client, amit: Client;
const id: Record<string, string> = {};
let committeeId = "";
let tid = "";

beforeAll(async () => {
  [kunal, nisha, priya, amit] = await Promise.all(["kunal.shah", "nisha.trivedi", "priya.vaghela", "amit.dave"].map((n) => login(`${n}@strats360.com`)));
  for (const r of (await sql`select id, work_email, tenant_id from employees where work_email in ('nisha.trivedi@strats360.com','krupa.joshi@strats360.com','amit.dave@strats360.com','priya.vaghela@strats360.com','hardik.mehta@strats360.com')`) as any) {
    id[r.work_email.split(".")[0]] = r.id;
    tid = r.tenant_id;
  }
  await sql`delete from committee_cases where tenant_id = ${tid}`;
  await sql`delete from committees where tenant_id = ${tid}`;
});
afterAll(async () => {
  await sql`delete from committee_cases where tenant_id = ${tid}`;
  await sql`delete from committees where tenant_id = ${tid}`;
  await sql.end();
});

describe("POSH Internal Committee", () => {
  it("is set up by HR and checked against the Act", async () => {
    expect((await priya.req("POST", "/ess/committees/cases", { kind: "posh_ic", subject: "Remarks", description: "Something happened at work" })).status).toBe(400);
    const bad = await kunal.post("/admin/compliance/committees", { kind: "posh_ic", name: "Internal Committee", constitutedOn: "2026-01-01", members: [{ employeeId: id.amit, role: "presiding", gender: "male" }] });
    expect(bad.status).toBe(201);
    expect(bad.body.problems).toContain("The presiding officer must be a senior woman employee");
    const r = await kunal.req("PUT", `/admin/compliance/committees/${bad.body.id}`, {
      kind: "posh_ic",
      name: "Internal Committee",
      constitutedOn: "2026-01-01",
      members: [
        { employeeId: id.nisha, role: "presiding", gender: "female" },
        { employeeId: id.krupa, role: "member", gender: "female" },
        { employeeId: id.amit, role: "member", gender: "male" },
        { name: "Asha Mehta", organisation: "Sakhi Trust", role: "external", gender: "female" },
      ],
      workshops: [{ date: "2026-03-08", title: "Awareness session" }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.problems).toEqual([]);
    committeeId = r.body.id;
  });

  it("keeps a case between the person who filed and the committee", async () => {
    const f = await priya.req("POST", "/ess/committees/cases", { kind: "posh_ic", subject: "Inappropriate remarks", description: "Repeated remarks in the team meeting", incidentDate: "2026-11-10", respondentEmployeeId: id.hardik });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect(f.body.code).toMatch(/^POSH-\d{4}$/);
    const caseId = f.body.id;

    // stored encrypted; the audit log doesn't say what it's about
    const [raw] = (await sql`select description_enc from committee_cases where id = ${caseId}`) as any;
    expect(raw.description_enc).not.toMatch(/remarks/);
    const logs = (await sql`select summary from audit_logs where entity_id = ${caseId}`) as any[];
    expect(logs.map((l) => l.summary).join(" ")).not.toMatch(/remarks|Hardik/i);

    // HR admins see counts, not the case
    expect((await kunal.get(`/ess/committees/cases/${caseId}`)).status).toBe(404);
    const list = (await kunal.get("/admin/compliance/committees")).body.rows[0];
    expect(list.cases).toMatchObject({ open: 1, total: 1 });
    expect(JSON.stringify(list)).not.toMatch(/Inappropriate/);

    // a member sees it, works it, and keeps some notes to the committee
    const mine = (await amit.get("/ess/committees")).body;
    expect(mine.assigned.map((x: any) => x.id)).toContain(caseId);
    const view = (await amit.get(`/ess/committees/cases/${caseId}`)).body;
    expect(view).toMatchObject({ description: "Repeated remarks in the team meeting", asMember: true, deadlines: { inquiryBy: new Date(Date.parse(`${view.filedOn}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10) } });
    expect((await amit.post(`/ess/committees/cases/${caseId}/notes`, { body: "Witness list drafted" })).status).toBe(200);
    expect((await nisha.post(`/ess/committees/cases/${caseId}/notes`, { status: "inquiry", body: "Inquiry starts on 25 Nov", share: true })).status).toBe(200);
    expect((await nisha.post(`/ess/committees/cases/${caseId}/notes`, { status: "closed" })).status).toBe(400);

    const own = (await priya.get(`/ess/committees/cases/${caseId}`)).body;
    expect(own.status).toBe("inquiry");
    const bodies = own.notes.map((n: any) => n.body);
    expect(bodies).toContain("Inquiry starts on 25 Nov");
    expect(bodies).not.toContain("Witness list drafted");
    expect((await priya.post(`/ess/committees/cases/${caseId}/notes`, { status: "closed" })).status).toBe(403);

    expect((await nisha.post(`/ess/committees/cases/${caseId}/notes`, { status: "closed", outcome: "Warning issued; training ordered" })).status).toBe(200);
    const rep = (await kunal.get(`/admin/compliance/committees/${committeeId}/annual-report?year=2026`)).body;
    expect(rep).toEqual({ year: 2026, received: 1, disposed: 1, pending: 0, pendingOver90Days: 0, workshops: 1 });
  });
});
