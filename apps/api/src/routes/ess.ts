import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  attendanceCorrections,
  attendanceRecords,
  branches,
  departments,
  designations,
  employeeDocuments,
  employees,
  holidays,
  leaveRequests,
  leaveTypes,
  onboardingInvites,
  payrollItems,
  payrollRuns,
  tenants,
} from "@hrms/db";
import {
  checkPunch,
  DEFAULT_PUNCH_POLICY,
  type PunchPolicy,
  aadhaarLast4Schema,
  accountNumberSchema,
  correctionCreateSchema,
  daysInMonth,
  employeePersonalSchema,
  essProfileUpdateSchema,
  evaluateAttendance,
  ifscSchema,
  isoDate,
  leaveApplySchema,
  nullable,
  onboardingSaveSchema,
  panSchema,
  phoneSchema,
  punchSchema,
  todayIST,
  toISTTime,
  uanSchema,
  TAX_REGIMES,
  GENDERS,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee } from "../lib/context";
import { v } from "../lib/validate";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { buildCalendar, shiftFor, upsertAttendance } from "../services/attendance";
import { approvalPolicy, chainFor, waitingOn } from "../services/approvals";
import { applyLeave, balanceSummary, cancelLeave } from "../services/leave";
import { bankFields } from "../services/employees";
import { storeUpload } from "./employees";
import { payslipView } from "./payroll";
import { notifyNextApprover } from "./leave";
import { essSalaryVisible, mySalary } from "../services/my-salary";
import { essPhotoAllowed } from "./photos";

export const essRoutes = new Hono<AppEnv>();
essRoutes.use("*", requireEmployee);
const mgr = alias(employees, "mgr");

const me = (c: Context<AppEnv>) => ({ tid: c.get("tenant").tenantId, eid: c.get("tenant").employeeId! });

async function loadMe(c: Context<AppEnv>) {
  const { tid, eid } = me(c);
  const [row] = await c
    .get("db")
    .select({ e: employees, department: departments.name, designation: designations.name, branch: branches.name, manager: mgr.fullName, company: tenants.name })
    .from(employees)
    .innerJoin(tenants, eq(tenants.id, employees.tenantId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .where(and(eq(employees.id, eid), eq(employees.tenantId, tid)));
  if (!row) throw notFound("Employee");
  const { accountNumberEnc: _enc, ...e } = row.e;
  return { ...e, department: row.department, designation: row.designation, branch: row.branch, manager: row.manager, company: row.company };
}

// ---------- home ----------
essRoutes.get("/home", async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const today = todayIST();
  const profile = await loadMe(c);
  const [rec] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.tenantId, tid), eq(attendanceRecords.employeeId, eid), eq(attendanceRecords.date, today)));
  const shift = await shiftFor(db, tid, eid);
  const balances = await balanceSummary(db, tid, eid, Number(today.slice(0, 4)));
  const upcoming = await db.select().from(holidays).where(and(eq(holidays.tenantId, tid), gte(holidays.date, today))).orderBy(asc(holidays.date)).limit(4);
  const requests = await db
    .select({ r: leaveRequests, type: leaveTypes.name })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.tenantId, tid), eq(leaveRequests.employeeId, eid)))
    .orderBy(desc(leaveRequests.createdAt))
    .limit(5);
  const [inv] = await db.select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.employeeId, eid)));
  return c.json({
    profile: {
      id: profile.id,
      name: profile.fullName,
      firstName: profile.firstName,
      code: profile.employeeCode,
      designation: profile.designation,
      department: profile.department,
      company: profile.company,
      status: profile.status,
    },
    onboarding: inv && inv.status !== "verified" ? { status: inv.status, progress: inv.progress } : null,
    today: {
      date: today,
      shift: { name: shift.name, start: shift.startTime, end: shift.endTime },
      checkIn: rec?.checkIn ? toISTTime(rec.checkIn) : null,
      checkOut: rec?.checkOut ? toISTTime(rec.checkOut) : null,
      status: rec?.status ?? null,
      source: rec?.source ?? null,
    },
    balances,
    holidays: upcoming,
    requests: requests.map((x) => ({ ...x.r, typeName: x.type })),
  });
});

// ---------- attendance ----------
/** Is this punch from an office (location and network), per the company's punch policy? */
async function punchCheck(c: Context<AppEnv>, tid: string, branchId: string | null, body: { source: string; lat?: number; lng?: number; accuracy?: number }) {
  const db = c.get("db");
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tid));
  const policy = { ...DEFAULT_PUNCH_POLICY, ...((t?.s as { punchPolicy?: Partial<PunchPolicy> } | undefined)?.punchPolicy ?? {}) };
  if (policy.location === "off" && policy.ip === "off") return { allowed: true, error: null, flags: [] as string[], distanceM: null };
  const all = await db.select().from(branches).where(eq(branches.tenantId, tid));
  const office = (b: typeof branches.$inferSelect) => ({ name: b.name, lat: b.geoLat, lng: b.geoLng, radiusM: b.geoRadiusM, allowedIps: b.allowedIps ?? [] });
  // no branch set: the head office is their office
  const home = all.find((b) => b.id === branchId) ?? all.find((b) => b.isHeadOffice) ?? null;
  return checkPunch(policy, home ? office(home) : null, all.filter((b) => b !== home).map(office), { lat: body.lat, lng: body.lng, accuracyM: body.accuracy, ip: c.req.header("cf-connecting-ip") ?? null, wfh: body.source === "wfh" });
}

essRoutes.post("/attendance/punch", v("json", punchSchema), async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const body = c.req.valid("json");
  const [emp] = await db.select({ status: employees.status, branchId: employees.branchId }).from(employees).where(eq(employees.id, eid));
  if (emp?.status === "onboarding") throw badRequest("Attendance starts once HR verifies your onboarding");
  const check = await punchCheck(c, tid, emp?.branchId ?? null, body);
  if (!check.allowed) throw new ApiError(403, check.error!, "outside_office");
  const now = new Date();
  const date = todayIST(now);
  const shift = await shiftFor(db, tid, eid);
  const [rec] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.tenantId, tid), eq(attendanceRecords.employeeId, eid), eq(attendanceRecords.date, date)));
  const wfh = body.source === "wfh" || rec?.source === "wfh";
  let checkIn = rec?.checkIn ?? null;
  let checkOut = rec?.checkOut ?? null;
  let action: "in" | "out";
  if (!checkIn) {
    checkIn = now;
    action = "in";
  } else {
    if (now.getTime() - checkIn.getTime() < 60_000) throw badRequest("You just checked in. Try again in a minute.");
    checkOut = now;
    action = "out";
  }
  const ev = evaluateAttendance(shift, checkIn, checkOut, { wfh });
  const row = await upsertAttendance(db, {
    tenantId: tid,
    employeeId: eid,
    date,
    checkIn,
    checkOut,
    source: rec?.source ?? body.source,
    status: ev.status,
    workMinutes: ev.workMinutes,
    lateMinutes: ev.lateMinutes,
    earlyMinutes: ev.earlyMinutes,
    overtimeMinutes: ev.overtimeMinutes,
    lat: body.lat ?? rec?.lat ?? null,
    lng: body.lng ?? rec?.lng ?? null,
    ip: c.req.header("cf-connecting-ip") ?? null,
    note: body.note ?? rec?.note ?? null,
    // keep what the check-in found, and add anything new from the check-out
    flags: [...new Set([...(rec?.flags ?? []), ...check.flags.map((f) => `${action === "in" ? "In" : "Out"}: ${f}`)])],
    distanceM: check.distanceM ?? rec?.distanceM ?? null,
  });
  return c.json({ action, checkIn: toISTTime(row.checkIn), checkOut: toISTTime(row.checkOut), status: row.status, lateMinutes: row.lateMinutes, flags: check.flags });
});

essRoutes.get("/attendance", v("query", z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })), async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const month = c.req.valid("query").month ?? todayIST().slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const [e] = await db.select({ id: employees.id, shiftId: employees.shiftId, branchId: employees.branchId, dateOfJoining: employees.dateOfJoining, lastWorkingDay: employees.lastWorkingDay }).from(employees).where(eq(employees.id, eid));
  const cal = await buildCalendar(db, tid, [e!], from, to);
  const corrections = await db
    .select()
    .from(attendanceCorrections)
    .where(and(eq(attendanceCorrections.tenantId, tid), eq(attendanceCorrections.employeeId, eid), gte(attendanceCorrections.date, from)))
    .orderBy(desc(attendanceCorrections.createdAt));
  return c.json({
    month,
    days: cal.days.map((d) => {
      const r = cal.records.get(`${eid}|${d}`);
      return { date: d, status: cal.status(e!, d), checkIn: r?.checkIn ? toISTTime(r.checkIn) : null, checkOut: r?.checkOut ? toISTTime(r.checkOut) : null, workMinutes: r?.workMinutes ?? 0, source: r?.source ?? null };
    }),
    corrections,
  });
});

essRoutes.post("/attendance/corrections", v("json", correctionCreateSchema), async (c) => {
  const { tid, eid } = me(c);
  const body = c.req.valid("json");
  if (body.date > todayIST()) throw badRequest("You can't correct a future date");
  if (!body.requestedCheckIn && !body.requestedCheckOut && !body.requestedStatus) throw badRequest("Say what should change: a time or a status");
  const db = c.get("db");
  const [dup] = await db
    .select({ id: attendanceCorrections.id })
    .from(attendanceCorrections)
    .where(and(eq(attendanceCorrections.tenantId, tid), eq(attendanceCorrections.employeeId, eid), eq(attendanceCorrections.date, body.date), eq(attendanceCorrections.status, "pending")));
  if (dup) throw badRequest("You already have a pending correction for this date");
  const [row] = await db.insert(attendanceCorrections).values({ ...body, tenantId: tid, employeeId: eid }).returning();
  await audit(c, { action: "attendance_correction.create", entity: "attendance_correction", entityId: row!.id, summary: `Requested correction for ${body.date}` });
  return c.json(row, 201);
});

// ---------- leave ----------
essRoutes.get("/leave", async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const year = Number(c.req.query("year") ?? todayIST().slice(0, 4));
  const balances = await balanceSummary(db, tid, eid, year);
  const requests = await db
    .select({ r: leaveRequests, type: leaveTypes.name, code: leaveTypes.code })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.tenantId, tid), eq(leaveRequests.employeeId, eid)))
    .orderBy(desc(leaveRequests.startDate))
    .limit(100);
  const types = await db.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tid), eq(leaveTypes.active, true))).orderBy(asc(leaveTypes.code));
  const policy = await approvalPolicy(db, tid);
  const out = [];
  for (const x of requests) {
    const waiting = x.r.status === "pending" ? waitingOn(await chainFor(db, tid, "leave", eid, Number(x.r.days), policy), x.r.approvals) : null;
    out.push({ ...x.r, typeName: x.type, typeCode: x.code, waitingOn: waiting ? { label: waiting.label, at: waiting.at, of: waiting.of } : null });
  }
  return c.json({ year, balances, types, requests: out });
});

essRoutes.post("/leave", v("json", leaveApplySchema), async (c) => {
  const { tid, eid } = me(c);
  const body = c.req.valid("json");
  const { request } = await applyLeave(c.get("db"), tid, { ...body, employeeId: eid }, c.get("session")!.userId);
  await audit(c, { action: "leave.apply", entity: "leave_request", entityId: request.id, summary: `Applied for ${request.days} day(s) leave` });
  // tell the first approver (HR steps have no single person to email)
  const chain = await chainFor(c.get("db"), tid, "leave", eid, Number(request.days));
  await notifyNextApprover(c, request, chain[0], true);
  return c.json(request, 201);
});

essRoutes.post("/leave/:id/cancel", async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const [req] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.id, c.req.param("id")), eq(leaveRequests.tenantId, tid), eq(leaveRequests.employeeId, eid)));
  if (!req) throw notFound("Leave request");
  if (req.status === "approved" && req.startDate <= todayIST()) throw badRequest("Leave that has started can only be cancelled by HR");
  await cancelLeave(db, tid, req.id, c.get("session")!.userId);
  await audit(c, { action: "leave.cancel", entity: "leave_request", entityId: req.id, summary: `Cancelled ${req.code}` });
  return c.json({ ok: true });
});

essRoutes.get("/holidays", async (c) => {
  const year = Number(c.req.query("year") ?? todayIST().slice(0, 4));
  const rows = await c
    .get("db")
    .select()
    .from(holidays)
    .where(and(eq(holidays.tenantId, me(c).tid), sql`extract(year from ${holidays.date}) = ${year}`))
    .orderBy(asc(holidays.date));
  return c.json(rows);
});

// ---------- profile & documents ----------
essRoutes.get("/profile", async (c) => {
  const p = await loadMe(c);
  const docs = await c.get("db").select().from(employeeDocuments).where(and(eq(employeeDocuments.tenantId, me(c).tid), eq(employeeDocuments.employeeId, me(c).eid))).orderBy(asc(employeeDocuments.createdAt));
  const [t] = await c.get("db").select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, me(c).tid));
  return c.json({ ...p, documents: docs, canEditPhoto: essPhotoAllowed(t?.settings) });
});

essRoutes.patch("/profile", v("json", essProfileUpdateSchema), async (c) => {
  const body = c.req.valid("json");
  await c.get("db").update(employees).set(body).where(and(eq(employees.id, me(c).eid), eq(employees.tenantId, me(c).tid)));
  await audit(c, { action: "employee.self_update", entity: "employee", entityId: me(c).eid, summary: "Updated own profile", data: { fields: Object.keys(body) } });
  return c.json({ ok: true });
});

essRoutes.post("/documents", async (c) => {
  const doc = await storeUpload(c, me(c).tid, me(c).eid, "pending");
  await audit(c, { action: "document.self_upload", entity: "employee_document", entityId: doc.id, summary: `Uploaded ${doc.name}` });
  await refreshOnboarding(c);
  return c.json(doc, 201);
});

// ---------- self-onboarding wizard ----------
const stepSchemas = {
  personal: employeePersonalSchema
    .pick({ firstName: true, lastName: true, personalEmail: true, phone: true, maritalStatus: true, bloodGroup: true })
    .extend({ dateOfBirth: isoDate, gender: z.enum(GENDERS) }),
  address: z.object({
    currentAddress: z.string().trim().min(10, "Enter your full current address").max(500),
    permanentAddress: z.string().trim().min(10, "Enter your full permanent address").max(500),
    emergencyContactName: z.string().trim().min(2).max(120),
    emergencyContactRelation: z.string().trim().min(2).max(40),
    emergencyContactPhone: phoneSchema,
  }),
  bank: z.object({ accountHolderName: z.string().trim().min(2).max(120), bankName: z.string().trim().min(2).max(120), accountNumber: accountNumberSchema, ifsc: ifscSchema }),
  tax: z.object({ pan: panSchema, aadhaarLast4: aadhaarLast4Schema, uan: nullable(uanSchema), taxRegime: z.enum(TAX_REGIMES) }),
};
const REQUIRED_DOCS = ["pan", "aadhaar", "bank_proof"];
const ALL_STEPS = ["account", "personal", "address", "bank", "tax", "documents"];

async function refreshOnboarding(c: Context<AppEnv>, addStep?: string) {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const [inv] = await db.select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.employeeId, eid)));
  if (!inv || inv.status === "verified" || inv.status === "submitted") return inv ?? null;
  const steps = new Set(inv.completedSteps);
  if (addStep) steps.add(addStep);
  const docs = await db.select({ type: employeeDocuments.type }).from(employeeDocuments).where(and(eq(employeeDocuments.tenantId, tid), eq(employeeDocuments.employeeId, eid)));
  const types = new Set(docs.map((d) => d.type));
  if (REQUIRED_DOCS.every((t) => types.has(t))) steps.add("documents");
  else steps.delete("documents");
  const progress = Math.round((ALL_STEPS.filter((s) => steps.has(s)).length / ALL_STEPS.length) * 95);
  const [row] = await db.update(onboardingInvites).set({ completedSteps: [...steps], progress, status: "in_progress" }).where(eq(onboardingInvites.id, inv.id)).returning();
  return row!;
}

essRoutes.get("/onboarding", async (c) => {
  const { tid, eid } = me(c);
  const [inv] = await c.get("db").select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.employeeId, eid)));
  if (!inv) throw notFound("Onboarding");
  const p = await loadMe(c);
  const docs = await c.get("db").select().from(employeeDocuments).where(and(eq(employeeDocuments.tenantId, tid), eq(employeeDocuments.employeeId, eid)));
  return c.json({ status: inv.status, progress: inv.progress, completedSteps: inv.completedSteps, requiredDocs: REQUIRED_DOCS, profile: p, documents: docs });
});

essRoutes.post("/onboarding/save", v("json", onboardingSaveSchema), async (c) => {
  const { step, data } = c.req.valid("json");
  const parsed = stepSchemas[step].safeParse(data);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw badRequest(i ? `${i.path.join(".")}: ${i.message}` : "Invalid input", parsed.error.issues);
  }
  const { tid, eid } = me(c);
  const db = c.get("db");
  const [inv] = await db.select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.employeeId, eid)));
  if (inv && (inv.status === "submitted" || inv.status === "verified")) throw badRequest("Your details are already submitted. Contact HR to change them.");
  const values = parsed.data as Record<string, unknown>;
  const patch: Record<string, unknown> = { ...values };
  if (step === "bank") {
    delete patch.accountNumber;
    Object.assign(patch, await bankFields(values.accountNumber as string, c.env.ENCRYPTION_KEY), { bankVerified: false });
  }
  if (step === "personal") patch.fullName = [values.firstName, values.lastName].filter(Boolean).join(" ");
  await db.update(employees).set(patch).where(and(eq(employees.id, eid), eq(employees.tenantId, tid)));
  const row = await refreshOnboarding(c, step);
  return c.json({ progress: row?.progress ?? 0, completedSteps: row?.completedSteps ?? [] });
});

essRoutes.post("/onboarding/submit", async (c) => {
  const row = await refreshOnboarding(c);
  if (!row) throw notFound("Onboarding");
  if (row.status === "submitted") return c.json({ ok: true });
  const missing = ALL_STEPS.filter((s) => !row.completedSteps.includes(s));
  if (missing.length) throw badRequest(`Finish these steps first: ${missing.join(", ")}`);
  await c.get("db").update(onboardingInvites).set({ status: "submitted", submittedAt: new Date(), progress: 100 }).where(eq(onboardingInvites.id, row.id));
  await audit(c, { action: "onboarding.submit", entity: "employee", entityId: me(c).eid, summary: "Submitted joining details" });
  return c.json({ ok: true });
});

// ---------- my salary ----------
essRoutes.get("/salary", async (c) => {
  const { tid, eid } = me(c);
  const db = c.get("db");
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tid));
  if (!essSalaryVisible(t?.settings)) throw new ApiError(403, "Your company doesn't show salary details here. Ask HR for your salary letter.", "salary_hidden");
  const out = await mySalary(db, tid, eid);
  if (!out) throw notFound("Employee");
  return c.json(out);
});

// ---------- payslips ----------
const published = sql`${payrollRuns.publishedAt} is not null and ${payrollRuns.status} in ('approved','paid')`;

essRoutes.get("/payslips", async (c) => {
  const { tid, eid } = me(c);
  const rows = await c
    .get("db")
    .select({ runId: payrollRuns.id, month: payrollRuns.month, payDate: payrollRuns.payDate, status: payrollRuns.status, gross: payrollItems.gross, net: payrollItems.net, totalDeductions: payrollItems.totalDeductions, onHold: payrollItems.onHold })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tid), eq(payrollItems.employeeId, eid), published))
    .orderBy(desc(payrollRuns.month));
  return c.json(rows);
});

essRoutes.get("/payslips/:runId", async (c) => {
  const { tid, eid } = me(c);
  const [row] = await c
    .get("db")
    .select({ run: payrollRuns, item: payrollItems })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, tid), eq(payrollItems.employeeId, eid), eq(payrollRuns.id, c.req.param("runId")), published));
  if (!row) throw notFound("Payslip");
  return c.json(await payslipView(c, row.run, row.item));
});
