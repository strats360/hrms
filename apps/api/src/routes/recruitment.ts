import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { applicationEvents, applications, branches, candidates, departments, designations, employees, interviewPanel, interviews, jobOpenings, tenants } from "@hrms/db";
import {
  addCandidateSchema,
  applySchema,
  can,
  canMove,
  candidateSchema,
  careersSettingsSchema,
  CLOSED_STAGES,
  EMPLOYMENT_TYPE_LABELS,
  feedbackSchema,
  fmtDate,
  hireSchema,
  inr,
  INTERVIEW_MODE_LABEL,
  interviewSchema,
  jobSchema,
  moveSchema,
  offerSchema,
  RECOMMENDATION_LABEL,
  STAGE_LABEL,
  type Recommendation,
  type Stage,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { deleteFile, getFile, putFile, safeName } from "../lib/storage";
import { nextEmployeeCode, sendOnboardingInvite } from "../services/employees";
import { allowedRecipients } from "../services/notifications";
import { featuresFor } from "../services/flags";
import { careersSettings, logEvent, MAX_RESUME_BYTES, nextJobCode, pipelineCounts, resumeType, tenantBySlug, upsertCandidate, type Application, type Job } from "../services/recruitment";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId ?? null;
/** Recruiters work on every job; everyone else with view sees the jobs they're hiring for. */
const recruiter = (c: Context<AppEnv>) => can(c.get("tenant").permissions, "recruitment", "edit");
export const whenIST = (d: Date | string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

async function loadJob(c: Context<AppEnv>, id: string) {
  const [j] = await c.get("db").select().from(jobOpenings).where(and(eq(jobOpenings.id, id), eq(jobOpenings.tenantId, tid(c))));
  if (!j || (!recruiter(c) && j.hiringManagerId !== me(c))) throw notFound("Job");
  return j;
}
async function loadApp(c: Context<AppEnv>, id: string) {
  const [a] = await c.get("db").select().from(applications).where(and(eq(applications.id, id), eq(applications.tenantId, tid(c))));
  if (!a) throw notFound("Application");
  const job = await loadJob(c, a.jobId);
  return { a, job };
}
const editOnly = (c: Context<AppEnv>, job: Job) => {
  if (!recruiter(c) && job.hiringManagerId !== me(c)) throw forbidden("Only recruiters or the hiring manager can do this");
};

async function mail(c: Context<AppEnv>, to: string, subject: string, heading: string, paragraphs: string[], cta?: { label: string; url: string }) {
  try {
    const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading, paragraphs, cta });
    await c.get("mailer").send({ to, subject, html, text });
  } catch (e) {
    console.error("recruitment email failed", e);
  }
}

function jobOut(j: Job, counts?: Record<string, number>) {
  const active = Object.entries(counts ?? {}).filter(([k]) => !CLOSED_STAGES.includes(k as Stage)).reduce((a, [, n]) => a + n, 0);
  return { ...j, counts: counts ?? {}, active, hired: counts?.hired ?? 0 };
}

async function readResume(c: Context<AppEnv>, form: FormData) {
  const file = form.get("resume");
  if (!(file instanceof File) || !file.size) return null;
  if (file.size > MAX_RESUME_BYTES) throw badRequest("Resumes must be 5 MB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = resumeType(bytes);
  if (!type) throw badRequest("Upload the resume as a PDF or Word file");
  return { bytes, type, name: safeName(file.name || "resume") };
}
async function storeResume(c: Context<AppEnv>, tenantId: string, candidateId: string, r: { bytes: Uint8Array; type: string; name: string }, oldKey: string | null) {
  const key = `tenants/${tenantId}/candidates/${candidateId}/resume-${crypto.randomUUID()}`;
  await putFile(c.env, key, r.bytes.buffer as ArrayBuffer, r.type);
  await c.get("db").update(candidates).set({ resumeKey: key, resumeName: r.name, resumeType: r.type, resumeSize: r.bytes.length, updatedAt: new Date() }).where(eq(candidates.id, candidateId));
  if (oldKey) await deleteFile(c.env, oldKey).catch(() => {});
}
const fileResponse = async (c: Context<AppEnv>, key: string | null, name: string | null, type: string | null) => {
  if (!key) throw notFound("Resume");
  const f = await getFile(c.env, key);
  if (!f) throw notFound("Resume");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": type ?? f.type, "Content-Disposition": `inline; filename="${name ?? "resume"}"`, "Cache-Control": "private, no-store" });
};

/* ======================= admin ======================= */

export const recruitmentRoutes = new Hono<AppEnv>();
recruitmentRoutes.use("*", requirePerm("recruitment", "view"));

recruitmentRoutes.get("/jobs", async (c) => {
  const db = c.get("db");
  const status = c.req.query("status");
  const rows = await db
    .select({ j: jobOpenings, dept: departments.name, branch: branches.name, manager: employees.fullName })
    .from(jobOpenings)
    .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
    .leftJoin(branches, eq(branches.id, jobOpenings.branchId))
    .leftJoin(employees, eq(employees.id, jobOpenings.hiringManagerId))
    .where(and(eq(jobOpenings.tenantId, tid(c)), status ? eq(jobOpenings.status, status) : undefined, recruiter(c) ? undefined : eq(jobOpenings.hiringManagerId, me(c) ?? "")))
    .orderBy(sql`case ${jobOpenings.status} when 'open' then 0 when 'on_hold' then 1 when 'draft' then 2 else 3 end`, desc(jobOpenings.createdAt));
  const counts = await pipelineCounts(db, rows.map((r) => r.j.id));
  const settings = await careersSettings(db, tid(c));
  return c.json({ rows: rows.map((r) => ({ ...jobOut(r.j, counts.get(r.j.id)), department: r.dept, branch: r.branch, hiringManager: r.manager })), canEdit: recruiter(c), canConfigure: can(c.get("tenant").permissions, "recruitment", "configure"), careers: settings });
});

recruitmentRoutes.post("/jobs", requirePerm("recruitment", "edit"), v("json", jobSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [j] = await db
    .insert(jobOpenings)
    .values({ ...b, tenantId: tid(c), code: await nextJobCode(db, tid(c)), createdBy: c.get("session")!.userId, openedAt: b.status === "open" ? new Date() : null })
    .returning();
  await audit(c, { action: "recruitment.job_create", entity: "job_opening", entityId: j!.id, summary: `Created ${j!.code} ${j!.title}` });
  return c.json(j, 201);
});

recruitmentRoutes.put("/jobs/:id", requirePerm("recruitment", "edit"), v("json", jobSchema), async (c) => {
  const j = await loadJob(c, c.req.param("id"));
  const b = c.req.valid("json");
  const [out] = await c
    .get("db")
    .update(jobOpenings)
    .set({ ...b, openedAt: j.openedAt ?? (b.status === "open" ? new Date() : null), closedAt: b.status === "closed" ? (j.closedAt ?? new Date()) : null, updatedAt: new Date() })
    .where(eq(jobOpenings.id, j.id))
    .returning();
  await audit(c, { action: "recruitment.job_update", entity: "job_opening", entityId: j.id, summary: `Updated ${j.code} ${b.title}${b.status !== j.status ? `: now ${b.status.replace("_", " ")}` : ""}` });
  return c.json(out);
});

recruitmentRoutes.get("/jobs/:id", async (c) => {
  const j = await loadJob(c, c.req.param("id"));
  const db = c.get("db");
  const rows = await db
    .select({ a: applications, cand: candidates })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(applications.jobId, j.id))
    .orderBy(desc(applications.stageChangedAt));
  // interview feedback summary per application
  const ids = rows.map((r) => r.a.id);
  const fb = ids.length
    ? await db
        .select({ applicationId: interviews.applicationId, n: sql<number>`count(${interviewPanel.submittedAt})::int`, avg: sql<number | null>`round(avg(${interviewPanel.rating})::numeric, 1)::float`, next: sql<string | null>`min(case when ${interviews.status} = 'scheduled' and ${interviews.scheduledAt} > now() then ${interviews.scheduledAt} end)` })
        .from(interviews)
        .leftJoin(interviewPanel, eq(interviewPanel.interviewId, interviews.id))
        .where(inArray(interviews.applicationId, ids))
        .groupBy(interviews.applicationId)
    : [];
  const fbMap = new Map(fb.map((f) => [f.applicationId, f]));
  const [meta] = await db
    .select({ dept: departments.name, desig: designations.name, branch: branches.name, manager: employees.fullName })
    .from(jobOpenings)
    .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
    .leftJoin(designations, eq(designations.id, jobOpenings.designationId))
    .leftJoin(branches, eq(branches.id, jobOpenings.branchId))
    .leftJoin(employees, eq(employees.id, jobOpenings.hiringManagerId))
    .where(eq(jobOpenings.id, j.id));
  const counts = await pipelineCounts(db, [j.id]);
  return c.json({
    job: { ...jobOut(j, counts.get(j.id)), department: meta?.dept ?? null, designation: meta?.desig ?? null, branch: meta?.branch ?? null, hiringManager: meta?.manager ?? null },
    canEdit: recruiter(c) || j.hiringManagerId === me(c),
    applications: rows.map(({ a, cand }) => ({
      id: a.id,
      stage: a.stage,
      stageChangedAt: a.stageChangedAt,
      createdAt: a.createdAt,
      rejectReason: a.rejectReason,
      offeredCtc: a.offeredCtc,
      joiningDate: a.joiningDate,
      candidate: { id: cand.id, name: cand.name, email: cand.email, phone: cand.phone, currentCompany: cand.currentCompany, currentTitle: cand.currentTitle, experienceYears: cand.experienceYears, expectedCtc: cand.expectedCtc, noticeDays: cand.noticeDays, source: cand.source, hasResume: !!cand.resumeKey },
      feedback: fbMap.get(a.id) ? { submitted: fbMap.get(a.id)!.n, avgRating: fbMap.get(a.id)!.avg, nextInterview: fbMap.get(a.id)!.next } : null,
    })),
  });
});

/** Add a candidate to a job (or an existing candidate to another job). Multipart when a resume comes with it. */
recruitmentRoutes.post("/candidates", requirePerm("recruitment", "edit"), async (c) => {
  const isForm = (c.req.header("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await c.req.formData() : null;
  const raw = form ? JSON.parse(String(form.get("data") ?? "{}")) : await c.req.json();
  const parsed = addCandidateSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the details");
  const { jobId, notes, ...b } = parsed.data;
  const job = await loadJob(c, jobId);
  if (job.status === "closed") throw badRequest("This job is closed");
  const resume = form ? await readResume(c, form) : null;
  const db = c.get("db");
  const { candidate, created } = await upsertCandidate(db, tid(c), { ...b, notes: notes || null });
  const [dup] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.jobId, job.id), eq(applications.candidateId, candidate.id)));
  if (dup) throw conflict(`${candidate.name} is already in this job's pipeline`);
  if (resume) await storeResume(c, tid(c), candidate.id, resume, candidate.resumeKey);
  const [a] = await db.insert(applications).values({ tenantId: tid(c), jobId: job.id, candidateId: candidate.id }).returning();
  await logEvent(db, tid(c), a!.id, { kind: "created", toStage: "applied", note: `Added by ${c.get("session")!.name}`, byName: c.get("session")!.name });
  await audit(c, { action: "recruitment.candidate_add", entity: "application", entityId: a!.id, summary: `Added ${candidate.name} to ${job.code} ${job.title}` });
  return c.json({ applicationId: a!.id, candidateId: candidate.id, existing: !created }, 201);
});

/** The talent pool: search everyone who's applied. */
recruitmentRoutes.get("/candidates", requirePerm("recruitment", "edit"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const db = c.get("db");
  const like = `%${q}%`;
  const rows = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.tenantId, tid(c)), q ? or(ilike(candidates.name, like), ilike(candidates.email, like), ilike(candidates.phone, like), ilike(candidates.currentCompany, like), ilike(candidates.currentTitle, like)) : undefined))
    .orderBy(desc(candidates.updatedAt))
    .limit(200);
  const apps = rows.length
    ? await db.select({ candidateId: applications.candidateId, stage: applications.stage, job: jobOpenings.title, jobId: jobOpenings.id, id: applications.id }).from(applications).innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobId)).where(inArray(applications.candidateId, rows.map((r) => r.id)))
    : [];
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, currentCompany: r.currentCompany, currentTitle: r.currentTitle, experienceYears: r.experienceYears, source: r.source, createdAt: r.createdAt, employeeId: r.employeeId, applications: apps.filter((a) => a.candidateId === r.id) })));
});

async function candidateVisible(c: Context<AppEnv>, candidateId: string) {
  const [cand] = await c.get("db").select().from(candidates).where(and(eq(candidates.id, candidateId), eq(candidates.tenantId, tid(c))));
  if (!cand) throw notFound("Candidate");
  if (recruiter(c)) return cand;
  const [mine] = await c.get("db").select({ id: applications.id }).from(applications).innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobId)).where(and(eq(applications.candidateId, cand.id), eq(jobOpenings.hiringManagerId, me(c) ?? "")));
  if (!mine) throw notFound("Candidate");
  return cand;
}

recruitmentRoutes.get("/candidates/:id", async (c) => {
  const cand = await candidateVisible(c, c.req.param("id"));
  const db = c.get("db");
  const apps = await db
    .select({ a: applications, job: jobOpenings })
    .from(applications)
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobId))
    .where(and(eq(applications.candidateId, cand.id), recruiter(c) ? undefined : eq(jobOpenings.hiringManagerId, me(c) ?? "")))
    .orderBy(desc(applications.createdAt));
  const appIds = apps.map((x) => x.a.id);
  const events = appIds.length ? await db.select().from(applicationEvents).where(inArray(applicationEvents.applicationId, appIds)).orderBy(desc(applicationEvents.createdAt)) : [];
  const ivs = appIds.length ? await db.select().from(interviews).where(inArray(interviews.applicationId, appIds)).orderBy(asc(interviews.scheduledAt)) : [];
  const panel = ivs.length
    ? await db.select({ p: interviewPanel, name: employees.fullName }).from(interviewPanel).innerJoin(employees, eq(employees.id, interviewPanel.employeeId)).where(inArray(interviewPanel.interviewId, ivs.map((i) => i.id)))
    : [];
  const [ref] = cand.referredById ? await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, cand.referredById)) : [];
  const { resumeKey, ...rest } = cand;
  return c.json({
    candidate: { ...rest, hasResume: !!resumeKey, referredBy: ref?.name ?? null },
    canEdit: recruiter(c),
    applications: apps.map(({ a, job }) => ({
      ...a,
      job: { id: job.id, code: job.code, title: job.title, status: job.status, hiringManagerId: job.hiringManagerId },
      canEdit: recruiter(c) || job.hiringManagerId === me(c),
      events: events.filter((e) => e.applicationId === a.id),
      interviews: ivs.filter((i) => i.applicationId === a.id).map((i) => ({ ...i, panel: panel.filter((p) => p.p.interviewId === i.id).map((p) => ({ employeeId: p.p.employeeId, name: p.name, rating: p.p.rating, recommendation: p.p.recommendation, notes: p.p.notes, submittedAt: p.p.submittedAt })) })),
    })),
  });
});

recruitmentRoutes.put("/candidates/:id", requirePerm("recruitment", "edit"), v("json", candidateSchema), async (c) => {
  const cand = await candidateVisible(c, c.req.param("id"));
  const b = c.req.valid("json");
  if (b.email !== cand.email) {
    const [other] = await c.get("db").select({ id: candidates.id }).from(candidates).where(and(eq(candidates.tenantId, tid(c)), eq(candidates.email, b.email)));
    if (other) throw conflict("Another candidate already has this email");
  }
  await c.get("db").update(candidates).set({ ...b, notes: b.notes || null, updatedAt: new Date() }).where(eq(candidates.id, cand.id));
  await audit(c, { action: "recruitment.candidate_update", entity: "candidate", entityId: cand.id, summary: `Updated candidate ${b.name}` });
  return c.json({ ok: true });
});

recruitmentRoutes.post("/candidates/:id/resume", requirePerm("recruitment", "edit"), async (c) => {
  const cand = await candidateVisible(c, c.req.param("id"));
  const r = await readResume(c, await c.req.formData());
  if (!r) throw badRequest("Attach a resume");
  await storeResume(c, tid(c), cand.id, r, cand.resumeKey);
  return c.json({ ok: true });
});

recruitmentRoutes.get("/candidates/:id/resume", async (c) => {
  const cand = await candidateVisible(c, c.req.param("id"));
  return fileResponse(c, cand.resumeKey, cand.resumeName, cand.resumeType);
});

/** Remove a candidate and their resume for good (they asked, or they're no longer needed). */
recruitmentRoutes.delete("/candidates/:id", requirePerm("recruitment", "configure"), async (c) => {
  const cand = await candidateVisible(c, c.req.param("id"));
  if (cand.employeeId) throw badRequest("They were hired. Their record is now the employee profile.");
  if (cand.resumeKey) await deleteFile(c.env, cand.resumeKey).catch(() => {});
  await c.get("db").delete(candidates).where(eq(candidates.id, cand.id));
  await audit(c, { action: "recruitment.candidate_delete", entity: "candidate", entityId: cand.id, summary: `Deleted candidate ${cand.name} and their resume` });
  return c.json({ ok: true });
});

async function setStage(c: Context<AppEnv>, a: Application, to: Stage, note: string, extra: Partial<Application> = {}) {
  const db = c.get("db");
  await db.update(applications).set({ stage: to, stageChangedAt: new Date(), updatedAt: new Date(), ...extra }).where(eq(applications.id, a.id));
  await logEvent(db, tid(c), a.id, { kind: "moved", fromStage: a.stage, toStage: to, note: note || null, byName: c.get("session")!.name });
}

recruitmentRoutes.post("/applications/:id/move", v("json", moveSchema), async (c) => {
  const { a, job } = await loadApp(c, c.req.param("id"));
  editOnly(c, job);
  const b = c.req.valid("json");
  if (b.stage === "hired") throw badRequest("Use Hire to move someone to hired; it creates their employee record");
  if (b.stage === "offer") throw badRequest("Use Make offer, so the offer details are recorded");
  if (!canMove(a.stage as Stage, b.stage)) throw badRequest(`Can't move from ${STAGE_LABEL[a.stage as Stage]} to ${STAGE_LABEL[b.stage]}`);
  if (b.stage === "rejected" && !b.reason) throw badRequest("Pick a reason for not going ahead");
  await setStage(c, a, b.stage, [b.reason, b.note].filter(Boolean).join(": "), { rejectReason: b.stage === "rejected" ? b.reason : null });
  const [cand] = await c.get("db").select().from(candidates).where(eq(candidates.id, a.candidateId));
  await audit(c, { action: "recruitment.move", entity: "application", entityId: a.id, summary: `${cand?.name}: ${STAGE_LABEL[a.stage as Stage]} to ${STAGE_LABEL[b.stage]} for ${job.code}` });
  return c.json({ ok: true });
});

recruitmentRoutes.post("/applications/:id/notes", v("json", z.object({ note: z.string().trim().min(1).max(4000) })), async (c) => {
  const { a } = await loadApp(c, c.req.param("id"));
  await logEvent(c.get("db"), tid(c), a.id, { kind: "note", note: c.req.valid("json").note, byName: c.get("session")!.name });
  return c.json({ ok: true }, 201);
});

recruitmentRoutes.post("/applications/:id/interviews", v("json", interviewSchema), async (c) => {
  const { a, job } = await loadApp(c, c.req.param("id"));
  editOnly(c, job);
  if (CLOSED_STAGES.includes(a.stage as Stage)) throw badRequest("This application is closed");
  const b = c.req.valid("json");
  const db = c.get("db");
  const panel = await db.select({ id: employees.id, name: employees.fullName, email: employees.workEmail, first: employees.firstName }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, b.interviewerIds)));
  if (panel.length !== new Set(b.interviewerIds).size) throw badRequest("Pick interviewers from your employees");
  const [iv] = await db.insert(interviews).values({ tenantId: tid(c), applicationId: a.id, round: b.round, scheduledAt: new Date(b.scheduledAt), durationMinutes: b.durationMinutes, mode: b.mode, location: b.location, createdBy: c.get("session")!.userId }).returning();
  await db.insert(interviewPanel).values(panel.map((p) => ({ tenantId: tid(c), interviewId: iv!.id, employeeId: p.id })));
  if (a.stage === "applied" || a.stage === "screening") await setStage(c, a, "interview", `${b.round} scheduled`);
  const [cand] = await db.select().from(candidates).where(eq(candidates.id, a.candidateId));
  await logEvent(db, tid(c), a.id, { kind: "interview", note: `${b.round} on ${whenIST(b.scheduledAt)} with ${panel.map((p) => p.name).join(", ")}`, byName: c.get("session")!.name });
  const when = whenIST(b.scheduledAt);
  const where = `${INTERVIEW_MODE_LABEL[b.mode]}${b.location ? `: ${b.location}` : ""}`;
  const ok = await allowedRecipients(db, tid(c), "interview_invites", panel.map((p) => p.email));
  for (const p of panel.filter((p) => ok.has(p.email)))
    await mail(c, p.email, `Interview: ${cand!.name} for ${job.title}, ${when}`, `You're interviewing ${cand!.name}`, [`Hi ${p.first},`, `You're on the panel for the ${b.round} round with ${cand!.name} for ${job.title}.`, `When: ${when} (${b.durationMinutes} minutes). ${where}.`, "Please add your feedback in the app after the interview."], { label: "Open the interview", url: `${c.env.APP_URL}/me/interviews` });
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  await mail(c, cand!.email, `Interview with ${t?.name}: ${job.title}`, `Your interview for ${job.title}`, [`Hi ${cand!.name.split(" ")[0]},`, `Thanks for your interest in the ${job.title} role. We'd like to invite you to the ${b.round} round.`, `When: ${when} IST, about ${b.durationMinutes} minutes.`, `${where}.`, "Reply to this email if you need a different time."]);
  await audit(c, { action: "recruitment.interview", entity: "application", entityId: a.id, summary: `Scheduled ${b.round} for ${cand!.name} on ${when}` });
  return c.json(iv, 201);
});

recruitmentRoutes.patch("/interviews/:id", v("json", z.object({ status: z.enum(["scheduled", "done", "cancelled"]) })), async (c) => {
  const db = c.get("db");
  const [iv] = await db.select().from(interviews).where(and(eq(interviews.id, c.req.param("id")), eq(interviews.tenantId, tid(c))));
  if (!iv) throw notFound("Interview");
  const { job } = await loadApp(c, iv.applicationId);
  editOnly(c, job);
  const { status } = c.req.valid("json");
  await db.update(interviews).set({ status, updatedAt: new Date() }).where(eq(interviews.id, iv.id));
  await logEvent(db, tid(c), iv.applicationId, { kind: "interview", note: `${iv.round} ${status === "cancelled" ? "cancelled" : status === "done" ? "marked done" : "rescheduled"}`, byName: c.get("session")!.name });
  return c.json({ ok: true });
});

recruitmentRoutes.post("/applications/:id/offer", v("json", offerSchema), async (c) => {
  const { a, job } = await loadApp(c, c.req.param("id"));
  editOnly(c, job);
  if (CLOSED_STAGES.includes(a.stage as Stage)) throw badRequest("This application is closed");
  const b = c.req.valid("json");
  await setStage(c, a, "offer", `Offer: ${inr(b.offeredCtc)} a year, joining ${fmtDate(b.joiningDate)}${b.note ? `. ${b.note}` : ""}`, { offeredCtc: b.offeredCtc, joiningDate: b.joiningDate, offerDesignationId: b.designationId ?? job.designationId });
  const [cand] = await c.get("db").select().from(candidates).where(eq(candidates.id, a.candidateId));
  await audit(c, { action: "recruitment.offer", entity: "application", entityId: a.id, summary: `Offer to ${cand?.name} for ${job.code}: ${inr(b.offeredCtc)} a year, joining ${fmtDate(b.joiningDate)}` });
  return c.json({ ok: true });
});

/** The offer is accepted: create their employee record and send the onboarding invite. */
recruitmentRoutes.post("/applications/:id/hire", requirePerm("employees", "edit"), v("json", hireSchema), async (c) => {
  const { a, job } = await loadApp(c, c.req.param("id"));
  if (!recruiter(c)) throw forbidden("Only recruiters can hire");
  if (a.stage !== "offer") throw badRequest("Make an offer first");
  const b = c.req.valid("json");
  const db = c.get("db");
  const [cand] = await db.select().from(candidates).where(eq(candidates.id, a.candidateId));
  if (cand!.employeeId) throw conflict(`${cand!.name} already has an employee record`);
  const [clash] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid(c)), or(eq(employees.employeeCode, b.employeeCode), eq(employees.workEmail, b.workEmail.toLowerCase()))));
  if (clash) throw conflict("Another employee already has this employee ID or work email");
  const [first, ...rest] = cand!.name.split(/\s+/);
  const [emp] = await db
    .insert(employees)
    .values({
      tenantId: tid(c),
      employeeCode: b.employeeCode,
      firstName: first!,
      lastName: rest.join(" ") || null,
      fullName: cand!.name,
      workEmail: b.workEmail.toLowerCase(),
      personalEmail: cand!.email,
      phone: cand!.phone,
      dateOfJoining: b.dateOfJoining,
      departmentId: job.departmentId,
      designationId: a.offerDesignationId ?? job.designationId,
      branchId: job.branchId,
      managerId: job.hiringManagerId,
      employmentType: job.employmentType,
      workLocation: job.location,
      annualCtc: a.offeredCtc ?? 0,
      status: "onboarding",
    })
    .returning();
  await db.update(candidates).set({ employeeId: emp!.id, updatedAt: new Date() }).where(eq(candidates.id, cand!.id));
  // the resume becomes their first document
  if (cand!.resumeKey) {
    const f = await getFile(c.env, cand!.resumeKey);
    if (f) {
      const { employeeDocuments } = await import("@hrms/db");
      const key = `tenants/${tid(c)}/employees/${emp!.id}/docs/${crypto.randomUUID()}`;
      const body = f.body instanceof ArrayBuffer ? f.body : await new Response(f.body).arrayBuffer();
      await putFile(c.env, key, body, cand!.resumeType ?? f.type);
      await db.insert(employeeDocuments).values({ tenantId: tid(c), employeeId: emp!.id, type: "resume", name: cand!.resumeName ?? "Resume", fileKey: key, mimeType: cand!.resumeType, sizeBytes: cand!.resumeSize, status: "verified", uploadedBy: c.get("session")!.userId });
    }
  }
  await setStage(c, a, "hired", `Joining ${fmtDate(b.dateOfJoining)} as ${b.employeeCode}`, { joiningDate: b.dateOfJoining });
  if (b.sendOnboardingInvite) await sendOnboardingInvite(c, emp!.id, cand!.email);
  // every opening filled: close the job
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.jobId, job.id), eq(applications.stage, "hired")))) as [{ n: number }];
  const filled = n >= job.openings;
  if (filled) await db.update(jobOpenings).set({ status: "closed", closedAt: new Date(), published: false, updatedAt: new Date() }).where(eq(jobOpenings.id, job.id));
  await audit(c, { action: "recruitment.hire", entity: "employee", entityId: emp!.id, summary: `Hired ${cand!.name} for ${job.code} ${job.title}, joining ${fmtDate(b.dateOfJoining)}${filled ? ". All openings filled; job closed" : ""}` });
  return c.json({ employeeId: emp!.id, jobClosed: filled, invited: b.sendOnboardingInvite }, 201);
});

recruitmentRoutes.get("/next-employee-code", requirePerm("employees", "edit"), async (c) => c.json({ code: await nextEmployeeCode(c.get("db"), tid(c)) }));

recruitmentRoutes.put("/settings", requirePerm("recruitment", "configure"), v("json", careersSettingsSchema), async (c) => {
  const b = c.req.valid("json");
  if (b.slug) {
    const t = await tenantBySlug(c.get("db"), b.slug);
    if (t && t.id !== tid(c)) throw conflict("Another company already uses this careers page address");
  }
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ careers: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "settings.careers", entity: "tenant", entityId: tid(c), summary: b.slug ? `Careers page at /careers/${b.slug}` : "Careers page turned off" });
  return c.json(b);
});

/* ======================= interviewers (any employee) ======================= */

export const myInterviewRoutes = new Hono<AppEnv>();
myInterviewRoutes.use("*", requireEmployee);

async function myPanelSeat(c: Context<AppEnv>, interviewId: string) {
  const db = c.get("db");
  const [row] = await db
    .select({ iv: interviews, seat: interviewPanel, a: applications, cand: candidates, job: jobOpenings })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobId))
    .where(and(eq(interviewPanel.interviewId, interviewId), eq(interviewPanel.employeeId, me(c)!), eq(interviewPanel.tenantId, tid(c))));
  if (!row) throw notFound("Interview");
  return row;
}

myInterviewRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ iv: interviews, seat: interviewPanel, cand: candidates.name, job: jobOpenings.title })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobId))
    .where(and(eq(interviewPanel.employeeId, me(c)!), eq(interviewPanel.tenantId, tid(c)), gte(interviews.scheduledAt, new Date(Date.now() - 90 * 86_400_000))))
    .orderBy(desc(interviews.scheduledAt));
  return c.json(rows.map((r) => ({ id: r.iv.id, round: r.iv.round, scheduledAt: r.iv.scheduledAt, durationMinutes: r.iv.durationMinutes, mode: r.iv.mode, location: r.iv.location, status: r.iv.status, candidate: r.cand, job: r.job, feedbackDone: !!r.seat.submittedAt })));
});

myInterviewRoutes.get("/:id", async (c) => {
  const r = await myPanelSeat(c, c.req.param("id"));
  return c.json({
    id: r.iv.id,
    round: r.iv.round,
    scheduledAt: r.iv.scheduledAt,
    durationMinutes: r.iv.durationMinutes,
    mode: r.iv.mode,
    location: r.iv.location,
    status: r.iv.status,
    job: { title: r.job.title, code: r.job.code, description: r.job.description },
    candidate: { name: r.cand.name, currentCompany: r.cand.currentCompany, currentTitle: r.cand.currentTitle, experienceYears: r.cand.experienceYears, noticeDays: r.cand.noticeDays, hasResume: !!r.cand.resumeKey },
    // only your own feedback, so earlier opinions don't sway you
    feedback: { rating: r.seat.rating, recommendation: r.seat.recommendation, notes: r.seat.notes, submittedAt: r.seat.submittedAt },
  });
});

myInterviewRoutes.get("/:id/resume", async (c) => {
  const r = await myPanelSeat(c, c.req.param("id"));
  return fileResponse(c, r.cand.resumeKey, r.cand.resumeName, r.cand.resumeType);
});

myInterviewRoutes.post("/:id/feedback", v("json", feedbackSchema), async (c) => {
  const r = await myPanelSeat(c, c.req.param("id"));
  if (r.iv.status === "cancelled") throw badRequest("This interview was cancelled");
  if (new Date(r.iv.scheduledAt).getTime() > Date.now() + 15 * 60_000) throw badRequest("Add feedback after the interview");
  const b = c.req.valid("json");
  const db = c.get("db");
  await db.update(interviewPanel).set({ ...b, submittedAt: new Date(), updatedAt: new Date() }).where(eq(interviewPanel.id, r.seat.id));
  // everyone on the panel has given feedback: the interview is done
  const [{ open }] = (await db.select({ open: sql<number>`count(*) filter (where ${interviewPanel.submittedAt} is null)::int` }).from(interviewPanel).where(eq(interviewPanel.interviewId, r.iv.id))) as [{ open: number }];
  if (!open && r.iv.status === "scheduled") await db.update(interviews).set({ status: "done", updatedAt: new Date() }).where(eq(interviews.id, r.iv.id));
  await logEvent(db, tid(c), r.a.id, { kind: "feedback", note: `${r.iv.round}: ${b.rating}/5, ${RECOMMENDATION_LABEL[b.recommendation as Recommendation]}`, byName: c.get("session")!.name });
  await audit(c, { action: "recruitment.feedback", entity: "application", entityId: r.a.id, summary: `Feedback on ${r.cand.name}, ${r.iv.round}: ${b.rating}/5 ${RECOMMENDATION_LABEL[b.recommendation as Recommendation]}` });
  return c.json({ ok: true });
});

/* ======================= public careers page ======================= */

export const careersRoutes = new Hono<AppEnv>();

async function careersTenant(c: Context<AppEnv>) {
  const t = await tenantBySlug(c.get("db"), c.req.param("slug") ?? "");
  if (!t || t.status === "suspended" || t.status === "cancelled") throw notFound("Careers page");
  if ((await featuresFor(c.get("db"), { id: t.id, plan: t.plan }))["module.recruitment"] === false) throw notFound("Careers page");
  return t;
}
const publicJob = (j: Job, dept: string | null, branch: string | null) => ({
  id: j.id,
  code: j.code,
  title: j.title,
  department: dept,
  location: j.location ?? branch,
  employmentType: EMPLOYMENT_TYPE_LABELS[j.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? j.employmentType,
  openings: j.openings,
  experience: j.minExperience != null || j.maxExperience != null ? `${j.minExperience ?? 0}${j.maxExperience != null ? ` to ${j.maxExperience}` : "+"} years` : null,
  description: j.description,
  postedAt: j.openedAt ?? j.createdAt,
});
async function openJobs(c: Context<AppEnv>, tenantId: string, id?: string) {
  return c
    .get("db")
    .select({ j: jobOpenings, dept: departments.name, branch: branches.name })
    .from(jobOpenings)
    .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
    .leftJoin(branches, eq(branches.id, jobOpenings.branchId))
    .where(and(eq(jobOpenings.tenantId, tenantId), eq(jobOpenings.status, "open"), eq(jobOpenings.published, true), id ? eq(jobOpenings.id, id) : undefined))
    .orderBy(desc(jobOpenings.openedAt));
}

careersRoutes.get("/:slug", async (c) => {
  const t = await careersTenant(c);
  const s = await careersSettings(c.get("db"), t.id);
  const jobs = await openJobs(c, t.id);
  return c.json({ company: { name: t.name, logoUrl: null }, intro: s.intro, jobs: jobs.map((r) => ({ ...publicJob(r.j, r.dept, r.branch), description: undefined })) });
});

careersRoutes.get("/:slug/jobs/:id", async (c) => {
  const t = await careersTenant(c);
  const [r] = await openJobs(c, t.id, c.req.param("id"));
  if (!r) throw notFound("Job");
  return c.json({ company: { name: t.name }, job: publicJob(r.j, r.dept, r.branch) });
});

careersRoutes.post("/:slug/jobs/:id/apply", async (c) => {
  const t = await careersTenant(c);
  const [r] = await openJobs(c, t.id, c.req.param("id"));
  if (!r) throw notFound("Job");
  const form = await c.req.formData();
  const parsed = applySchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the form");
  const b = parsed.data;
  const resume = await readResume(c, form);
  if (!resume) throw badRequest("Attach your resume");
  const db = c.get("db");
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  // slow down floods: a handful of applications per address per hour
  if (ip) {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.tenantId, t.id), eq(applications.ip, ip), gte(applications.createdAt, new Date(Date.now() - 3_600_000))))) as [{ n: number }];
    if (n >= 5) throw badRequest("Too many applications from your network. Please try again in an hour.");
  }
  const { candidate } = await upsertCandidate(db, t.id, { name: b.name, email: b.email, phone: b.phone, currentCompany: b.currentCompany || null, experienceYears: b.experienceYears ?? null, noticeDays: b.noticeDays ?? null, source: "careers_page" });
  const [dup] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.jobId, r.j.id), eq(applications.candidateId, candidate.id)));
  // applying twice is fine: same answer, nothing new to see
  if (!dup) {
    await storeResume(c, t.id, candidate.id, resume, candidate.resumeKey);
    const [a] = await db.insert(applications).values({ tenantId: t.id, jobId: r.j.id, candidateId: candidate.id, ip }).returning();
    await logEvent(db, t.id, a!.id, { kind: "created", toStage: "applied", note: b.note ? `Applied on the careers page: ${b.note}` : "Applied on the careers page", byName: b.name });
    try {
      const { html, text } = layout({ company: t.name, heading: `Thanks for applying, ${b.name.split(" ")[0]}`, paragraphs: [`We've received your application for ${r.j.title} at ${t.name}.`, "Our team reviews every application. If your profile is a good fit, we'll be in touch about next steps.", "We keep your details only to consider you for roles with us. Reply to this email if you'd like them removed."] });
      await c.get("mailer").send({ to: b.email, subject: `Your application for ${r.j.title}`, html, text });
      if (r.j.hiringManagerId) {
        const [m] = await db.select({ email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, r.j.hiringManagerId));
        if (m && (await allowedRecipients(db, t.id, "interview_invites", [m.email])).has(m.email)) {
          const x = layout({ company: t.name, heading: `New applicant for ${r.j.title}`, paragraphs: [`Hi ${m.first},`, `${b.name} applied for ${r.j.title} on the careers page.`], cta: { label: "See the pipeline", url: `${c.env.APP_URL}/recruitment/jobs/${r.j.id}` } });
          await c.get("mailer").send({ to: m.email, subject: `New applicant: ${b.name} for ${r.j.title}`, html: x.html, text: x.text });
        }
      }
    } catch (e) {
      console.error("application email failed", e);
    }
  }
  return c.json({ ok: true }, 201);
});
