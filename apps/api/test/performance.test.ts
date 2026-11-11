import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, amit: Client, priya: Client;
let tenantId = "";
let priyaId = "";
let deptId = "";
let cycleId = "";
let reviewId = "";

const cycle = (over: Record<string, unknown> = {}) => ({
  name: "Half-year review H1 2026-27",
  periodStart: "2026-04-01",
  periodEnd: "2026-09-30",
  selfDue: "2026-11-20",
  managerDue: "2026-11-30",
  competencies: ["Ownership", "Communication"],
  departmentIds: [deptId],
  branchIds: [],
  joinedBy: null,
  ...over,
});

beforeAll(async () => {
  [nisha, hardik, amit, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "amit.dave", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: priyaId, tenant_id: tenantId, department_id: deptId }] = (await sql`select id, tenant_id, department_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from review_cycles where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("Performance reviews", () => {
  it("lets HR set up a draft cycle and see who's in it", async () => {
    expect((await hardik.post("/admin/performance/cycles", cycle())).status).toBe(403);
    expect((await nisha.post("/admin/performance/cycles", cycle({ managerDue: "2026-11-10" }))).status).toBe(422);
    const r = await nisha.post("/admin/performance/cycles", cycle());
    expect(r.status).toBe(201);
    cycleId = r.body.id;
    const d = (await nisha.get(`/admin/performance/cycles/${cycleId}`)).body;
    expect(d.cycle.status).toBe("draft");
    expect(d.eligible.some((e: any) => e.employeeId === priyaId)).toBe(true);
    // not visible to managers or employees yet
    expect((await hardik.get("/admin/performance/cycles")).body.rows.some((x: any) => x.id === cycleId)).toBe(false);
    expect((await priya.get("/ess/reviews")).body).toEqual([]);
  });

  it("launches: everyone gets a review with their manager, and an email", async () => {
    const before = mailer.sent.length;
    const r = await nisha.post(`/admin/performance/cycles/${cycleId}/launch`);
    expect(r.status).toBe(200);
    expect(r.body.reviews).toBeGreaterThan(0);
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && m.subject === "Half-year review H1 2026-27: your self review is open")).toBe(true);
    expect((await nisha.post(`/admin/performance/cycles/${cycleId}/launch`)).status).toBe(400);
    const mine = (await priya.get("/ess/reviews")).body;
    expect(mine[0]).toMatchObject({ cycle: "Half-year review H1 2026-27", stage: "self", finalRating: null });
    reviewId = mine[0].id;
    const [row] = await sql`select manager_id from performance_reviews where id = ${reviewId}`;
    const [hk] = await sql`select id from employees where work_email = 'hardik.mehta@strats360.com'`;
    expect(row!.manager_id).toBe(hk!.id);
  });

  it("takes the employee's goals and self review, with checks before submitting", async () => {
    let r = await priya.req("PUT", `/ess/reviews/${reviewId}/goals`, { goals: [{ title: "Ship the payroll export", weight: 60 }, { title: "Mentor two juniors", weight: 30 }] });
    expect(r.status).toBe(200);
    const goals = r.body.goals;
    const save = (submit: boolean, comp: Record<string, number | null>) =>
      priya.req("PUT", `/ess/reviews/${reviewId}/self`, { goals: goals.map((g: any, i: number) => ({ id: g.id, rating: i === 0 ? 4 : 3, comment: "Done" })), competencies: comp, summary: "A good half", submit });
    expect((await save(true, { Ownership: 4, Communication: 3 })).body.error.message).toMatch(/add up to 90%/);
    r = await priya.req("PUT", `/ess/reviews/${reviewId}/goals`, { goals: [{ id: goals[0].id, title: "Ship the payroll export", weight: 60 }, { id: goals[1].id, title: "Mentor two juniors", weight: 40 }] });
    // ratings already given survive a goal edit
    expect((await save(false, { Ownership: 4 })).body.selfScore).toBe(3.6);
    expect((await save(true, { Ownership: 4 })).body.error.message).toMatch(/every competency/);
    const before = mailer.sent.length;
    r = await save(true, { Ownership: 4, Communication: 3 });
    expect(r.status).toBe(200);
    expect(r.body.stage).toBe("manager");
    expect(mailer.sent.slice(before).map((m) => m.subject)).toContain("Review Priya Vaghela: self review is in");
    expect((await save(false, {})).body.error.message).toMatch(/already submitted/);
  });

  it("lets the manager review their own team only", async () => {
    const d = (await hardik.get(`/admin/performance/cycles/${cycleId}`)).body;
    expect(d.canManage).toBe(false);
    expect(d.rows.find((x: any) => x.id === reviewId)).toMatchObject({ name: "Priya Vaghela", stage: "manager", selfScore: 3.6 });
    expect((await amit.get(`/admin/performance/reviews/${reviewId}`)).status).toBe(404);
    const rv = (await hardik.get(`/admin/performance/reviews/${reviewId}`)).body;
    expect(rv.self.summary).toBe("A good half");
    const goals = rv.goals.map((g: any) => ({ id: g.id, rating: g.title.startsWith("Ship") ? 4 : 3, comment: "Agreed" }));
    const body = { goals, competencies: { Ownership: 4, Communication: 4 }, summary: "", strengths: "Owns delivery", improvements: "Speak up in reviews", submit: true };
    expect((await hardik.req("PUT", `/admin/performance/reviews/${reviewId}/manager`, body)).body.error.message).toMatch(/overall comment/);
    const r = await hardik.req("PUT", `/admin/performance/reviews/${reviewId}/manager`, { ...body, summary: "Strong half year" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ stage: "calibration", managerScore: 3.6 });
    // the employee doesn't see the manager's part yet
    const own = (await priya.get(`/ess/reviews/${reviewId}`)).body;
    expect(own.managerPart).toEqual({});
    expect(own.goals[0].managerRating).toBeUndefined();
    expect(own.finalRating).toBeNull();
  });

  it("lets HR calibrate, share, and the employee acknowledge", async () => {
    expect((await hardik.post(`/admin/performance/reviews/${reviewId}/calibrate`, { finalRating: 4 })).status).toBe(403);
    expect((await nisha.post(`/admin/performance/reviews/${reviewId}/calibrate`, { finalRating: 4 })).body.error.message).toMatch(/differs/);
    expect((await nisha.post(`/admin/performance/reviews/${reviewId}/calibrate`, { finalRating: 4, note: "Delivery across teams" })).status).toBe(200);
    const d = (await nisha.get(`/admin/performance/cycles/${cycleId}`)).body;
    expect(d.distribution[4]).toBeGreaterThanOrEqual(1);
    const s = await nisha.post(`/admin/performance/cycles/${cycleId}/share`, { reviewIds: [reviewId] });
    expect(s.body.shared).toBe(1);
    expect(lastEmailTo("priya.vaghela@strats360.com")!.subject).toBe("Half-year review H1 2026-27: your review is ready");
    const own = (await priya.get(`/ess/reviews/${reviewId}`)).body;
    expect(own).toMatchObject({ stage: "shared", finalRating: 4, finalLabel: "Exceeds expectations", calibrationNote: null });
    expect(own.managerPart.strengths).toBe("Owns delivery");
    expect(own.goals[0].managerRating).toBe(4);
    expect((await priya.post(`/ess/reviews/${reviewId}/acknowledge`, { comment: "Thanks, agreed" })).status).toBe(200);
    expect((await priya.post(`/ess/reviews/${reviewId}/acknowledge`, {})).status).toBe(400);
  });

  it("handles people who can't do a self review, sends reminders, exports and closes", async () => {
    const d = (await nisha.get(`/admin/performance/cycles/${cycleId}`)).body;
    const other = d.rows.find((x: any) => x.stage === "self" && !x.mine);
    expect((await nisha.post(`/admin/performance/reviews/${other.id}/skip-self`)).status).toBe(200);
    expect((await nisha.post(`/admin/performance/cycles/${cycleId}/remind`)).status).toBe(200);
    const x = await nisha.file(`/admin/performance/cycles/${cycleId}/export.xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect((await nisha.post(`/admin/performance/cycles/${cycleId}/close`)).status).toBe(200);
    expect((await nisha.post(`/admin/performance/reviews/${other.id}/calibrate`, { finalRating: 3 })).body.error.message).toMatch(/closed/);
    expect((await nisha.del(`/admin/performance/cycles/${cycleId}`)).status).toBe(400);
  });
});
