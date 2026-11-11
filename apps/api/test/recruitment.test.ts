import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, lastEmailTo, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, amit: Client, priya: Client;
let tenantId = "", hardikId = "", priyaId = "", jobId = "", appId = "", candId = "", interviewId = "", hiredId = "";
const pdf = () => new Blob([new TextEncoder().encode("%PDF-1.4 resume")], { type: "application/pdf" });
const apply = (over: Record<string, string> = {}, file: Blob | null = pdf()) => {
  const f = new FormData();
  const fields = { name: "Riya Joshi", email: "riya.joshi@example.com", phone: "+91 98250 11111", currentCompany: "Acme", experienceYears: "4", noticeDays: "30", note: "Keen on payroll work", website: "", consent: "yes", ...over };
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append("resume", file, "riya-resume.pdf");
  return new Client().req("POST", `/public/careers/strats360/jobs/${jobId}/apply`, f, { "x-forwarded-for": "203.0.113.7" });
};

beforeAll(async () => {
  [nisha, hardik, amit, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "amit.dave", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ id: hardikId, tenant_id: tenantId }] = (await sql`select id, tenant_id from employees where work_email = 'hardik.mehta@strats360.com'`) as any;
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from job_openings where tenant_id = ${tenantId}`;
  await sql`delete from candidates where tenant_id = ${tenantId}`;
  if (hiredId) await sql`delete from employees where id = ${hiredId}`;
  await sql`update tenants set settings = settings - 'careers' where id = ${tenantId}`;
  await sql.end();
});

describe("Recruitment", () => {
  it("lets recruiters open a job; hiring managers see only theirs", async () => {
    const body = { title: "Payroll Executive", employmentType: "full_time", openings: 1, minExperience: 2, maxExperience: 5, minCtc: 400000, maxCtc: 600000, description: "Run monthly payroll for 200+ people.", hiringManagerId: hardikId, status: "open", published: true, location: "Ahmedabad" };
    expect((await hardik.post("/admin/recruitment/jobs", body)).status).toBe(403);
    expect((await nisha.post("/admin/recruitment/jobs", { ...body, maxCtc: 300000 })).status).toBe(422);
    const r = await nisha.post("/admin/recruitment/jobs", body);
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^JOB-\d{4}$/);
    jobId = r.body.id;
    expect((await hardik.get("/admin/recruitment/jobs")).body.rows.map((j: any) => j.id)).toContain(jobId);
    expect((await amit.get("/admin/recruitment/jobs")).body.rows.map((j: any) => j.id)).not.toContain(jobId);
    expect((await amit.get(`/admin/recruitment/jobs/${jobId}`)).status).toBe(404);
    expect((await priya.get("/admin/recruitment/jobs")).status).toBe(403);
  });

  it("takes applications on the public careers page", async () => {
    expect((await new Client().get("/public/careers/strats360")).status).toBe(404);
    expect((await nisha.req("PUT", "/admin/recruitment/settings", { slug: "Strats360", intro: "Build HR software people like." })).status).toBe(200);
    const page = (await new Client().get("/public/careers/strats360")).body;
    expect(page.company.name).toBeTruthy();
    expect(page.jobs.map((j: any) => j.title)).toContain("Payroll Executive");
    expect((await new Client().get(`/public/careers/strats360/jobs/${jobId}`)).body.job).toMatchObject({ title: "Payroll Executive", experience: "2 to 5 years", location: "Ahmedabad" });
    // no salary range or hiring manager on the public page
    expect(JSON.stringify(page)).not.toMatch(/600000|hiringManager/);

    expect((await apply({ website: "http://spam.example" })).status).toBe(400);
    expect((await apply({ consent: "" })).body.error.message).toMatch(/agree/);
    expect((await apply({}, null)).body.error.message).toMatch(/resume/);
    expect((await apply({}, new Blob(["not a resume"], { type: "application/pdf" }))).body.error.message).toMatch(/PDF or Word/);
    const before = mailer.sent.length;
    expect((await apply()).status).toBe(201);
    expect((await apply()).status).toBe(201); // twice is harmless
    const sent = mailer.sent.slice(before);
    expect(sent.filter((m) => m.to === "riya.joshi@example.com")).toHaveLength(1);
    expect(sent.some((m) => m.to === "hardik.mehta@strats360.com" && m.subject === "New applicant: Riya Joshi for Payroll Executive")).toBe(true);
    const job = (await hardik.get(`/admin/recruitment/jobs/${jobId}`)).body;
    expect(job.applications).toHaveLength(1);
    expect(job.applications[0].candidate).toMatchObject({ name: "Riya Joshi", source: "careers_page", hasResume: true, experienceYears: 4 });
    appId = job.applications[0].id;
    candId = job.applications[0].candidate.id;
    const res = await hardik.file(`/admin/recruitment/candidates/${candId}/resume`);
    expect(res.status).toBe(200);
    expect(await res.raw.text()).toBe("%PDF-1.4 resume");
  });

  it("lets recruiters add candidates and moves them through the stages", async () => {
    const add = await nisha.post("/admin/recruitment/candidates", { jobId, name: "Karan Shah", email: "Karan.Shah@example.com", phone: "9825022222", source: "referral", referredById: priyaId });
    expect(add.status).toBe(201);
    expect((await nisha.post("/admin/recruitment/candidates", { jobId, name: "Karan Shah", email: "karan.shah@example.com" })).status).toBe(409);
    const karan = add.body.applicationId;
    expect((await nisha.post(`/admin/recruitment/applications/${karan}/move`, { stage: "rejected" })).body.error.message).toMatch(/reason/);
    expect((await nisha.post(`/admin/recruitment/applications/${karan}/move`, { stage: "rejected", reason: "Not enough payroll experience" })).status).toBe(200);
    expect((await nisha.post(`/admin/recruitment/applications/${karan}/move`, { stage: "interview" })).body.error.message).toMatch(/Can't move/);
    expect((await hardik.post(`/admin/recruitment/applications/${appId}/move`, { stage: "screening", note: "Good fit on paper" })).status).toBe(200);
    expect((await hardik.post(`/admin/recruitment/applications/${appId}/move`, { stage: "hired" })).status).toBe(400);
    // a recruiter can remove a candidate who wasn't hired, resume and all
    expect((await hardik.del(`/admin/recruitment/candidates/${add.body.candidateId}`)).status).toBe(403);
    expect((await nisha.del(`/admin/recruitment/candidates/${add.body.candidateId}`)).status).toBe(200);
  });

  it("schedules interviews and collects feedback from the panel", async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    expect((await hardik.post(`/admin/recruitment/applications/${appId}/interviews`, { round: "Technical", scheduledAt: at, mode: "video", location: "https://meet.example/abc", interviewerIds: [] })).status).toBe(422);
    const before = mailer.sent.length;
    const r = await hardik.post(`/admin/recruitment/applications/${appId}/interviews`, { round: "Technical", scheduledAt: at, mode: "video", location: "https://meet.example/abc", interviewerIds: [priyaId] });
    expect(r.status).toBe(201);
    interviewId = r.body.id;
    const subjects = mailer.sent.slice(before).map((m) => `${m.to}|${m.subject}`);
    expect(subjects.some((s) => s.startsWith("priya.vaghela@strats360.com|Interview: Riya Joshi for Payroll Executive"))).toBe(true);
    expect(subjects.some((s) => s.startsWith("riya.joshi@example.com|Interview with"))).toBe(true);
    expect((await hardik.get(`/admin/recruitment/jobs/${jobId}`)).body.applications[0].stage).toBe("interview");

    const mine = (await priya.get("/ess/interviews")).body;
    expect(mine[0]).toMatchObject({ candidate: "Riya Joshi", round: "Technical", feedbackDone: false });
    expect((await amit.get(`/ess/interviews/${interviewId}`)).status).toBe(404);
    expect((await priya.file(`/ess/interviews/${interviewId}/resume`)).status).toBe(200);
    expect((await priya.post(`/ess/interviews/${interviewId}/feedback`, { rating: 4, recommendation: "yes", notes: "short" })).status).toBe(422);
    expect((await priya.post(`/ess/interviews/${interviewId}/feedback`, { rating: 4, recommendation: "yes", notes: "Strong on PF and ESI rules; clear thinker." })).status).toBe(200);
    const cand = (await hardik.get(`/admin/recruitment/candidates/${candId}`)).body;
    const iv = cand.applications[0].interviews[0];
    expect(iv.status).toBe("done");
    expect(iv.panel[0]).toMatchObject({ name: "Priya Vaghela", rating: 4, recommendation: "yes" });
    expect(cand.applications[0].events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["created", "moved", "interview", "feedback"]));
  });

  it("makes an offer and hires into onboarding, closing the filled job", async () => {
    expect((await nisha.post(`/admin/recruitment/applications/${appId}/hire`, { employeeCode: "STL-9001", workEmail: "riya.joshi@strats360.com", dateOfJoining: "2026-12-01" })).body.error.message).toMatch(/offer first/);
    expect((await hardik.post(`/admin/recruitment/applications/${appId}/offer`, { offeredCtc: 540000, joiningDate: "2026-12-01" })).status).toBe(200);
    expect((await hardik.post(`/admin/recruitment/applications/${appId}/hire`, { employeeCode: "STL-9001", workEmail: "riya.joshi@strats360.com", dateOfJoining: "2026-12-01" })).status).toBe(403);
    expect((await nisha.post(`/admin/recruitment/applications/${appId}/hire`, { employeeCode: "STL-0042", workEmail: "riya.joshi@strats360.com", dateOfJoining: "2026-12-01" })).status).toBe(409);
    const h = await nisha.post(`/admin/recruitment/applications/${appId}/hire`, { employeeCode: "STL-9001", workEmail: "riya.joshi@strats360.com", dateOfJoining: "2026-12-01", sendOnboardingInvite: true });
    expect(h.status).toBe(201);
    expect(h.body.jobClosed).toBe(true);
    hiredId = h.body.employeeId;
    const [e] = await sql`select full_name, status, annual_ctc, manager_id, personal_email, date_of_joining::text as doj from employees where id = ${hiredId}`;
    expect(e).toMatchObject({ full_name: "Riya Joshi", status: "onboarding", manager_id: hardikId, personal_email: "riya.joshi@example.com", doj: "2026-12-01" });
    expect(Number(e!.annual_ctc)).toBe(540000);
    expect((await sql`select type from employee_documents where employee_id = ${hiredId}`).map((d) => d.type)).toEqual(["resume"]);
    expect(lastEmailTo("riya.joshi@example.com")!.subject).toMatch(/complete your joining details/);
    const [j] = await sql`select status, published from job_openings where id = ${jobId}`;
    expect(j).toMatchObject({ status: "closed", published: false });
    expect((await new Client().get("/public/careers/strats360")).body.jobs.some((x: any) => x.id === jobId)).toBe(false);
    expect((await nisha.del(`/admin/recruitment/candidates/${candId}`)).body.error.message).toMatch(/hired/);
  });
});
