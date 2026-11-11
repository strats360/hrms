import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { employeeLoans, employees, loanRepayments, payrollRuns, tenants } from "@hrms/db";
import {
  addMonths,
  inr,
  LOAN_STATUS_LABEL,
  LOAN_TYPE_LABEL,
  loanApproveSchema,
  loanCreateSchema,
  loanDisburseSchema,
  loanLimitError,
  loanPolicySchema,
  loanRepaymentSchema,
  loanRequestSchema,
  PERQUISITE_LOAN_LIMIT,
  todayIST,
  type LoanStatus,
  type LoanType,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { closeRepaidLoans, loanPolicy, loanSummary, nextLoanCode, recoveredFor, type Loan } from "../services/loans";
import { monthlyPay } from "../services/pay-extras";
import { sendNotification } from "../services/notifications";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;
const thisMonth = () => todayIST().slice(0, 7);

/** The month after the last locked payroll: the earliest a recovery can start or be paused. */
async function firstOpenMonth(c: Context<AppEnv>) {
  const [last] = await c.get("db").select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid(c)), inArray(payrollRuns.status, ["approved", "paid"]))).orderBy(desc(payrollRuns.month)).limit(1);
  const next = last ? addMonths(last.month, 1) : thisMonth();
  return next > thisMonth() ? next : thisMonth();
}

async function view(c: Context<AppEnv>, loans: Loan[]) {
  const rec = await recoveredFor(c.get("db"), loans.map((l) => l.id));
  return loans.map((l) => {
    const r = rec.get(l.id)!;
    const s = loanSummary(l, r);
    const next = l.status === "active" ? s.schedule.find((x) => !r.payroll.some((p) => p.month === x.month)) : undefined;
    return { ...l, statusLabel: LOAN_STATUS_LABEL[l.status as LoanStatus], typeLabel: LOAN_TYPE_LABEL[l.type as LoanType], emi: s.emi, payable: s.payable, recovered: s.recovered, pending: s.pending, outstanding: ["active", "approved"].includes(l.status) ? s.outstanding : 0, nextMonth: next?.month ?? null, endMonth: s.schedule.at(-1)?.month ?? null };
  });
}

async function mail(c: Context<AppEnv>, loan: Loan, subject: string, paragraphs: string[]) {
  try {
    const [e] = await c.get("db").select({ email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, loan.employeeId));
    if (!e) return;
    const { html, text } = layout({ company: "Strats360 People", heading: subject, paragraphs: [`Hi ${e.first},`, ...paragraphs], cta: { label: "Open self-service", url: `${c.env.APP_URL}/me/payslips?view=loans` } });
    await sendNotification(c, "loan_updates", { to: e.email, subject, html, text });
  } catch (err) {
    console.error("loan email failed", err);
  }
}

async function load(c: Context<AppEnv>, id: string) {
  const [l] = await c.get("db").select().from(employeeLoans).where(and(eq(employeeLoans.id, id), eq(employeeLoans.tenantId, tid(c))));
  if (!l) throw notFound("Loan");
  return l;
}

// ---------------------------------------------------------------------------
// HR and payroll
// ---------------------------------------------------------------------------
export const loanRoutes = new Hono<AppEnv>();

loanRoutes.get("/", requirePerm("payroll", "view"), v("query", z.object({ status: z.enum(["open", "all"]).default("open") })), async (c) => {
  const db = c.get("db");
  const q = c.req.valid("query");
  const rows = await db
    .select({ l: employeeLoans, name: employees.fullName, code: employees.employeeCode })
    .from(employeeLoans)
    .innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
    .where(and(eq(employeeLoans.tenantId, tid(c)), ...(q.status === "open" ? [inArray(employeeLoans.status, ["requested", "approved", "active"])] : [])))
    .orderBy(desc(employeeLoans.createdAt));
  const v2 = await view(c, rows.map((r) => r.l));
  const list = v2.map((l, i) => ({ ...l, employeeName: rows[i]!.name, employeeCode: rows[i]!.code }));
  const active = list.filter((l) => l.status === "active");
  return c.json({
    rows: list,
    summary: { requested: list.filter((l) => l.status === "requested").length, active: active.length, outstanding: active.reduce((s, l) => s + l.outstanding, 0), monthly: active.reduce((s, l) => s + Math.min(l.emi, l.outstanding), 0) },
    policy: await loanPolicy(db, tid(c)),
    firstOpenMonth: await firstOpenMonth(c),
  });
});

loanRoutes.put("/policy", requirePerm("payroll", "configure"), v("json", loanPolicySchema), async (c) => {
  const b = c.req.valid("json");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ loanPolicy: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "loans.policy", entity: "tenant", entityId: tid(c), summary: `Loan rules: advances up to ${b.advanceMaxPctOfGross}% of gross over ${b.advanceMaxMonths} months, loans up to ${b.loanMaxMonthsOfGross} months' gross over ${b.loanMaxMonths} months at ${b.loanInterestPct}%${b.requests ? "" : ", no self-service requests"}`, data: b });
  return c.json(b);
});

loanRoutes.get("/:id", requirePerm("payroll", "view"), async (c) => {
  const db = c.get("db");
  const l = await load(c, c.req.param("id"));
  const [e] = await db.select({ name: employees.fullName, code: employees.employeeCode, status: employees.status }).from(employees).where(eq(employees.id, l.employeeId));
  const rec = (await recoveredFor(db, [l.id])).get(l.id)!;
  const s = loanSummary(l, rec);
  const [summary] = await view(c, [l]);
  // other open loans for the same person, for the perquisite check
  const [others] = await db
    .select({ s: sql<number>`coalesce(sum(${employeeLoans.amount}),0)::float` })
    .from(employeeLoans)
    .where(and(eq(employeeLoans.employeeId, l.employeeId), inArray(employeeLoans.status, ["approved", "active"])));
  const warnings: string[] = [];
  if ((others?.s ?? 0) > PERQUISITE_LOAN_LIMIT && Number(l.interestPct) < 9) warnings.push(`This person's loans add up to more than ${inr(PERQUISITE_LOAN_LIMIT)} at a concessional rate. The interest saved is a taxable perquisite (Rule 3(7)(i)); add it to their taxable salary.`);
  if (e?.status === "notice") warnings.push("This employee is serving notice. What's left is recovered in their full and final settlement.");
  return c.json({ loan: summary, employee: e, schedule: s.schedule.map((x) => ({ ...x, recovered: rec.payroll.find((p) => p.month === x.month) ?? null })), payroll: rec.payroll, repayments: rec.repayments, warnings, firstOpenMonth: await firstOpenMonth(c) });
});

loanRoutes.post("/", requirePerm("payroll", "edit"), v("json", loanCreateSchema.extend({ paid: loanDisburseSchema.optional() })), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [e] = await db.select({ id: employees.id, name: employees.fullName, status: employees.status }).from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  if (["exited", "inactive"].includes(e.status)) throw badRequest(`${e.name} has left`);
  if (b.startMonth < (await firstOpenMonth(c))) throw badRequest("Payroll for that month is already locked. Start the recovery from a later month.");
  const [row] = await db
    .insert(employeeLoans)
    .values({ tenantId: tid(c), employeeId: e.id, code: await nextLoanCode(db, tid(c), b.type), type: b.type, status: b.paid ? "active" : "approved", amount: b.amount, interestPct: b.interestPct, months: b.months, startMonth: b.startMonth, reason: b.reason, requestedBy: uid(c), decidedBy: uid(c), decidedAt: new Date(), ...(b.paid ? { paidOn: b.paid.paidOn, paidMethod: b.paid.method, paidReference: b.paid.reference ?? null } : {}) })
    .returning();
  await audit(c, { action: "loans.create", entity: "employee_loan", entityId: row!.id, summary: `${LOAN_TYPE_LABEL[b.type]} ${row!.code} of ${inr(b.amount)} for ${e.name}, ${b.months} months from ${b.startMonth}` });
  return c.json(row, 201);
});

loanRoutes.post("/:id/decision", requirePerm("payroll", "approve"), v("json", z.discriminatedUnion("decision", [loanApproveSchema.extend({ decision: z.literal("approved") }), z.object({ decision: z.literal("rejected"), note: z.string().trim().min(3, "Give a reason").max(500) })])), async (c) => {
  const l = await load(c, c.req.param("id"));
  if (l.status !== "requested") throw conflict("This request has already been decided");
  const b = c.req.valid("json");
  const db = c.get("db");
  if (b.decision === "rejected") {
    await db.update(employeeLoans).set({ status: "rejected", decidedBy: uid(c), decidedAt: new Date(), decisionNote: b.note }).where(eq(employeeLoans.id, l.id));
    await mail(c, l, `${LOAN_TYPE_LABEL[l.type as LoanType]} request not approved`, [`Your request ${l.code} for ${inr(Number(l.amount))} wasn't approved: ${b.note}`]);
  } else {
    if (b.startMonth < (await firstOpenMonth(c))) throw badRequest("Payroll for that month is already locked. Start the recovery from a later month.");
    await db.update(employeeLoans).set({ status: "approved", amount: b.amount, months: b.months, interestPct: b.interestPct, startMonth: b.startMonth, decidedBy: uid(c), decidedAt: new Date(), decisionNote: b.note ?? null }).where(eq(employeeLoans.id, l.id));
    await mail(c, l, `${LOAN_TYPE_LABEL[l.type as LoanType]} approved`, [`Your request ${l.code} is approved for ${inr(b.amount)}, recovered over ${b.months} month${b.months === 1 ? "" : "s"} from your ${b.startMonth} salary.`, "You'll get another email when it's paid out."]);
  }
  await audit(c, { action: `loans.${b.decision}`, entity: "employee_loan", entityId: l.id, summary: `${b.decision === "approved" ? "Approved" : "Rejected"} ${l.code}` });
  return c.json({ ok: true });
});

loanRoutes.post("/:id/disburse", requirePerm("payroll", "edit"), v("json", loanDisburseSchema), async (c) => {
  const l = await load(c, c.req.param("id"));
  if (l.status !== "approved") throw conflict(l.status === "active" ? "This has already been paid out" : "Approve it first");
  const b = c.req.valid("json");
  await c.get("db").update(employeeLoans).set({ status: "active", paidOn: b.paidOn, paidMethod: b.method, paidReference: b.reference ?? null }).where(eq(employeeLoans.id, l.id));
  await mail(c, l, `${LOAN_TYPE_LABEL[l.type as LoanType]} paid out`, [`${inr(Number(l.amount))} (${l.code}) was paid to you on ${b.paidOn}. Recovery starts with your ${l.startMonth} salary.`]);
  await audit(c, { action: "loans.disburse", entity: "employee_loan", entityId: l.id, summary: `Paid out ${l.code}: ${inr(Number(l.amount))} on ${b.paidOn} (${b.method.replace("_", " ")}${b.reference ? `, ${b.reference}` : ""})` });
  return c.json({ ok: true });
});

/** Pause (or resume) the recovery for one month; the rest of the schedule moves back. */
loanRoutes.post("/:id/pause", requirePerm("payroll", "edit"), v("json", z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), paused: z.boolean() })), async (c) => {
  const l = await load(c, c.req.param("id"));
  if (!["approved", "active"].includes(l.status)) throw badRequest("Only a loan being recovered can be paused");
  const b = c.req.valid("json");
  if (b.month < (await firstOpenMonth(c))) throw badRequest("Payroll for that month is already locked");
  const skip = new Set(l.skipMonths ?? []);
  if (b.paused) skip.add(b.month);
  else skip.delete(b.month);
  await c.get("db").update(employeeLoans).set({ skipMonths: [...skip].sort() }).where(eq(employeeLoans.id, l.id));
  await audit(c, { action: "loans.pause", entity: "employee_loan", entityId: l.id, summary: `${b.paused ? "Paused" : "Resumed"} ${l.code} recovery for ${b.month}` });
  return c.json({ skipMonths: [...skip].sort() });
});

loanRoutes.post("/:id/repayment", requirePerm("payroll", "edit"), v("json", loanRepaymentSchema), async (c) => {
  const l = await load(c, c.req.param("id"));
  if (l.status !== "active") throw badRequest("Only a loan being recovered can take a repayment");
  const b = c.req.valid("json");
  const db = c.get("db");
  const s = loanSummary(l, (await recoveredFor(db, [l.id])).get(l.id)!);
  if (b.amount > s.afterOpenPayroll) throw badRequest(`That's more than what's left (${inr(s.afterOpenPayroll)}${s.pending ? ` after ${inr(s.pending)} in payroll not yet locked` : ""})`);
  await db.insert(loanRepayments).values({ tenantId: tid(c), loanId: l.id, amount: b.amount, paidOn: b.paidOn, source: "manual", note: b.note ?? null, createdBy: uid(c) });
  const closed = await closeRepaidLoans(db, tid(c), [l.id]);
  await audit(c, { action: "loans.repayment", entity: "employee_loan", entityId: l.id, summary: `Recorded ${inr(b.amount)} repaid on ${l.code}${closed ? " (now fully repaid)" : ""}` });
  return c.json({ ok: true, closed: closed > 0 }, 201);
});

loanRoutes.post("/:id/write-off", requirePerm("payroll", "approve"), v("json", z.object({ note: z.string().trim().min(3, "Give a reason").max(500) })), async (c) => {
  const l = await load(c, c.req.param("id"));
  if (l.status !== "active") throw badRequest("Only a loan being recovered can be written off");
  const db = c.get("db");
  const s = loanSummary(l, (await recoveredFor(db, [l.id])).get(l.id)!);
  await db.update(employeeLoans).set({ status: "written_off", closedOn: todayIST(), decisionNote: c.req.valid("json").note }).where(eq(employeeLoans.id, l.id));
  await audit(c, { action: "loans.write_off", entity: "employee_loan", entityId: l.id, summary: `Wrote off ${inr(s.outstanding)} on ${l.code}: ${c.req.valid("json").note}` });
  return c.json({ ok: true, writtenOff: s.outstanding });
});

loanRoutes.post("/:id/cancel", requirePerm("payroll", "edit"), async (c) => {
  const l = await load(c, c.req.param("id"));
  if (!["requested", "approved"].includes(l.status)) throw badRequest("Only a loan that hasn't been paid out can be cancelled");
  await c.get("db").update(employeeLoans).set({ status: "cancelled" }).where(eq(employeeLoans.id, l.id));
  await audit(c, { action: "loans.cancel", entity: "employee_loan", entityId: l.id, summary: `Cancelled ${l.code}` });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------
export const essLoanRoutes = new Hono<AppEnv>();
essLoanRoutes.use("*", requireEmployee);

essLoanRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  const loans = await db.select().from(employeeLoans).where(and(eq(employeeLoans.tenantId, tid(c)), eq(employeeLoans.employeeId, eid))).orderBy(desc(employeeLoans.createdAt));
  const policy = await loanPolicy(db, tid(c));
  const gross = (await monthlyPay(db, tid(c), [eid], todayIST())).get(eid)?.gross ?? 0;
  const rows = (await view(c, loans)).map(({ requestedBy, decidedBy, ...l }) => (void requestedBy, void decidedBy, l));
  return c.json({
    rows,
    policy: { requests: policy.requests, advanceMax: Math.round((gross * policy.advanceMaxPctOfGross) / 100), advanceMaxMonths: policy.advanceMaxMonths, loanMax: Math.round(gross * policy.loanMaxMonthsOfGross), loanMaxMonths: policy.loanMaxMonths, interestPct: policy.loanInterestPct },
  });
});

essLoanRoutes.post("/", v("json", loanRequestSchema), async (c) => {
  const db = c.get("db");
  const eid = c.get("tenant").employeeId!;
  const b = c.req.valid("json");
  const policy = await loanPolicy(db, tid(c));
  if (!policy.requests) throw badRequest("Your company handles loans and advances through HR. Ask them directly.");
  const [e] = await db.select({ status: employees.status, name: employees.fullName }).from(employees).where(eq(employees.id, eid));
  if (e && ["notice", "exited", "inactive"].includes(e.status)) throw badRequest("Loans and advances aren't available during the notice period");
  const [open] = await db.select({ code: employeeLoans.code }).from(employeeLoans).where(and(eq(employeeLoans.employeeId, eid), eq(employeeLoans.type, b.type), inArray(employeeLoans.status, ["requested", "approved"])));
  if (open) throw conflict(`You already have ${open.code} waiting. Wait for it to be decided or paid out first.`);
  const gross = (await monthlyPay(db, tid(c), [eid], todayIST())).get(eid)?.gross ?? 0;
  const err = loanLimitError(policy, b.type, b.amount, b.months, gross);
  if (err) throw badRequest(err);
  const [row] = await db
    .insert(employeeLoans)
    .values({ tenantId: tid(c), employeeId: eid, code: await nextLoanCode(db, tid(c), b.type), type: b.type, status: "requested", amount: b.amount, interestPct: b.type === "loan" ? policy.loanInterestPct : 0, months: b.months, startMonth: await firstOpenMonth(c), reason: b.reason, requestedBy: uid(c) })
    .returning();
  await audit(c, { action: "loans.request", entity: "employee_loan", entityId: row!.id, summary: `${e?.name} asked for a ${LOAN_TYPE_LABEL[b.type].toLowerCase()} of ${inr(b.amount)} over ${b.months} months` });
  return c.json(row, 201);
});

essLoanRoutes.post("/:id/cancel", async (c) => {
  const db = c.get("db");
  const [l] = await db.select().from(employeeLoans).where(and(eq(employeeLoans.id, c.req.param("id")), eq(employeeLoans.employeeId, c.get("tenant").employeeId!)));
  if (!l) throw notFound("Request");
  if (l.status !== "requested") throw badRequest("Only a request that's still waiting can be withdrawn");
  await db.update(employeeLoans).set({ status: "cancelled" }).where(eq(employeeLoans.id, l.id));
  return c.json({ ok: true });
});
